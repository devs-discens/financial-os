import json
import time
import logging
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from ..db.database import get_pool
from ..config import settings
from ..middleware.auth import get_optional_user, resolve_user_id, AuthUser
from ..services.registry_client import RegistryClient
from ..services import template_discovery, oauth_flow, data_pull
from ..services import twin as twin_service

logger = logging.getLogger("onboarding")
router = APIRouter(prefix="/onboarding", tags=["onboarding"])
registry = RegistryClient(settings.registry_url)


class ConnectRequest(BaseModel):
    institution_id: str
    user_id: str = "alex-chen"
    account_ids: list[str] | None = None


class MfaSubmitRequest(BaseModel):
    connection_id: int
    mfa_code: str


# ── Step-by-step onboarding ──


@router.post("/connect")
async def connect_institution(
    req: ConnectRequest,
    auth_user: AuthUser | None = Depends(get_optional_user),
):
    """
    Main onboarding endpoint. Orchestrates the full 5-step flow:
    1. Check registry
    2. Check/discover template
    3. Start OAuth
    4. Exchange tokens (or return MFA challenge)
    5. Initial data pull
    """
    req.user_id = resolve_user_id(auth_user, req.user_id)
    start = time.monotonic()
    logger.info("Onboarding → connect institution=%s user=%s", req.institution_id, req.user_id)
    pool = get_pool()

    # Step 1: Check registry
    logger.debug("Step 1: checking registry for %s", req.institution_id)
    institution = await registry.get_institution(req.institution_id)
    if institution is None:
        logger.warning("Step 1: institution %s not found in registry", req.institution_id)
        raise HTTPException(404, f"Institution '{req.institution_id}' not found in registry")

    logger.debug("Step 1: institution=%s status=%s", req.institution_id, institution["status"])

    if institution["status"] != "live":
        logger.info(
            "Step 1: institution %s not live (status=%s), returning not_available",
            req.institution_id, institution["status"],
        )
        await pool.execute(
            """INSERT INTO onboarding_events (institution_id, event_type, details)
               VALUES ($1, 'not_live', $2)""",
            req.institution_id,
            json.dumps({"status": institution["status"]}),
        )
        return {
            "status": "not_available",
            "institution_id": req.institution_id,
            "institution_status": institution["status"],
            "message": f"{institution['name']} is not yet available for open banking. "
                       f"Current status: {institution['status']}. We'll notify you when it goes live.",
        }

    # Step 1b: Check for existing connection
    logger.debug("Step 1b: checking existing connection for user=%s institution=%s", req.user_id, req.institution_id)
    existing = await pool.fetchrow(
        "SELECT * FROM connections WHERE user_id = $1 AND institution_id = $2",
        req.user_id, req.institution_id,
    )
    if existing is not None:
        if existing["status"] == "active":
            logger.info(
                "Step 1b: already_connected connection_id=%d for user=%s institution=%s",
                existing["id"], req.user_id, req.institution_id,
            )
            accounts = await pool.fetch(
                """SELECT account_id, account_type, account_category, display_name,
                          masked_number, currency, balance, balance_type
                   FROM connected_accounts WHERE connection_id = $1 AND valid_to IS NULL""",
                existing["id"],
            )
            logger.debug("Step 1b: returning %d existing accounts", len(accounts))
            return {
                "status": "already_connected",
                "connection_id": existing["id"],
                "institution_id": req.institution_id,
                "institution_name": institution["name"],
                "connected_at": existing["connected_at"].isoformat() if existing["connected_at"] else None,
                "accounts": [dict(a) for a in accounts],
            }
        else:
            logger.info(
                "Step 1b: cleaning up stale %s connection %d for %s",
                existing["status"], existing["id"], req.institution_id,
            )
            await pool.execute(
                "DELETE FROM onboarding_events WHERE connection_id = $1", existing["id"]
            )
            await pool.execute(
                "DELETE FROM connections WHERE id = $1", existing["id"]
            )

    # Step 2: Check for cached template, or discover
    logger.debug("Step 2: checking template cache for %s", req.institution_id)
    template = await template_discovery.get_cached_template(pool, req.institution_id)
    template_cached = template is not None

    if template is None:
        logger.info("Step 2: no cached template — starting LLM-assisted discovery for %s", req.institution_id)
        discovery_result = await template_discovery.discover_and_cache_template(
            pool, req.institution_id, institution["baseUrl"], institution["name"]
        )
        template = discovery_result
        discovery_elapsed_ms = discovery_result.get("discovery_elapsed_ms", 0)
        reasoning = discovery_result.get("reasoning", {})
        logger.debug("Step 2: template discovered in %dms", discovery_elapsed_ms)
    else:
        discovery_elapsed_ms = 0
        reasoning = None
        logger.debug("Step 2: using cached template for %s", req.institution_id)

    # Step 3: Start OAuth
    scopes = list(template["scopes_supported"])
    logger.debug("Step 3: starting OAuth for %s with scopes=%s account_ids=%s", req.institution_id, scopes, req.account_ids)
    oauth_result = await oauth_flow.start_oauth(template, scopes, req.user_id, req.account_ids)
    logger.debug("Step 3: OAuth result status=%s", oauth_result["status"])

    # If MFA required, create pending connection and return challenge
    if oauth_result["status"] == "mfa_required":
        conn_id = await pool.fetchval(
            """INSERT INTO connections (user_id, institution_id, status, consent_scopes, consented_account_ids)
               VALUES ($1, $2, 'mfa_pending', $3, $4) RETURNING id""",
            req.user_id, req.institution_id, scopes, req.account_ids,
        )
        await pool.execute(
            """INSERT INTO onboarding_events (connection_id, institution_id, event_type, details)
               VALUES ($1, $2, 'mfa_required', $3)""",
            conn_id, req.institution_id,
            json.dumps({"mfa_session": oauth_result["mfa_session"]}),
        )
        elapsed_ms = round((time.monotonic() - start) * 1000)
        logger.info(
            "Onboarding ← mfa_required connection_id=%d institution=%s (%dms)",
            conn_id, req.institution_id, elapsed_ms,
        )
        return {
            "status": "mfa_required",
            "connection_id": conn_id,
            "mfa_session": oauth_result["mfa_session"],
            "message": oauth_result["message"],
            "template_cached": template_cached,
            "discovery_elapsed_ms": discovery_elapsed_ms,
        }

    # Step 4: Exchange code for tokens
    logger.debug("Step 4: exchanging auth code for tokens")
    tokens = await oauth_flow.exchange_code(template, oauth_result["code"])

    # Create connection record
    now = datetime.now(timezone.utc)
    expires_in = tokens.get("expires_in", 1800)
    token_expires_at = now + timedelta(seconds=expires_in)
    conn_id = await pool.fetchval(
        """INSERT INTO connections
               (user_id, institution_id, status, access_token, refresh_token,
                token_expires_at, consent_scopes, consented_account_ids, connected_at)
           VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $8)
           RETURNING id""",
        req.user_id, req.institution_id,
        tokens["access_token"], tokens["refresh_token"],
        token_expires_at, scopes, req.account_ids, now,
    )
    logger.debug("Step 4: connection created id=%d token_expires_at=%s", conn_id, token_expires_at)

    # Step 5: Initial data pull
    logger.debug("Step 5: starting initial data pull for connection %d", conn_id)
    accounts = await data_pull.initial_data_pull(
        pool, conn_id, institution["baseUrl"], tokens["access_token"]
    )

    # Step 5b: Pull transactions and statements for twin
    account_ids = [a["account_id"] for a in accounts]
    txn_count = await data_pull.pull_transactions(
        pool, conn_id, institution["baseUrl"], tokens["access_token"], account_ids,
    )
    stmt_count = await data_pull.pull_statements(
        pool, conn_id, institution["baseUrl"], tokens["access_token"], account_ids,
    )
    logger.debug(
        "Step 5b: pulled %d transactions, %d statements for connection %d",
        txn_count, stmt_count, conn_id,
    )

    # Step 5c: Compute metrics for user's twin
    await twin_service.compute_metrics(pool, req.user_id)

    await pool.execute(
        """INSERT INTO onboarding_events (connection_id, institution_id, event_type, details)
           VALUES ($1, $2, 'connected', $3)""",
        conn_id, req.institution_id,
        json.dumps({"accounts_count": len(accounts), "transactions": txn_count, "statements": stmt_count}),
    )

    elapsed_ms = round((time.monotonic() - start) * 1000)
    logger.info(
        "Onboarding ← connected connection_id=%d institution=%s accounts=%d txns=%d stmts=%d (%dms)",
        conn_id, req.institution_id, len(accounts), txn_count, stmt_count, elapsed_ms,
    )

    return {
        "status": "connected",
        "connection_id": conn_id,
        "institution_id": req.institution_id,
        "institution_name": institution["name"],
        "template_cached": template_cached,
        "discovery_elapsed_ms": discovery_elapsed_ms,
        "reasoning": reasoning.get("reasoning_text") if reasoning else None,
        "accounts": accounts,
    }


@router.post("/mfa")
async def submit_mfa(req: MfaSubmitRequest):
    """Complete MFA step and finish onboarding."""
    start = time.monotonic()
    logger.info("MFA → submit connection_id=%d", req.connection_id)
    pool = get_pool()

    # Get the pending connection
    conn = await pool.fetchrow(
        "SELECT * FROM connections WHERE id = $1 AND status = 'mfa_pending'",
        req.connection_id,
    )
    if conn is None:
        logger.warning("MFA ← connection %d not found or not mfa_pending", req.connection_id)
        raise HTTPException(404, "No pending MFA connection found")

    logger.debug("MFA → found pending connection for institution=%s", conn["institution_id"])

    # Get the MFA session from events
    event = await pool.fetchrow(
        """SELECT details FROM onboarding_events
           WHERE connection_id = $1 AND event_type = 'mfa_required'
           ORDER BY created_at DESC LIMIT 1""",
        req.connection_id,
    )
    if event is None:
        logger.warning("MFA ← no mfa_required event found for connection %d", req.connection_id)
        raise HTTPException(400, "No MFA session found")

    details = json.loads(event["details"]) if isinstance(event["details"], str) else event["details"]
    mfa_session = details["mfa_session"]
    logger.debug("MFA → submitting code for session=%s", mfa_session)

    # Get template
    template = await template_discovery.get_cached_template(pool, conn["institution_id"])

    # Submit MFA
    mfa_result = await oauth_flow.submit_mfa(template, mfa_session, req.mfa_code)
    logger.debug("MFA ← code verified, exchanging auth code for tokens")

    # Exchange code for tokens
    tokens = await oauth_flow.exchange_code(template, mfa_result["code"])

    # Update connection
    now = datetime.now(timezone.utc)
    expires_in = tokens.get("expires_in", 1800)
    token_expires_at = now + timedelta(seconds=expires_in)
    await pool.execute(
        """UPDATE connections SET status = 'active', access_token = $1,
           refresh_token = $2, token_expires_at = $3, connected_at = $4 WHERE id = $5""",
        tokens["access_token"], tokens["refresh_token"], token_expires_at, now, req.connection_id,
    )
    logger.debug("MFA → connection %d updated to active token_expires_at=%s", req.connection_id, token_expires_at)

    # Get institution info for data pull
    institution = await registry.get_institution(conn["institution_id"])

    # Initial data pull
    logger.debug("MFA → starting initial data pull for connection %d", req.connection_id)
    accounts = await data_pull.initial_data_pull(
        pool, req.connection_id, institution["baseUrl"], tokens["access_token"]
    )

    # Pull transactions and statements for twin
    account_ids = [a["account_id"] for a in accounts]
    txn_count = await data_pull.pull_transactions(
        pool, req.connection_id, institution["baseUrl"], tokens["access_token"], account_ids,
    )
    stmt_count = await data_pull.pull_statements(
        pool, req.connection_id, institution["baseUrl"], tokens["access_token"], account_ids,
    )
    logger.debug(
        "MFA → pulled %d transactions, %d statements for connection %d",
        txn_count, stmt_count, req.connection_id,
    )

    # Compute metrics for user's twin
    user_id = conn["user_id"]
    await twin_service.compute_metrics(pool, user_id)

    await pool.execute(
        """INSERT INTO onboarding_events (connection_id, institution_id, event_type, details)
           VALUES ($1, $2, 'connected', $3)""",
        req.connection_id, conn["institution_id"],
        json.dumps({"accounts_count": len(accounts), "transactions": txn_count, "statements": stmt_count}),
    )

    elapsed_ms = round((time.monotonic() - start) * 1000)
    logger.info(
        "MFA ← connected connection_id=%d institution=%s accounts=%d txns=%d stmts=%d (%dms)",
        req.connection_id, conn["institution_id"], len(accounts), txn_count, stmt_count, elapsed_ms,
    )

    return {
        "status": "connected",
        "connection_id": req.connection_id,
        "institution_id": conn["institution_id"],
        "accounts": accounts,
    }
