"""
Background Orchestration Service (Component 4).

Runs as an asyncio task inside the FastAPI lifespan. Periodically polls
active connections: refreshes tokens, re-pulls account data, detects
balance anomalies, and logs events.
"""

import asyncio
import json
import logging
import time
from datetime import datetime, timezone, timedelta

import asyncpg

from ..config import settings
from . import data_pull, oauth_flow, twin, milestones, goals
from .registry_client import RegistryClient
from . import template_discovery

logger = logging.getLogger("onboarding")

registry = RegistryClient(settings.registry_url)


class BackgroundOrchestrator:
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool
        self.interval = settings.polling_interval_seconds
        self.token_buffer = settings.token_refresh_buffer_seconds
        self.anomaly_threshold = settings.anomaly_balance_threshold
        self._task: asyncio.Task | None = None
        self._trigger = asyncio.Event()
        self._stop = asyncio.Event()
        self.running = False
        self.cycle_count = 0
        self.last_cycle_at: datetime | None = None
        self.last_cycle_ms: int | None = None
        # Per-connection backoff state: connection_id -> consecutive failures
        self._backoff: dict[int, int] = {}

    async def start(self):
        if not settings.background_enabled:
            logger.info("Background → disabled via config")
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._poll_loop())
        self.running = True
        logger.info(
            "Background → started (interval=%ds, token_buffer=%ds, anomaly_threshold=%.0f%%)",
            self.interval, self.token_buffer, self.anomaly_threshold * 100,
        )

    async def stop(self):
        if self._task is None:
            return
        self._stop.set()
        self._trigger.set()  # wake up if sleeping
        try:
            await asyncio.wait_for(self._task, timeout=5.0)
        except asyncio.TimeoutError:
            self._task.cancel()
        self._task = None
        self.running = False
        logger.info("Background → stopped after %d cycles", self.cycle_count)

    async def trigger(self) -> dict:
        """Force an immediate poll cycle. Returns cycle result."""
        self._trigger.set()
        # Give the loop a moment to pick up the trigger
        await asyncio.sleep(0.1)
        return self.status()

    def status(self) -> dict:
        return {
            "running": self.running,
            "cycle_count": self.cycle_count,
            "last_cycle_at": self.last_cycle_at.isoformat() if self.last_cycle_at else None,
            "last_cycle_ms": self.last_cycle_ms,
            "poll_interval_seconds": self.interval,
            "background_enabled": settings.background_enabled,
        }

    async def _poll_loop(self):
        logger.debug("Background → poll loop starting")
        while not self._stop.is_set():
            try:
                # Wait for interval or trigger
                try:
                    await asyncio.wait_for(self._trigger.wait(), timeout=self.interval)
                except asyncio.TimeoutError:
                    pass  # Normal timeout — time to poll

                if self._stop.is_set():
                    break

                self._trigger.clear()
                await self._run_cycle()

            except Exception as e:
                logger.error("Background → poll loop error: %s", e, exc_info=True)
                await asyncio.sleep(5)

    async def _run_cycle(self):
        start = time.monotonic()
        logger.debug("Background → cycle %d starting", self.cycle_count + 1)

        connections = await self.pool.fetch(
            """SELECT c.id, c.user_id, c.institution_id, c.access_token,
                      c.refresh_token, c.token_expires_at, c.status
               FROM connections c
               WHERE c.status = 'active'
               ORDER BY c.last_poll_at NULLS FIRST, c.id"""
        )

        results = []
        for conn in connections:
            # Check backoff
            backoff_delay = self._get_backoff_delay(conn["id"])
            if backoff_delay > 0:
                logger.debug(
                    "Background → skipping connection %d (backoff %ds remaining)",
                    conn["id"], backoff_delay,
                )
                continue

            result = await self._poll_connection(dict(conn))
            results.append(result)

        # Goal reassessment every 10 cycles (avoid LLM cost every 30s)
        if (self.cycle_count + 1) % 10 == 0:
            active_users = set()
            for conn in connections:
                active_users.add(conn["user_id"])
            for uid in active_users:
                try:
                    await goals.reassess_goals(self.pool, uid)
                except Exception as e:
                    logger.warning("Background → goal reassessment failed for user=%s: %s", uid, e)

        elapsed_ms = round((time.monotonic() - start) * 1000)
        self.cycle_count += 1
        self.last_cycle_at = datetime.now(timezone.utc)
        self.last_cycle_ms = elapsed_ms

        success = sum(1 for r in results if r.get("success"))
        failed = len(results) - success
        logger.info(
            "Background ← cycle %d complete: %d connections polled (%d ok, %d failed) in %dms",
            self.cycle_count, len(results), success, failed, elapsed_ms,
        )

    def _get_backoff_delay(self, connection_id: int) -> int:
        failures = self._backoff.get(connection_id, 0)
        if failures == 0:
            return 0
        # Exponential backoff: 10s, 20s, 40s, 80s, ... max 600s (10min)
        delay = min(10 * (2 ** (failures - 1)), 600)
        return delay

    async def _poll_connection(self, conn: dict) -> dict:
        conn_id = conn["id"]
        institution_id = conn["institution_id"]
        user_id = conn["user_id"]

        # Skip on-platform connections (e.g. Wealthsimple) — no external polling needed
        if conn.get("access_token") == "on-platform":
            logger.debug("Background → skipping on-platform connection %d", conn_id)
            return {"connection_id": conn_id, "success": True, "skipped": "on-platform"}

        logger.debug(
            "Background → polling connection %d institution=%s user=%s",
            conn_id, institution_id, user_id,
        )

        try:
            # 1. Ensure valid token
            access_token = await self._ensure_valid_token(conn)
            if access_token is None:
                return {"connection_id": conn_id, "success": False, "error": "token_refresh_failed"}

            # 2. Get previous account balances for anomaly detection
            prev_accounts = await self.pool.fetch(
                """SELECT account_id, balance, account_category
                   FROM connected_accounts
                   WHERE connection_id = $1 AND valid_to IS NULL""",
                conn_id,
            )
            prev_balances = {
                a["account_id"]: float(a["balance"] or 0)
                for a in prev_accounts
            }

            # 3. Get institution base_url
            institution = await registry.get_institution(institution_id)
            if institution is None:
                logger.warning("Background → institution %s not in registry", institution_id)
                return {"connection_id": conn_id, "success": False, "error": "institution_not_found"}

            base_url = institution["baseUrl"]

            # 4. Re-pull account data (SCD2)
            accounts = await data_pull.initial_data_pull(
                self.pool, conn_id, base_url, access_token,
            )

            # 5. Pull transactions
            account_ids = [a["account_id"] for a in accounts]
            await data_pull.pull_transactions(
                self.pool, conn_id, base_url, access_token, account_ids,
            )

            # 6. Detect balance anomalies
            new_balances = {a["account_id"]: float(a["balance"] or 0) for a in accounts}
            anomalies = self._detect_balance_anomalies(prev_balances, new_balances)
            for anomaly in anomalies:
                logger.warning(
                    "Background → anomaly detected connection=%d account=%s: %s",
                    conn_id, anomaly["account_id"], anomaly["detail"],
                )
                await self._log_event(
                    conn_id, institution_id, "anomaly_detected",
                    anomaly,
                )

            # 7. Compute metrics
            await twin.compute_metrics(self.pool, user_id)

            # 7b. Compute progress metrics + detect milestones
            try:
                progress = await twin.compute_progress_metrics(self.pool, user_id)
                new_milestones = await milestones.detect_milestones(self.pool, user_id, progress)
                if new_milestones:
                    for ms in new_milestones:
                        await self._log_event(
                            conn_id, institution_id, "milestone_achieved",
                            {"milestone_key": ms["milestone_key"],
                             "milestone_type": ms["milestone_type"],
                             "milestone_value": float(ms.get("milestone_value") or 0)},
                        )
            except Exception as e:
                logger.warning(
                    "Background → progress/milestones failed for user=%s: %s",
                    user_id, e,
                )

            # 8. Update last_poll_at
            await self.pool.execute(
                "UPDATE connections SET last_poll_at = now() WHERE id = $1", conn_id,
            )

            # 9. Log success
            await self._log_event(
                conn_id, institution_id, "background_poll_success",
                {"accounts": len(accounts), "anomalies": len(anomalies)},
            )

            # Reset backoff on success
            self._backoff.pop(conn_id, None)

            return {"connection_id": conn_id, "success": True, "accounts": len(accounts)}

        except Exception as e:
            error_type = self._classify_error(e)
            logger.warning(
                "Background → connection %d poll failed: %s (%s)",
                conn_id, error_type, e,
            )

            # Handle specific error types
            if error_type == "consent_revoked":
                await self.pool.execute(
                    "UPDATE connections SET status = 'revoked' WHERE id = $1", conn_id,
                )
                await self._log_event(
                    conn_id, institution_id, "consent_revoked",
                    {"error": str(e)},
                )
                self._backoff.pop(conn_id, None)
            elif error_type == "token_expired":
                await self.pool.execute(
                    "UPDATE connections SET status = 'stale' WHERE id = $1", conn_id,
                )
                await self._log_event(
                    conn_id, institution_id, "token_refresh_failed_401",
                    {"error": str(e)},
                )
                self._backoff.pop(conn_id, None)
            else:
                # Increment backoff
                self._backoff[conn_id] = self._backoff.get(conn_id, 0) + 1
                await self._log_event(
                    conn_id, institution_id, "background_poll_failed",
                    {"error": str(e), "error_type": error_type,
                     "backoff_failures": self._backoff[conn_id]},
                )

            return {"connection_id": conn_id, "success": False, "error": error_type}

    async def _ensure_valid_token(self, conn: dict) -> str | None:
        """Check if token needs refresh, refresh if needed. Returns valid access_token or None."""
        conn_id = conn["id"]
        institution_id = conn["institution_id"]
        access_token = conn["access_token"]
        refresh_token = conn["refresh_token"]
        expires_at = conn["token_expires_at"]

        # If no expiry info, assume token is still valid
        if expires_at is None:
            return access_token

        now = datetime.now(timezone.utc)
        buffer = timedelta(seconds=self.token_buffer)

        if now + buffer < expires_at:
            # Token still valid with buffer
            return access_token

        logger.info(
            "Background → token expiring for connection %d (expires_at=%s), refreshing",
            conn_id, expires_at,
        )

        # Get template for token endpoint
        template = await template_discovery.get_cached_template(self.pool, institution_id)
        if template is None:
            logger.error("Background → no template for %s, cannot refresh", institution_id)
            return None

        try:
            tokens = await oauth_flow.refresh_access_token(template, refresh_token)
            new_access = tokens["access_token"]
            new_refresh = tokens.get("refresh_token", refresh_token)
            expires_in = tokens.get("expires_in", 1800)
            new_expires = now + timedelta(seconds=expires_in)

            await self.pool.execute(
                """UPDATE connections SET access_token = $1, refresh_token = $2,
                   token_expires_at = $3 WHERE id = $4""",
                new_access, new_refresh, new_expires, conn_id,
            )

            await self._log_event(
                conn_id, institution_id, "token_refreshed",
                {"expires_in": expires_in},
            )

            logger.info("Background ← token refreshed for connection %d", conn_id)
            return new_access

        except Exception as e:
            logger.error("Background → token refresh failed for connection %d: %s", conn_id, e)
            raise

    def _detect_balance_anomalies(
        self, prev: dict[str, float], new: dict[str, float],
    ) -> list[dict]:
        """Detect percentage-based balance anomalies between polls."""
        anomalies = []
        for account_id, new_bal in new.items():
            old_bal = prev.get(account_id)
            if old_bal is None or old_bal == 0:
                continue

            pct_change = abs(new_bal - old_bal) / abs(old_bal)
            if pct_change >= self.anomaly_threshold:
                anomalies.append({
                    "account_id": account_id,
                    "previous_balance": old_bal,
                    "new_balance": new_bal,
                    "pct_change": round(pct_change * 100, 1),
                    "detail": f"Balance changed {pct_change*100:.1f}% "
                              f"(${old_bal:,.2f} → ${new_bal:,.2f})",
                })
        return anomalies

    def _classify_error(self, e: Exception) -> str:
        """Classify an HTTP/connection error for handling."""
        err_str = str(e).lower()
        if "403" in err_str or "forbidden" in err_str or "consent" in err_str:
            return "consent_revoked"
        if "401" in err_str or "unauthorized" in err_str:
            return "token_expired"
        if "429" in err_str or "rate" in err_str:
            return "rate_limited"
        if "timeout" in err_str:
            return "timeout"
        return "transient_error"

    async def poll_connection(self, connection_id: int) -> dict:
        """Poll a single connection immediately (for admin-triggered polls)."""
        conn = await self.pool.fetchrow(
            """SELECT id, user_id, institution_id, access_token,
                      refresh_token, token_expires_at, status
               FROM connections WHERE id = $1 AND status = 'active'""",
            connection_id,
        )
        if conn is None:
            return {"connection_id": connection_id, "success": False, "error": "not_found"}
        return await self._poll_connection(dict(conn))

    async def _log_event(
        self, connection_id: int, institution_id: str,
        event_type: str, details: dict,
    ):
        await self.pool.execute(
            """INSERT INTO onboarding_events (connection_id, institution_id, event_type, details)
               VALUES ($1, $2, $3, $4)""",
            connection_id, institution_id, event_type, json.dumps(details),
        )
