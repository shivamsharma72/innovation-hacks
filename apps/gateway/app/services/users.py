from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User


async def get_or_create_user(
    session: AsyncSession,
    auth0_sub: str,
    email: str | None,
) -> User:
    r = await session.execute(select(User).where(User.auth0_sub == auth0_sub))
    user = r.scalar_one_or_none()
    if user:
        if email and user.email != email:
            user.email = email
            session.add(user)
            await session.commit()
            await session.refresh(user)
        return user
    user = User(auth0_sub=auth0_sub, email=email, onboarding_complete=False)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user
