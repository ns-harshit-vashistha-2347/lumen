"""add chat sessions and messages

Revision ID: e3c9a1d7f5b2
Revises: c1a7f2e9d4b0
Create Date: 2026-08-27 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "e3c9a1d7f5b2"
down_revision = "c1a7f2e9d4b0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # create_type=False on the columns below prevents SQLAlchemy from
    # re-issuing CREATE TYPE when it emits the table DDL — we create the
    # enums explicitly with checkfirst=True right here.
    chatkind = postgresql.ENUM("doc", "code", name="chatkind", create_type=False)
    chatrole = postgresql.ENUM("user", "assistant", name="chatrole", create_type=False)
    sa.Enum("doc", "code", name="chatkind").create(op.get_bind(), checkfirst=True)
    sa.Enum("user", "assistant", name="chatrole").create(op.get_bind(), checkfirst=True)

    op.create_table(
        "chat_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"),
                  nullable=False, index=True),
        sa.Column("kind", chatkind, nullable=False),
        sa.Column("repo_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("repos.id", ondelete="CASCADE"),
                  nullable=True, index=True),
        sa.Column("title", sa.String(255), nullable=False, server_default="new chat"),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "chat_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("session_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("chat_sessions.id", ondelete="CASCADE"),
                  nullable=False, index=True),
        sa.Column("role", chatrole, nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("payload", postgresql.JSONB, nullable=True),
        sa.Column("trace_id", sa.String(64), nullable=True, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("chat_messages")
    op.drop_table("chat_sessions")
    sa.Enum(name="chatrole").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="chatkind").drop(op.get_bind(), checkfirst=True)
