import hmac
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import Cookie, Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings

ALGORITHM = "HS256"
COOKIE_NAME = "scholaread_token"

bearer_scheme = HTTPBearer(auto_error=False)


def verify_admin_credentials(username: str, password: str) -> bool:
    u_ok = hmac.compare_digest(username.strip(), settings.ADMIN_USERNAME)
    p_ok = hmac.compare_digest(password, settings.ADMIN_PASSWORD)
    return u_ok and p_ok


def create_access_token(username: str) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(hours=settings.JWT_EXPIRE_HOURS)
    payload = {
        "sub": username,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[ALGORITHM])
        sub = payload.get("sub")
        if not sub:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject"
            )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired, please log in again"
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication token"
        )


def extract_token_from_request(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    cookie_token: Optional[str] = Cookie(default=None, alias=COOKIE_NAME),
    token: Optional[str] = Query(default=None),
) -> str:
    if credentials and credentials.credentials:
        return credentials.credentials
    if cookie_token:
        return cookie_token
    if token:
        return token
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required",
    )


def get_current_user(raw_token: str = Depends(extract_token_from_request)) -> str:
    payload = decode_token(raw_token)
    return str(payload["sub"])
