import logging
from dataclasses import dataclass

from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from ..services.auth import decode_token

logger = logging.getLogger("onboarding")

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class AuthUser:
    user_id: str
    role: str

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> AuthUser:
    """Require a valid JWT. Returns AuthUser or raises 401."""
    if credentials is None:
        raise HTTPException(401, "Authentication required")

    payload = decode_token(credentials.credentials)
    if payload is None:
        raise HTTPException(401, "Invalid or expired token")

    if payload.get("type") != "access":
        raise HTTPException(401, "Invalid token type")

    return AuthUser(user_id=payload["sub"], role=payload.get("role", "user"))


async def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> AuthUser | None:
    """Optionally extract user from JWT. Returns None if no token provided."""
    if credentials is None:
        return None

    payload = decode_token(credentials.credentials)
    if payload is None:
        return None

    if payload.get("type") != "access":
        return None

    return AuthUser(user_id=payload["sub"], role=payload.get("role", "user"))


async def require_admin(
    user: AuthUser = Depends(get_current_user),
) -> AuthUser:
    """Require admin role. Returns AuthUser or raises 403."""
    if not user.is_admin:
        raise HTTPException(403, "Admin access required")
    return user


def resolve_user_id(auth_user: AuthUser | None, fallback: str) -> str:
    """Return authenticated user_id if present, otherwise the fallback parameter."""
    if auth_user is not None:
        return auth_user.user_id
    return fallback
