import datetime
import enum
from typing import Optional

from sqlalchemy import (
    DateTime,
    Enum,
    Float,
    ForeignKey,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class RegionStatus(str, enum.Enum):
    PENDING = "PENDING"
    COMPLETED = "COMPLETED"


class ActionType(str, enum.Enum):
    HUNT_FOUND = "HUNT_FOUND"
    USER_THUMB_UP = "USER_THUMB_UP"
    USER_THUMB_DOWN = "USER_THUMB_DOWN"


class DocType(str, enum.Enum):
    AUDIT = "AUDIT"
    IE_REPORT = "IE_REPORT"
    SUNBIZ = "SUNBIZ"


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class RegionOfInterest(Base):
    __tablename__ = "regions_of_interest"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255))
    bounding_box: Mapped[dict] = mapped_column(JSONB, comment="Keys: north, south, east, west")
    target_county: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    parameters: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True, comment="e.g. stories, coast_distance")
    status: Mapped[RegionStatus] = mapped_column(
        Enum(RegionStatus, name="region_status"),
        default=RegionStatus.PENDING,
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Entity(Base):
    __tablename__ = "entities"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255))
    address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    county: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    characteristics: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    ledger_events: Mapped[list["LeadLedger"]] = relationship(back_populates="entity")
    assets: Mapped[list["EntityAsset"]] = relationship(back_populates="entity")
    contacts: Mapped[list["Contact"]] = relationship(back_populates="entity")


class LeadLedger(Base):
    __tablename__ = "lead_ledger"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"))
    action_type: Mapped[ActionType] = mapped_column(Enum(ActionType, name="action_type"))
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    entity: Mapped["Entity"] = relationship(back_populates="ledger_events")


class EntityAsset(Base):
    __tablename__ = "entity_assets"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"))
    doc_type: Mapped[DocType] = mapped_column(Enum(DocType, name="doc_type"))
    s3_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    extracted_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    entity: Mapped["Entity"] = relationship(back_populates="assets")


class Contact(Base):
    __tablename__ = "contacts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255))
    title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    entity: Mapped["Entity"] = relationship(back_populates="contacts")
