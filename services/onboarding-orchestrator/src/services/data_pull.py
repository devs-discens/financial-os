import asyncpg
import json
import logging
from datetime import date
from uuid import uuid4
from . import bank_client

logger = logging.getLogger("onboarding")


def _extract_balance(acct: dict):
    """Extract balance from an FDX account object."""
    return (
        acct.get("currentBalance")
        or acct.get("principalBalance")
        or acct.get("availableBalance")
        or 0
    )


def _has_changed(old_raw: dict, new_raw: dict) -> bool:
    """Check if account data has materially changed (balance or raw_data)."""
    old_balance = _extract_balance(old_raw)
    new_balance = _extract_balance(new_raw)
    if old_balance != new_balance:
        return True
    # Compare full raw data (excluding transient fields if any)
    return old_raw != new_raw


INSERT_ACCOUNT_SQL = """
    INSERT INTO connected_accounts
        (connection_id, account_id, account_type, account_category,
         display_name, masked_number, currency, balance, balance_type,
         raw_data, valid_from, pull_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11)
"""


async def initial_data_pull(
    pool: asyncpg.Pool, connection_id: int, base_url: str, access_token: str
) -> list[dict]:
    """
    Pull all accounts from the bank using SCD2 pattern.
    - First pull: insert new current rows
    - Subsequent pulls: close changed rows and insert new versions
    """
    pull_id = str(uuid4())
    logger.debug(
        "DataPull → initial_data_pull connection_id=%d base_url=%s pull_id=%s",
        connection_id, base_url, pull_id,
    )

    accounts = await bank_client.fetch_accounts(base_url, access_token)
    logger.debug("DataPull ← fetched %d raw accounts from bank", len(accounts))

    stored = []
    async with pool.acquire() as conn:
        async with conn.transaction():
            for acct in accounts:
                account_id = acct["accountId"]
                display_name = acct.get("displayName", account_id)
                masked = f"****{account_id[-4:]}" if len(account_id) >= 4 else account_id
                balance = _extract_balance(acct)
                balance_type = "current"
                if "principalBalance" in acct:
                    balance_type = "principal"

                logger.debug(
                    "DataPull → account=%s type=%s category=%s balance=%s %s",
                    account_id, acct.get("accountType"), acct.get("accountCategory"),
                    balance, acct.get("currency", "CAD"),
                )

                # Check for existing current row (SCD2)
                current = await conn.fetchrow(
                    """SELECT id, raw_data FROM connected_accounts
                       WHERE connection_id = $1 AND account_id = $2 AND valid_to IS NULL""",
                    connection_id, account_id,
                )

                if current is not None:
                    old_raw = json.loads(current["raw_data"]) if isinstance(current["raw_data"], str) else current["raw_data"]
                    if _has_changed(old_raw, acct):
                        logger.debug("DataPull → SCD2 closing old row id=%d for account=%s", current["id"], account_id)
                        await conn.execute(
                            "UPDATE connected_accounts SET valid_to = now() WHERE id = $1",
                            current["id"],
                        )
                        await conn.execute(
                            INSERT_ACCOUNT_SQL,
                            connection_id, account_id,
                            acct.get("accountType", "UNKNOWN"),
                            acct.get("accountCategory", "UNKNOWN"),
                            display_name, masked,
                            acct.get("currency", "CAD"),
                            balance, balance_type,
                            json.dumps(acct), pull_id,
                        )
                    else:
                        logger.debug("DataPull → no change for account=%s, skipping SCD2", account_id)
                else:
                    # First time seeing this account
                    await conn.execute(
                        INSERT_ACCOUNT_SQL,
                        connection_id, account_id,
                        acct.get("accountType", "UNKNOWN"),
                        acct.get("accountCategory", "UNKNOWN"),
                        display_name, masked,
                        acct.get("currency", "CAD"),
                        balance, balance_type,
                        json.dumps(acct), pull_id,
                    )

                stored.append({
                    "account_id": account_id,
                    "display_name": display_name,
                    "masked_number": masked,
                    "account_type": acct.get("accountType"),
                    "account_category": acct.get("accountCategory"),
                    "balance": balance,
                    "currency": acct.get("currency", "CAD"),
                })

    logger.info(
        "DataPull complete: %d accounts stored for connection %d (pull_id=%s)",
        len(stored), connection_id, pull_id,
    )
    return stored


async def pull_transactions(
    pool: asyncpg.Pool, connection_id: int, base_url: str,
    access_token: str, account_ids: list[str],
) -> int:
    """Pull transactions for all accounts and store (append-only, idempotent)."""
    total = 0
    for account_id in account_ids:
        try:
            data = await bank_client.fetch_transactions(base_url, access_token, account_id)
        except Exception as e:
            logger.warning(
                "DataPull → failed to fetch transactions for account=%s: %s",
                account_id, e,
            )
            continue

        txns = data.get("transactions", [])
        for txn in txns:
            txn_id = txn.get("transactionId")
            if not txn_id:
                continue

            # Parse posted date from transactionTimestamp
            posted_date = None
            ts = txn.get("transactionTimestamp")
            if ts:
                try:
                    posted_date = date.fromisoformat(ts[:10])
                except (ValueError, TypeError):
                    pass

            await pool.execute(
                """INSERT INTO twin_transactions
                   (connection_id, account_id, transaction_id, posted_date, amount,
                    description, category, transaction_type, raw_data)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                   ON CONFLICT (connection_id, account_id, transaction_id) DO NOTHING""",
                connection_id, account_id, txn_id,
                posted_date,
                txn.get("amount"),
                txn.get("description"),
                txn.get("category"),
                txn.get("transactionType"),
                json.dumps(txn),
            )
            total += 1

        logger.debug(
            "DataPull → stored %d transactions for account=%s",
            len(txns), account_id,
        )

    logger.info(
        "DataPull transactions: %d total for connection %d",
        total, connection_id,
    )
    return total


async def pull_statements(
    pool: asyncpg.Pool, connection_id: int, base_url: str,
    access_token: str, account_ids: list[str],
) -> int:
    """Pull statements for all accounts (append-only, idempotent)."""
    total = 0
    for account_id in account_ids:
        try:
            statements = await bank_client.fetch_statements(base_url, access_token, account_id)
        except Exception as e:
            logger.warning(
                "DataPull → failed to fetch statements for account=%s: %s",
                account_id, e,
            )
            continue

        for stmt in statements:
            stmt_id = stmt.get("statementId")
            if not stmt_id:
                continue

            # Parse statement date from startDate or endDate
            stmt_date = None
            for date_field in ("endDate", "startDate", "statementDate"):
                d = stmt.get(date_field)
                if d:
                    try:
                        stmt_date = date.fromisoformat(d[:10])
                        break
                    except (ValueError, TypeError):
                        pass

            await pool.execute(
                """INSERT INTO twin_statements
                   (connection_id, account_id, statement_id, statement_date,
                    description, raw_data)
                   VALUES ($1, $2, $3, $4, $5, $6)
                   ON CONFLICT (connection_id, account_id, statement_id) DO NOTHING""",
                connection_id, account_id, stmt_id,
                stmt_date,
                stmt.get("description"),
                json.dumps(stmt),
            )
            total += 1

        logger.debug(
            "DataPull → stored %d statements for account=%s",
            len(statements), account_id,
        )

    logger.info(
        "DataPull statements: %d total for connection %d",
        total, connection_id,
    )
    return total
