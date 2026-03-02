import logging
from .http_client import get_http_client

logger = logging.getLogger("onboarding")


async def fetch_accounts(base_url: str, access_token: str) -> list[dict]:
    """Fetch all accounts from a bank's FDX API."""
    url = f"{base_url}/fdx/v6/accounts"
    logger.debug("BankClient → GET %s", url)
    client = await get_http_client()
    resp = await client.get(
        url,
        headers={"Authorization": f"Bearer {access_token}"},
    )
    resp.raise_for_status()
    accounts = resp.json()["accounts"]
    logger.debug(
        "BankClient ← %d accounts from %s: %s",
        len(accounts), base_url,
        [a.get("accountId") for a in accounts],
    )
    return accounts


async def fetch_account_detail(base_url: str, access_token: str, account_id: str) -> dict:
    """Fetch detailed account info."""
    url = f"{base_url}/fdx/v6/accounts/{account_id}"
    logger.debug("BankClient → GET %s", url)
    client = await get_http_client()
    resp = await client.get(
        url,
        headers={"Authorization": f"Bearer {access_token}"},
    )
    resp.raise_for_status()
    data = resp.json()
    logger.debug(
        "BankClient ← account_detail id=%s type=%s category=%s balance=%s",
        account_id, data.get("accountType"), data.get("accountCategory"),
        data.get("currentBalance") or data.get("principalBalance"),
    )
    return data


async def fetch_transactions(
    base_url: str, access_token: str, account_id: str,
    start_time: str | None = None, end_time: str | None = None, limit: int = 100,
) -> dict:
    """Fetch transactions for an account."""
    url = f"{base_url}/fdx/v6/accounts/{account_id}/transactions"
    params = {"limit": str(limit)}
    if start_time:
        params["startTime"] = start_time
    if end_time:
        params["endTime"] = end_time

    logger.debug("BankClient → GET %s params=%s", url, params)
    client = await get_http_client()
    resp = await client.get(
        url,
        headers={"Authorization": f"Bearer {access_token}"},
        params=params,
    )
    resp.raise_for_status()
    data = resp.json()
    txn_count = len(data.get("transactions", []))
    logger.debug(
        "BankClient ← %d transactions for account=%s (page total=%s)",
        txn_count, account_id, data.get("page", {}).get("totalElements"),
    )
    return data


async def fetch_statements(base_url: str, access_token: str, account_id: str) -> list[dict]:
    """Fetch statements for an account (e.g. mortgage amortization)."""
    url = f"{base_url}/fdx/v6/accounts/{account_id}/statements"
    logger.debug("BankClient → GET %s", url)
    client = await get_http_client()
    resp = await client.get(
        url,
        headers={"Authorization": f"Bearer {access_token}"},
    )
    resp.raise_for_status()
    statements = resp.json().get("statements", [])
    logger.debug("BankClient ← %d statements for account=%s", len(statements), account_id)
    return statements
