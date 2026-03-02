"""
In-memory session store for PII filter mappings.

Each session is completely isolated — keyed by UUID, with its own entity map,
reverse map, and perturbation seed. No cross-session access is possible by design
(production consideration: multi-tenant session isolation).
"""

import logging
import time
import uuid
import random
from dataclasses import dataclass, field

from ..config import settings

logger = logging.getLogger("pii-filter")


@dataclass
class Session:
    session_id: str
    created_at: float
    seed: int
    known_entities: dict  # {type: [values]} provided at session creation
    entity_map: dict = field(default_factory=dict)    # {anonymized → real}
    reverse_map: dict = field(default_factory=dict)    # {real → anonymized}
    amount_factor: float = 1.0
    date_offset_days: int = 0

    @property
    def is_expired(self) -> bool:
        return (time.time() - self.created_at) > settings.session_ttl_seconds


# Module-level store — each session is isolated by UUID key
_sessions: dict[str, Session] = {}


def create_session(known_entities: dict | None = None) -> Session:
    """Create a new isolated session with a unique perturbation seed."""
    session_id = str(uuid.uuid4())
    seed = random.randint(0, 2**31)
    rng = random.Random(seed)

    # Generate consistent perturbation parameters for this session
    amount_factor = rng.uniform(settings.amount_shift_min, settings.amount_shift_max)
    date_offset_days = rng.randint(settings.date_shift_min_days, settings.date_shift_max_days)

    session = Session(
        session_id=session_id,
        created_at=time.time(),
        seed=seed,
        known_entities=known_entities or {},
        amount_factor=amount_factor,
        date_offset_days=date_offset_days,
    )
    _sessions[session_id] = session

    logger.debug(
        "SessionStore → created session=%s entities=%s amount_factor=%.3f date_offset=%d",
        session_id, list((known_entities or {}).keys()), amount_factor, date_offset_days,
    )
    return session


def get_session(session_id: str) -> Session | None:
    """Retrieve a session by ID. Returns None if not found or expired."""
    session = _sessions.get(session_id)
    if session is None:
        return None
    if session.is_expired:
        logger.debug("SessionStore → session=%s expired, removing", session_id)
        del _sessions[session_id]
        return None
    return session


def delete_session(session_id: str) -> bool:
    """Delete a session and all its mappings. Returns True if session existed."""
    if session_id in _sessions:
        del _sessions[session_id]
        logger.debug("SessionStore → deleted session=%s", session_id)
        return True
    return False


def cleanup_expired() -> int:
    """Remove all expired sessions. Returns count removed."""
    expired = [sid for sid, s in _sessions.items() if s.is_expired]
    for sid in expired:
        del _sessions[sid]
    if expired:
        logger.info("SessionStore → cleaned up %d expired sessions", len(expired))
    return len(expired)


def session_count() -> int:
    """Return the number of active sessions."""
    return len(_sessions)
