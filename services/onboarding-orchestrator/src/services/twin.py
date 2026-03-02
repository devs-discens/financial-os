import asyncpg
import json
import logging
from datetime import datetime, timezone, timedelta
from decimal import Decimal

logger = logging.getLogger("onboarding")

# FDX account categories: assets vs liabilities
ASSET_CATEGORIES = {"DEPOSIT_ACCOUNT"}
LIABILITY_CATEGORIES = {"LOAN_ACCOUNT", "LOC_ACCOUNT"}


def _to_float(val) -> float:
    """Convert Decimal/int/None to float for JSON serialization."""
    if val is None:
        return 0.0
    return float(val)


async def get_twin_snapshot(pool: asyncpg.Pool, user_id: str) -> dict:
    """
    Return the full Digital Financial Twin for a user.
    Includes connections, current accounts, and computed metrics.
    """
    logger.debug("Twin → snapshot for user=%s", user_id)

    # Active connections
    connections = await pool.fetch(
        """SELECT c.id, c.institution_id, c.status, c.connected_at, c.last_poll_at,
                  t.institution_name
           FROM connections c
           JOIN institution_templates t ON t.institution_id = c.institution_id
           WHERE c.user_id = $1 AND c.status = 'active'
           ORDER BY c.connected_at""",
        user_id,
    )

    # Current accounts (SCD2: valid_to IS NULL)
    accounts = await pool.fetch(
        """SELECT ca.id, ca.connection_id, ca.account_id, ca.account_type,
                  ca.account_category, ca.display_name, ca.masked_number,
                  ca.currency, ca.balance, ca.balance_type, ca.valid_from,
                  ca.raw_data, c.institution_id
           FROM connected_accounts ca
           JOIN connections c ON c.id = ca.connection_id
           WHERE c.user_id = $1 AND ca.valid_to IS NULL
           ORDER BY ca.connection_id, ca.account_id""",
        user_id,
    )

    # Holdings (investment positions)
    holdings = await pool.fetch(
        """SELECT h.id, h.connection_id, h.account_id, h.symbol, h.name,
                  h.asset_class, h.quantity, h.cost_basis, h.market_value,
                  h.currency, h.as_of, c.institution_id
           FROM twin_holdings h
           JOIN connections c ON c.id = h.connection_id
           WHERE c.user_id = $1
           ORDER BY h.account_id, h.symbol""",
        user_id,
    )
    holdings_list = [dict(r) for r in holdings]

    # Compute live metrics from current data
    metrics = _compute_balance_metrics(accounts)

    # Add investment breakdown if holdings exist
    if holdings_list:
        metrics["investment_breakdown"] = _compute_holdings_breakdown(holdings_list)

    # Transaction counts per account
    txn_count = await pool.fetchval(
        """SELECT COUNT(*) FROM twin_transactions tt
           JOIN connections c ON c.id = tt.connection_id
           WHERE c.user_id = $1""",
        user_id,
    )

    # Active goals
    goals = await pool.fetch(
        """SELECT id, raw_text, summary_label, goal_type, target_amount,
                  target_date, feasibility, feasibility_assessment,
                  cross_goal_impact, progress_pct, status, created_at
           FROM user_goals
           WHERE user_id = $1 AND status = 'active'
           ORDER BY created_at DESC""",
        user_id,
    )
    goals_list = [dict(r) for r in goals]

    conn_list = [dict(r) for r in connections]
    acct_list = [dict(r) for r in accounts]

    institution_ids = {c["institution_id"] for c in conn_list}

    snapshot = {
        "user_id": user_id,
        "snapshot_at": datetime.now(timezone.utc).isoformat(),
        "connections": conn_list,
        "accounts": acct_list,
        "holdings": holdings_list,
        "goals": goals_list,
        "metrics": metrics,
        "account_count": len(acct_list),
        "institution_count": len(institution_ids),
        "transaction_count": txn_count or 0,
    }

    logger.info(
        "Twin ← snapshot user=%s connections=%d accounts=%d institutions=%d",
        user_id, len(conn_list), len(acct_list), len(institution_ids),
    )
    return snapshot


def _extract_property_value(acct) -> float:
    """Extract propertyValue from raw_data for mortgage accounts."""
    raw = acct.get("raw_data")
    if raw is None:
        return 0.0
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return 0.0
    return float(raw.get("propertyValue", 0) or 0)


def _compute_balance_metrics(accounts) -> dict:
    """Compute financial metrics from current account balances.

    For LOAN_ACCOUNT mortgages with a propertyValue, the property is counted
    as an asset (home equity = propertyValue) and the principal owed as a
    liability.  This avoids the misleading result of a mortgage-holder
    showing deeply negative net worth.
    """
    total_assets = Decimal(0)
    total_liabilities = Decimal(0)
    asset_breakdown = {}
    liability_breakdown = {}

    for acct in accounts:
        balance = acct["balance"] or Decimal(0)
        acct_id = acct["account_id"]
        category = acct["account_category"]
        institution = acct["institution_id"]
        label = f"{institution}/{acct_id}"

        if category in ASSET_CATEGORIES:
            total_assets += balance
            asset_breakdown[label] = _to_float(balance)
        elif category in LIABILITY_CATEGORIES:
            total_liabilities += abs(balance)
            liability_breakdown[label] = _to_float(abs(balance))

            # Mortgage with property value: count the property as an asset
            prop_value = _extract_property_value(acct)
            if prop_value > 0:
                prop_label = f"{institution}/{acct_id}:property"
                total_assets += Decimal(str(prop_value))
                asset_breakdown[prop_label] = prop_value
        else:
            # Default: positive = asset, negative = liability
            if balance >= 0:
                total_assets += balance
                asset_breakdown[label] = _to_float(balance)
            else:
                total_liabilities += abs(balance)
                liability_breakdown[label] = _to_float(abs(balance))

    net_worth = total_assets - total_liabilities

    return {
        "net_worth": _to_float(net_worth),
        "total_assets": _to_float(total_assets),
        "total_liabilities": _to_float(total_liabilities),
        "asset_breakdown": asset_breakdown,
        "liability_breakdown": liability_breakdown,
    }


def _compute_holdings_breakdown(holdings: list[dict]) -> dict:
    """Compute investment breakdown from holdings: totals by asset class and account."""
    total_market_value = 0.0
    total_cost_basis = 0.0
    by_asset_class: dict[str, float] = {}
    by_account: dict[str, float] = {}

    for h in holdings:
        mv = float(h.get("market_value", 0) or 0)
        cb = float(h.get("cost_basis", 0) or 0)
        total_market_value += mv
        total_cost_basis += cb

        asset_class = h.get("asset_class", "other")
        by_asset_class[asset_class] = by_asset_class.get(asset_class, 0) + mv

        acct = h.get("account_id", "unknown")
        by_account[acct] = by_account.get(acct, 0) + mv

    return {
        "total_market_value": round(total_market_value, 2),
        "total_cost_basis": round(total_cost_basis, 2),
        "unrealized_gain": round(total_market_value - total_cost_basis, 2),
        "by_asset_class": {k: round(v, 2) for k, v in by_asset_class.items()},
        "by_account": {k: round(v, 2) for k, v in by_account.items()},
    }


async def compute_metrics(pool: asyncpg.Pool, user_id: str) -> dict:
    """
    Compute and store a metrics snapshot for the user.
    Calculates net_worth, total_assets, total_liabilities from account balances
    and monthly_income/monthly_expenses from recent transactions.
    Returns the computed metrics dict.
    """
    logger.debug("Twin → compute_metrics for user=%s", user_id)

    # Current accounts
    accounts = await pool.fetch(
        """SELECT ca.account_id, ca.account_category, ca.balance,
                  ca.raw_data, c.institution_id
           FROM connected_accounts ca
           JOIN connections c ON c.id = ca.connection_id
           WHERE c.user_id = $1 AND ca.valid_to IS NULL""",
        user_id,
    )

    balance_metrics = _compute_balance_metrics(accounts)

    # Monthly income/expenses from last 30 days of transactions
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    txn_summary = await pool.fetch(
        """SELECT tt.transaction_type, tt.category, SUM(tt.amount) as total
           FROM twin_transactions tt
           JOIN connections c ON c.id = tt.connection_id
           WHERE c.user_id = $1 AND tt.posted_date >= $2
           GROUP BY tt.transaction_type, tt.category""",
        user_id, cutoff.date(),
    )

    monthly_income = Decimal(0)
    monthly_expenses = Decimal(0)
    income_breakdown = {}
    expense_breakdown = {}

    for row in txn_summary:
        total = row["total"] or Decimal(0)
        cat = row["category"] or "uncategorized"
        if row["transaction_type"] == "CREDIT":
            monthly_income += total
            income_breakdown[cat] = _to_float(total)
        elif row["transaction_type"] == "DEBIT":
            monthly_expenses += total
            expense_breakdown[cat] = _to_float(total)

    # Store each metric as an append-only snapshot
    metrics_to_store = [
        ("net_worth", balance_metrics["net_worth"], {
            "assets": balance_metrics["asset_breakdown"],
            "liabilities": balance_metrics["liability_breakdown"],
        }),
        ("total_assets", balance_metrics["total_assets"], balance_metrics["asset_breakdown"]),
        ("total_liabilities", balance_metrics["total_liabilities"], balance_metrics["liability_breakdown"]),
        ("monthly_income", _to_float(monthly_income), income_breakdown),
        ("monthly_expenses", _to_float(monthly_expenses), expense_breakdown),
    ]

    # Compute debt-to-income if we have income
    if monthly_income > 0:
        annual_income = monthly_income * 12
        dti = float(balance_metrics["total_liabilities"]) / float(annual_income)
        metrics_to_store.append(("debt_to_income_ratio", round(dti, 4), {
            "total_liabilities": balance_metrics["total_liabilities"],
            "annual_income": _to_float(annual_income),
        }))

    for metric_type, metric_value, breakdown in metrics_to_store:
        await pool.execute(
            """INSERT INTO twin_metrics (user_id, metric_type, metric_value, breakdown)
               VALUES ($1, $2, $3, $4)""",
            user_id, metric_type, metric_value, json.dumps(breakdown),
        )

    result = {
        **balance_metrics,
        "monthly_income": _to_float(monthly_income),
        "monthly_expenses": _to_float(monthly_expenses),
    }

    logger.info(
        "Twin ← metrics computed for user=%s: net_worth=%.2f assets=%.2f liabilities=%.2f",
        user_id, result["net_worth"], result["total_assets"], result["total_liabilities"],
    )
    return result


# Progress metric constants
ESSENTIAL_CATEGORIES = {
    "rent", "mortgage", "utilities", "groceries", "transit",
    "insurance", "healthcare", "childcare",
}

TIER_THRESHOLDS = [
    (80, "Flourishing"),
    (60, "Thriving"),
    (40, "Growing"),
    (20, "Building"),
    (0, "Starting Out"),
]

TIER_QUOTES = {
    "Flourishing": "Your financial garden is in full bloom.",
    "Thriving": "Strong roots, steady growth — you're thriving.",
    "Growing": "Every smart choice compounds. Keep going.",
    "Building": "Brick by brick, your foundation is forming.",
    "Starting Out": "The best time to start is now. You're here.",
}

# Score weights
SCORE_WEIGHTS = {
    "savings_rate": 0.25,
    "emergency_fund": 0.25,
    "dti_trend": 0.20,
    "credit_utilization": 0.15,
    "consistency": 0.15,
}


def _score_savings_rate(rate: float) -> float:
    """Score savings rate 0-100. 20%+ = perfect."""
    if rate <= 0:
        return 0
    return min(rate / 0.20 * 100, 100)


def _score_emergency_fund(months: float) -> float:
    """Score emergency fund 0-100. 6+ months = perfect."""
    if months <= 0:
        return 0
    return min(months / 6.0 * 100, 100)


def _score_dti(dti: float, prev_dti: float | None) -> float:
    """Score DTI 0-100. Lower is better. Improving trend gives bonus."""
    if dti <= 0:
        base = 100
    elif dti >= 0.50:
        base = 0
    else:
        base = max(0, (0.50 - dti) / 0.50 * 100)

    # Trend bonus: improving DTI gets up to 15 bonus points
    if prev_dti is not None and prev_dti > 0 and dti < prev_dti:
        improvement = (prev_dti - dti) / prev_dti
        base = min(100, base + improvement * 50)

    return base


def _score_credit_utilization(util: float) -> float:
    """Score credit utilization 0-100. Under 30% = good, under 10% = perfect."""
    if util <= 0:
        return 100
    if util >= 0.75:
        return 0
    if util <= 0.10:
        return 100
    if util <= 0.30:
        return 70 + (0.30 - util) / 0.20 * 30
    return max(0, (0.75 - util) / 0.45 * 70)


def _score_consistency(positive_months: int, total_months: int) -> float:
    """Score consistency 0-100 based on how many months had positive savings."""
    if total_months == 0:
        return 50  # neutral start
    return min(positive_months / max(total_months, 1) * 100, 100)


def _get_tier(score: float) -> str:
    for threshold, name in TIER_THRESHOLDS:
        if score >= threshold:
            return name
    return "Starting Out"


async def compute_progress_metrics(pool: asyncpg.Pool, user_id: str) -> dict:
    """
    Compute progress-specific metrics from twin data: savings rate,
    emergency fund months, credit utilization, composite score, and tier.
    Stores results as new metric_type rows in twin_metrics (append-only).
    """
    logger.debug("Twin → compute_progress_metrics for user=%s", user_id)

    # Fetch latest computed metrics
    latest = await pool.fetch(
        """SELECT DISTINCT ON (metric_type)
                  metric_type, metric_value, breakdown, computed_at
           FROM twin_metrics
           WHERE user_id = $1
           ORDER BY metric_type, computed_at DESC""",
        user_id,
    )
    metrics_map = {r["metric_type"]: r for r in latest}

    monthly_income = float(metrics_map.get("monthly_income", {}).get("metric_value", 0) or 0)
    monthly_expenses = float(metrics_map.get("monthly_expenses", {}).get("metric_value", 0) or 0)

    # -- Savings rate --
    savings_rate = 0.0
    if monthly_income > 0:
        savings_rate = round((monthly_income - monthly_expenses) / monthly_income, 4)

    # -- Emergency fund months --
    # Liquid deposits / monthly essential spending
    deposit_balances = await pool.fetch(
        """SELECT ca.balance FROM connected_accounts ca
           JOIN connections c ON c.id = ca.connection_id
           WHERE c.user_id = $1 AND ca.valid_to IS NULL
             AND ca.account_category = 'DEPOSIT_ACCOUNT'""",
        user_id,
    )
    liquid_deposits = sum(float(r["balance"] or 0) for r in deposit_balances)

    # Essential spending from expense breakdown
    expense_row = metrics_map.get("monthly_expenses")
    monthly_essentials = 0.0
    if expense_row:
        breakdown = expense_row["breakdown"]
        if isinstance(breakdown, str):
            breakdown = json.loads(breakdown)
        for cat, amount in breakdown.items():
            if cat.lower() in ESSENTIAL_CATEGORIES:
                monthly_essentials += abs(float(amount))

    # If no essentials breakdown, estimate as 60% of total expenses
    if monthly_essentials == 0 and monthly_expenses > 0:
        monthly_essentials = monthly_expenses * 0.60

    emergency_fund_months = 0.0
    if monthly_essentials > 0:
        emergency_fund_months = round(liquid_deposits / monthly_essentials, 1)

    # -- Credit utilization --
    credit_accounts = await pool.fetch(
        """SELECT ca.balance, ca.raw_data FROM connected_accounts ca
           JOIN connections c ON c.id = ca.connection_id
           WHERE c.user_id = $1 AND ca.valid_to IS NULL
             AND ca.account_category = 'LOC_ACCOUNT'""",
        user_id,
    )
    total_credit_used = 0.0
    total_credit_limit = 0.0
    for acct in credit_accounts:
        total_credit_used += abs(float(acct["balance"] or 0))
        raw = acct["raw_data"]
        if isinstance(raw, str):
            raw = json.loads(raw)
        total_credit_limit += float(raw.get("creditLimit", 0) or 0)

    credit_utilization = 0.0
    if total_credit_limit > 0:
        credit_utilization = round(total_credit_used / total_credit_limit, 4)

    # -- DTI (use latest computed value) --
    dti_row = metrics_map.get("debt_to_income_ratio")
    current_dti = float(dti_row["metric_value"]) if dti_row else 0.0

    # Previous DTI for trend scoring
    prev_dti_row = await pool.fetchrow(
        """SELECT metric_value FROM twin_metrics
           WHERE user_id = $1 AND metric_type = 'debt_to_income_ratio'
           ORDER BY computed_at DESC OFFSET 1 LIMIT 1""",
        user_id,
    )
    prev_dti = float(prev_dti_row["metric_value"]) if prev_dti_row else None

    # -- Consistency: months with positive savings in history --
    savings_history = await pool.fetch(
        """SELECT metric_value FROM twin_metrics
           WHERE user_id = $1 AND metric_type = 'savings_rate'
           ORDER BY computed_at DESC LIMIT 12""",
        user_id,
    )
    positive_months = sum(1 for r in savings_history if float(r["metric_value"]) > 0)
    total_months = len(savings_history)

    # -- Composite score --
    score_components = {
        "savings_rate": _score_savings_rate(savings_rate),
        "emergency_fund": _score_emergency_fund(emergency_fund_months),
        "dti_trend": _score_dti(current_dti, prev_dti),
        "credit_utilization": _score_credit_utilization(credit_utilization),
        "consistency": _score_consistency(positive_months, total_months),
    }

    progress_score = round(sum(
        score_components[k] * SCORE_WEIGHTS[k]
        for k in SCORE_WEIGHTS
    ), 1)

    progress_tier = _get_tier(progress_score)
    tier_quote = TIER_QUOTES.get(progress_tier, "")

    # Find next tier threshold
    next_tier_threshold = 100
    next_tier_name = None
    for threshold, name in TIER_THRESHOLDS:
        if threshold > progress_score:
            next_tier_threshold = threshold
            next_tier_name = name

    points_to_next = round(next_tier_threshold - progress_score, 1) if next_tier_name else 0

    # -- Store progress metrics --
    progress_metrics = [
        ("savings_rate", savings_rate, {
            "monthly_income": monthly_income,
            "monthly_expenses": monthly_expenses,
        }),
        ("emergency_fund_months", emergency_fund_months, {
            "liquid_deposits": liquid_deposits,
            "monthly_essentials": monthly_essentials,
        }),
        ("credit_utilization", credit_utilization, {
            "credit_used": total_credit_used,
            "credit_limit": total_credit_limit,
        }),
        ("progress_score", progress_score, {
            "components": score_components,
            "weights": SCORE_WEIGHTS,
            "tier": progress_tier,
            "tier_quote": tier_quote,
        }),
    ]

    for metric_type, metric_value, breakdown in progress_metrics:
        await pool.execute(
            """INSERT INTO twin_metrics (user_id, metric_type, metric_value, breakdown)
               VALUES ($1, $2, $3, $4)""",
            user_id, metric_type, metric_value, json.dumps(breakdown),
        )

    result = {
        "savings_rate": savings_rate,
        "emergency_fund_months": emergency_fund_months,
        "credit_utilization": credit_utilization,
        "dti": current_dti,
        "progress_score": progress_score,
        "progress_tier": progress_tier,
        "tier_quote": tier_quote,
        "next_tier": next_tier_name,
        "points_to_next": points_to_next,
        "score_components": score_components,
        "liquid_deposits": liquid_deposits,
        "monthly_essentials": monthly_essentials,
        "total_credit_used": total_credit_used,
        "total_credit_limit": total_credit_limit,
    }

    logger.info(
        "Twin ← progress metrics user=%s: score=%.1f tier=%s savings=%.2f%% emergency=%.1fmo",
        user_id, progress_score, progress_tier, savings_rate * 100, emergency_fund_months,
    )
    return result


async def get_metrics(pool: asyncpg.Pool, user_id: str) -> dict:
    """Get the latest metrics and their history for a user."""
    logger.debug("Twin → get_metrics for user=%s", user_id)

    # Latest value for each metric type
    latest = await pool.fetch(
        """SELECT DISTINCT ON (metric_type)
                  metric_type, metric_value, breakdown, computed_at
           FROM twin_metrics
           WHERE user_id = $1
           ORDER BY metric_type, computed_at DESC""",
        user_id,
    )

    # Full history (for trends)
    history = await pool.fetch(
        """SELECT metric_type, metric_value, computed_at
           FROM twin_metrics
           WHERE user_id = $1
           ORDER BY computed_at DESC
           LIMIT 100""",
        user_id,
    )

    current = {}
    for row in latest:
        breakdown = row["breakdown"]
        if isinstance(breakdown, str):
            breakdown = json.loads(breakdown)
        current[row["metric_type"]] = {
            "value": _to_float(row["metric_value"]),
            "breakdown": breakdown,
            "computed_at": row["computed_at"].isoformat() if row["computed_at"] else None,
        }

    return {
        "user_id": user_id,
        "current": current,
        "history": [dict(r) for r in history],
    }


async def get_account_history(
    pool: asyncpg.Pool, connection_id: int, account_id: str,
) -> list[dict]:
    """Return all SCD2 rows for an account — the full version history."""
    logger.debug(
        "Twin → account_history connection_id=%d account_id=%s",
        connection_id, account_id,
    )
    rows = await pool.fetch(
        """SELECT id, connection_id, account_id, account_type, account_category,
                  display_name, balance, balance_type, currency, raw_data,
                  valid_from, valid_to, pull_id
           FROM connected_accounts
           WHERE connection_id = $1 AND account_id = $2
           ORDER BY valid_from""",
        connection_id, account_id,
    )
    return [dict(r) for r in rows]


async def get_transactions(
    pool: asyncpg.Pool, user_id: str,
    account_id: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    category: str | None = None,
    limit: int = 200,
) -> list[dict]:
    """Query transactions across all accounts with optional filters."""
    logger.debug("Twin → get_transactions user=%s filters=(%s, %s, %s, %s)",
                 user_id, account_id, start_date, end_date, category)

    query = """
        SELECT tt.id, tt.connection_id, tt.account_id, tt.transaction_id,
               tt.posted_date, tt.amount, tt.description, tt.category,
               tt.transaction_type, tt.pulled_at, c.institution_id
        FROM twin_transactions tt
        JOIN connections c ON c.id = tt.connection_id
        WHERE c.user_id = $1
    """
    params: list = [user_id]
    idx = 2

    if account_id:
        query += f" AND tt.account_id = ${idx}"
        params.append(account_id)
        idx += 1

    if start_date:
        query += f" AND tt.posted_date >= ${idx}"
        params.append(start_date)
        idx += 1

    if end_date:
        query += f" AND tt.posted_date <= ${idx}"
        params.append(end_date)
        idx += 1

    if category:
        query += f" AND tt.category = ${idx}"
        params.append(category)
        idx += 1

    query += f" ORDER BY tt.posted_date DESC NULLS LAST LIMIT ${idx}"
    params.append(limit)

    rows = await pool.fetch(query, *params)
    logger.debug("Twin ← %d transactions for user=%s", len(rows), user_id)
    return [dict(r) for r in rows]
