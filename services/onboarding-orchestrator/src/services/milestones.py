"""
Milestone detection engine for financial wellness progress.

Runs after compute_progress_metrics() in each background poll cycle.
All milestone inserts are idempotent via ON CONFLICT DO NOTHING on
(user_id, milestone_key).
"""

import json
import logging
from datetime import datetime, timezone

import asyncpg

logger = logging.getLogger("onboarding")

# Net worth milestone thresholds
NET_WORTH_MILESTONES = [0, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000]

# Emergency fund milestones (months)
EMERGENCY_FUND_MILESTONES = [1, 2, 3, 6]


async def detect_milestones(
    pool: asyncpg.Pool,
    user_id: str,
    progress: dict,
) -> list[dict]:
    """
    Detect new milestones based on current progress metrics.
    Returns list of newly achieved milestones.
    """
    logger.debug("Milestones → detecting for user=%s", user_id)
    new_milestones = []

    # Fetch latest twin metrics for net worth
    net_worth_row = await pool.fetchrow(
        """SELECT metric_value FROM twin_metrics
           WHERE user_id = $1 AND metric_type = 'net_worth'
           ORDER BY computed_at DESC LIMIT 1""",
        user_id,
    )
    net_worth = float(net_worth_row["metric_value"]) if net_worth_row else 0.0

    # --- Net worth crossings ---
    for threshold in NET_WORTH_MILESTONES:
        if net_worth >= threshold:
            milestone = await _record_milestone(
                pool, user_id,
                milestone_type="net_worth_crossing",
                milestone_key=f"net_worth_{threshold}",
                milestone_value=threshold,
                details={"actual_net_worth": net_worth, "threshold": threshold},
            )
            if milestone:
                new_milestones.append(milestone)

    # --- Emergency fund milestones ---
    emergency_months = progress.get("emergency_fund_months", 0)
    for months in EMERGENCY_FUND_MILESTONES:
        if emergency_months >= months:
            milestone = await _record_milestone(
                pool, user_id,
                milestone_type="emergency_fund",
                milestone_key=f"emergency_fund_{months}mo",
                milestone_value=months,
                details={"actual_months": emergency_months, "threshold_months": months},
            )
            if milestone:
                new_milestones.append(milestone)

    # --- First positive savings rate ---
    savings_rate = progress.get("savings_rate", 0)
    if savings_rate > 0:
        milestone = await _record_milestone(
            pool, user_id,
            milestone_type="savings",
            milestone_key="first_positive_savings",
            milestone_value=savings_rate,
            details={"savings_rate": savings_rate},
        )
        if milestone:
            new_milestones.append(milestone)

    # --- Credit card balance $0 ---
    total_credit_used = progress.get("total_credit_used", 0)
    if total_credit_used == 0 and progress.get("total_credit_limit", 0) > 0:
        milestone = await _record_milestone(
            pool, user_id,
            milestone_type="debt_payoff",
            milestone_key="credit_cards_zero",
            milestone_value=0,
            details={"credit_limit": progress.get("total_credit_limit", 0)},
        )
        if milestone:
            new_milestones.append(milestone)

    # --- Tier transitions ---
    tier = progress.get("progress_tier", "Starting Out")
    score = progress.get("progress_score", 0)
    milestone = await _record_milestone(
        pool, user_id,
        milestone_type="tier_transition",
        milestone_key=f"tier_{tier.lower().replace(' ', '_')}",
        milestone_value=score,
        details={"tier": tier, "score": score},
    )
    if milestone:
        new_milestones.append(milestone)

    # --- Goal progress milestones ---
    goals = await pool.fetch(
        "SELECT id, summary_label, progress_pct, status FROM user_goals WHERE user_id = $1 AND status = 'active'",
        user_id,
    )
    for goal in goals:
        goal_pct = float(goal["progress_pct"] or 0)
        for threshold in [25, 50, 75, 100]:
            if goal_pct >= threshold:
                ms_type = "goal_achieved" if threshold == 100 else "goal_progress"
                milestone = await _record_milestone(
                    pool, user_id,
                    milestone_type=ms_type,
                    milestone_key=f"goal_{goal['id']}_{threshold}pct",
                    milestone_value=threshold,
                    details={
                        "goal_id": goal["id"],
                        "goal_label": goal["summary_label"] or "Goal",
                        "progress_pct": goal_pct,
                        "threshold": threshold,
                    },
                )
                if milestone:
                    new_milestones.append(milestone)
                    # Mark goal as achieved at 100%
                    if threshold == 100:
                        await pool.execute(
                            "UPDATE user_goals SET status = 'achieved', updated_at = now() WHERE id = $1",
                            goal["id"],
                        )

    # --- Update streaks ---
    await _update_streaks(pool, user_id, progress)

    # --- Personal bests ---
    if savings_rate > 0:
        await _check_personal_best(
            pool, user_id, "highest_savings_rate", savings_rate, "savings_rate",
        )

    dti = progress.get("dti", 0)
    if dti > 0:
        await _check_personal_best(
            pool, user_id, "lowest_dti", dti, "debt_to_income_ratio", lower_is_better=True,
        )

    if new_milestones:
        logger.info(
            "Milestones ← %d new milestones for user=%s: %s",
            len(new_milestones), user_id,
            ", ".join(m["milestone_key"] for m in new_milestones),
        )
    else:
        logger.debug("Milestones ← no new milestones for user=%s", user_id)

    return new_milestones


async def _record_milestone(
    pool: asyncpg.Pool,
    user_id: str,
    milestone_type: str,
    milestone_key: str,
    milestone_value: float,
    details: dict,
) -> dict | None:
    """
    Insert a milestone. Returns the milestone dict if newly created,
    or None if it already existed (ON CONFLICT DO NOTHING).
    """
    row = await pool.fetchrow(
        """INSERT INTO progress_milestones (user_id, milestone_type, milestone_key, milestone_value, details)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, milestone_key) DO NOTHING
           RETURNING id, user_id, milestone_type, milestone_key, milestone_value, details, achieved_at""",
        user_id, milestone_type, milestone_key, milestone_value, json.dumps(details),
    )
    if row is None:
        return None
    return dict(row)


async def _update_streaks(
    pool: asyncpg.Pool,
    user_id: str,
    progress: dict,
) -> None:
    """Update streak counters based on current progress metrics."""
    now = datetime.now(timezone.utc)

    # Positive savings streak
    savings_rate = progress.get("savings_rate", 0)
    await _update_streak(
        pool, user_id, "positive_savings",
        is_active=savings_rate > 0,
        now=now,
    )

    # Debt reduction streak (credit utilization decreasing)
    credit_util = progress.get("credit_utilization", 0)
    prev_util_row = await pool.fetchrow(
        """SELECT metric_value FROM twin_metrics
           WHERE user_id = $1 AND metric_type = 'credit_utilization'
           ORDER BY computed_at DESC OFFSET 1 LIMIT 1""",
        user_id,
    )
    debt_reducing = False
    if prev_util_row and credit_util < float(prev_util_row["metric_value"]):
        debt_reducing = True
    await _update_streak(
        pool, user_id, "debt_reduction",
        is_active=debt_reducing,
        now=now,
    )


async def _update_streak(
    pool: asyncpg.Pool,
    user_id: str,
    streak_type: str,
    is_active: bool,
    now: datetime,
) -> None:
    """Update a single streak counter with upsert logic."""
    existing = await pool.fetchrow(
        """SELECT id, current_count, longest_count FROM progress_streaks
           WHERE user_id = $1 AND streak_type = $2""",
        user_id, streak_type,
    )

    if existing is None:
        new_count = 1 if is_active else 0
        await pool.execute(
            """INSERT INTO progress_streaks
               (user_id, streak_type, current_count, longest_count, last_checked_at, streak_start_at)
               VALUES ($1, $2, $3, $3, $4, $5)
               ON CONFLICT (user_id, streak_type) DO NOTHING""",
            user_id, streak_type, new_count, now, now if is_active else None,
        )
    else:
        if is_active:
            new_count = existing["current_count"] + 1
            new_longest = max(existing["longest_count"], new_count)
            start_at = now if existing["current_count"] == 0 else None
            if start_at:
                await pool.execute(
                    """UPDATE progress_streaks
                       SET current_count = $1, longest_count = $2,
                           last_checked_at = $3, streak_start_at = $4
                       WHERE id = $5""",
                    new_count, new_longest, now, start_at, existing["id"],
                )
            else:
                await pool.execute(
                    """UPDATE progress_streaks
                       SET current_count = $1, longest_count = $2, last_checked_at = $3
                       WHERE id = $4""",
                    new_count, new_longest, now, existing["id"],
                )
        else:
            # Streak broken — reset current but preserve longest
            await pool.execute(
                """UPDATE progress_streaks
                   SET current_count = 0, last_checked_at = $1, streak_start_at = NULL
                   WHERE id = $2""",
                now, existing["id"],
            )


async def _check_personal_best(
    pool: asyncpg.Pool,
    user_id: str,
    milestone_key: str,
    current_value: float,
    metric_type: str,
    lower_is_better: bool = False,
) -> None:
    """Record or update a personal best milestone."""
    existing = await pool.fetchrow(
        """SELECT id, milestone_value FROM progress_milestones
           WHERE user_id = $1 AND milestone_key = $2""",
        user_id, milestone_key,
    )

    if existing is None:
        await pool.execute(
            """INSERT INTO progress_milestones
               (user_id, milestone_type, milestone_key, milestone_value, details)
               VALUES ($1, 'personal_best', $2, $3, $4)
               ON CONFLICT (user_id, milestone_key) DO NOTHING""",
            user_id, milestone_key, current_value,
            json.dumps({"metric_type": metric_type, "value": current_value}),
        )
    else:
        is_better = (
            current_value < float(existing["milestone_value"])
            if lower_is_better
            else current_value > float(existing["milestone_value"])
        )
        if is_better:
            await pool.execute(
                """UPDATE progress_milestones
                   SET milestone_value = $1, details = $2, achieved_at = now()
                   WHERE id = $3""",
                current_value,
                json.dumps({"metric_type": metric_type, "value": current_value,
                            "previous_best": float(existing["milestone_value"])}),
                existing["id"],
            )


async def get_milestones(
    pool: asyncpg.Pool,
    user_id: str,
    unacknowledged_only: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """Get milestones for a user with optional filtering."""
    where = "WHERE user_id = $1"
    params: list = [user_id]
    idx = 2

    if unacknowledged_only:
        where += " AND acknowledged = FALSE"

    count = await pool.fetchval(
        f"SELECT COUNT(*) FROM progress_milestones {where}", *params,
    )

    rows = await pool.fetch(
        f"""SELECT id, user_id, milestone_type, milestone_key, milestone_value,
                   details, narrative, acknowledged, achieved_at
            FROM progress_milestones {where}
            ORDER BY achieved_at DESC
            LIMIT ${idx} OFFSET ${idx + 1}""",
        *params, limit, offset,
    )

    milestones = []
    for r in rows:
        m = dict(r)
        if isinstance(m["details"], str):
            m["details"] = json.loads(m["details"])
        milestones.append(m)

    return {"milestones": milestones, "total": count}


async def acknowledge_milestone(
    pool: asyncpg.Pool,
    user_id: str,
    milestone_id: int,
) -> bool:
    """Mark a milestone as acknowledged. Returns True if found and updated."""
    result = await pool.execute(
        """UPDATE progress_milestones SET acknowledged = TRUE
           WHERE id = $1 AND user_id = $2""",
        milestone_id, user_id,
    )
    return result == "UPDATE 1"


async def get_streaks(pool: asyncpg.Pool, user_id: str) -> list[dict]:
    """Get all streaks for a user."""
    rows = await pool.fetch(
        """SELECT id, user_id, streak_type, current_count, longest_count,
                  last_checked_at, streak_start_at
           FROM progress_streaks WHERE user_id = $1
           ORDER BY streak_type""",
        user_id,
    )
    return [dict(r) for r in rows]
