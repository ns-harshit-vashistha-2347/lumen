"""add repo_id to eval_suites so a suite can target a code repo

Revision ID: d7f9a4c81b02
Revises: a1b2c3d4e5f6
Create Date: 2026-09-08 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "d7f9a4c81b02"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "eval_suites",
        sa.Column("repo_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_eval_suites_repo_id_repos",
        source_table="eval_suites",
        referent_table="repos",
        local_cols=["repo_id"],
        remote_cols=["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_eval_suites_repo_id", "eval_suites", ["repo_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_eval_suites_repo_id", table_name="eval_suites")
    op.drop_constraint(
        "fk_eval_suites_repo_id_repos", "eval_suites", type_="foreignkey"
    )
    op.drop_column("eval_suites", "repo_id")
