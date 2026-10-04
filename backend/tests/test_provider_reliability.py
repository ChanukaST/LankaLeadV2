import time

import pytest

from app.sources import (
    MockBusinessSource,
    ProviderError,
    ProviderLocationNotFoundError,
    ProviderRateLimiter,
    ProviderTimeoutError,
)


@pytest.mark.asyncio
async def test_provider_rate_limiter_spacing() -> None:
    limiter = ProviderRateLimiter(min_interval_seconds=0.1)
    start = time.perf_counter()
    await limiter.acquire("test_host")
    await limiter.acquire("test_host")
    elapsed = time.perf_counter() - start
    assert elapsed >= 0.09


@pytest.mark.asyncio
async def test_mock_source_health_check() -> None:
    source = MockBusinessSource()
    health = await source.check_health()
    assert health.is_healthy is True
    assert "Mock development provider" in health.message
    assert health.provider_name == source.name


def test_provider_exceptions_inheritance() -> None:
    assert issubclass(ProviderTimeoutError, ProviderError)
    assert issubclass(ProviderLocationNotFoundError, ProviderError)
