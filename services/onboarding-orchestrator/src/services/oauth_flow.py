import logging
from urllib.parse import urlencode
from .http_client import get_http_client

logger = logging.getLogger("onboarding")

REDIRECT_URI = "http://localhost:8100/callback"
CLIENT_ID = "financial-os"


async def start_oauth(
    template: dict, scopes: list[str], user_id: str = "alex-chen",
    account_ids: list[str] | None = None,
) -> dict:
    """
    Begin the OAuth flow with a bank. Uses auto_approve=true for simulation.
    Returns either a redirect with auth code, or an MFA challenge.
    """
    client = await get_http_client()
    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": "+".join(scopes),
        "state": f"onboard-{template['institution_id']}",
        "auto_approve": "true",
        "user_id": user_id,
    }
    if account_ids:
        params["account_ids"] = ",".join(account_ids)

    endpoint = template["authorize_endpoint"]
    logger.debug(
        "OAuth → start_oauth institution=%s endpoint=%s scopes=%s",
        template["institution_id"], endpoint, scopes,
    )

    resp = await client.get(endpoint, params=params, follow_redirects=False)
    logger.debug("OAuth ← status=%d", resp.status_code)

    # No MFA — got a redirect with auth code
    if resp.status_code == 302:
        location = resp.headers["location"]
        from urllib.parse import urlparse, parse_qs
        parsed = parse_qs(urlparse(location).query)
        code = parsed.get("code", [None])[0]
        logger.debug("OAuth ← code_received (redirect, code=%s...)", code[:8] if code else "None")
        return {"status": "code_received", "code": code}

    # MFA required — got JSON with mfa_session
    if resp.status_code == 200:
        body = resp.json()
        if body.get("status") == "mfa_required":
            logger.debug(
                "OAuth ← mfa_required session=%s message=%s",
                body.get("mfa_session"), body.get("message"),
            )
            return {
                "status": "mfa_required",
                "mfa_session": body["mfa_session"],
                "message": body.get("message", "MFA code required"),
            }

    raise RuntimeError(f"Unexpected OAuth response: {resp.status_code}")


async def submit_mfa(template: dict, mfa_session: str, mfa_code: str) -> dict:
    """Submit MFA code and get auth code back."""
    endpoint = f"{template['authorize_endpoint']}/mfa"
    logger.debug(
        "OAuth → submit_mfa institution=%s endpoint=%s session=%s",
        template["institution_id"], endpoint, mfa_session,
    )

    client = await get_http_client()
    resp = await client.post(
        endpoint,
        json={"mfa_session": mfa_session, "mfa_code": mfa_code},
    )
    resp.raise_for_status()
    body = resp.json()
    logger.debug("OAuth ← mfa_verified code=%s...", body["code"][:8])
    return {"status": "code_received", "code": body["code"]}


async def exchange_code(template: dict, code: str) -> dict:
    """Exchange authorization code for access + refresh tokens."""
    endpoint = template["token_endpoint"]
    logger.debug(
        "OAuth → exchange_code institution=%s endpoint=%s code=%s...",
        template["institution_id"], endpoint, code[:8],
    )

    client = await get_http_client()
    resp = await client.post(
        endpoint,
        json={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": CLIENT_ID,
        },
    )
    resp.raise_for_status()
    tokens = resp.json()
    logger.debug(
        "OAuth ← tokens received access=%s... refresh=%s... expires_in=%s",
        tokens["access_token"][:8], tokens["refresh_token"][:8],
        tokens.get("expires_in"),
    )
    return tokens


async def refresh_access_token(template: dict, refresh_token: str) -> dict:
    """Refresh an expired access token."""
    endpoint = template["token_endpoint"]
    logger.debug(
        "OAuth → refresh_token institution=%s endpoint=%s",
        template["institution_id"], endpoint,
    )

    client = await get_http_client()
    resp = await client.post(
        endpoint,
        json={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        },
    )
    resp.raise_for_status()
    tokens = resp.json()
    logger.debug(
        "OAuth ← refreshed access=%s... expires_in=%s",
        tokens["access_token"][:8], tokens.get("expires_in"),
    )
    return tokens
