"""
Goal system — LLM-powered financial goal feasibility analysis.

Users describe goals in natural language. The system:
1. Gets twin snapshot for financial context
2. Filters through PII pipeline
3. LLM analyzes feasibility, cross-goal impact, progress
4. Stores structured goal with assessment
"""

import json
import logging
import time
from datetime import datetime, timezone

import asyncpg

from ..config import settings
from .llm_client import query_llm, embed_text
from .pii_client import PiiClient
from .guardrails import SYSTEM_GUARDRAIL, apply_outbound
from .council import extract_entities, format_twin_context, _step
from .session_store import _format_embedding
from . import twin

logger = logging.getLogger("onboarding")

GOAL_ANALYSIS_SYSTEM = """You are a compassionate but honest financial adviser. You always ground your
analysis in the person's actual financial numbers — never speculate, never be vague, never be
overly optimistic. Use specific dollar amounts, percentages, and timelines derived from their
profile data.

When a goal is unrealistic given current circumstances, say so kindly but clearly. Explain WHY
with numbers, and suggest what IS achievable or what would need to change to make it possible.

When a goal is achievable, show the specific math: how much per month, how long it takes, what
trade-offs exist with other goals. Be encouraging about what's working but never misleading
about difficulty.

Always consider the person's complete financial picture — existing debts, income patterns,
other active goals — when assessing any single goal.

Respond with valid JSON only (no markdown, no code fences):
{
  "summary_label": "Short label for the goal (e.g., 'Save for Home Down Payment')",
  "goal_type": "one of: savings, debt_payoff, investment, purchase, income, retirement, emergency_fund, other",
  "target_amount": null or numeric amount if applicable,
  "target_date": null or "YYYY-MM-DD" if a timeline is mentioned or can be inferred,
  "feasibility": "green (achievable), yellow (challenging but possible), or red (very difficult)",
  "assessment": "2-3 sentence assessment grounded in their real numbers — use specific balances, rates, income figures, and timelines",
  "cross_goal_impact": ["list of specific trade-offs with other active goals, if any"],
  "progress_pct": 0-100 estimated current progress toward this goal
}""" + SYSTEM_GUARDRAIL


async def add_goal(pool: asyncpg.Pool, user_id: str, raw_text: str) -> dict:
    """Analyze and store a new financial goal."""
    start = time.monotonic()
    logger.info("Goals → add goal user=%s text='%s'", user_id, raw_text[:80])
    steps = []

    pii = PiiClient()

    # 1. Get twin snapshot
    steps.append(_step("twin_snapshot", "Fetching financial data"))
    snapshot = await twin.get_twin_snapshot(pool, user_id)
    context = format_twin_context(snapshot)

    # 2. Create PII session
    steps.append(_step("pii_session", "Creating anonymization session"))
    entities = extract_entities(snapshot)
    session_id = await pii.create_session(entities)

    try:
        # 3. Filter context + goal text
        steps.append(_step("pii_filter", "Anonymizing context and goal"))
        filtered_context = await pii.filter_text(session_id, context)
        filtered_goal = await pii.filter_text(session_id, raw_text)

        # Build existing goals context
        existing_goals = snapshot.get("goals", [])
        goals_context = ""
        if existing_goals:
            goals_context = "\n\nExisting active goals:\n"
            for g in existing_goals:
                label = g.get("summary_label") or g.get("raw_text", "")
                goals_context += f"- {label} (feasibility: {g.get('feasibility', '?')}, progress: {g.get('progress_pct', 0)}%)\n"

        prompt = (
            f"Financial Profile:\n{filtered_context}\n"
            f"{goals_context}\n"
            f"New Goal: {filtered_goal}\n\n"
            f"Analyze this goal's feasibility and provide your assessment as JSON."
        )

        # 4. Query LLM
        steps.append(_step("llm_analysis", "Analyzing goal feasibility"))
        result = await query_llm(
            prompt=prompt,
            system=GOAL_ANALYSIS_SYSTEM,
            provider=settings.llm_provider,
            model=settings.llm_model,
            api_key=settings.anthropic_api_key if settings.llm_provider == "anthropic"
                    else settings.openai_api_key if settings.llm_provider == "openai"
                    else settings.gemini_api_key,
            max_tokens=settings.llm_max_tokens,
            temperature=0.3,
            timeout=60.0,
        )

        if result is None:
            raise ValueError("LLM did not respond")

        # 5. Parse JSON response
        steps.append(_step("parse_response", "Parsing LLM analysis"))
        content = result["content"].strip()
        # Strip markdown code fences if present
        if content.startswith("```"):
            content = content.split("\n", 1)[1] if "\n" in content else content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()

        analysis = json.loads(content)

        # 6. Rehydrate assessment text
        steps.append(_step("rehydrate", "Restoring real names in assessment"))
        assessment = analysis.get("assessment", "")
        rehydrated_assessment = await pii.rehydrate_text(session_id, assessment)

        # Outbound guardrail — flag compliance issues with disclaimer
        rehydrated_assessment = apply_outbound(rehydrated_assessment)

        # Parse target_date
        target_date = None
        if analysis.get("target_date"):
            try:
                target_date = datetime.strptime(analysis["target_date"], "%Y-%m-%d").date()
            except (ValueError, TypeError):
                pass

        # 7. Generate embedding for similarity search
        steps.append(_step("embed_goal", "Generating embedding for similarity search"))
        goal_embedding = await embed_text(raw_text, settings.openai_api_key)

        # 8. Store goal
        steps.append(_step("store_goal", "Saving goal to database"))
        embedding_str = _format_embedding(goal_embedding)
        goal_id = await pool.fetchval(
            """INSERT INTO user_goals
                   (user_id, raw_text, summary_label, goal_type, target_amount,
                    target_date, feasibility, feasibility_assessment,
                    cross_goal_impact, progress_pct, goal_embedding)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector)
               RETURNING id""",
            user_id, raw_text,
            analysis.get("summary_label", raw_text[:60]),
            analysis.get("goal_type", "other"),
            analysis.get("target_amount"),
            target_date,
            analysis.get("feasibility", "yellow"),
            rehydrated_assessment,
            json.dumps(analysis.get("cross_goal_impact", [])),
            analysis.get("progress_pct", 0),
            embedding_str,
        )

        elapsed_ms = round((time.monotonic() - start) * 1000)
        steps.append(_step("complete", f"Goal analysis complete in {elapsed_ms}ms"))
        logger.info("Goals ← added goal id=%d user=%s feasibility=%s in %dms",
                     goal_id, user_id, analysis.get("feasibility"), elapsed_ms)

        goal = {
            "id": goal_id,
            "user_id": user_id,
            "raw_text": raw_text,
            "summary_label": analysis.get("summary_label", raw_text[:60]),
            "goal_type": analysis.get("goal_type", "other"),
            "target_amount": analysis.get("target_amount"),
            "target_date": str(target_date) if target_date else None,
            "feasibility": analysis.get("feasibility", "yellow"),
            "feasibility_assessment": rehydrated_assessment,
            "cross_goal_impact": analysis.get("cross_goal_impact", []),
            "progress_pct": analysis.get("progress_pct", 0),
            "status": "active",
        }

        return {
            "goal": goal,
            "steps": steps,
            "elapsed_ms": elapsed_ms,
        }

    finally:
        await pii.delete_session(session_id)


async def list_goals(pool: asyncpg.Pool, user_id: str) -> list[dict]:
    """List all active goals for a user."""
    rows = await pool.fetch(
        """SELECT id, user_id, raw_text, summary_label, goal_type,
                  target_amount, target_date, feasibility, feasibility_assessment,
                  cross_goal_impact, progress_pct, status, created_at, updated_at
           FROM user_goals
           WHERE user_id = $1 AND status = 'active'
           ORDER BY created_at DESC""",
        user_id,
    )
    goals = []
    for r in rows:
        g = dict(r)
        if isinstance(g["cross_goal_impact"], str):
            g["cross_goal_impact"] = json.loads(g["cross_goal_impact"])
        goals.append(g)
    return goals


async def get_goal(pool: asyncpg.Pool, user_id: str, goal_id: int) -> dict | None:
    """Get a single goal."""
    row = await pool.fetchrow(
        """SELECT id, user_id, raw_text, summary_label, goal_type,
                  target_amount, target_date, feasibility, feasibility_assessment,
                  cross_goal_impact, progress_pct, status, created_at, updated_at
           FROM user_goals
           WHERE id = $1 AND user_id = $2""",
        goal_id, user_id,
    )
    if row is None:
        return None
    g = dict(row)
    if isinstance(g["cross_goal_impact"], str):
        g["cross_goal_impact"] = json.loads(g["cross_goal_impact"])
    return g


async def update_goal(pool: asyncpg.Pool, user_id: str, goal_id: int, raw_text: str) -> dict:
    """Re-assess an existing goal with new text."""
    # Delete old goal
    await pool.execute(
        "UPDATE user_goals SET status = 'abandoned', updated_at = now() WHERE id = $1 AND user_id = $2",
        goal_id, user_id,
    )
    # Create new assessment
    return await add_goal(pool, user_id, raw_text)


async def delete_goal(pool: asyncpg.Pool, user_id: str, goal_id: int) -> bool:
    """Soft delete a goal (status='abandoned')."""
    result = await pool.execute(
        "UPDATE user_goals SET status = 'abandoned', updated_at = now() WHERE id = $1 AND user_id = $2",
        goal_id, user_id,
    )
    return result == "UPDATE 1"


async def reassess_goals(pool: asyncpg.Pool, user_id: str) -> list[dict]:
    """Re-evaluate all active goals against current twin data. Returns updated goals."""
    goals = await list_goals(pool, user_id)
    if not goals:
        return []

    logger.info("Goals → reassessing %d goals for user=%s", len(goals), user_id)
    updated = []

    pii = PiiClient()
    snapshot = await twin.get_twin_snapshot(pool, user_id)
    context = format_twin_context(snapshot)
    entities = extract_entities(snapshot)
    session_id = await pii.create_session(entities)

    try:
        filtered_context = await pii.filter_text(session_id, context)

        for goal in goals:
            try:
                filtered_goal = await pii.filter_text(session_id, goal["raw_text"])
                prompt = (
                    f"Financial Profile:\n{filtered_context}\n\n"
                    f"Goal: {filtered_goal}\n\n"
                    f"Re-assess this goal's current feasibility and progress. Respond with JSON only."
                )

                result = await query_llm(
                    prompt=prompt,
                    system=GOAL_ANALYSIS_SYSTEM,
                    provider=settings.llm_provider,
                    model=settings.llm_model,
                    api_key=settings.anthropic_api_key if settings.llm_provider == "anthropic"
                            else settings.openai_api_key if settings.llm_provider == "openai"
                            else settings.gemini_api_key,
                    max_tokens=settings.llm_max_tokens,
                    temperature=0.3,
                    timeout=30.0,
                )

                if result is None:
                    continue

                content = result["content"].strip()
                if content.startswith("```"):
                    content = content.split("\n", 1)[1] if "\n" in content else content[3:]
                    if content.endswith("```"):
                        content = content[:-3]
                    content = content.strip()

                analysis = json.loads(content)
                assessment = analysis.get("assessment", "")
                rehydrated = await pii.rehydrate_text(session_id, assessment)

                await pool.execute(
                    """UPDATE user_goals
                       SET feasibility = $1, feasibility_assessment = $2,
                           progress_pct = $3, updated_at = now()
                       WHERE id = $4""",
                    analysis.get("feasibility", goal["feasibility"]),
                    rehydrated,
                    analysis.get("progress_pct", goal["progress_pct"]),
                    goal["id"],
                )

                updated.append(goal["id"])
                logger.debug("Goals ← reassessed goal id=%d feasibility=%s",
                             goal["id"], analysis.get("feasibility"))

            except Exception as e:
                logger.warning("Goals → reassess failed for goal id=%d: %s", goal["id"], e)

    finally:
        await pii.delete_session(session_id)

    logger.info("Goals ← reassessed %d/%d goals for user=%s", len(updated), len(goals), user_id)
    return updated


async def find_similar_goals(
    pool: asyncpg.Pool,
    user_id: str,
    embedding: list[float],
    threshold: float = 0.80,
    limit: int = 3,
) -> list[dict]:
    """Find semantically similar active goals via cosine similarity."""
    embedding_str = _format_embedding(embedding)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, summary_label, goal_type, feasibility, raw_text,
                   progress_pct, created_at,
                   1 - (goal_embedding <=> $1::vector) AS similarity
            FROM user_goals
            WHERE user_id = $2
              AND status = 'active'
              AND goal_embedding IS NOT NULL
              AND 1 - (goal_embedding <=> $1::vector) >= $3
            ORDER BY similarity DESC
            LIMIT $4
            """,
            embedding_str,
            user_id,
            threshold,
            limit,
        )

    matches = [
        {
            "id": r["id"],
            "summary_label": r["summary_label"],
            "goal_type": r["goal_type"],
            "feasibility": r["feasibility"],
            "raw_text": r["raw_text"],
            "progress_pct": float(r["progress_pct"]) if r["progress_pct"] is not None else 0,
            "similarity": round(float(r["similarity"]), 4),
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]
    logger.debug("Goals ← find_similar found %d matches (threshold=%.2f)", len(matches), threshold)
    return matches
