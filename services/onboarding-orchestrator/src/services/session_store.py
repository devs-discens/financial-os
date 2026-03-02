"""
Council session persistence with pgvector similarity search.

Sessions are stored after each council run. Embeddings enable
"You've explored similar questions" detection before new LLM calls.
"""

import json
import logging

import asyncpg

logger = logging.getLogger("onboarding")


async def store_session(
    pool: asyncpg.Pool,
    user_id: str,
    mode: str,
    question: str,
    response: dict,
    synthesis: str | None,
    elapsed_ms: int | None,
    embedding: list[float] | None = None,
    goal_id: int | None = None,
) -> int:
    """Insert a council session with optional embedding and goal link. Returns session ID."""
    embedding_str = _format_embedding(embedding)

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO council_sessions
                (user_id, mode, question, question_embedding, response, synthesis, elapsed_ms, goal_id)
            VALUES ($1, $2, $3, $4::vector, $5::jsonb, $6, $7, $8)
            RETURNING id
            """,
            user_id,
            mode,
            question,
            embedding_str,
            json.dumps(response),
            synthesis,
            elapsed_ms,
            goal_id,
        )
    session_id = row["id"]
    logger.info("SessionStore ← stored session %d for user=%s mode=%s goal_id=%s", session_id, user_id, mode, goal_id)
    return session_id


async def find_similar(
    pool: asyncpg.Pool,
    user_id: str,
    embedding: list[float],
    threshold: float = 0.85,
    limit: int = 5,
) -> list[dict]:
    """Find semantically similar past questions via cosine similarity."""
    embedding_str = _format_embedding(embedding)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, mode, question, synthesis, elapsed_ms, goal_id, created_at,
                   1 - (question_embedding <=> $1::vector) AS similarity
            FROM council_sessions
            WHERE user_id = $2
              AND question_embedding IS NOT NULL
              AND archived = FALSE
              AND 1 - (question_embedding <=> $1::vector) >= $3
            ORDER BY similarity DESC
            LIMIT $4
            """,
            embedding_str,
            user_id,
            threshold,
            limit,
        )

    matches = [
        {
            "session_id": r["id"],
            "mode": r["mode"],
            "question": r["question"],
            "synthesis": r["synthesis"],
            "elapsed_ms": r["elapsed_ms"],
            "goal_id": r["goal_id"],
            "similarity": round(float(r["similarity"]), 4),
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]
    logger.debug("SessionStore ← find_similar found %d matches (threshold=%.2f)", len(matches), threshold)
    return matches


async def archive_session(pool: asyncpg.Pool, session_id: int) -> bool:
    """Soft-archive a council session. Returns True if a row was updated."""
    async with pool.acquire() as conn:
        result = await conn.execute(
            "UPDATE council_sessions SET archived = TRUE WHERE id = $1 AND archived = FALSE",
            session_id,
        )
    archived = result == "UPDATE 1"
    if archived:
        logger.info("SessionStore ← archived session %d", session_id)
    return archived


async def link_session_to_goal(pool: asyncpg.Pool, session_id: int, goal_id: int) -> bool:
    """Link an existing session to a goal. Returns True if updated."""
    async with pool.acquire() as conn:
        result = await conn.execute(
            "UPDATE council_sessions SET goal_id = $1 WHERE id = $2",
            goal_id, session_id,
        )
    linked = result == "UPDATE 1"
    if linked:
        logger.info("SessionStore ← linked session %d to goal %d", session_id, goal_id)
    return linked


async def get_session(pool: asyncpg.Pool, session_id: int) -> dict | None:
    """Get a full session including response JSONB."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, user_id, mode, question, response, synthesis, elapsed_ms, goal_id, created_at
            FROM council_sessions
            WHERE id = $1
            """,
            session_id,
        )

    if not row:
        return None

    return {
        "session_id": row["id"],
        "user_id": row["user_id"],
        "mode": row["mode"],
        "question": row["question"],
        "response": json.loads(row["response"]),
        "synthesis": row["synthesis"],
        "elapsed_ms": row["elapsed_ms"],
        "goal_id": row["goal_id"],
        "created_at": row["created_at"].isoformat(),
    }


async def list_sessions(
    pool: asyncpg.Pool,
    user_id: str,
    limit: int = 20,
) -> list[dict]:
    """List recent sessions without response body (lightweight for lists)."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, mode, question, synthesis, elapsed_ms, goal_id, created_at
            FROM council_sessions
            WHERE user_id = $1
              AND archived = FALSE
            ORDER BY created_at DESC
            LIMIT $2
            """,
            user_id,
            limit,
        )

    return [
        {
            "session_id": r["id"],
            "mode": r["mode"],
            "question": r["question"],
            "synthesis": r["synthesis"],
            "elapsed_ms": r["elapsed_ms"],
            "goal_id": r["goal_id"],
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]


def _format_embedding(embedding: list[float] | None) -> str | None:
    """Format embedding list as pgvector string literal '[0.1,0.2,...]'."""
    if embedding is None:
        return None
    return "[" + ",".join(str(v) for v in embedding) + "]"
