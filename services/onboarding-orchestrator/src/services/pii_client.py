"""
HTTP client for the PII Filter Gateway service.
Wraps session management, text anonymization, and rehydration.
"""

import logging

from .http_client import get_http_client
from ..config import settings

logger = logging.getLogger("onboarding")


class PiiClient:
    def __init__(self, base_url: str = ""):
        self.base_url = base_url or settings.pii_filter_url

    async def create_session(self, known_entities: dict) -> str:
        """Create a PII session with known entities. Returns session_id."""
        logger.debug("PiiClient → create_session entities=%s", list(known_entities.keys()))
        client = await get_http_client()
        resp = await client.post(
            f"{self.base_url}/sessions",
            json={"known_entities": known_entities},
        )
        resp.raise_for_status()
        data = resp.json()
        session_id = data["session_id"]
        logger.info(
            "PiiClient ← session created id=%s entity_count=%d",
            session_id, data.get("entity_count", 0),
        )
        return session_id

    async def filter_text(self, session_id: str, text: str) -> str:
        """Anonymize text through the PII filter. Returns filtered_text."""
        logger.debug("PiiClient → filter session=%s text_len=%d", session_id, len(text))
        client = await get_http_client()
        resp = await client.post(
            f"{self.base_url}/filter",
            json={"session_id": session_id, "text": text},
        )
        resp.raise_for_status()
        data = resp.json()
        logger.debug(
            "PiiClient ← filtered entities_found=%d",
            len(data.get("entities_found", [])),
        )
        return data["filtered_text"]

    async def rehydrate_text(self, session_id: str, text: str) -> str:
        """Restore real values in anonymized text. Returns rehydrated_text."""
        logger.debug("PiiClient → rehydrate session=%s text_len=%d", session_id, len(text))
        client = await get_http_client()
        resp = await client.post(
            f"{self.base_url}/rehydrate",
            json={"session_id": session_id, "text": text},
        )
        resp.raise_for_status()
        data = resp.json()
        logger.debug("PiiClient ← rehydrated text_len=%d", len(data["rehydrated_text"]))
        return data["rehydrated_text"]

    async def delete_session(self, session_id: str) -> None:
        """Delete a PII session and its mappings."""
        logger.debug("PiiClient → delete session=%s", session_id)
        client = await get_http_client()
        resp = await client.delete(f"{self.base_url}/sessions/{session_id}")
        resp.raise_for_status()
        logger.debug("PiiClient ← session deleted id=%s", session_id)
