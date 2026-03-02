"""Session management routes — create, get, delete PII filter sessions."""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services import session_store

logger = logging.getLogger("pii-filter")
router = APIRouter(tags=["sessions"])


class CreateSessionRequest(BaseModel):
    known_entities: dict = {}
    # known_entities format:
    # {
    #   "names": ["Alex Chen"],
    #   "institutions": ["Maple Direct", "Heritage Financial"],
    # }


@router.post("/sessions")
async def create_session(req: CreateSessionRequest):
    """Create a new PII filter session with known entity lists."""
    session = session_store.create_session(req.known_entities)

    logger.debug(
        "Sessions → created session=%s with %d entity types",
        session.session_id, len(req.known_entities),
    )

    return {
        "session_id": session.session_id,
        "created_at": session.created_at,
        "entity_types": list(req.known_entities.keys()),
        "entity_count": sum(len(v) for v in req.known_entities.values() if isinstance(v, list)),
    }


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    """Get session info (entity count, created_at, mapping count)."""
    session = session_store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")

    return {
        "session_id": session.session_id,
        "created_at": session.created_at,
        "entity_types": list(session.known_entities.keys()),
        "entity_count": sum(len(v) for v in session.known_entities.values() if isinstance(v, list)),
        "mapping_count": len(session.entity_map),
    }


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete a session and all its mappings."""
    deleted = session_store.delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")

    logger.debug("Sessions → deleted session=%s", session_id)
    return {"status": "deleted", "session_id": session_id}
