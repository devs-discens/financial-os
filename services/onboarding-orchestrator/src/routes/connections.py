import json
import logging
from fastapi import APIRouter, HTTPException, Depends
from ..db.database import get_pool
from ..middleware.auth import get_optional_user, resolve_user_id, AuthUser

logger = logging.getLogger("onboarding")
router = APIRouter(prefix="/connections", tags=["connections"])


@router.get("")
async def list_connections(
    user_id: str = "alex-chen",
    auth_user: AuthUser | None = Depends(get_optional_user),
):
    """List all connections for a user."""
    user_id = resolve_user_id(auth_user, user_id)
    logger.debug("Connections → list user_id=%s", user_id)
    pool = get_pool()
    rows = await pool.fetch(
        """SELECT c.*, t.institution_name
           FROM connections c
           JOIN institution_templates t ON t.institution_id = c.institution_id
           WHERE c.user_id = $1
           ORDER BY c.created_at""",
        user_id,
    )
    logger.debug("Connections ← %d connections for user=%s", len(rows), user_id)
    return {"connections": [dict(r) for r in rows]}


@router.get("/{connection_id}")
async def get_connection(connection_id: int):
    """Get connection details including accounts."""
    logger.debug("Connections → get connection_id=%d", connection_id)
    pool = get_pool()
    conn = await pool.fetchrow("SELECT * FROM connections WHERE id = $1", connection_id)
    if conn is None:
        logger.debug("Connections ← connection %d not found", connection_id)
        raise HTTPException(404, "Connection not found")

    accounts = await pool.fetch(
        """SELECT account_id, account_type, account_category, display_name,
                  masked_number, currency, balance, balance_type
           FROM connected_accounts WHERE connection_id = $1 AND valid_to IS NULL""",
        connection_id,
    )
    logger.debug(
        "Connections ← connection %d: institution=%s status=%s accounts=%d",
        connection_id, conn["institution_id"], conn["status"], len(accounts),
    )
    return {
        "connection": dict(conn),
        "accounts": [dict(a) for a in accounts],
    }


@router.get("/{connection_id}/events")
async def get_connection_events(connection_id: int):
    """Get the event log for a connection."""
    logger.debug("Connections → events connection_id=%d", connection_id)
    pool = get_pool()
    rows = await pool.fetch(
        """SELECT id, event_type, details, created_at
           FROM onboarding_events
           WHERE connection_id = $1
           ORDER BY created_at""",
        connection_id,
    )
    logger.debug("Connections ← %d events for connection %d", len(rows), connection_id)
    return {"events": [dict(r) for r in rows]}
