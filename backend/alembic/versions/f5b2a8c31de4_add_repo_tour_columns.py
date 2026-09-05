"""add tour_markdown + tour_generated_at to repos

Revision ID: f5b2a8c31de4
Revises: e3c9a1d7f5b2
Create Date: 2026-09-06 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "f5b2a8c31de4"
down_revision = "e3c9a1d7f5b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("repos", sa.Column("tour_markdown", sa.Text(), nullable=True))
    op.add_column(
        "repos",
        sa.Column("tour_generated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("repos", "tour_generated_at")
    op.drop_column("repos", "tour_markdown")
