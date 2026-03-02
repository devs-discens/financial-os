"""
API routes for the Positive Progress — Gamified Financial Wellness feature.
"""

import json
import logging
from fastapi import APIRouter, Query, Depends, HTTPException

from ..db.database import get_pool
from ..config import settings
from ..services import twin as twin_service
from ..services import milestones as milestones_service
from ..services import benchmarks as benchmarks_service
from ..services.llm_client import query_llm
from ..middleware.auth import get_optional_user, resolve_user_id, AuthUser

logger = logging.getLogger("onboarding")
router = APIRouter(prefix="/progress", tags=["progress"])


async def _get_user_profile(pool, user_id: str) -> dict:
    """Fetch user profile from users table."""
    row = await pool.fetchrow(
        "SELECT profile FROM users WHERE id = $1", user_id,
    )
    if row is None or not row["profile"]:
        return {}
    profile = row["profile"]
    if isinstance(profile, str):
        profile = json.loads(profile)
    return profile


def _generate_encouragement(progress: dict, national: dict, peer: dict) -> dict:
    """Generate encouragement/assessment summary based on progress vs benchmarks."""
    messages = []
    score = progress["progress_score"]
    tier = progress["progress_tier"]

    # Overall tier message
    if score >= 80:
        messages.append({
            "type": "celebration",
            "message": f"Outstanding! You're in the {tier} tier — top-tier financial wellness.",
        })
    elif score >= 60:
        messages.append({
            "type": "encouragement",
            "message": f"Great work! At {score}/100 you're {tier}. A few targeted moves could push you to Flourishing.",
        })
    elif score >= 40:
        messages.append({
            "type": "encouragement",
            "message": f"Solid progress at {score}/100 ({tier}). You're building real momentum.",
        })
    elif score >= 20:
        messages.append({
            "type": "guidance",
            "message": f"You're at {score}/100 ({tier}). Focus on one metric at a time — small wins compound.",
        })
    else:
        messages.append({
            "type": "guidance",
            "message": f"Starting out at {score}/100. Every journey begins with a single step — you're already here.",
        })

    # Savings rate vs peers
    sr = progress["savings_rate"]
    peer_sr = peer.get("peer_savings_rate", 0)
    if sr > peer_sr and sr > 0:
        pct_ahead = ((sr - peer_sr) / max(peer_sr, 0.01)) * 100
        messages.append({
            "type": "win",
            "metric": "savings_rate",
            "message": f"Your savings rate ({sr*100:.1f}%) is {pct_ahead:.0f}% ahead of your peer group.",
        })
    elif sr > 0:
        gap = peer_sr - sr
        messages.append({
            "type": "opportunity",
            "metric": "savings_rate",
            "message": f"Saving an extra ${gap*progress.get('monthly_essentials', 3000)/12:.0f}/mo would match your peers' savings rate.",
        })

    # Emergency fund
    ef = progress["emergency_fund_months"]
    if ef >= 6:
        messages.append({
            "type": "win",
            "metric": "emergency_fund",
            "message": f"Your {ef:.1f}-month emergency fund exceeds the recommended 6-month target.",
        })
    elif ef >= 3:
        messages.append({
            "type": "encouragement",
            "metric": "emergency_fund",
            "message": f"Good buffer at {ef:.1f} months. Reaching 6 months would provide full protection.",
        })
    elif ef > 0:
        messages.append({
            "type": "opportunity",
            "metric": "emergency_fund",
            "message": f"At {ef:.1f} months, building to 3 months should be a priority.",
        })

    # Credit utilization
    cu = progress["credit_utilization"]
    if cu <= 0.10 and progress.get("total_credit_limit", 0) > 0:
        messages.append({
            "type": "win",
            "metric": "credit_utilization",
            "message": f"Excellent credit utilization at {cu*100:.1f}% — well below the 30% threshold.",
        })
    elif cu > 0.30:
        messages.append({
            "type": "opportunity",
            "metric": "credit_utilization",
            "message": f"Credit utilization at {cu*100:.1f}%. Getting below 30% would boost your score significantly.",
        })

    # DTI
    dti = progress["dti"]
    if 0 < dti <= 0.20:
        messages.append({
            "type": "win",
            "metric": "dti",
            "message": f"Healthy debt-to-income ratio at {dti*100:.1f}%.",
        })
    elif dti > 0.35:
        messages.append({
            "type": "opportunity",
            "metric": "dti",
            "message": f"DTI at {dti*100:.1f}% is elevated. Reducing debt or increasing income would help.",
        })

    return {
        "messages": messages,
        "summary": messages[0]["message"] if messages else "Keep going!",
    }


ASSESSMENT_SUMMARY_SYSTEM = (
    "You are a financial wellness assistant. Given a list of financial assessment observations, "
    "respond with a JSON object containing exactly two fields, in this order:\n"
    '1. "summary": a single cohesive paragraph (3-5 sentences) weaving the key insights into natural prose. '
    "Be warm, encouraging, and specific. Use second person ('you'). "
    "Don't repeat percentages verbatim. Start with a concrete financial detail, not a general sentiment.\n"
    '2. "title": a short, warm headline (3-6 words) that captures the overall sentiment of the summary you just wrote '
    '(e.g. "You\'re in great shape", "Strong foundation, room to grow", "Building real momentum"). '
    "The title must not repeat any phrasing from the summary's first sentence.\n\n"
    "Never mention that you're an AI or that these are 'observations'. Just speak directly.\n"
    "Respond ONLY with the JSON object, no markdown fences or extra text."
)


async def _llm_summarize_assessment(messages: list[dict]) -> dict | None:
    """Summarize rule-based encouragement messages into a title + paragraph via LLM.

    Returns {"title": str, "summary": str} or None on failure.
    """
    if not messages:
        return None
    bullets = "\n".join(f"- {m['message']}" for m in messages)
    result = await query_llm(
        prompt=bullets,
        system=ASSESSMENT_SUMMARY_SYSTEM,
        provider=settings.llm_provider,
        model=settings.llm_model,
        api_key=settings.llm_api_key,
        max_tokens=300,
    )
    if result and result.get("content"):
        try:
            raw = result["content"].strip()
            # Strip markdown fences if present
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
            parsed = json.loads(raw)
            title = parsed.get("title", "").strip()
            summary = parsed.get("summary", "").strip()
            if title and summary:
                logger.info("Progress ← LLM assessment generated title=%r (%d chars)", title, len(summary))
                return {"title": title, "summary": summary}
        except (json.JSONDecodeError, AttributeError):
            logger.warning("Progress ← LLM assessment JSON parse failed, using rule-based fallback")
            return None
    logger.warning("Progress ← LLM assessment summary failed, using rule-based fallback")
    return None


async def _build_progress_response(pool, user_id: str, progress: dict) -> dict:
    """Build the full progress response with benchmarks, milestones, streaks, encouragement."""
    profile = await _get_user_profile(pool, user_id)
    overrides = await benchmarks_service.load_overrides(pool)

    age = profile.get("age", 30)
    income = profile.get("income", 75000)
    province = profile.get("province", "ON")
    city = profile.get("city", "Toronto")
    housing_status = profile.get("housing_status", "Renting")
    dependents = profile.get("dependents", 0)

    national = benchmarks_service.get_national_benchmark(age, income, province, overrides=overrides)
    peer = benchmarks_service.get_peer_benchmark(age, income, city, housing_status, dependents, overrides=overrides)

    milestone_data = await milestones_service.get_milestones(
        pool, user_id, unacknowledged_only=True, limit=5,
    )
    streaks = await milestones_service.get_streaks(pool, user_id)
    encouragement = _generate_encouragement(progress, national, peer)

    return {
        "user_id": user_id,
        "progress_score": progress["progress_score"],
        "progress_tier": progress["progress_tier"],
        "tier_quote": progress["tier_quote"],
        "next_tier": progress["next_tier"],
        "points_to_next": progress["points_to_next"],
        "score_components": progress["score_components"],
        "metrics": {
            "savings_rate": progress["savings_rate"],
            "emergency_fund_months": progress["emergency_fund_months"],
            "credit_utilization": progress["credit_utilization"],
            "dti": progress["dti"],
        },
        "details": {
            "liquid_deposits": progress["liquid_deposits"],
            "monthly_essentials": progress["monthly_essentials"],
            "total_credit_used": progress["total_credit_used"],
            "total_credit_limit": progress["total_credit_limit"],
        },
        "benchmarks": {
            "national": national,
            "peer": peer,
        },
        "recent_milestones": milestone_data["milestones"],
        "streaks": streaks,
        "encouragement": encouragement,
    }


@router.get("/{user_id}")
async def get_progress(
    user_id: str,
    auth_user: AuthUser | None = Depends(get_optional_user),
):
    """Full progress snapshot: tier, score, metrics, benchmarks, milestones, streaks, encouragement."""
    user_id = resolve_user_id(auth_user, user_id)
    pool = get_pool()
    progress = await twin_service.compute_progress_metrics(pool, user_id)
    await milestones_service.detect_milestones(pool, user_id, progress)
    return await _build_progress_response(pool, user_id, progress)


@router.post("/{user_id}/assess")
async def trigger_assessment(
    user_id: str,
    auth_user: AuthUser | None = Depends(get_optional_user),
):
    """Manually trigger a full assessment: compute progress + detect milestones + generate encouragement."""
    user_id = resolve_user_id(auth_user, user_id)
    pool = get_pool()

    # Compute fresh progress metrics
    progress = await twin_service.compute_progress_metrics(pool, user_id)

    # Detect milestones
    new_milestones = await milestones_service.detect_milestones(pool, user_id, progress)

    # Build full response
    response = await _build_progress_response(pool, user_id, progress)
    response["new_milestones"] = new_milestones

    # LLM-summarize the encouragement messages into a title + polished paragraph
    llm_result = await _llm_summarize_assessment(response["encouragement"]["messages"])
    if llm_result:
        response["encouragement"]["title"] = llm_result["title"]
        response["encouragement"]["summary"] = llm_result["summary"]

    logger.info(
        "Progress ← assessment triggered for user=%s: score=%.1f tier=%s new_milestones=%d",
        user_id, progress["progress_score"], progress["progress_tier"], len(new_milestones),
    )
    return response


@router.get("/{user_id}/milestones")
async def get_milestones(
    user_id: str,
    unacknowledged_only: bool = Query(default=False),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0),
    auth_user: AuthUser | None = Depends(get_optional_user),
):
    """All milestones with pagination and optional unacknowledged filter."""
    user_id = resolve_user_id(auth_user, user_id)
    pool = get_pool()
    return await milestones_service.get_milestones(
        pool, user_id,
        unacknowledged_only=unacknowledged_only,
        limit=limit,
        offset=offset,
    )


@router.post("/{user_id}/milestones/{milestone_id}/acknowledge")
async def acknowledge_milestone(
    user_id: str,
    milestone_id: int,
    auth_user: AuthUser | None = Depends(get_optional_user),
):
    """Mark a milestone as seen/acknowledged."""
    user_id = resolve_user_id(auth_user, user_id)
    pool = get_pool()
    success = await milestones_service.acknowledge_milestone(pool, user_id, milestone_id)
    if not success:
        raise HTTPException(status_code=404, detail="Milestone not found")
    return {"acknowledged": True, "milestone_id": milestone_id}


@router.get("/{user_id}/streaks")
async def get_streaks(
    user_id: str,
    auth_user: AuthUser | None = Depends(get_optional_user),
):
    """Active streaks and personal bests."""
    user_id = resolve_user_id(auth_user, user_id)
    pool = get_pool()

    streaks = await milestones_service.get_streaks(pool, user_id)

    personal_bests_data = await pool.fetch(
        """SELECT milestone_key, milestone_value, details, achieved_at
           FROM progress_milestones
           WHERE user_id = $1 AND milestone_type = 'personal_best'
           ORDER BY milestone_key""",
        user_id,
    )
    personal_bests = []
    for r in personal_bests_data:
        pb = dict(r)
        if isinstance(pb["details"], str):
            pb["details"] = json.loads(pb["details"])
        personal_bests.append(pb)

    return {
        "streaks": streaks,
        "personal_bests": personal_bests,
    }


@router.get("/{user_id}/benchmarks")
async def get_benchmarks(
    user_id: str,
    auth_user: AuthUser | None = Depends(get_optional_user),
):
    """National + peer benchmarks for user's demographic."""
    user_id = resolve_user_id(auth_user, user_id)
    pool = get_pool()

    profile = await _get_user_profile(pool, user_id)
    overrides = await benchmarks_service.load_overrides(pool)

    age = profile.get("age", 30)
    income = profile.get("income", 75000)
    province = profile.get("province", "ON")
    city = profile.get("city", "Toronto")
    housing_status = profile.get("housing_status", "Renting")
    dependents = profile.get("dependents", 0)

    national = benchmarks_service.get_national_benchmark(age, income, province, overrides=overrides)
    peer = benchmarks_service.get_peer_benchmark(age, income, city, housing_status, dependents, overrides=overrides)

    return {
        "user_id": user_id,
        "national": national,
        "peer": peer,
    }
