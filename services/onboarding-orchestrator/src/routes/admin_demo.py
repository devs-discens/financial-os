"""
Admin Demo endpoints for bulk user setup, connect, reset, and transaction injection.
All endpoints require admin authentication.
"""

import json
import logging
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from ..db.database import get_pool
from ..config import settings
from ..middleware.auth import require_admin, AuthUser
from ..services.registry_client import RegistryClient
from ..services import template_discovery, oauth_flow, data_pull
from ..services import twin as twin_service
from ..services.http_client import get_http_client

logger = logging.getLogger("onboarding")
router = APIRouter(prefix="/admin/demo", tags=["admin-demo"])
registry = RegistryClient(settings.registry_url)

# ── Seed user → bank/account mapping ──

SEED_USER_BANK_MAP = {
    "sarah-johnson": {
        "maple-direct": ["mpl-sarah--chq-001", "mpl-sarah--visa-001"],  # no Mastercard
    },
    "marcus-williams": {
        "maple-direct": None,  # all accounts
        "heritage-financial": None,  # all (mortgage + HELOC)
    },
    "priya-patel": {
        "maple-direct": ["mpl-priya--chq-001"],  # chequing only
        "frontier-business": None,  # all biz accounts
    },
    "david-kim": {
        "maple-direct": None,
        "heritage-financial": None,
        "frontier-business": None,
    },
    "emma-rodriguez": {
        "heritage-financial": ["htg-emma-r-mtg-001"],  # mortgage only, no HELOC
    },
}

# ── Wealthsimple on-platform accounts + holdings ──

WEALTHSIMPLE_ACCOUNTS = {
    "alex-chen": {
        "accounts": [
            {"account_id": "ws-alex-tfsa-001", "display_name": "Tax-Free Savings Account", "type": "TFSA", "balance": 38500, "category": "DEPOSIT_ACCOUNT"},
            {"account_id": "ws-alex-rrsp-001", "display_name": "Registered Retirement Savings Plan", "type": "RRSP", "balance": 22100, "category": "DEPOSIT_ACCOUNT"},
            {"account_id": "ws-alex-chq-001", "display_name": "Wealthsimple Cash", "type": "CHEQUING", "balance": 1800, "category": "DEPOSIT_ACCOUNT"},
        ],
        "holdings": [
            {"account_id": "ws-alex-tfsa-001", "symbol": "XEQT", "name": "iShares Core Equity ETF Portfolio", "asset_class": "etf", "quantity": 800, "cost_basis": 19200, "market_value": 21600},
            {"account_id": "ws-alex-tfsa-001", "symbol": "VFV", "name": "Vanguard S&P 500 Index ETF", "asset_class": "etf", "quantity": 120, "cost_basis": 9000, "market_value": 10800},
            {"account_id": "ws-alex-tfsa-001", "symbol": "SHOP", "name": "Shopify Inc.", "asset_class": "equity", "quantity": 25, "cost_basis": 2200, "market_value": 2800},
            {"account_id": "ws-alex-tfsa-001", "symbol": "BTC", "name": "Bitcoin", "asset_class": "crypto", "quantity": 0.02, "cost_basis": 1500, "market_value": 1800},
            {"account_id": "ws-alex-tfsa-001", "symbol": "ETH", "name": "Ethereum", "asset_class": "crypto", "quantity": 0.5, "cost_basis": 900, "market_value": 1000},
            {"account_id": "ws-alex-tfsa-001", "symbol": "CASH", "name": "Cash Balance", "asset_class": "cash", "quantity": 1, "cost_basis": 500, "market_value": 500},
            {"account_id": "ws-alex-rrsp-001", "symbol": "VBAL", "name": "Vanguard Balanced ETF Portfolio", "asset_class": "etf", "quantity": 450, "cost_basis": 13500, "market_value": 14400},
            {"account_id": "ws-alex-rrsp-001", "symbol": "GIC-18M", "name": "18-Month GIC (4.25%)", "asset_class": "fixed_income", "quantity": 1, "cost_basis": 5000, "market_value": 5200},
            {"account_id": "ws-alex-rrsp-001", "symbol": "XIU", "name": "iShares S&P/TSX 60 Index ETF", "asset_class": "etf", "quantity": 70, "cost_basis": 2200, "market_value": 2500},
        ],
    },
    "sarah-johnson": {
        "accounts": [
            {"account_id": "ws-sarah-tfsa-001", "display_name": "Tax-Free Savings Account", "type": "TFSA", "balance": 15000, "category": "DEPOSIT_ACCOUNT"},
            {"account_id": "ws-sarah-chq-001", "display_name": "Wealthsimple Cash", "type": "CHEQUING", "balance": 2500, "category": "DEPOSIT_ACCOUNT"},
        ],
        "holdings": [
            {"account_id": "ws-sarah-tfsa-001", "symbol": "XEQT", "name": "iShares Core Equity ETF Portfolio", "asset_class": "etf", "quantity": 350, "cost_basis": 8400, "market_value": 9450},
            {"account_id": "ws-sarah-tfsa-001", "symbol": "XGRO", "name": "iShares Core Growth ETF Portfolio", "asset_class": "etf", "quantity": 150, "cost_basis": 3600, "market_value": 4050},
            {"account_id": "ws-sarah-tfsa-001", "symbol": "CASH", "name": "Cash Balance", "asset_class": "cash", "quantity": 1, "cost_basis": 1500, "market_value": 1500},
        ],
    },
    "marcus-williams": {
        "accounts": [
            {"account_id": "ws-marcus-tfsa-001", "display_name": "Tax-Free Savings Account", "type": "TFSA", "balance": 45000, "category": "DEPOSIT_ACCOUNT"},
            {"account_id": "ws-marcus-rrsp-001", "display_name": "Registered Retirement Savings Plan", "type": "RRSP", "balance": 85000, "category": "DEPOSIT_ACCOUNT"},
            {"account_id": "ws-marcus-chq-001", "display_name": "Wealthsimple Cash", "type": "CHEQUING", "balance": 8000, "category": "DEPOSIT_ACCOUNT"},
        ],
        "holdings": [
            {"account_id": "ws-marcus-tfsa-001", "symbol": "VFV", "name": "Vanguard S&P 500 Index ETF", "asset_class": "etf", "quantity": 300, "cost_basis": 22500, "market_value": 27000},
            {"account_id": "ws-marcus-tfsa-001", "symbol": "XIC", "name": "iShares Core S&P/TSX Capped Composite", "asset_class": "etf", "quantity": 400, "cost_basis": 12000, "market_value": 13200},
            {"account_id": "ws-marcus-tfsa-001", "symbol": "CASH", "name": "Cash Balance", "asset_class": "cash", "quantity": 1, "cost_basis": 4800, "market_value": 4800},
            {"account_id": "ws-marcus-rrsp-001", "symbol": "VBAL", "name": "Vanguard Balanced ETF Portfolio", "asset_class": "etf", "quantity": 1200, "cost_basis": 36000, "market_value": 38400},
            {"account_id": "ws-marcus-rrsp-001", "symbol": "ZAG", "name": "BMO Aggregate Bond Index ETF", "asset_class": "fixed_income", "quantity": 800, "cost_basis": 11200, "market_value": 11600},
            {"account_id": "ws-marcus-rrsp-001", "symbol": "GIC-12M", "name": "12-Month GIC (4.10%)", "asset_class": "fixed_income", "quantity": 1, "cost_basis": 20000, "market_value": 20500},
            {"account_id": "ws-marcus-rrsp-001", "symbol": "XIU", "name": "iShares S&P/TSX 60 Index ETF", "asset_class": "etf", "quantity": 400, "cost_basis": 12800, "market_value": 14500},
        ],
    },
    "priya-patel": {
        "accounts": [
            {"account_id": "ws-priya-tfsa-001", "display_name": "Tax-Free Savings Account", "type": "TFSA", "balance": 22000, "category": "DEPOSIT_ACCOUNT"},
            {"account_id": "ws-priya-chq-001", "display_name": "Wealthsimple Cash", "type": "CHEQUING", "balance": 5000, "category": "DEPOSIT_ACCOUNT"},
        ],
        "holdings": [
            {"account_id": "ws-priya-tfsa-001", "symbol": "XEQT", "name": "iShares Core Equity ETF Portfolio", "asset_class": "etf", "quantity": 500, "cost_basis": 12000, "market_value": 13500},
            {"account_id": "ws-priya-tfsa-001", "symbol": "TEC", "name": "TD Global Technology Leaders Index ETF", "asset_class": "etf", "quantity": 200, "cost_basis": 5000, "market_value": 5800},
            {"account_id": "ws-priya-tfsa-001", "symbol": "CASH", "name": "Cash Balance", "asset_class": "cash", "quantity": 1, "cost_basis": 2700, "market_value": 2700},
        ],
    },
    "david-kim": {
        "accounts": [
            {"account_id": "ws-david-tfsa-001", "display_name": "Tax-Free Savings Account", "type": "TFSA", "balance": 55000, "category": "DEPOSIT_ACCOUNT"},
            {"account_id": "ws-david-rrsp-001", "display_name": "Registered Retirement Savings Plan", "type": "RRSP", "balance": 30000, "category": "DEPOSIT_ACCOUNT"},
            {"account_id": "ws-david-chq-001", "display_name": "Wealthsimple Cash", "type": "CHEQUING", "balance": 12000, "category": "DEPOSIT_ACCOUNT"},
        ],
        "holdings": [
            {"account_id": "ws-david-tfsa-001", "symbol": "SHOP", "name": "Shopify Inc.", "asset_class": "equity", "quantity": 80, "cost_basis": 7200, "market_value": 8960},
            {"account_id": "ws-david-tfsa-001", "symbol": "NVDA", "name": "NVIDIA Corporation", "asset_class": "equity", "quantity": 15, "cost_basis": 5000, "market_value": 8250},
            {"account_id": "ws-david-tfsa-001", "symbol": "BTC", "name": "Bitcoin", "asset_class": "crypto", "quantity": 0.15, "cost_basis": 8000, "market_value": 13500},
            {"account_id": "ws-david-tfsa-001", "symbol": "ETH", "name": "Ethereum", "asset_class": "crypto", "quantity": 3.0, "cost_basis": 6000, "market_value": 6000},
            {"account_id": "ws-david-tfsa-001", "symbol": "SOL", "name": "Solana", "asset_class": "crypto", "quantity": 40, "cost_basis": 4000, "market_value": 5200},
            {"account_id": "ws-david-tfsa-001", "symbol": "XEQT", "name": "iShares Core Equity ETF Portfolio", "asset_class": "etf", "quantity": 300, "cost_basis": 7200, "market_value": 8100},
            {"account_id": "ws-david-tfsa-001", "symbol": "CASH", "name": "Cash Balance", "asset_class": "cash", "quantity": 1, "cost_basis": 4990, "market_value": 4990},
            {"account_id": "ws-david-rrsp-001", "symbol": "VFV", "name": "Vanguard S&P 500 Index ETF", "asset_class": "etf", "quantity": 200, "cost_basis": 15000, "market_value": 18000},
            {"account_id": "ws-david-rrsp-001", "symbol": "XIC", "name": "iShares Core S&P/TSX Capped Composite", "asset_class": "etf", "quantity": 300, "cost_basis": 9000, "market_value": 9900},
            {"account_id": "ws-david-rrsp-001", "symbol": "CASH", "name": "Cash Balance", "asset_class": "cash", "quantity": 1, "cost_basis": 2100, "market_value": 2100},
        ],
    },
    "emma-rodriguez": {
        "accounts": [
            {"account_id": "ws-emma-rrsp-001", "display_name": "Registered Retirement Savings Plan", "type": "RRSP", "balance": 40000, "category": "DEPOSIT_ACCOUNT"},
            {"account_id": "ws-emma-chq-001", "display_name": "Wealthsimple Cash", "type": "CHEQUING", "balance": 3000, "category": "DEPOSIT_ACCOUNT"},
        ],
        "holdings": [
            {"account_id": "ws-emma-rrsp-001", "symbol": "VBAL", "name": "Vanguard Balanced ETF Portfolio", "asset_class": "etf", "quantity": 800, "cost_basis": 24000, "market_value": 25600},
            {"account_id": "ws-emma-rrsp-001", "symbol": "ZAG", "name": "BMO Aggregate Bond Index ETF", "asset_class": "fixed_income", "quantity": 500, "cost_basis": 7000, "market_value": 7250},
            {"account_id": "ws-emma-rrsp-001", "symbol": "GIC-24M", "name": "24-Month GIC (4.50%)", "asset_class": "fixed_income", "quantity": 1, "cost_basis": 5000, "market_value": 5300},
            {"account_id": "ws-emma-rrsp-001", "symbol": "CASH", "name": "Cash Balance", "asset_class": "cash", "quantity": 1, "cost_basis": 1850, "market_value": 1850},
        ],
    },
}


SEED_USER_PERSONAS = {
    "alex-chen": "34yo, $105k income, common-law, renting, considering first home",
    "sarah-johnson": "29yo, freelance designer, building savings",
    "marcus-williams": "42yo, dual income household, mortgage + investments",
    "priya-patel": "36yo, small business owner, design studio",
    "david-kim": "31yo, tech professional, business + personal banking",
    "emma-rodriguez": "38yo, single parent, focused on mortgage paydown",
}


# ── Request models ──

class AdminConnectRequest(BaseModel):
    user_id: str
    institution_id: str
    account_ids: list[str] | None = None  # None = all


class InjectTransactionRequest(BaseModel):
    user_id: str
    institution_id: str
    account_id: str
    description: str
    amount: float
    transaction_type: str = "DEBIT"
    category: str | None = None


# ── Helper: connect a single user to a bank ──

async def _connect_user_bank(
    user_id: str, institution_id: str, account_ids: list[str] | None,
) -> dict:
    """Connect a user to a bank, handling MFA automatically."""
    pool = get_pool()

    # Check if already connected
    existing = await pool.fetchrow(
        "SELECT id, status FROM connections WHERE user_id = $1 AND institution_id = $2",
        user_id, institution_id,
    )
    if existing and existing["status"] == "active":
        # Already connected, return existing info
        accounts = await pool.fetch(
            """SELECT account_id, account_type, display_name, balance
               FROM connected_accounts WHERE connection_id = $1 AND valid_to IS NULL""",
            existing["id"],
        )
        return {
            "status": "already_connected",
            "connection_id": existing["id"],
            "accounts": [dict(a) for a in accounts],
        }

    # Clean stale/failed connections
    if existing:
        await pool.execute("DELETE FROM onboarding_events WHERE connection_id = $1", existing["id"])
        await pool.execute("DELETE FROM connections WHERE id = $1", existing["id"])

    # Get institution info — auto-register and go-live if needed
    institution = await registry.get_institution(institution_id)
    if not institution:
        return {"status": "error", "error": f"Institution {institution_id} not found in registry"}

    if institution["status"] != "live":
        client = await get_http_client()
        if institution["status"] == "not_registered":
            logger.debug("AdminDemo → auto-registering institution=%s", institution_id)
            await client.post(f"{settings.registry_url}/registry/institutions/{institution_id}/register")
        logger.debug("AdminDemo → auto-going-live institution=%s", institution_id)
        await client.post(f"{settings.registry_url}/registry/institutions/{institution_id}/go-live")
        institution = await registry.get_institution(institution_id)
        if not institution or institution["status"] != "live":
            return {"status": "error", "error": f"Failed to make {institution_id} live"}

    # Get or discover template
    template = await template_discovery.get_cached_template(pool, institution_id)
    if template is None:
        discovery_result = await template_discovery.discover_and_cache_template(
            pool, institution_id, institution["baseUrl"], institution["name"]
        )
        template = discovery_result

    # Start OAuth with account_ids
    scopes = list(template["scopes_supported"])
    oauth_result = await oauth_flow.start_oauth(template, scopes, user_id, account_ids)

    # Handle MFA automatically (Heritage Financial)
    if oauth_result["status"] == "mfa_required":
        logger.debug("AdminDemo → auto-submitting MFA for user=%s institution=%s", user_id, institution_id)
        mfa_result = await oauth_flow.submit_mfa(template, oauth_result["mfa_session"], "123456")
        oauth_result = mfa_result

    if oauth_result["status"] != "code_received":
        return {"status": "error", "error": f"Unexpected OAuth status: {oauth_result['status']}"}

    # Exchange code for tokens
    tokens = await oauth_flow.exchange_code(template, oauth_result["code"])

    # Create connection record
    now = datetime.now(timezone.utc)
    expires_in = tokens.get("expires_in", 1800)
    token_expires_at = now + timedelta(seconds=expires_in)
    conn_id = await pool.fetchval(
        """INSERT INTO connections
               (user_id, institution_id, status, access_token, refresh_token,
                token_expires_at, consent_scopes, consented_account_ids, connected_at)
           VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $8)
           RETURNING id""",
        user_id, institution_id,
        tokens["access_token"], tokens["refresh_token"],
        token_expires_at, scopes, account_ids, now,
    )

    # Initial data pull
    accounts = await data_pull.initial_data_pull(
        pool, conn_id, institution["baseUrl"], tokens["access_token"]
    )
    account_id_list = [a["account_id"] for a in accounts]
    txn_count = await data_pull.pull_transactions(
        pool, conn_id, institution["baseUrl"], tokens["access_token"], account_id_list,
    )
    stmt_count = await data_pull.pull_statements(
        pool, conn_id, institution["baseUrl"], tokens["access_token"], account_id_list,
    )

    # Compute metrics
    await twin_service.compute_metrics(pool, user_id)

    # Log event
    await pool.execute(
        """INSERT INTO onboarding_events (connection_id, institution_id, event_type, details)
           VALUES ($1, $2, 'connected', $3)""",
        conn_id, institution_id,
        json.dumps({"accounts_count": len(accounts), "source": "admin_demo"}),
    )

    logger.info(
        "AdminDemo ← connected user=%s institution=%s conn=%d accounts=%d txns=%d",
        user_id, institution_id, conn_id, len(accounts), txn_count,
    )

    return {
        "status": "connected",
        "connection_id": conn_id,
        "accounts": accounts,
        "transactions": txn_count,
        "statements": stmt_count,
    }


# ── Wealthsimple on-platform seed helper ──

async def _seed_wealthsimple_data(user_id: str, pool=None) -> dict:
    """Seed Wealthsimple on-platform data (accounts + holdings) for a user."""
    ws_config = WEALTHSIMPLE_ACCOUNTS.get(user_id)
    if not ws_config:
        return {"status": "skipped", "reason": "no wealthsimple config"}

    if pool is None:
        pool = get_pool()
    now = datetime.now(timezone.utc)

    # Ensure wealthsimple institution template exists
    await pool.execute(
        """INSERT INTO institution_templates
               (institution_id, institution_name, base_url, fdx_version,
                authorize_endpoint, token_endpoint, accounts_endpoint,
                scopes_supported, discovery_method)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (institution_id) DO NOTHING""",
        "wealthsimple", "Wealthsimple", "https://wealthsimple.com",
        "6.0", "/oauth/authorize", "/oauth/token", "/accounts",
        ["accounts", "transactions"], "on_platform",
    )

    # Check if already connected
    existing = await pool.fetchrow(
        "SELECT id FROM connections WHERE user_id = $1 AND institution_id = 'wealthsimple'",
        user_id,
    )
    if existing:
        return {"status": "already_connected", "connection_id": existing["id"]}

    # Create on-platform connection (never-expiring token)
    conn_id = await pool.fetchval(
        """INSERT INTO connections
               (user_id, institution_id, status, access_token, refresh_token,
                token_expires_at, consent_scopes, connected_at)
           VALUES ($1, 'wealthsimple', 'active', 'on-platform', 'on-platform',
                   $2, $3, $4)
           RETURNING id""",
        user_id,
        now + timedelta(days=36500),  # 100 years
        ["accounts", "transactions"],
        now,
    )

    # Insert accounts
    for acct in ws_config["accounts"]:
        await pool.execute(
            """INSERT INTO connected_accounts
                   (connection_id, account_id, account_type, account_category,
                    display_name, masked_number, currency, balance, balance_type,
                    raw_data, valid_from)
               VALUES ($1, $2, $3, $4, $5, $6, 'CAD', $7, 'CURRENT', '{}', $8)""",
            conn_id, acct["account_id"], acct["type"], acct["category"],
            acct["display_name"], acct["account_id"][-3:],
            acct["balance"], now,
        )

    # Insert holdings
    for h in ws_config.get("holdings", []):
        await pool.execute(
            """INSERT INTO twin_holdings
                   (connection_id, account_id, symbol, name, asset_class,
                    quantity, cost_basis, market_value, currency)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'CAD')
               ON CONFLICT (connection_id, account_id, symbol) DO UPDATE
               SET quantity = EXCLUDED.quantity, cost_basis = EXCLUDED.cost_basis,
                   market_value = EXCLUDED.market_value, as_of = CURRENT_DATE""",
            conn_id, h["account_id"], h["symbol"], h["name"], h["asset_class"],
            h["quantity"], h["cost_basis"], h["market_value"],
        )

    logger.info(
        "AdminDemo ← seeded Wealthsimple for user=%s conn=%d accounts=%d holdings=%d",
        user_id, conn_id, len(ws_config["accounts"]), len(ws_config.get("holdings", [])),
    )

    return {
        "status": "connected",
        "connection_id": conn_id,
        "accounts": len(ws_config["accounts"]),
        "holdings": len(ws_config.get("holdings", [])),
    }


async def seed_all_wealthsimple(pool) -> int:
    """Seed Wealthsimple on-platform data for all configured users.
    Called at startup so users see their Wealthsimple data on first login."""
    seeded = 0
    for user_id in WEALTHSIMPLE_ACCOUNTS:
        result = await _seed_wealthsimple_data(user_id, pool)
        if result["status"] == "connected":
            seeded += 1
    if seeded > 0:
        logger.info("Wealthsimple ← seeded on-platform data for %d users", seeded)
    else:
        logger.debug("Wealthsimple → all users already have on-platform data")
    return seeded


# ── Endpoints ──

@router.post("/setup")
async def setup_demo(admin: AuthUser = Depends(require_admin)):
    """Bulk setup: connect all seed users to their designated banks + Wealthsimple."""
    logger.info("AdminDemo → setup starting")
    results = []

    for user_id, banks in SEED_USER_BANK_MAP.items():
        user_result = {"user_id": user_id, "connections": []}
        for institution_id, account_ids in banks.items():
            try:
                conn_result = await _connect_user_bank(user_id, institution_id, account_ids)
                user_result["connections"].append({
                    "institution_id": institution_id,
                    **conn_result,
                })
            except Exception as e:
                logger.error(
                    "AdminDemo → setup failed user=%s institution=%s: %s",
                    user_id, institution_id, e,
                )
                user_result["connections"].append({
                    "institution_id": institution_id,
                    "status": "error",
                    "error": str(e),
                })
        results.append(user_result)

    # Seed Wealthsimple on-platform data for all users
    for user_id in WEALTHSIMPLE_ACCOUNTS:
        try:
            ws_result = await _seed_wealthsimple_data(user_id)
            # Find user in results and append wealthsimple
            for r in results:
                if r["user_id"] == user_id:
                    r["connections"].append({
                        "institution_id": "wealthsimple",
                        **ws_result,
                    })
                    break
            else:
                # User might be alex-chen (not in SEED_USER_BANK_MAP)
                results.append({
                    "user_id": user_id,
                    "connections": [{"institution_id": "wealthsimple", **ws_result}],
                })
        except Exception as e:
            logger.error("AdminDemo → wealthsimple seed failed user=%s: %s", user_id, e)

    logger.info("AdminDemo ← setup complete for %d users", len(results))
    return {"users": results}


@router.post("/connect")
async def admin_connect(
    req: AdminConnectRequest,
    admin: AuthUser = Depends(require_admin),
):
    """Connect a single user to a bank with optional account consent filtering."""
    logger.info("AdminDemo → connect user=%s institution=%s", req.user_id, req.institution_id)
    result = await _connect_user_bank(req.user_id, req.institution_id, req.account_ids)
    return result


@router.post("/reset-user/{user_id}")
async def reset_user(user_id: str, admin: AuthUser = Depends(require_admin)):
    """Reset a user's connections and twin data (FK-safe order)."""
    logger.info("AdminDemo → reset user=%s", user_id)
    pool = get_pool()

    # 1. Delete onboarding events for user's connections
    await pool.execute(
        """DELETE FROM onboarding_events
           WHERE connection_id IN (SELECT id FROM connections WHERE user_id = $1)""",
        user_id,
    )

    # 2. Delete connections (CASCADE handles connected_accounts, twin_transactions, twin_statements)
    deleted_conns = await pool.execute(
        "DELETE FROM connections WHERE user_id = $1", user_id,
    )

    # 3. Delete twin metrics
    await pool.execute("DELETE FROM twin_metrics WHERE user_id = $1", user_id)

    # 4. Delete action DAGs and their nodes (CASCADE)
    await pool.execute("DELETE FROM action_dags WHERE user_id = $1", user_id)

    # 5. Delete user goals
    await pool.execute("DELETE FROM user_goals WHERE user_id = $1", user_id)

    # 6. Delete progress data
    await pool.execute("DELETE FROM progress_milestones WHERE user_id = $1", user_id)
    await pool.execute("DELETE FROM progress_streaks WHERE user_id = $1", user_id)

    # 7. Delete council sessions
    await pool.execute("DELETE FROM council_sessions WHERE user_id = $1", user_id)

    logger.info("AdminDemo ← reset complete user=%s connections=%s", user_id, deleted_conns)
    return {"status": "reset", "user_id": user_id}


@router.post("/inject-transaction")
async def inject_transaction(
    req: InjectTransactionRequest,
    admin: AuthUser = Depends(require_admin),
):
    """Inject a transaction into a bank, then poll to pull it into the twin."""
    logger.info(
        "AdminDemo → inject txn user=%s institution=%s account=%s amount=%s",
        req.user_id, req.institution_id, req.account_id, req.amount,
    )
    pool = get_pool()

    # Find active connection
    conn = await pool.fetchrow(
        "SELECT * FROM connections WHERE user_id = $1 AND institution_id = $2 AND status = 'active'",
        req.user_id, req.institution_id,
    )
    if not conn:
        raise HTTPException(404, f"No active connection for {req.user_id} at {req.institution_id}")

    # Get institution info for base URL
    institution = await registry.get_institution(req.institution_id)
    if not institution:
        raise HTTPException(404, f"Institution {req.institution_id} not found")

    # POST to bank's injection endpoint
    client = await get_http_client()
    inject_url = f"{institution['baseUrl']}/admin/transactions/inject"
    inject_resp = await client.post(
        inject_url,
        json={
            "userId": req.user_id,
            "accountId": req.account_id,
            "transaction": {
                "description": req.description,
                "amount": req.amount,
                "transactionType": req.transaction_type,
                "category": req.category,
            },
        },
    )
    if inject_resp.status_code != 200:
        raise HTTPException(
            inject_resp.status_code,
            f"Bank injection failed: {inject_resp.text}",
        )
    injected = inject_resp.json()

    # Targeted poll: pull transactions for this connection
    account_ids = [req.account_id]
    txn_count = await data_pull.pull_transactions(
        pool, conn["id"], institution["baseUrl"], conn["access_token"], account_ids,
    )

    # Recompute metrics
    await twin_service.compute_metrics(pool, req.user_id)

    logger.info(
        "AdminDemo ← injected txn into %s, pulled %d txns",
        req.account_id, txn_count,
    )

    return {
        "status": "injected",
        "transaction": injected.get("transaction"),
        "pulled_transactions": txn_count,
    }


@router.get("/users")
async def get_demo_users(admin: AuthUser = Depends(require_admin)):
    """Get all seed users with their designated banks and connection status."""
    pool = get_pool()
    result = []

    for user_id, persona in SEED_USER_PERSONAS.items():
        banks = SEED_USER_BANK_MAP.get(user_id, {})

        # Get actual connections
        connections = await pool.fetch(
            """SELECT institution_id, status, connected_at
               FROM connections WHERE user_id = $1 ORDER BY institution_id""",
            user_id,
        )
        conn_map = {c["institution_id"]: dict(c) for c in connections}

        bank_status = []
        for inst_id, account_ids in banks.items():
            conn = conn_map.get(inst_id)
            bank_status.append({
                "institution_id": inst_id,
                "consented_accounts": account_ids,
                "status": conn["status"] if conn else "not_connected",
                "connected_at": conn["connected_at"].isoformat() if conn and conn["connected_at"] else None,
            })

        result.append({
            "user_id": user_id,
            "persona": persona,
            "banks": bank_status,
        })

    return {"users": result}
