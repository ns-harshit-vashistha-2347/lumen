import secrets
import urllib.parse
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse

from src.core.rate_limit import limiter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.db import get_db
from src.core.deps import get_current_user
from src.core.jwt import (
    create_access_token,
    generate_refresh_token,
    hash_refresh_token,
)
from src.core.logging import get_logger
from src.core.security import hash_password, verify_password
from src.models.user import AuthProvider, RefreshToken, User
from src.schemas.auth import (
    LoginRequest,
    RefreshRequest,
    SignupRequest,
    TokenPair,
    UserResponse,
)

auth_router = APIRouter(prefix="/auth", tags=["Auth"])
logger = get_logger(__name__)


async def _issue_token_pair(user: User, db: AsyncSession) -> TokenPair:
    access = create_access_token(subject=str(user.id), extra_claims={"email": user.email})
    raw_refresh, token_hash, expires_at = generate_refresh_token()
    db.add(RefreshToken(user_id=user.id, token_hash=token_hash, expires_at=expires_at))
    await db.commit()
    return TokenPair(access_token=access, refresh_token=raw_refresh)


@auth_router.post("/signup", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def signup(request: Request, payload: SignupRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == payload.email.lower()))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email is already registered")

    user = User(
        email=payload.email.lower(),
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        provider=AuthProvider.LOCAL,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return await _issue_token_pair(user, db)


@auth_router.post("/login", response_model=TokenPair)
@limiter.limit("10/minute")
async def login(request: Request, payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == payload.email.lower()))
    user = result.scalar_one_or_none()

    if not user or not user.hashed_password or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is inactive")

    return await _issue_token_pair(user, db)


@auth_router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, db: AsyncSession = Depends(get_db)):
    token_hash = hash_refresh_token(payload.refresh_token)
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    token = result.scalar_one_or_none()

    if not token or token.revoked:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    if token.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Refresh token expired")

    token.revoked = True
    await db.flush()

    user_result = await db.execute(select(User).where(User.id == token.user_id))
    user = user_result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    return await _issue_token_pair(user, db)


@auth_router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(payload: RefreshRequest, db: AsyncSession = Depends(get_db)):
    token_hash = hash_refresh_token(payload.refresh_token)
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    token = result.scalar_one_or_none()
    if token and not token.revoked:
        token.revoked = True
        await db.commit()
    return None


@auth_router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)):
    return current_user


GOOGLE_AUTHZ_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


OAUTH_STATE_COOKIE = "oauth_state"
OAUTH_STATE_TTL_SECONDS = 600


@auth_router.get("/google/login")
async def google_login():
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Google OAuth not configured")
    state = secrets.token_urlsafe(32)
    params = {
        "response_type": "code",
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    response = RedirectResponse(f"{GOOGLE_AUTHZ_URL}?{urllib.parse.urlencode(params)}")
    response.set_cookie(
        OAUTH_STATE_COOKIE,
        state,
        max_age=OAUTH_STATE_TTL_SECONDS,
        httponly=True,
        secure=settings.ENV != "local",
        samesite="lax",
    )
    return response


@auth_router.get("/google/callback")
async def google_callback(request: Request, db: AsyncSession = Depends(get_db)):
    code = request.query_params.get("code")
    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")

    received_state = request.query_params.get("state")
    expected_state = request.cookies.get(OAUTH_STATE_COOKIE)
    if not received_state or not expected_state or not secrets.compare_digest(
        received_state, expected_state
    ):
        raise HTTPException(status_code=400, detail="Invalid OAuth state")

    async with httpx.AsyncClient(timeout=15) as client:
        token_resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": settings.GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
        )
        if token_resp.status_code != 200:
            logger.error(f"Google token exchange failed: {token_resp.text}")
            raise HTTPException(status_code=400, detail="Google token exchange failed")
        access_token = token_resp.json().get("access_token")

        user_resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if user_resp.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to fetch Google userinfo")
        userinfo = user_resp.json()

    email = (userinfo.get("email") or "").lower()
    if not email:
        raise HTTPException(status_code=400, detail="Google account has no email")

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user is None:
        user = User(
            email=email,
            full_name=userinfo.get("name"),
            avatar_url=userinfo.get("picture"),
            provider=AuthProvider.GOOGLE,
            provider_user_id=userinfo.get("sub"),
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    else:
        changed = False
        if user.provider == AuthProvider.LOCAL:
            user.provider = AuthProvider.GOOGLE
            user.provider_user_id = userinfo.get("sub")
            changed = True
        if not user.avatar_url and userinfo.get("picture"):
            user.avatar_url = userinfo.get("picture")
            changed = True
        if changed:
            await db.commit()

    tokens = await _issue_token_pair(user, db)

    redirect_target = (
        f"{settings.FRONTEND_URL}/auth/callback"
        f"#access_token={tokens.access_token}&refresh_token={tokens.refresh_token}"
    )
    response = RedirectResponse(redirect_target)
    response.delete_cookie(OAUTH_STATE_COOKIE)
    return response
