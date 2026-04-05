from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class User(SQLModel, table=True):
    __tablename__ = "app_user"

    id: Optional[int] = Field(default=None, primary_key=True)
    auth0_sub: str = Field(unique=True, index=True)
    email: Optional[str] = None
    onboarding_complete: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CanvasCredential(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="app_user.id", unique=True)
    canvas_domain: str
    token_encrypted: str
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class GoogleCredential(SQLModel, table=True):
    """Legacy table: Google is authenticated only via Workspace MCP now. Kept so existing DBs migrate without errors."""

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="app_user.id", unique=True)
    refresh_token_encrypted: str
    scopes: str = ""
    updated_at: datetime = Field(default_factory=datetime.utcnow)
