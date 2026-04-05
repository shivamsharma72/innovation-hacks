from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import APIRouter, Depends, HTTPException, status

from app.auth_jwt import get_auth0_payload
from app.config import get_settings
from app.crypto_util import decrypt_secret, encrypt_secret
from app.db import get_db
from app.models import CanvasCredential, User
from app.services.users import get_or_create_user

router = APIRouter(prefix="/me", tags=["me"])


class CanvasOnboardBody(BaseModel):
    canvas_domain: str = Field(..., min_length=4, max_length=255)
    canvas_token: str = Field(..., min_length=8, max_length=2048)


@router.get("")
async def me(
    payload: dict = Depends(get_auth0_payload),
    session: AsyncSession = Depends(get_db),
):
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing sub")
    email = payload.get("email")
    user = await get_or_create_user(session, sub, email)
    return {
        "sub": sub,
        "email": user.email,
        "onboarding_complete": user.onboarding_complete,
    }


@router.post("/canvas")
async def save_canvas(
    body: CanvasOnboardBody,
    payload: dict = Depends(get_auth0_payload),
    session: AsyncSession = Depends(get_db),
):
    settings = get_settings()
    if not settings.encryption_key:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "ENCRYPTION_KEY is not set on the gateway",
        )
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing sub")
    email = payload.get("email")
    user = await get_or_create_user(session, sub, email)

    domain = body.canvas_domain.strip().lower().replace("https://", "").split("/")[0]
    try:
        enc = encrypt_secret(settings.encryption_key, body.canvas_token.strip())
    except ValueError as e:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "ENCRYPTION_KEY is invalid. Generate with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"",
        ) from e

    r = await session.execute(
        select(CanvasCredential).where(CanvasCredential.user_id == user.id)
    )
    existing = r.scalar_one_or_none()
    if existing:
        existing.canvas_domain = domain
        existing.token_encrypted = enc
        session.add(existing)
    else:
        session.add(
            CanvasCredential(user_id=user.id, canvas_domain=domain, token_encrypted=enc)
        )
    user.onboarding_complete = True
    session.add(user)
    await session.commit()
    return {"ok": True, "onboarding_complete": True}


@router.get("/canvas/status")
async def canvas_status(
    payload: dict = Depends(get_auth0_payload),
    session: AsyncSession = Depends(get_db),
):
    """Verify stored token still works (optional sanity check)."""
    settings = get_settings()
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing sub")
    r = await session.execute(select(User).where(User.auth0_sub == sub))
    user = r.scalar_one_or_none()
    if not user:
        return {"configured": False}
    r2 = await session.execute(
        select(CanvasCredential).where(CanvasCredential.user_id == user.id)
    )
    cred = r2.scalar_one_or_none()
    if not cred:
        return {"configured": False}
    try:
        decrypt_secret(settings.encryption_key, cred.token_encrypted)
    except ValueError:
        return {"configured": True, "decrypt_ok": False}
    return {"configured": True, "domain": cred.canvas_domain, "decrypt_ok": True}
