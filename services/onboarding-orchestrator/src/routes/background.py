import json
import logging
from fastapi import APIRouter, Query

logger = logging.getLogger("onboarding")
router = APIRouter(prefix="/background", tags=["background"])

# Module-level reference set by main.py at startup
_orchestrator = None


def set_orchestrator(bg):
    global _orchestrator
    _orchestrator = bg


def get_orchestrator():
    return _orchestrator


@router.get("/status")
async def background_status():
    bg = get_orchestrator()
    if bg is None:
        return {"running": False, "error": "Background orchestrator not initialized"}
    return bg.status()


@router.post("/trigger")
async def background_trigger():
    bg = get_orchestrator()
    if bg is None:
        return {"error": "Background orchestrator not initialized"}
    result = await bg.trigger()
    return {"triggered": True, **result}


@router.post("/trigger/{user_id}")
async def background_trigger_user(user_id: str):
    """Trigger a background poll for a single user's active connections."""
    bg = get_orchestrator()
    if bg is None:
        return {"error": "Background orchestrator not initialized"}

    from ..db.database import get_pool
    pool = get_pool()

    rows = await pool.fetch(
        """SELECT id FROM connections
           WHERE user_id = $1 AND status = 'active'
             AND access_token != 'on-platform'""",
        user_id,
    )

    if not rows:
        return {"triggered": False, "user_id": user_id, "error": "No pollable connections", "results": []}

    results = []
    for row in rows:
        result = await bg.poll_connection(row["id"])
        results.append(result)

    return {"triggered": True, "user_id": user_id, "polled": len(results), "results": results}


@router.get("/events")
async def background_events(
    event_type: str | None = Query(None),
    institution_id: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
):
    from ..db.database import get_pool
    pool = get_pool()

    query = """
        SELECT id, connection_id, institution_id, event_type, details, created_at
        FROM onboarding_events
        WHERE (event_type LIKE 'background%' OR event_type IN (
            'token_refreshed', 'anomaly_detected', 'consent_revoked', 'token_refresh_failed_401'
        ))
    """
    params: list = []
    idx = 1

    if event_type:
        query += f" AND event_type = ${idx}"
        params.append(event_type)
        idx += 1

    if institution_id:
        query += f" AND institution_id = ${idx}"
        params.append(institution_id)
        idx += 1

    query += f" ORDER BY created_at DESC LIMIT ${idx}"
    params.append(limit)

    rows = await pool.fetch(query, *params)
    events = []
    for r in rows:
        details = r["details"]
        if isinstance(details, str):
            details = json.loads(details)
        events.append({
            "id": r["id"],
            "connection_id": r["connection_id"],
            "institution_id": r["institution_id"],
            "event_type": r["event_type"],
            "details": details,
            "created_at": r["created_at"].isoformat(),
        })

    return {"events": events, "count": len(events)}


@router.get("/connections")
async def background_connections():
    """Return all active connections grouped by user_id with status details."""
    from ..db.database import get_pool
    pool = get_pool()

    rows = await pool.fetch(
        """SELECT c.id AS connection_id, c.user_id, c.institution_id, c.status,
                  c.last_poll_at, c.token_expires_at, c.access_token,
                  t.institution_name
           FROM connections c
           JOIN institution_templates t ON t.institution_id = c.institution_id
           ORDER BY c.user_id, c.institution_id"""
    )

    # Get latest background event per connection
    event_rows = await pool.fetch(
        """SELECT DISTINCT ON (connection_id)
                  connection_id, event_type, created_at
           FROM onboarding_events
           WHERE event_type LIKE 'background%'
              OR event_type IN ('token_refreshed', 'anomaly_detected',
                                'consent_revoked', 'token_refresh_failed_401')
           ORDER BY connection_id, created_at DESC"""
    )
    latest_events = {r["connection_id"]: r for r in event_rows}

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)

    users: dict[str, list] = {}
    for r in rows:
        conn_id = r["connection_id"]
        evt = latest_events.get(conn_id)

        # Token health: on-platform tokens are always healthy
        is_on_platform = r["access_token"] == "on-platform"
        token_healthy = True
        if not is_on_platform and r["token_expires_at"]:
            token_healthy = r["token_expires_at"] > now

        entry = {
            "connection_id": conn_id,
            "institution_id": r["institution_id"],
            "institution_name": r["institution_name"],
            "status": r["status"],
            "last_poll_at": r["last_poll_at"].isoformat() if r["last_poll_at"] else None,
            "token_expires_at": r["token_expires_at"].isoformat() if r["token_expires_at"] else None,
            "token_healthy": token_healthy,
            "is_on_platform": is_on_platform,
            "latest_event": {
                "event_type": evt["event_type"],
                "created_at": evt["created_at"].isoformat(),
            } if evt else None,
        }
        users.setdefault(r["user_id"], []).append(entry)

    result = [
        {"user_id": uid, "connections": conns}
        for uid, conns in users.items()
    ]

    return {"users": result, "total_connections": len(rows)}


@router.get("/anomalies")
async def background_anomalies(limit: int = Query(50, ge=1, le=500)):
    from ..db.database import get_pool
    pool = get_pool()

    rows = await pool.fetch(
        """SELECT id, connection_id, institution_id, details, created_at
           FROM onboarding_events
           WHERE event_type = 'anomaly_detected'
           ORDER BY created_at DESC LIMIT $1""",
        limit,
    )
    anomalies = []
    for r in rows:
        details = r["details"]
        if isinstance(details, str):
            details = json.loads(details)
        anomalies.append({
            "id": r["id"],
            "connection_id": r["connection_id"],
            "institution_id": r["institution_id"],
            "details": details,
            "created_at": r["created_at"].isoformat(),
        })

    return {"anomalies": anomalies, "count": len(anomalies)}
