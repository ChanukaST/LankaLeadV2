from datetime import UTC, datetime
from enum import Enum
from uuid import UUID, uuid4


def utc_now() -> datetime:
    return datetime.now(UTC)

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Uuid,
    text,
)
from sqlalchemy import Enum as SqlEnum
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class RunStatus(str, Enum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class WebsiteStatus(str, Enum):
    FOUND = "WEBSITE_FOUND"
    NOT_DETECTED = "WEBSITE_NOT_DETECTED"
    UNCLEAR = "WEBSITE_UNCLEAR"
    UNREACHABLE = "WEBSITE_UNREACHABLE"
    PARKED = "WEBSITE_PARKED"
    SOCIAL_ONLY = "SOCIAL_ONLY"


class OutreachStatus(str, Enum):
    NEW = "NEW"
    CONTACTED = "CONTACTED"
    FOLLOW_UP = "FOLLOW_UP"
    PROPOSAL_SENT = "PROPOSAL_SENT"
    WON = "WON"
    NOT_INTERESTED = "NOT_INTERESTED"


class User(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Location(Base):
    __tablename__ = "locations"
    __table_args__ = (Index("ix_locations_region", "province", "district", "city"),)

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    province: Mapped[str] = mapped_column(String(100), index=True)
    district: Mapped[str] = mapped_column(String(100), index=True)
    city: Mapped[str] = mapped_column(String(100), index=True)


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Business(Base):
    __tablename__ = "businesses"
    __table_args__ = (Index("ix_businesses_search", "normalized_name", "district", "city"),)

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(255))
    normalized_name: Mapped[str] = mapped_column(String(255), index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    city: Mapped[str] = mapped_column(String(100), index=True)
    district: Mapped[str] = mapped_column(String(100), index=True)
    province: Mapped[str] = mapped_column(String(100), index=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    category_id: Mapped[UUID] = mapped_column(ForeignKey("categories.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    outreach_status: Mapped[str] = mapped_column(String(50), default="NEW", index=True)
    outreach_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_contacted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    category: Mapped[Category] = relationship()


class Source(Base):
    __tablename__ = "sources"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)


class BusinessSource(Base):
    __tablename__ = "business_sources"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    business_id: Mapped[UUID] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"))
    source_id: Mapped[UUID] = mapped_column(ForeignKey("sources.id"))
    external_id: Mapped[str] = mapped_column(String(255))
    source_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class SocialProfile(Base):
    __tablename__ = "social_profiles"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    business_id: Mapped[UUID] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"))
    platform: Mapped[str] = mapped_column(String(40))
    profile_url: Mapped[str] = mapped_column(String(500))
    discovered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Website(Base):
    __tablename__ = "websites"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    business_id: Mapped[UUID] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"))
    url: Mapped[str] = mapped_column(String(500))
    status: Mapped[WebsiteStatus] = mapped_column(SqlEnum(WebsiteStatus), default=WebsiteStatus.UNCLEAR)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WebsiteCheck(Base):
    __tablename__ = "website_checks"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    website_id: Mapped[UUID] = mapped_column(ForeignKey("websites.id", ondelete="CASCADE"))
    final_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    https: Mapped[bool] = mapped_column(Boolean, default=False)
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    meta_description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    redirect_chain: Mapped[str | None] = mapped_column(Text, nullable=True)
    has_robots_txt: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    has_sitemap: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    is_parked: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("0"))
    name_matched: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    phone_matched: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    emails_found: Mapped[str | None] = mapped_column(Text, nullable=True)
    phones_found: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class DiscoveryRun(Base):
    __tablename__ = "discovery_runs"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    province: Mapped[str | None] = mapped_column(String(100), nullable=True)
    district: Mapped[str | None] = mapped_column(String(100), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    category_id: Mapped[UUID] = mapped_column(ForeignKey("categories.id"))
    status: Mapped[RunStatus] = mapped_column(SqlEnum(RunStatus), default=RunStatus.QUEUED)
    businesses_found: Mapped[int] = mapped_column(Integer, default=0)
    websites_checked: Mapped[int] = mapped_column(Integer, default=0)
    websites_found: Mapped[int] = mapped_column(Integer, default=0)
    websites_not_detected: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class DiscoveryResult(Base):
    __tablename__ = "discovery_results"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[UUID] = mapped_column(ForeignKey("discovery_runs.id", ondelete="CASCADE"))
    business_id: Mapped[UUID] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"))
    website_status: Mapped[WebsiteStatus] = mapped_column(SqlEnum(WebsiteStatus))
    evidence: Mapped[str] = mapped_column(Text, default="Business identified")

