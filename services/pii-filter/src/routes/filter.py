"""Filter and rehydrate routes — anonymize PII and restore original values."""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services import session_store, detector, transformer

logger = logging.getLogger("pii-filter")
router = APIRouter(tags=["filter"])


class FilterRequest(BaseModel):
    session_id: str
    text: str


class RehydrateRequest(BaseModel):
    session_id: str
    text: str


@router.post("/filter")
async def filter_text(req: FilterRequest):
    """Anonymize PII in text using the session's known entities and patterns."""
    session = session_store.get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session not found: {req.session_id}")

    logger.debug(
        "Filter → session=%s input_length=%d",
        req.session_id, len(req.text),
    )

    # Detect PII entities
    detections = detector.detect(req.text, session.known_entities)

    # Anonymize
    filtered_text = transformer.anonymize(req.text, detections, session)

    entities_found = [
        {
            "type": d.entity_type,
            "original_length": len(d.value),
        }
        for d in detections
    ]

    logger.debug(
        "Filter ← session=%s entities_found=%d output_length=%d",
        req.session_id, len(detections), len(filtered_text),
    )

    return {
        "filtered_text": filtered_text,
        "entities_found": entities_found,
        "session_id": req.session_id,
    }


@router.post("/rehydrate")
async def rehydrate_text(req: RehydrateRequest):
    """Replace anonymized values in LLM response with original real values."""
    session = session_store.get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session not found: {req.session_id}")

    logger.debug(
        "Rehydrate → session=%s input_length=%d mappings=%d",
        req.session_id, len(req.text), len(session.entity_map),
    )

    rehydrated_text = transformer.rehydrate(req.text, session)

    logger.debug(
        "Rehydrate ← session=%s output_length=%d",
        req.session_id, len(rehydrated_text),
    )

    return {
        "rehydrated_text": rehydrated_text,
        "session_id": req.session_id,
    }
