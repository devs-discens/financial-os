import logging
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from ..db.database import get_pool
from ..services import auth as auth_service
from ..middleware.auth import get_current_user, AuthUser

logger = logging.getLogger("onboarding")
router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    username: str
    display_name: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


def _make_user_response(user: dict) -> dict:
    """Strip password_hash from user dict for API responses."""
    return {k: v for k, v in user.items() if k != "password_hash"}


@router.post("/register")
async def register(req: RegisterRequest):
    """Register a new user."""
    logger.info("Auth → register username=%s", req.username)
    pool = get_pool()

    existing = await auth_service.get_user_by_username(pool, req.username)
    if existing:
        raise HTTPException(409, "Username already taken")

    # Use username as user_id
    user = await auth_service.create_user(
        pool, req.username, req.username, req.display_name, req.password,
    )
    access_token = auth_service.create_access_token(user["id"], user["role"])
    refresh_token = auth_service.create_refresh_token(user["id"], user["role"])

    logger.info("Auth ← registered user=%s", user["id"])
    return {
        "user": user,
        "access_token": access_token,
        "refresh_token": refresh_token,
    }


@router.post("/login")
async def login(req: LoginRequest):
    """Authenticate and return tokens."""
    logger.info("Auth → login username=%s", req.username)
    pool = get_pool()

    user = await auth_service.get_user_by_username(pool, req.username)
    if not user or not auth_service.verify_password(req.password, user["password_hash"]):
        raise HTTPException(401, "Invalid username or password")

    access_token = auth_service.create_access_token(user["id"], user["role"])
    refresh_token = auth_service.create_refresh_token(user["id"], user["role"])

    logger.info("Auth ← login success user=%s", user["id"])
    return {
        "user": _make_user_response(user),
        "access_token": access_token,
        "refresh_token": refresh_token,
    }


@router.get("/me")
async def get_me(user: AuthUser = Depends(get_current_user)):
    """Return current authenticated user info."""
    pool = get_pool()
    db_user = await auth_service.get_user(pool, user.user_id)
    if not db_user:
        raise HTTPException(404, "User not found")
    return {"user": db_user}


@router.patch("/me/profile")
async def update_profile(body: dict, user: AuthUser = Depends(get_current_user)):
    """Update current user's profile fields (merge)."""
    logger.info("Auth → update_profile user=%s fields=%s", user.user_id, list(body.keys()))
    pool = get_pool()
    updated = await auth_service.update_profile(pool, user.user_id, body)
    if not updated:
        raise HTTPException(404, "User not found")
    logger.info("Auth ← profile updated user=%s", user.user_id)
    return {"user": updated}


@router.post("/refresh")
async def refresh(req: RefreshRequest):
    """Exchange a refresh token for a new access token."""
    payload = auth_service.decode_token(req.refresh_token)
    if payload is None or payload.get("type") != "refresh":
        raise HTTPException(401, "Invalid or expired refresh token")

    access_token = auth_service.create_access_token(payload["sub"], payload.get("role", "user"))
    return {"access_token": access_token}
