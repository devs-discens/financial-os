"""Goal API routes — CRUD + discuss via Council + plan via DAG engine."""

import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..db.database import get_pool
from ..services import goals as goal_service
from ..services import council
from ..services import dag_engine
from ..services.guardrails import validate_inbound
from ..services.llm_client import embed_text
from ..config import settings

logger = logging.getLogger("onboarding")
router = APIRouter(prefix="/goals", tags=["goals"])


class AddGoalRequest(BaseModel):
    text: str


class UpdateGoalRequest(BaseModel):
    text: str


class CheckSimilarGoalRequest(BaseModel):
    text: str
    threshold: float = 0.80
    limit: int = 3


@router.post("/{user_id}/check-similar")
async def check_similar_goal(user_id: str, req: CheckSimilarGoalRequest):
    """Check for semantically similar existing goals via pgvector."""
    if not req.text.strip():
        raise HTTPException(400, "Goal text is required")

    embedding = await embed_text(req.text.strip(), settings.openai_api_key)
    if not embedding:
        return {"matches": [], "count": 0}

    pool = get_pool()
    matches = await goal_service.find_similar_goals(pool, user_id, embedding, req.threshold, req.limit)
    return {"matches": matches, "count": len(matches)}


@router.post("/{user_id}")
async def add_goal(user_id: str, req: AddGoalRequest):
    """Add a new financial goal with LLM feasibility analysis."""
    if not req.text.strip():
        raise HTTPException(400, "Goal text is required")

    guard = validate_inbound(req.text.strip())
    if not guard.passed:
        return JSONResponse(status_code=422, content={"error": guard.code, "message": guard.reason})

    pool = get_pool()
    result = await goal_service.add_goal(pool, user_id, req.text.strip())
    return result


@router.get("/{user_id}")
async def list_goals(user_id: str):
    """List all active goals for a user."""
    pool = get_pool()
    goals = await goal_service.list_goals(pool, user_id)
    return {"goals": goals, "count": len(goals)}


@router.put("/{user_id}/{goal_id}")
async def update_goal(user_id: str, goal_id: int, req: UpdateGoalRequest):
    """Re-assess a goal with new text."""
    if not req.text.strip():
        raise HTTPException(400, "Goal text is required")

    guard = validate_inbound(req.text.strip())
    if not guard.passed:
        return JSONResponse(status_code=422, content={"error": guard.code, "message": guard.reason})

    pool = get_pool()
    existing = await goal_service.get_goal(pool, user_id, goal_id)
    if existing is None:
        raise HTTPException(404, f"Goal {goal_id} not found")

    result = await goal_service.update_goal(pool, user_id, goal_id, req.text.strip())
    return result


@router.delete("/{user_id}/{goal_id}")
async def delete_goal(user_id: str, goal_id: int):
    """Remove (soft delete) a goal."""
    pool = get_pool()
    deleted = await goal_service.delete_goal(pool, user_id, goal_id)
    if not deleted:
        raise HTTPException(404, f"Goal {goal_id} not found")
    return {"status": "deleted", "goal_id": goal_id}


@router.post("/{user_id}/{goal_id}/discuss")
async def discuss_goal(user_id: str, goal_id: int):
    """Discuss a goal with the Council (collaborative mode)."""
    pool = get_pool()
    goal = await goal_service.get_goal(pool, user_id, goal_id)
    if goal is None:
        raise HTTPException(404, f"Goal {goal_id} not found")

    label = goal.get("summary_label") or goal.get("raw_text", "")
    feasibility = goal.get("feasibility", "unknown")
    question = (
        f"I have a financial goal: \"{label}\" "
        f"(currently assessed as {feasibility} feasibility). "
        f"What specific steps should I take to achieve this goal, "
        f"and how does it fit with my overall financial picture?"
    )

    result = await council.run_collaborative(pool, user_id, question)
    return result


@router.post("/{user_id}/{goal_id}/plan")
async def generate_goal_plan(user_id: str, goal_id: int):
    """Generate an action plan (DAG) linked to a specific goal."""
    pool = get_pool()
    goal = await goal_service.get_goal(pool, user_id, goal_id)
    if goal is None:
        raise HTTPException(404, f"Goal {goal_id} not found")

    label = goal.get("summary_label") or goal.get("raw_text", "")
    assessment = goal.get("feasibility_assessment", "")
    question = (
        f"Create a step-by-step action plan for this financial goal: \"{label}\". "
        f"Current assessment: {assessment}"
    )

    try:
        result = await dag_engine.generate_dag(
            pool, user_id, question,
            council_synthesis=assessment,
            goal_id=goal_id,
        )
        return result
    except (ValueError, RuntimeError) as e:
        logger.error("Goal plan generation failed: %s", e)
        raise HTTPException(502, str(e))
