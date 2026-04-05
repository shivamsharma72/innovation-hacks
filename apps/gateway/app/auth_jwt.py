import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from app.config import get_settings

bearer = HTTPBearer(auto_error=False)


def _jwks_client() -> PyJWKClient:
    s = get_settings()
    if not s.auth0_domain:
        raise RuntimeError("AUTH0_DOMAIN not set")
    return PyJWKClient(f"https://{s.auth0_domain}/.well-known/jwks.json")


async def get_auth0_payload(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> dict:
    settings = get_settings()
    if settings.skip_auth:
        return {"sub": "dev-user", "email": "dev@local.test"}

    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )

    token = creds.credentials
    if not settings.auth0_domain or not settings.auth0_audience:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server auth is not configured",
        )

    try:
        jwks = _jwks_client()
        key = jwks.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            key.key,
            algorithms=["RS256"],
            audience=settings.auth0_audience,
            issuer=f"https://{settings.auth0_domain}/",
        )
        return payload
    except jwt.exceptions.PyJWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {e!s}",
        ) from e
