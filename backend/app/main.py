import csv
import io
import json
import logging
import time
from collections import defaultdict
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import cast
from uuid import UUID, uuid4

from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import Select, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.types import ASGIApp

from app.core.config import get_settings
from app.core.security import create_access_token, decode_subject, hash_password, verify_password
from app.database import SessionLocal, engine, get_db
from app.models import (
    Base,
    Business,
    BusinessSource,
    Category,
    DiscoveryResult,
    DiscoveryRun,
    Location,
    RunStatus,
    SocialProfile,
    Source,
    User,
    Website,
    WebsiteCheck,
    WebsiteStatus,
)
from app.schemas import (
    AuthRequest,
    BusinessDetailResponse,
    BusinessResponse,
    CategoryResponse,
    DiscoveryCreate,
    DiscoveryResponse,
    HealthCheckResponse,
    LocationResponse,
    PaginatedBusinesses,
    ProviderStatusResponse,
    TokenResponse,
    UserResponse,
)
from app.sources import get_business_source

logger = logging.getLogger("lankalead.api")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

ALL_PROVINCES_LOCATIONS = [
    # Western Province
    ("Western", "Colombo", "Colombo"),
    ("Western", "Gampaha", "Negombo"),
    ("Western", "Kalutara", "Kalutara"),
    # Central Province
    ("Central", "Kandy", "Kandy"),
    ("Central", "Matale", "Matale"),
    ("Central", "Nuwara Eliya", "Nuwara Eliya"),
    # Southern Province
    ("Southern", "Galle", "Galle"),
    ("Southern", "Matara", "Matara"),
    ("Southern", "Hambantota", "Hambantota"),
    # North Western Province
    ("North Western", "Kurunegala", "Kurunegala"),
    ("North Western", "Puttalam", "Chilaw"),
    # Northern Province
    ("Northern", "Jaffna", "Jaffna"),
    ("Northern", "Vavuniya", "Vavuniya"),
    ("Northern", "Kilinochchi", "Kilinochchi"),
    # North Central Province
    ("North Central", "Anuradhapura", "Anuradhapura"),
    ("North Central", "Polonnaruwa", "Polonnaruwa"),
    # Eastern Province
    ("Eastern", "Batticaloa", "Batticaloa"),
    ("Eastern", "Trincomalee", "Trincomalee"),
    ("Eastern", "Ampara", "Ampara"),
    # Uva Province
    ("Uva", "Badulla", "Badulla"),
    ("Uva", "Monaragala", "Monaragala"),
    # Sabaragamuwa Province
    ("Sabaragamuwa", "Ratnapura", "Ratnapura"),
    ("Sabaragamuwa", "Kegalle", "Kegalle"),
]


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        for col_sql in (
            "ALTER TABLE businesses ADD COLUMN email VARCHAR(320)",
            "ALTER TABLE website_checks ADD COLUMN emails_found TEXT",
            "ALTER TABLE website_checks ADD COLUMN phones_found TEXT",
        ):
            try:
                await connection.execute(text(col_sql))
            except Exception as exc:  # noqa: BLE001
                logger.debug("Migration notice for %s: %s", col_sql, exc)

        for cleanup_sql in (
            "DELETE FROM website_checks WHERE website_id IN (SELECT id FROM websites WHERE lower(url) IN ('none', 'https://none', 'http://none'))",
            "DELETE FROM websites WHERE lower(url) IN ('none', 'https://none', 'http://none')",
            "UPDATE discovery_results SET website_status = 'NOT_DETECTED', evidence = 'No website candidate supplied by source.' WHERE evidence LIKE '%Website candidate None%'",
        ):
            try:
                await connection.execute(text(cleanup_sql))
            except Exception as exc:  # noqa: BLE001
                logger.debug("Cleanup notice for %s: %s", cleanup_sql, exc)

    async with SessionLocal() as db:
        for province, district, city in ALL_PROVINCES_LOCATIONS:
            exists = await db.scalar(
                select(Location).where(Location.city == city, Location.district == district)
            )
            if not exists:
                db.add(Location(province=province, district=district, city=city))
        await db.commit()
    yield


app = FastAPI(title="LankaLead API", version="0.1.0", lifespan=lifespan)


class ObservabilityAndSecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        req_id = request.headers.get("X-Request-ID") or str(uuid4())
        request.state.request_id = req_id
        start_time = time.perf_counter()

        response = await call_next(request)

        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        response.headers["X-Request-ID"] = req_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-XSS-Protection"] = "0"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"

        client_ip = request.client.host if request.client else "unknown"
        logger.info(
            "%s %s %s duration=%sms ip=%s req_id=%s",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
            client_ip,
            req_id,
        )
        return response


class RateLimiterMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp, max_requests_per_minute: int = 120) -> None:
        super().__init__(app)
        self.max_requests = max_requests_per_minute
        self.requests: dict[str, list[float]] = defaultdict(list)

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.url.path.startswith("/api/health"):
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        now = time.monotonic()
        cutoff = now - 60.0

        window = [t for t in self.requests[client_ip] if t > cutoff]
        if len(window) >= self.max_requests:
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={"detail": {"code": "RATE_LIMIT_EXCEEDED", "message": "Too many requests. Please slow down."}},
                headers={"Retry-After": "60"},
            )
        window.append(now)
        self.requests[client_ip] = window
        return await call_next(request)


settings = get_settings()
app.add_middleware(ObservabilityAndSecurityMiddleware)
app.add_middleware(RateLimiterMiddleware, max_requests_per_minute=settings.api_rate_limit_per_minute)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")




async def current_user(
    token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)
) -> User:
    subject = decode_subject(token)
    if not subject:
        raise HTTPException(status_code=401, detail={"code": "INVALID_TOKEN", "message": "Invalid token"})
    user = await db.get(User, UUID(subject))
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED", "message": "Unauthorized"})
    return user


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "lankalead-api", "timestamp": datetime.now(UTC).isoformat()}


@app.get("/api/health/ready", response_model=HealthCheckResponse)
async def health_ready(db: AsyncSession = Depends(get_db)) -> HealthCheckResponse:
    db_status = "ok"
    try:
        await db.execute(text("SELECT 1"))
    except (OSError, RuntimeError) as exc:
        db_status = f"unhealthy: {exc}"

    provider_health = await get_business_source().check_health()
    provider_response = ProviderStatusResponse(
        provider_name=provider_health.provider_name,
        is_healthy=provider_health.is_healthy,
        message=provider_health.message,
        endpoints=list(provider_health.endpoints),
        last_checked=provider_health.last_checked,
    )
    overall_status = "ok" if (db_status == "ok" and provider_health.is_healthy) else "degraded"
    return HealthCheckResponse(
        status=overall_status,
        service="lankalead-api",
        timestamp=datetime.now(UTC).isoformat(),
        database=db_status,
        provider=provider_response,
    )


@app.get("/api/providers/status", response_model=ProviderStatusResponse)
async def provider_status_endpoint() -> ProviderStatusResponse:
    health_data = await get_business_source().check_health()
    return ProviderStatusResponse(
        provider_name=health_data.provider_name,
        is_healthy=health_data.is_healthy,
        message=health_data.message,
        endpoints=list(health_data.endpoints),
        last_checked=health_data.last_checked,
    )


@app.post("/api/auth/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: AuthRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    existing = await db.scalar(select(User).where(User.email == payload.email))
    if existing:
        raise HTTPException(status_code=409, detail={"code": "EMAIL_EXISTS", "message": "Email already registered"})
    user = User(email=payload.email, password_hash=hash_password(payload.password))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return TokenResponse(access_token=create_access_token(str(user.id)), user=UserResponse.model_validate(user))


@app.post("/api/auth/login", response_model=TokenResponse)
async def login(payload: AuthRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    user = await db.scalar(select(User).where(User.email == payload.email))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail={"code": "INVALID_CREDENTIALS", "message": "Invalid credentials"})
    return TokenResponse(access_token=create_access_token(str(user.id)), user=UserResponse.model_validate(user))


@app.post("/api/auth/refresh", response_model=TokenResponse)
async def refresh_token(user: User = Depends(current_user)) -> TokenResponse:
    return TokenResponse(access_token=create_access_token(str(user.id)), user=UserResponse.model_validate(user))


@app.post("/api/auth/logout")
async def logout(_: User = Depends(current_user)) -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/auth/me", response_model=UserResponse)
async def me(user: User = Depends(current_user)) -> User:
    return user


@app.get("/api/categories", response_model=list[CategoryResponse])
async def categories(db: AsyncSession = Depends(get_db)) -> list[Category]:
    return list((await db.scalars(select(Category).where(Category.is_active).order_by(Category.name))).all())


@app.get("/api/locations", response_model=list[LocationResponse])
async def locations(db: AsyncSession = Depends(get_db)) -> list[LocationResponse]:
    from app.models import Location
    rows = (await db.scalars(select(Location).order_by(Location.province, Location.district, Location.city))).all()
    return [LocationResponse.model_validate(row) for row in rows]


@app.post("/api/discovery", response_model=DiscoveryResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_discovery(
    payload: DiscoveryCreate, background_tasks: BackgroundTasks,
    user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> DiscoveryRun:
    category = await db.get(Category, payload.category_id)
    if not category:
        raise HTTPException(status_code=400, detail={"code": "INVALID_CATEGORY", "message": "Category not found"})
    run = DiscoveryRun(
        user_id=user.id, province=payload.province, district=payload.district,
        city=payload.city, category_id=payload.category_id
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    from app.worker import run_discovery
    background_tasks.add_task(run_discovery, {}, str(run.id))
    return run


@app.get("/api/discovery", response_model=list[DiscoveryResponse])
async def list_discovery(
    user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> list[DiscoveryRun]:
    return list((await db.scalars(select(DiscoveryRun).where(DiscoveryRun.user_id == user.id).order_by(DiscoveryRun.created_at.desc()))).all())


@app.get("/api/discovery/{run_id}", response_model=DiscoveryResponse)
async def get_discovery(run_id: UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> DiscoveryRun:
    run = await db.scalar(select(DiscoveryRun).where(DiscoveryRun.id == run_id, DiscoveryRun.user_id == user.id))
    if not run:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Discovery run not found"})
    return run


@app.post("/api/discovery/{run_id}/cancel", response_model=DiscoveryResponse)
async def cancel_discovery(
    run_id: UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> DiscoveryRun:
    run = await db.scalar(select(DiscoveryRun).where(DiscoveryRun.id == run_id, DiscoveryRun.user_id == user.id))
    if not run:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Discovery run not found"})
    if run.status in {RunStatus.QUEUED, RunStatus.RUNNING}:
        run.status = RunStatus.CANCELLED
        run.completed_at = datetime.now(UTC)
        await db.commit()
        await db.refresh(run)
    return run


def format_source_url(source_name: str, external_id: str, existing_url: str | None) -> str | None:
    if existing_url:
        return existing_url
    if "osm-" in external_id:
        parts = external_id.split("-")
        if len(parts) >= 3 and parts[1] in {"node", "way", "relation"}:
            return f"https://www.openstreetmap.org/{parts[1]}/{parts[2]}"
    if external_id.startswith("rp-"):
        slug = external_id.replace("rp-", "")
        return f"https://rainbowpages.lk/search.php?s={slug}"
    return None


def _build_business_query(
    *,
    search: str | None = None,
    province: str | None = None,
    district: str | None = None,
    city: str | None = None,
    category_id: UUID | None = None,
    status_filter: WebsiteStatus | None = None,
    run_id: UUID | None = None,
    source_name: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    sort_by: str = "created_at",
    sort_order: str = "desc",
) -> Select[tuple[Business, str, WebsiteStatus | None, str | None]]:
    latest_status = (
        select(DiscoveryResult.website_status)
        .where(DiscoveryResult.business_id == Business.id)
        .order_by(DiscoveryResult.id.desc())
        .limit(1)
        .correlate(Business)
        .scalar_subquery()
    )
    latest_website_url = (
        select(Website.url)
        .where(Website.business_id == Business.id)
        .order_by(Website.last_checked_at.desc().nullslast())
        .limit(1)
        .correlate(Business)
        .scalar_subquery()
    )
    query = select(
        Business,
        Category.name,
        latest_status.label("latest_status"),
        latest_website_url.label("website_url"),
    ).join(Category)

    if run_id:
        query = query.join(DiscoveryResult, DiscoveryResult.business_id == Business.id).where(
            DiscoveryResult.run_id == run_id
        )
    if source_name:
        query = query.join(BusinessSource, BusinessSource.business_id == Business.id).join(
            Source, Source.id == BusinessSource.source_id
        ).where(Source.name.ilike(f"%{source_name}%"))
    if date_from:
        query = query.where(Business.created_at >= date_from)
    if date_to:
        query = query.where(Business.created_at <= date_to)
    if district:
        query = query.where(Business.district == district)
    if city:
        query = query.where(Business.city == city)
    if province:
        query = query.where(Business.province == province)
    if search:
        search_pattern = f"%{search}%"
        query = query.where(
            Business.name.ilike(search_pattern)
            | Business.phone.ilike(search_pattern)
            | Business.email.ilike(search_pattern)
            | Business.address.ilike(search_pattern)
        )
    if category_id:
        query = query.where(Business.category_id == category_id)
    if status_filter:
        query = query.where(latest_status == status_filter)

    sort_col_map = {
        "name": Business.name,
        "city": Business.city,
        "district": Business.district,
        "province": Business.province,
        "created_at": Business.created_at,
        "website_status": latest_status,
    }
    sort_column = sort_col_map.get(sort_by, Business.created_at)
    if sort_order.lower() == "asc":
        query = query.order_by(sort_column.asc())
    else:
        query = query.order_by(sort_column.desc())

    return query


@app.get("/api/businesses", response_model=PaginatedBusinesses)
async def list_businesses(
    search: str | None = Query(default=None, min_length=1, max_length=120),
    province: str | None = None,
    district: str | None = None,
    city: str | None = None,
    category_id: UUID | None = None,
    status_filter: WebsiteStatus | None = Query(default=None, alias="website_status"),
    run_id: UUID | None = Query(default=None, description="Filter by discovery run"),
    source_name: str | None = Query(default=None, description="Filter by source name"),
    date_from: datetime | None = Query(default=None, description="Created on or after"),
    date_to: datetime | None = Query(default=None, description="Created on or before"),
    sort_by: str = Query(default="created_at", pattern="^(name|city|district|province|created_at|website_status)$"),
    sort_order: str = Query(default="desc", pattern="^(asc|desc)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    _: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> PaginatedBusinesses:
    query = _build_business_query(
        search=search, province=province, district=district, city=city,
        category_id=category_id, status_filter=status_filter, run_id=run_id,
        source_name=source_name, date_from=date_from, date_to=date_to,
        sort_by=sort_by, sort_order=sort_order,
    )
    count = await db.scalar(select(func.count()).select_from(query.subquery()))
    rows = (await db.execute(query.offset((page - 1) * page_size).limit(page_size))).all()

    # Pre-fetch sources, social profiles, and latest evidence for the page results
    biz_ids = [cast(Business, cast(tuple[object, ...], r)[0]).id for r in rows]
    source_map: dict[UUID, list[dict[str, object]]] = defaultdict(list)
    social_map: dict[UUID, list[dict[str, object]]] = defaultdict(list)
    evidence_map: dict[UUID, str] = {}

    if biz_ids:
        src_rows = (await db.execute(
            select(
                BusinessSource.business_id,
                Source.name,
                BusinessSource.external_id,
                BusinessSource.source_url,
                BusinessSource.confidence,
            )
            .join(Source, Source.id == BusinessSource.source_id)
            .where(BusinessSource.business_id.in_(biz_ids))
        )).all()
        for b_id, s_name, ext_id, s_url, conf in src_rows:
            url = format_source_url(str(s_name), str(ext_id), s_url)
            source_map[b_id].append({
                "name": s_name,
                "external_id": ext_id,
                "source_url": url,
                "confidence": conf,
            })

        sp_rows = (await db.execute(
            select(SocialProfile.business_id, SocialProfile.platform, SocialProfile.profile_url)
            .where(SocialProfile.business_id.in_(biz_ids))
        )).all()
        for b_id, plat, p_url in sp_rows:
            social_map[b_id].append({"platform": plat, "profile_url": p_url})

        ev_rows = (await db.execute(
            select(DiscoveryResult.business_id, DiscoveryResult.evidence)
            .where(DiscoveryResult.business_id.in_(biz_ids))
            .order_by(DiscoveryResult.id.desc())
        )).all()
        for b_id, ev in ev_rows:
            if b_id not in evidence_map and ev:
                evidence_map[b_id] = ev

    items: list[BusinessResponse] = []
    for r in rows:
        row = cast(tuple[object, ...], r)
        business = cast(Business, row[0])
        category = cast(str, row[1])
        latest_status_value = cast(WebsiteStatus | None, row[2])
        website_url_value = cast(str | None, row[3])
        b_sources = source_map.get(business.id, [])
        primary_source_name = str(b_sources[0]["name"]) if b_sources else "Public Discovery"
        items.append(BusinessResponse(
            id=business.id,
            name=business.name,
            description=business.description,
            phone=business.phone,
            email=business.email,
            address=business.address,
            city=business.city,
            district=business.district,
            province=business.province,
            category=category,
            website_status=latest_status_value or WebsiteStatus.UNCLEAR,
            website_url=website_url_value,
            created_at=business.created_at,
            primary_source=primary_source_name,
            discovery_evidence=evidence_map.get(business.id),
            sources=b_sources,
            social_profiles=social_map.get(business.id, []),
        ))
    return PaginatedBusinesses(data=items, pagination={"page": page, "page_size": page_size, "total": count or 0})


@app.get("/api/businesses/{business_id}", response_model=BusinessDetailResponse)
async def get_business(
    business_id: UUID, _: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> BusinessDetailResponse:
    row = await db.execute(
        select(Business, Category.name).join(Category).where(Business.id == business_id)
    )
    result = row.one_or_none()
    if not result:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Business not found"})
    business, category = result
    source_rows = (await db.execute(
        select(
            Source.name,
            BusinessSource.external_id,
            BusinessSource.source_url,
            BusinessSource.confidence,
            BusinessSource.retrieved_at,
        )
        .join(BusinessSource, BusinessSource.source_id == Source.id)
        .where(BusinessSource.business_id == business_id)
    )).all()
    social_rows = (await db.execute(
        select(SocialProfile.platform, SocialProfile.profile_url, SocialProfile.discovered_at)
        .where(SocialProfile.business_id == business_id)
    )).all()
    website = await db.scalar(
        select(Website).where(Website.business_id == business_id).order_by(Website.last_checked_at.desc())
    )
    checks: list[WebsiteCheck] = []
    if website:
        checks = list((await db.scalars(
            select(WebsiteCheck).where(WebsiteCheck.website_id == website.id).order_by(WebsiteCheck.checked_at.desc())
        )).all())
    latest_result = await db.scalar(
        select(DiscoveryResult).where(DiscoveryResult.business_id == business_id).order_by(DiscoveryResult.id.desc())
    )

    # Build chronological evidence timeline
    timeline: list[dict[str, object]] = []
    for s_name, external_id, source_url, confidence, retrieved_at in source_rows:
        timeline.append({
            "event": "source_discovery",
            "label": "Verified Public Record",
            "title": f"Discovered via {s_name}",
            "detail": f"External ID: {external_id} (Confidence: {int(confidence * 100)}%)",
            "timestamp": retrieved_at.isoformat() if retrieved_at else None,
            "url": source_url,
        })

    for platform, profile_url, discovered_at in social_rows:
        timeline.append({
            "event": "social_profile",
            "label": "Verified Public Record",
            "title": f"Social presence on {platform}",
            "detail": profile_url,
            "timestamp": discovered_at.isoformat() if discovered_at else None,
            "url": profile_url,
        })

    if website:
        timeline.append({
            "event": "website_candidate",
            "label": "Source Data",
            "title": f"Website candidate: {website.url}",
            "detail": "Public website URL supplied by source",
            "timestamp": (website.last_checked_at or business.created_at).isoformat() if (website.last_checked_at or business.created_at) else None,
            "url": website.url,
        })

    for check in checks:
        status_label = (
            "Website Found"
            if check.http_status and 200 <= check.http_status < 400
            else ("Website Parked" if check.is_parked else ("Website Unreachable" if check.http_status in {404, 410} or (check.http_status and check.http_status >= 500) else "Website Status Unclear"))
        )
        timeline.append({
            "event": "website_check",
            "label": "Inferred Analysis",
            "title": f"Presence check ({status_label})",
            "detail": f"HTTP {check.http_status or 'N/A'}, HTTPS: {'Yes' if check.https else 'No'}, Latency: {check.response_time_ms or '—'}ms, Confidence: {int((check.confidence_score or 0) * 100)}%",
            "timestamp": check.checked_at.isoformat() if check.checked_at else None,
            "url": check.final_url,
        })

    timeline.sort(key=lambda x: str(x.get("timestamp") or ""), reverse=True)

    formatted_checks: list[dict[str, object]] = []
    for check in checks:
        chain_list: list[str] = []
        if check.redirect_chain:
            try:
                chain_list = json.loads(check.redirect_chain)
            except (json.JSONDecodeError, TypeError):
                chain_list = [check.redirect_chain]
        formatted_checks.append({
            "final_url": check.final_url,
            "http_status": check.http_status,
            "response_time_ms": check.response_time_ms,
            "https": check.https,
            "title": check.title,
            "meta_description": check.meta_description,
            "redirect_chain": chain_list,
            "has_robots_txt": check.has_robots_txt,
            "has_sitemap": check.has_sitemap,
            "is_parked": check.is_parked,
            "name_matched": check.name_matched,
            "phone_matched": check.phone_matched,
            "confidence_score": check.confidence_score,
            "error": check.error,
            "checked_at": check.checked_at,
        })

    return BusinessDetailResponse(
        id=business.id,
        name=business.name,
        description=business.description,
        phone=business.phone,
        email=business.email,
        address=business.address,
        city=business.city,
        district=business.district,
        province=business.province,
        category=category,
        website_status=website.status if website else (
            latest_result.website_status if latest_result else WebsiteStatus.UNCLEAR
        ),
        website_url=website.url if website else None,
        created_at=business.created_at,
        sources=[{"name": name, "external_id": external_id, "source_url": format_source_url(str(name), str(external_id), source_url), "confidence": confidence}
                 for name, external_id, source_url, confidence, _ in source_rows],
        social_profiles=[{"platform": platform, "profile_url": profile_url, "discovered_at": discovered_at}
                          for platform, profile_url, discovered_at in social_rows],
        primary_source=str(source_rows[0][0]) if source_rows else "Public Discovery",
        discovery_evidence=latest_result.evidence if latest_result else None,
        website={
            "url": website.url,
            "status": website.status,
            "last_checked_at": website.last_checked_at,
            "checks": formatted_checks,
        } if website else None,
        evidence=[latest_result.evidence] if latest_result else [],
        timeline=timeline,
    )


@app.post("/api/websites/check")
async def check_website_endpoint(url: str, _: User = Depends(current_user)) -> dict[str, object]:
    from app.websites import check_website
    result = await check_website(url)
    return {"data": result.__dict__}


@app.get("/api/exports/businesses.csv")
async def export_businesses_csv(
    search: str | None = None,
    province: str | None = None,
    district: str | None = None,
    city: str | None = None,
    category_id: UUID | None = None,
    status_filter: WebsiteStatus | None = Query(default=None, alias="website_status"),
    run_id: UUID | None = None,
    source_name: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    _: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    query = _build_business_query(
        search=search, province=province, district=district, city=city,
        category_id=category_id, status_filter=status_filter, run_id=run_id,
        source_name=source_name, date_from=date_from, date_to=date_to,
        sort_by="name", sort_order="asc",
    )
    rows = (await db.execute(query)).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "business_name", "category", "city", "district", "province",
        "phone", "email", "address", "website_url", "website_status", "created_at"
    ])
    for r in rows:
        row = cast(tuple[object, ...], r)
        biz = cast(Business, row[0])
        cat = cast(str, row[1])
        st = cast(WebsiteStatus | None, row[2])
        url_val = cast(str | None, row[3])
        writer.writerow([
            biz.name,
            cat,
            biz.city,
            biz.district,
            biz.province,
            biz.phone or "",
            biz.email or "",
            biz.address or "",
            url_val or "",
            (st or WebsiteStatus.UNCLEAR).value,
            biz.created_at.isoformat() if biz.created_at else "",
        ])
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="lankalead-businesses.csv"'},
    )


@app.get("/api/exports/businesses.json")
async def export_businesses_json(
    search: str | None = None,
    province: str | None = None,
    district: str | None = None,
    city: str | None = None,
    category_id: UUID | None = None,
    status_filter: WebsiteStatus | None = Query(default=None, alias="website_status"),
    run_id: UUID | None = None,
    source_name: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    _: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, object]]:
    query = _build_business_query(
        search=search, province=province, district=district, city=city,
        category_id=category_id, status_filter=status_filter, run_id=run_id,
        source_name=source_name, date_from=date_from, date_to=date_to,
        sort_by="name", sort_order="asc",
    )
    rows = (await db.execute(query)).all()
    items_json: list[dict[str, object]] = []
    for r in rows:
        row = cast(tuple[object, ...], r)
        biz = cast(Business, row[0])
        cat = cast(str, row[1])
        st = cast(WebsiteStatus | None, row[2])
        url_val = cast(str | None, row[3])
        items_json.append({
            "id": str(biz.id),
            "business_name": biz.name,
            "category": cat,
            "city": biz.city,
            "district": biz.district,
            "province": biz.province,
            "phone": biz.phone,
            "email": biz.email,
            "address": biz.address,
            "website_url": url_val,
            "website_status": (st or WebsiteStatus.UNCLEAR).value,
            "created_at": biz.created_at.isoformat() if biz.created_at else None,
        })
    return items_json
