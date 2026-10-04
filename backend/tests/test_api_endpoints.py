from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


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

        # Export JSON
        json_res = await client.get("/api/exports/businesses.json", headers=headers)
        assert json_res.status_code == 200
        assert isinstance(json_res.json(), list)
