"""create repos and repo_files tables

Revision ID: c1a7f2e9d4b0
Revises: b8d4e2f1a9c3
Create Date: 2026-08-24 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "c1a7f2e9d4b0"
down_revision = "b8d4e2f1a9c3"   
branch_labels = None
depends_on = None


def upgrade() -> None:
    repo_status = sa.Enum(
        "pending", "cloning", "parsing", "embedding", "storing",
        "graph_building", "completed", "failed",
        name="repostatus",
    )
    repo_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "repos",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("provider", sa.String(32), nullable=False, server_default="github"),
        sa.Column("owner", sa.String(255), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("default_branch", sa.String(255), nullable=False, server_default="main"),
        sa.Column("clone_url", sa.String(1024), nullable=False),
        sa.Column("is_private", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("encrypted_token", sa.Text, nullable=True),
        sa.Column("status", repo_status, nullable=False, server_default="pending"),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("total_files", sa.Integer, nullable=False, server_default="0"),
        sa.Column("indexed_files", sa.Integer, nullable=False, server_default="0"),
        sa.Column("total_chunks", sa.Integer, nullable=False, server_default="0"),
        sa.Column("size_bytes", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("last_indexed_sha", sa.String(64), nullable=True),
        sa.Column("collection_name", sa.String(255), nullable=False),
        sa.Column("webhook_secret", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "provider", "owner", "name", name="uq_user_repo"),
    )

    op.create_table(
        "repo_files",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("repo_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("repos.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("path", sa.String(1024), nullable=False),
        sa.Column("language", sa.String(32), nullable=True),
        sa.Column("size_bytes", sa.Integer, nullable=False, server_default="0"),
        sa.Column("sha", sa.String(64), nullable=True),
        sa.Column("chunk_count", sa.Integer, nullable=False, server_default="0"),
        sa.UniqueConstraint("repo_id", "path", name="uq_repo_file_path"),
    )


def downgrade() -> None:
    op.drop_table("repo_files")
    op.drop_table("repos")
    sa.Enum(name="repostatus").drop(op.get_bind(), checkfirst=True)