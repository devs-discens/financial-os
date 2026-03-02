import asyncpg
import logging

logger = logging.getLogger("onboarding")

pool: asyncpg.Pool | None = None


async def init_pool(database_url: str, min_size: int = 2, max_size: int = 10) -> asyncpg.Pool:
    global pool
    logger.debug("DB → init_pool min=%d max=%d", min_size, max_size)
    pool = await asyncpg.create_pool(database_url, min_size=min_size, max_size=max_size)
    logger.info("DB pool initialized (min=%d, max=%d)", min_size, max_size)
    return pool


async def close_pool():
    global pool
    if pool:
        await pool.close()
        pool = None
        logger.info("DB pool closed")


def get_pool() -> asyncpg.Pool:
    if pool is None:
        raise RuntimeError("Database pool not initialized")
    return pool
