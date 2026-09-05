"""add eval suites/cases/runs/results tables

Revision ID: a1b2c3d4e5f6
Revises: f5b2a8c31de4
Create Date: 2026-09-06 12:05:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "a1b2c3d4e5f6"
down_revision = "f5b2a8c31de4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    sa.Enum(
        "queued", "running", "completed", "failed",
        name="evalrunstatus",
    ).create(op.get_bind(), checkfirst=True)
    sa.Enum(
        "pass", "partial", "fail", "error",
        name="evalverdict",
    ).create(op.get_bind(), checkfirst=True)

    op.create_table(
        "eval_suites",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("document_ids", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
    )

    op.create_table(
        "eval_cases",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "suite_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("eval_suites.id", ondelete="CASCADE"), nullable=False, index=True,
        ),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("expected", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
    )

    op.create_table(
        "eval_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "suite_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("eval_suites.id", ondelete="CASCADE"), nullable=False, index=True,
        ),
        sa.Column(
            "status",
            postgresql.ENUM("queued", "running", "completed", "failed",
                            name="evalrunstatus", create_type=False),
            nullable=False, server_default="queued",
        ),
        sa.Column("settings_snapshot", postgresql.JSONB(), nullable=True),
        sa.Column("total_cases", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("pass_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("partial_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("fail_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
    )

    op.create_table(
        "eval_results",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "run_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("eval_runs.id", ondelete="CASCADE"), nullable=False, index=True,
        ),
        sa.Column(
            "case_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("eval_cases.id", ondelete="CASCADE"), nullable=False, index=True,
        ),
        sa.Column(
            "verdict",
            postgresql.ENUM("pass", "partial", "fail", "error",
                            name="evalverdict", create_type=False),
            nullable=False,
        ),
        sa.Column("actual_answer", sa.Text(), nullable=True),
        sa.Column("judge_reason", sa.Text(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("sources", postgresql.JSONB(), nullable=True),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("eval_results")
    op.drop_table("eval_runs")
    op.drop_table("eval_cases")
    op.drop_table("eval_suites")
    sa.Enum(name="evalverdict").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="evalrunstatus").drop(op.get_bind(), checkfirst=True)
