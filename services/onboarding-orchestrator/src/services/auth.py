import json
import logging
from datetime import datetime, timezone, timedelta

import bcrypt
import jwt

from ..config import settings

logger = logging.getLogger("onboarding")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(user_id: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "role": role,
        "type": "access",
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_refresh_token(user_id: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "role": role,
        "type": "refresh",
        "iat": now,
        "exp": now + timedelta(days=settings.refresh_token_expire_days),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        return None


async def get_user(pool, user_id: str) -> dict | None:
    row = await pool.fetchrow(
        "SELECT id, username, display_name, role, created_at, profile FROM users WHERE id = $1",
        user_id,
    )
    if not row:
        return None
    user = dict(row)
    # Parse JSONB profile — asyncpg returns it as a string
    if isinstance(user.get("profile"), str):
        user["profile"] = json.loads(user["profile"])
    return user


async def get_user_by_username(pool, username: str) -> dict | None:
    row = await pool.fetchrow("SELECT * FROM users WHERE username = $1", username)
    if not row:
        return None
    user = dict(row)
    if isinstance(user.get("profile"), str):
        user["profile"] = json.loads(user["profile"])
    return user


async def create_user(pool, user_id: str, username: str, display_name: str, password: str, role: str = "user") -> dict:
    hashed = hash_password(password)
    await pool.execute(
        """INSERT INTO users (id, username, display_name, password_hash, role)
           VALUES ($1, $2, $3, $4, $5)""",
        user_id, username, display_name, hashed, role,
    )
    return {"id": user_id, "username": username, "display_name": display_name, "role": role, "profile": {}}


SEED_USER_PROFILES = {
    "alex-chen": {
        "age": 34,
        "occupation": "Software Engineer",
        "employer": "Shopify",
        "income": 105000,
        "city": "Toronto",
        "province": "ON",
        "relationship_status": "Common-law",
        "housing_status": "Renting",
        "dependents": 0,
        "financial_goals": ["First home purchase", "Emergency fund", "Retirement savings"],
    },
    "sarah-johnson": {
        "age": 29,
        "occupation": "Freelance Designer",
        "employer": "Self-employed",
        "income": 72000,
        "city": "Vancouver",
        "province": "BC",
        "relationship_status": "Single",
        "housing_status": "Renting",
        "dependents": 0,
        "financial_goals": ["Build savings", "Invest for growth"],
    },
    "marcus-williams": {
        "age": 42,
        "occupation": "Marketing Director",
        "employer": "Bell Canada",
        "income": 145000,
        "city": "Ottawa",
        "province": "ON",
        "relationship_status": "Married",
        "housing_status": "Homeowner",
        "dependents": 2,
        "financial_goals": ["Education fund", "Mortgage paydown", "Retirement planning"],
    },
    "priya-patel": {
        "age": 36,
        "occupation": "Design Studio Owner",
        "employer": "Patel Design Co.",
        "income": 95000,
        "city": "Montreal",
        "province": "QC",
        "relationship_status": "Single",
        "housing_status": "Renting",
        "dependents": 0,
        "financial_goals": ["Business expansion", "Personal savings", "Tax optimization"],
    },
    "david-kim": {
        "age": 31,
        "occupation": "Tech Lead",
        "employer": "Wealthsimple",
        "income": 125000,
        "city": "Calgary",
        "province": "AB",
        "relationship_status": "Single",
        "housing_status": "Renting",
        "dependents": 0,
        "financial_goals": ["Investment growth", "Business development", "Home purchase"],
    },
    "emma-rodriguez": {
        "age": 38,
        "occupation": "Project Manager",
        "employer": "Deloitte",
        "income": 92000,
        "city": "Toronto",
        "province": "ON",
        "relationship_status": "Single parent",
        "housing_status": "Homeowner",
        "dependents": 1,
        "financial_goals": ["Mortgage paydown", "Education fund", "Emergency fund"],
    },
}

SEED_USERS = [
    ("alex-chen", "alex-chen", "Alex Chen", "password123", "user"),
    ("sarah-johnson", "sarah-johnson", "Sarah Johnson", "password123", "user"),
    ("marcus-williams", "marcus-williams", "Marcus Williams", "password123", "user"),
    ("priya-patel", "priya-patel", "Priya Patel", "password123", "user"),
    ("david-kim", "david-kim", "David Kim", "password123", "user"),
    ("emma-rodriguez", "emma-rodriguez", "Emma Rodriguez", "password123", "user"),
    ("admin", "admin", "Admin", "admin123", "admin"),
]


async def update_profile(pool, user_id: str, profile_fields: dict) -> dict | None:
    """Merge profile_fields into existing profile JSONB and return updated user."""
    row = await pool.fetchrow(
        "SELECT id, profile FROM users WHERE id = $1", user_id,
    )
    if not row:
        return None
    current = row["profile"]
    if isinstance(current, str):
        current = json.loads(current) if current else {}
    elif current is None:
        current = {}
    merged = {**current, **profile_fields}
    await pool.execute(
        "UPDATE users SET profile = $1 WHERE id = $2",
        json.dumps(merged), user_id,
    )
    return await get_user(pool, user_id)


async def seed_users(pool):
    """Create seed users if they don't exist. Uses upsert pattern so adding new
    seed users doesn't require a full reset. Also backfills profiles."""
    created = 0
    profiles_updated = 0
    for user_id, username, display_name, password, role in SEED_USERS:
        existing = await pool.fetchval("SELECT id FROM users WHERE id = $1", user_id)
        if existing is None:
            await create_user(pool, user_id, username, display_name, password, role)
            created += 1

        # Backfill profile data for seed users (idempotent)
        profile = SEED_USER_PROFILES.get(user_id)
        if profile:
            current = await pool.fetchval("SELECT profile FROM users WHERE id = $1", user_id)
            if current is None or current == {} or current == "{}":
                await pool.execute(
                    "UPDATE users SET profile = $1 WHERE id = $2",
                    json.dumps(profile), user_id,
                )
                profiles_updated += 1

    if created > 0:
        logger.info("Auth ← seeded %d new users (total seed: %d)", created, len(SEED_USERS))
    else:
        logger.debug("Auth → all %d seed users already exist", len(SEED_USERS))
    if profiles_updated > 0:
        logger.info("Auth ← backfilled %d user profiles", profiles_updated)
