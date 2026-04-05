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


class UserMemory(SQLModel, table=True):
    __tablename__ = "user_memory"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="app_user.id", index=True)
    key: str
    value_json: str  # JSON-encoded value
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class PendingAction(SQLModel, table=True):
    __tablename__ = "pending_action"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="app_user.id", index=True)
    action_type: str  # e.g. "gws__send_gmail_message"
    payload_json: str  # serialized tool arguments
    status: str = Field(default="pending", index=True)  # pending/approved/rejected/executed/failed
    result_json: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    resolved_at: Optional[datetime] = None


class ChatSession(SQLModel, table=True):
    __tablename__ = "chat_session"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="app_user.id", index=True)
    title: str  # first 80 chars of first user message
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_message_at: datetime = Field(default_factory=datetime.utcnow)


class ChatMessage(SQLModel, table=True):
    __tablename__ = "chat_message"

    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="chat_session.id", index=True)
    role: str  # "user" | "assistant"
    content: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
