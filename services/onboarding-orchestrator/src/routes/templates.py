import asyncpg
import logging
from fastapi import APIRouter, HTTPException
from ..db.database import get_pool

logger = logging.getLogger("onboarding")
router = APIRouter(prefix="/templates", tags=["templates"])


@router.get("")
async def list_templates():
    """List all cached institution templates."""
    logger.debug("Templates → list all")
    pool = get_pool()
    rows = await pool.fetch(
        "SELECT * FROM institution_templates ORDER BY discovered_at"
    )
    logger.debug("Templates ← %d templates", len(rows))
    return {"templates": [dict(r) for r in rows]}


@router.get("/{institution_id}")
async def get_template(institution_id: str):
    """Get a specific institution template."""
    logger.debug("Templates → get institution_id=%s", institution_id)
    pool = get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM institution_templates WHERE institution_id = $1",
        institution_id,
    )
    if row is None:
        logger.debug("Templates ← %s not found", institution_id)
        raise HTTPException(404, "Template not found")
    logger.debug(
        "Templates ← %s: scopes=%s mfa=%s polling=%ds",
        institution_id, row["scopes_supported"], row["mfa_required"],
        row["polling_interval_seconds"],
    )
    return dict(row)


@router.delete("/{institution_id}")
async def delete_template(institution_id: str):
    """Delete a cached template (forces re-discovery on next connect)."""
    logger.debug("Templates → delete institution_id=%s", institution_id)
    pool = get_pool()
    try:
        result = await pool.execute(
            "DELETE FROM institution_templates WHERE institution_id = $1",
            institution_id,
        )
    except asyncpg.ForeignKeyViolationError:
        logger.warning("Templates ← cannot delete %s: active connections exist", institution_id)
        raise HTTPException(
            409, "Cannot delete template: active connections exist"
        )
    if result == "DELETE 0":
        logger.debug("Templates ← %s not found for deletion", institution_id)
        raise HTTPException(404, "Template not found")
    logger.info("Templates ← deleted template for %s", institution_id)
    return {"status": "deleted", "institution_id": institution_id}
