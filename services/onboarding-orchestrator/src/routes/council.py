import logging
from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..config import settings
from ..db.database import get_pool
from ..services import council as council_service
from ..services.guardrails import validate_inbound
from ..services.llm_client import embed_text
from ..services.session_store import store_session, find_similar, get_session, list_sessions, archive_session, link_session_to_goal
from ..middleware.auth import get_optional_user, resolve_user_id, AuthUser

logger = logging.getLogger("onboarding")
router = APIRouter(prefix="/council", tags=["council"])


class CouncilRequest(BaseModel):
    user_id: str = "alex-chen"
    question: str
    goal_id: int | None = None


class CheckSimilarRequest(BaseModel):
    user_id: str = "alex-chen"
    question: str
    threshold: float = 0.85
    limit: int = 5


class LinkSessionGoalRequest(BaseModel):
    goal_id: int


@router.post("/collaborative")
async def run_collaborative(
    req: CouncilRequest,
    auth_user: AuthUser | None = Depends(get_optional_user),
):
    """Run the LLM Council in collaborative mode (analyst + strategist + planner + chairman)."""
    req.user_id = resolve_user_id(auth_user, req.user_id)

    guard = validate_inbound(req.question)
    if not guard.passed:
        return JSONResponse(status_code=422, content={"error": guard.code, "message": guard.reason})

    logger.info("Council route → collaborative user=%s", req.user_id)
    pool = get_pool()
    try:
        result = await council_service.run_collaborative(pool, req.user_id, req.question)

        # Store session (non-blocking — failure doesn't break the response)
        try:
            embedding = await embed_text(req.question, settings.openai_api_key)
            session_id = await store_session(
                pool,
                user_id=req.user_id,
                mode="collaborative",
                question=req.question,
                response=result,
                synthesis=result.get("synthesis"),
                elapsed_ms=result.get("elapsed_ms"),
                embedding=embedding,
                goal_id=req.goal_id,
            )
            result["session_id"] = session_id
            result["goal_id"] = req.goal_id
        except Exception as store_err:
            logger.warning("Council session storage failed: %s", store_err)

        return result
    except Exception as e:
        logger.error("Council collaborative failed: %s", e)
        raise HTTPException(500, f"Council error: {e}")


@router.post("/adversarial")
async def run_adversarial(
    req: CouncilRequest,
    auth_user: AuthUser | None = Depends(get_optional_user),
):
    """Run the LLM Council in adversarial/debate mode (bull + bear + chairman verdict)."""
    req.user_id = resolve_user_id(auth_user, req.user_id)

    guard = validate_inbound(req.question)
    if not guard.passed:
        return JSONResponse(status_code=422, content={"error": guard.code, "message": guard.reason})

    logger.info("Council route → adversarial user=%s", req.user_id)
    pool = get_pool()
    try:
        result = await council_service.run_adversarial(pool, req.user_id, req.question)

        # Store session (non-blocking — failure doesn't break the response)
        try:
            synthesis = result.get("chairman_verdict", {}).get("content")
            embedding = await embed_text(req.question, settings.openai_api_key)
            session_id = await store_session(
                pool,
                user_id=req.user_id,
                mode="adversarial",
                question=req.question,
                response=result,
                synthesis=synthesis,
                elapsed_ms=result.get("elapsed_ms"),
                embedding=embedding,
                goal_id=req.goal_id,
            )
            result["session_id"] = session_id
            result["goal_id"] = req.goal_id
        except Exception as store_err:
            logger.warning("Council session storage failed: %s", store_err)

        return result
    except Exception as e:
        logger.error("Council adversarial failed: %s", e)
        raise HTTPException(500, f"Council error: {e}")


@router.post("/check-similar")
async def check_similar(
    req: CheckSimilarRequest,
    auth_user: AuthUser | None = Depends(get_optional_user),
):
    """Check for semantically similar past questions before making a new LLM call."""
    req.user_id = resolve_user_id(auth_user, req.user_id)

    pool = get_pool()
    embedding = await embed_text(req.question, settings.openai_api_key)
    if embedding is None:
        return {"matches": [], "count": 0}

    matches = await find_similar(pool, req.user_id, embedding, req.threshold, req.limit)
    return {"matches": matches, "count": len(matches)}


@router.get("/sessions")
async def get_sessions(
    user_id: str = Query(default="alex-chen"),
    limit: int = Query(default=20, ge=1, le=100),
    auth_user: AuthUser | None = Depends(get_optional_user),
):
    """List past council sessions for a user (lightweight, no response body)."""
    user_id = resolve_user_id(auth_user, user_id)
    pool = get_pool()
    sessions = await list_sessions(pool, user_id, limit)
    return {"sessions": sessions, "count": len(sessions)}


@router.get("/sessions/{session_id}")
async def get_session_detail(
    session_id: int,
    auth_user: AuthUser | None = Depends(get_optional_user),
):
    """Get a full council session including the complete response."""
    pool = get_pool()
    session = await get_session(pool, session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    return session


@router.patch("/sessions/{session_id}")
async def patch_session(
    session_id: int,
    req: LinkSessionGoalRequest,
    auth_user: AuthUser | None = Depends(get_optional_user),
):
    """Link a session to a goal (retroactive linking after Track as Goal)."""
    pool = get_pool()
    linked = await link_session_to_goal(pool, session_id, req.goal_id)
    if not linked:
        raise HTTPException(404, "Session not found")
    return {"status": "linked", "session_id": session_id, "goal_id": req.goal_id}


@router.delete("/sessions/{session_id}")
async def archive_session_endpoint(
    session_id: int,
    auth_user: AuthUser | None = Depends(get_optional_user),
):
    """Archive (soft-delete) a council session."""
    pool = get_pool()
    archived = await archive_session(pool, session_id)
    if not archived:
        raise HTTPException(404, "Session not found or already archived")
    return {"status": "archived", "session_id": session_id}
