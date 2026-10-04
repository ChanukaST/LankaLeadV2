from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models import RunStatus, WebsiteStatus


class AuthRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    email: EmailStr


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class CategoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    slug: str


class LocationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    province: str
    district: str
    city: str


class DiscoveryCreate(BaseModel):
    province: str | None = None
    district: str | None = None
    city: str | None = None
    category_id: UUID


class DiscoveryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    status: RunStatus
    province: str | None
    district: str | None
    city: str | None
    category_id: UUID
    businesses_found: int
    websites_checked: int
    websites_found: int
    websites_not_detected: int
    error: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class BusinessResponse(BaseModel):
    id: UUID
    name: str
    description: str | None
    phone: str | None
    email: str | None = None
    address: str | None
    city: str
    district: str
    province: str
    category: str
    website_status: WebsiteStatus
    website_url: str | None = None
    created_at: datetime | None = None
    primary_source: str | None = None
    discovery_evidence: str | None = None
    sources: list[dict[str, object]] = []
    social_profiles: list[dict[str, object]] = []
    outreach_status: str = "NEW"
    outreach_notes: str | None = None
    last_contacted_at: datetime | None = None


class OutreachUpdateRequest(BaseModel):
    outreach_status: str | None = None
    outreach_notes: str | None = None


class LeadMetricsResponse(BaseModel):
    total_leads: int
    prime_targets: int
    social_only: int
    no_website: int
    pipeline_new: int
    pipeline_contacted: int
    pipeline_follow_up: int
    pipeline_proposal: int
    pipeline_won: int
    pipeline_not_interested: int


class BusinessDetailResponse(BusinessResponse):
    website: dict[str, object] | None
    evidence: list[str]
    timeline: list[dict[str, object]] = []


class PaginatedBusinesses(BaseModel):
    data: list[BusinessResponse]
    pagination: dict[str, int]


class ProviderStatusResponse(BaseModel):
    provider_name: str
    is_healthy: bool
    message: str
    endpoints: list[str]
    last_checked: str


class HealthCheckResponse(BaseModel):
    status: str
    service: str
    timestamp: str
    database: str
    provider: ProviderStatusResponse | None = None
