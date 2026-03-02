import logging
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from ..db.database import get_pool
from ..middleware.auth import require_admin, AuthUser
from ..services import benchmarks as benchmarks_service

logger = logging.getLogger("onboarding")
router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users")
async def list_users(admin: AuthUser = Depends(require_admin)):
    """List all users (admin only)."""
    pool = get_pool()
    rows = await pool.fetch(
        "SELECT id, username, display_name, role, created_at FROM users ORDER BY created_at"
    )
    return {"users": [dict(r) for r in rows]}


@router.get("/users/{user_id}")
async def get_user_detail(user_id: str, admin: AuthUser = Depends(require_admin)):
    """Get user detail with their connections (admin only)."""
    pool = get_pool()
    user = await pool.fetchrow(
        "SELECT id, username, display_name, role, created_at FROM users WHERE id = $1",
        user_id,
    )
    if not user:
        raise HTTPException(404, "User not found")

    connections = await pool.fetch(
        """SELECT c.*, t.institution_name
           FROM connections c
           JOIN institution_templates t ON t.institution_id = c.institution_id
           WHERE c.user_id = $1
           ORDER BY c.created_at""",
        user_id,
    )
    return {
        "user": dict(user),
        "connections": [dict(c) for c in connections],
    }


@router.get("/connections")
async def list_all_connections(admin: AuthUser = Depends(require_admin)):
    """List all connections across all users (admin only)."""
    pool = get_pool()
    rows = await pool.fetch(
        """SELECT c.*, t.institution_name
           FROM connections c
           JOIN institution_templates t ON t.institution_id = c.institution_id
           ORDER BY c.created_at"""
    )
    return {"connections": [dict(r) for r in rows]}


# ── Benchmark management ──


class BenchmarkOverrideRequest(BaseModel):
    bracket_key: str
    values: dict


@router.get("/benchmarks")
async def get_benchmarks(admin: AuthUser = Depends(require_admin)):
    """Get all national benchmarks with any admin overrides applied."""
    pool = get_pool()
    brackets = await benchmarks_service.get_all_benchmarks_with_overrides(pool)
    return {"brackets": brackets}


@router.put("/benchmarks")
async def set_benchmark(
    req: BenchmarkOverrideRequest,
    admin: AuthUser = Depends(require_admin),
):
    """Override national benchmark values for a specific bracket."""
    pool = get_pool()
    try:
        result = await benchmarks_service.set_benchmark_override(pool, req.bracket_key, req.values)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return result


@router.delete("/benchmarks/{bracket_key}")
async def reset_benchmark(bracket_key: str, admin: AuthUser = Depends(require_admin)):
    """Reset a specific bracket back to defaults."""
    pool = get_pool()
    found = await benchmarks_service.reset_benchmark_override(pool, bracket_key)
    if not found:
        raise HTTPException(404, "No override found for this bracket")
    return {"reset": True, "bracket_key": bracket_key}


@router.post("/benchmarks/reset-all")
async def reset_all_benchmarks(admin: AuthUser = Depends(require_admin)):
    """Reset all benchmark overrides back to defaults."""
    pool = get_pool()
    count = await benchmarks_service.reset_all_overrides(pool)
    return {"reset": True, "count": count}
