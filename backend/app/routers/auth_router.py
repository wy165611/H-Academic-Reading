from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.auth import COOKIE_NAME, create_access_token, get_current_user, verify_admin_credentials
from app.schemas import LoginRequest, TokenResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, response: Response):
    if not verify_admin_credentials(payload.username, payload.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
        )
    token = create_access_token(payload.username.strip())
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        path="/",
        max_age=7 * 24 * 3600,
    )
    return TokenResponse(access_token=token, username=payload.username.strip())


@router.get("/me")
def me(username: str = Depends(get_current_user)):
    return {"username": username}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(key=COOKIE_NAME, path="/")
    return {"ok": True}
