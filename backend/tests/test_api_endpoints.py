from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app, lifespan


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture(autouse=True)
async def init_db() -> None:
    from sqlalchemy import delete, select
    from app.database import SessionLocal
    from app.models import Business, BusinessSource
    async with SessionLocal() as db:
        mock_biz_ids = (await db.scalars(
            select(BusinessSource.business_id).where(BusinessSource.external_id.like("mock-%"))
        )).all()
        if mock_biz_ids:
            await db.execute(delete(Business).where(Business.id.in_(mock_biz_ids)))
            await db.commit()

    async with lifespan(app):
        yield

    async with SessionLocal() as db:
        mock_biz_ids = (await db.scalars(
            select(BusinessSource.business_id).where(BusinessSource.external_id.like("mock-%"))
        )).all()
        if mock_biz_ids:
            await db.execute(delete(Business).where(Business.id.in_(mock_biz_ids)))
            await db.commit()


@pytest.mark.asyncio
async def test_health_and_readiness() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/health")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert "X-Request-ID" in res.headers
        assert res.headers["X-Content-Type-Options"] == "nosniff"
        assert res.headers["X-Frame-Options"] == "DENY"

        ready = await client.get("/api/health/ready")
        assert ready.status_code == 200
        ready_data = ready.json()
        assert ready_data["status"] in {"ok", "degraded"}
        assert ready_data["database"] == "ok"

        prov = await client.get("/api/providers/status")
        assert prov.status_code == 200
        assert "provider_name" in prov.json()


@pytest.mark.asyncio
async def test_auth_flow() -> None:
    unique_email = f"tester_{uuid4().hex[:8]}@example.com"
    password = "SecretPassword123"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Register
        reg = await client.post("/api/auth/register", json={"email": unique_email, "password": password})
        assert reg.status_code == 201
        token = reg.json()["access_token"]
        assert token

        # Duplicate register fails
        dup = await client.post("/api/auth/register", json={"email": unique_email, "password": password})
        assert dup.status_code == 409

        # Login
        login = await client.post("/api/auth/login", json={"email": unique_email, "password": password})
        assert login.status_code == 200
        assert login.json()["access_token"]

        # Wrong password
        bad_login = await client.post("/api/auth/login", json={"email": unique_email, "password": "WrongPassword"})
        assert bad_login.status_code == 401

        # Current user
        me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        assert me.json()["email"] == unique_email

        # Refresh token
        ref = await client.post("/api/auth/refresh", headers={"Authorization": f"Bearer {token}"})
        assert ref.status_code == 200
        assert ref.json()["access_token"]


@pytest.mark.asyncio
async def test_categories_and_locations() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        cats = await client.get("/api/categories")
        assert cats.status_code == 200
        assert isinstance(cats.json(), list)

        locs = await client.get("/api/locations")
        assert locs.status_code == 200
        assert isinstance(locs.json(), list)


@pytest.mark.asyncio
async def test_businesses_and_exports() -> None:
    unique_email = f"tester_{uuid4().hex[:8]}@example.com"
    password = "SecretPassword123"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        reg = await client.post("/api/auth/register", json={"email": unique_email, "password": password})
        token = reg.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Businesses listing
        res = await client.get("/api/businesses?page=1&page_size=10", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert "data" in data
        assert "pagination" in data
        for biz in data["data"]:
            assert "primary_source" in biz
            assert "sources" in biz
            assert "social_profiles" in biz
            assert "email" in biz

        # Export CSV
        csv_res = await client.get("/api/exports/businesses.csv", headers=headers)
        assert csv_res.status_code == 200
        assert "text/csv" in csv_res.headers.get("content-type", "")
        assert "email" in csv_res.text
        assert "lead_priority" in csv_res.text
        assert "whatsapp_link" in csv_res.text
        assert "outreach_status" in csv_res.text

        # Export JSON
        json_res = await client.get("/api/exports/businesses.json", headers=headers)
        assert json_res.status_code == 200
        assert isinstance(json_res.json(), list)


@pytest.mark.asyncio
async def test_outreach_pipeline_and_lead_metrics() -> None:
    unique_email = f"sales_{uuid4().hex[:8]}@example.com"
    password = "SalesPassword123"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        reg = await client.post("/api/auth/register", json={"email": unique_email, "password": password})
        token = reg.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Check lead metrics endpoint
        metrics_res = await client.get("/api/lead-metrics", headers=headers)
        assert metrics_res.status_code == 200
        m = metrics_res.json()
        assert "total_leads" in m
        assert "prime_targets" in m
        assert "social_only" in m
        assert "pipeline_new" in m
        assert "pipeline_contacted" in m
        assert "pipeline_won" in m

        # Fetch a business to update outreach status
        biz_list = await client.get("/api/businesses?page=1&page_size=1", headers=headers)
        assert biz_list.status_code == 200
        biz_data = biz_list.json()["data"]
        if biz_data:
            biz_id = biz_data[0]["id"]

            # Update outreach status to CONTACTED and add notes
            patch_res = await client.patch(
                f"/api/businesses/{biz_id}/outreach",
                headers=headers,
                json={"outreach_status": "CONTACTED", "outreach_notes": "Spoke with owner, requested website package details."},
            )
            assert patch_res.status_code == 200
            updated = patch_res.json()
            assert updated["outreach_status"] == "CONTACTED"
            assert updated["outreach_notes"] == "Spoke with owner, requested website package details."
            assert updated["last_contacted_at"] is not None

            # Verify in detail view
            detail_res = await client.get(f"/api/businesses/{biz_id}", headers=headers)
            assert detail_res.status_code == 200
            detail = detail_res.json()
            assert detail["outreach_status"] == "CONTACTED"
            assert detail["outreach_notes"] == "Spoke with owner, requested website package details."

            # Test invalid outreach status rejected
            bad_status = await client.patch(
                f"/api/businesses/{biz_id}/outreach",
                headers=headers,
                json={"outreach_status": "INVALID_STATUS"},
            )
            assert bad_status.status_code == 400

            # Filter businesses by outreach_status
            filtered = await client.get("/api/businesses?outreach_status=CONTACTED", headers=headers)
            assert filtered.status_code == 200
            assert any(b["id"] == biz_id for b in filtered.json()["data"])


@pytest.mark.asyncio
async def test_collector_scraper_endpoints() -> None:
    unique_email = f"collector_{uuid4().hex[:8]}@example.com"
    password = "CollectorPassword123"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        reg = await client.post("/api/auth/register", json={"email": unique_email, "password": password})
        token = reg.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 1. Test listing available providers
        providers_res = await client.get("/api/collector/providers", headers=headers)
        assert providers_res.status_code == 200
        providers = providers_res.json()
        assert isinstance(providers, list)
        provider_ids = [p["id"] for p in providers]
        assert "composite" in provider_ids
        assert "tiktok" in provider_ids
        assert "osm" in provider_ids
        assert "directory" in provider_ids
        assert "search" in provider_ids
        assert "mock" in provider_ids

        # 2. Test synchronous collector scraper run with mock provider
        run_res = await client.post(
            "/api/collector/run",
            headers=headers,
            json={
                "source_provider": "mock",
                "province": "Western",
                "city": "Colombo",
                "max_records": 3,
                "sync_wait": True,
            },
        )
        assert run_res.status_code in {200, 202}
        run_data = run_res.json()
        assert run_data["status"] == "COMPLETED"
        assert run_data["source_provider"] == "mock"
        assert run_data["businesses_found"] >= 1

        # 3. Test that exclude_mock=true excludes mock businesses
        mock_excluded_res = await client.get("/api/businesses?exclude_mock=true", headers=headers)
        assert mock_excluded_res.status_code == 200
        for b in mock_excluded_res.json()["data"]:
            for s in b.get("sources", []):
                assert "mock" not in s["name"].lower()

        # 4. In production mode, mock provider should be barred from collector run
        from app.core.config import get_settings
        orig_env = get_settings().environment
        try:
            get_settings().environment = "production"
            prod_run = await client.post(
                "/api/collector/run",
                headers=headers,
                json={
                    "source_provider": "mock",
                    "province": "Western",
                    "city": "Colombo",
                },
            )
            assert prod_run.status_code == 400
            assert prod_run.json()["detail"]["code"] == "MOCK_PROVIDER_NOT_ALLOWED"

            prod_prov = await client.get("/api/collector/providers", headers=headers)
            assert "mock" not in [p["id"] for p in prod_prov.json()]
        finally:
            get_settings().environment = orig_env


@pytest.mark.asyncio
async def test_subsequent_runs_exclude_previously_found_targets() -> None:
    unique_email = f"fresh_{uuid4().hex[:8]}@example.com"
    password = "FreshPassword123"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        reg = await client.post("/api/auth/register", json={"email": unique_email, "password": password})
        token = reg.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        cats_res = await client.get("/api/categories", headers=headers)
        photo_cat_id = next(c["id"] for c in cats_res.json() if c["slug"] == "photography")

        # Run 1: Discover first Galle Photography target
        res1 = await client.post(
            "/api/collector/run",
            headers=headers,
            json={
                "category_id": photo_cat_id,
                "source_provider": "mock",
                "province": "Southern",
                "city": "Galle",
                "max_records": 1,
                "sync_wait": True,
            },
        )
        assert res1.status_code in {200, 202}
        run1 = res1.json()
        assert run1["businesses_found"] == 1

        # Get business found in run 1
        leads_run1 = await client.get(f"/api/businesses?run_id={run1['id']}&exclude_mock=false", headers=headers)
        assert leads_run1.status_code == 200
        biz1_ids = {b["id"] for b in leads_run1.json()["data"]}
        assert len(biz1_ids) == 1

        # Run 2: same location & provider, but previous target must be excluded!
        res2 = await client.post(
            "/api/collector/run",
            headers=headers,
            json={
                "category_id": photo_cat_id,
                "source_provider": "mock",
                "province": "Southern",
                "city": "Galle",
                "max_records": 1,
                "sync_wait": True,
            },
        )
        assert res2.status_code in {200, 202}
        run2 = res2.json()
        assert run2["businesses_found"] == 1

        # Get business found in run 2
        leads_run2 = await client.get(f"/api/businesses?run_id={run2['id']}&exclude_mock=false", headers=headers)
        assert leads_run2.status_code == 200
        biz2_ids = {b["id"] for b in leads_run2.json()["data"]}
        assert len(biz2_ids) == 1

        # Ensure run 2 yielded a completely fresh, distinct target, not the same one!
        assert biz1_ids.isdisjoint(biz2_ids), "Run 2 returned previously found target instead of fresh lead!"

        # Run 3: both Galle Photography targets have already been collected, so run 3 finds 0 duplicates
        res3 = await client.post(
            "/api/collector/run",
            headers=headers,
            json={
                "category_id": photo_cat_id,
                "source_provider": "mock",
                "province": "Southern",
                "city": "Galle",
                "max_records": 1,
                "sync_wait": True,
            },
        )
        assert res3.status_code in {200, 202}
        run3 = res3.json()
        assert run3["businesses_found"] == 0, "Run 3 should exclude all already-found targets"

