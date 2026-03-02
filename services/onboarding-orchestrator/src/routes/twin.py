import logging
from fastapi import APIRouter, Query, Depends

from ..db.database import get_pool
from ..services import twin as twin_service
from ..middleware.auth import get_optional_user, resolve_user_id, AuthUser

logger = logging.getLogger("onboarding")
router = APIRouter(prefix="/twin", tags=["twin"])


@router.get("/{user_id}")
async def get_twin_snapshot(
    user_id: str,
    auth_user: AuthUser | None = Depends(get_optional_user),
):
    """Return the full Digital Financial Twin for a user."""
    user_id = resolve_user_id(auth_user, user_id)
    pool = get_pool()
    return await twin_service.get_twin_snapshot(pool, user_id)


@router.get("/{user_id}/metrics")
async def get_metrics(
    user_id: str,
    auth_user: AuthUser | None = Depends(get_optional_user),
):
    """Return latest metrics and history for a user."""
    user_id = resolve_user_id(auth_user, user_id)
    pool = get_pool()
    return await twin_service.get_metrics(pool, user_id)


@router.get("/{user_id}/accounts/{account_id}/history")
async def get_account_history(
    user_id: str,
    account_id: str,
    connection_id: int = Query(default=None, description="Filter by connection ID"),
    auth_user: AuthUser | None = Depends(get_optional_user),
):
    """Return SCD2 version history for an account."""
    pool = get_pool()

    user_id = resolve_user_id(auth_user, user_id)
    # If connection_id not provided, look it up from user's connections
    if connection_id is None:
        row = await pool.fetchrow(
            """SELECT ca.connection_id FROM connected_accounts ca
               JOIN connections c ON c.id = ca.connection_id
               WHERE c.user_id = $1 AND ca.account_id = $2
               LIMIT 1""",
            user_id, account_id,
        )
        if row is None:
            return {"versions": [], "account_id": account_id}
        connection_id = row["connection_id"]

    versions = await twin_service.get_account_history(pool, connection_id, account_id)
    return {"versions": versions, "account_id": account_id, "connection_id": connection_id}


@router.get("/{user_id}/transactions")
async def get_transactions(
    user_id: str,
    account_id: str = Query(default=None),
    start_date: str = Query(default=None),
    end_date: str = Query(default=None),
    category: str = Query(default=None),
    limit: int = Query(default=200, le=1000),
    auth_user: AuthUser | None = Depends(get_optional_user),
):
    """Query transactions across all accounts with optional filters."""
    user_id = resolve_user_id(auth_user, user_id)
    pool = get_pool()
    txns = await twin_service.get_transactions(
        pool, user_id,
        account_id=account_id,
        start_date=start_date,
        end_date=end_date,
        category=category,
        limit=limit,
    )
    return {"transactions": txns, "count": len(txns)}
