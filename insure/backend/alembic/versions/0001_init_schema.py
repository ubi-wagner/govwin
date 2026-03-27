"""Init Schema

Revision ID: 0001
Revises:
Create Date: 2026-03-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enums
    region_status = sa.Enum("PENDING", "COMPLETED", name="region_status")
    action_type = sa.Enum("HUNT_FOUND", "USER_THUMB_UP", "USER_THUMB_DOWN", name="action_type")
    doc_type = sa.Enum("AUDIT", "IE_REPORT", "SUNBIZ", name="doc_type")

    region_status.create(op.get_bind(), checkfirst=True)
    action_type.create(op.get_bind(), checkfirst=True)
    doc_type.create(op.get_bind(), checkfirst=True)

    # regions_of_interest
    op.create_table(
        "regions_of_interest",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("bounding_box", JSONB, nullable=False, comment="Keys: north, south, east, west"),
        sa.Column("target_county", sa.String(100), nullable=True),
        sa.Column("parameters", JSONB, nullable=True, comment="e.g. stories, coast_distance"),
        sa.Column("status", region_status, nullable=False, server_default="PENDING"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # entities
    op.create_table(
        "entities",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("address", sa.Text, nullable=True),
        sa.Column("county", sa.String(100), nullable=True),
        sa.Column("latitude", sa.Float, nullable=True),
        sa.Column("longitude", sa.Float, nullable=True),
        sa.Column("characteristics", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # lead_ledger
    op.create_table(
        "lead_ledger",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("entity_id", sa.Integer, sa.ForeignKey("entities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("action_type", action_type, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # entity_assets
    op.create_table(
        "entity_assets",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("entity_id", sa.Integer, sa.ForeignKey("entities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("doc_type", doc_type, nullable=False),
        sa.Column("s3_url", sa.Text, nullable=True),
        sa.Column("extracted_text", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # contacts
    op.create_table(
        "contacts",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("entity_id", sa.Integer, sa.ForeignKey("entities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("title", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("contacts")
    op.drop_table("entity_assets")
    op.drop_table("lead_ledger")
    op.drop_table("entities")
    op.drop_table("regions_of_interest")

    sa.Enum(name="doc_type").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="action_type").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="region_status").drop(op.get_bind(), checkfirst=True)
