from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def _resolve_default_db_url() -> str:
    root_db = Path(__file__).resolve().parent.parent.parent.parent / "lankalead.db"
    if root_db.exists():
        return f"sqlite+aiosqlite:///{root_db.as_posix()}"
    return "sqlite+aiosqlite:///./lankalead.db"


class Settings(BaseSettings):
    app_name: str = "LankaLead"
    environment: str = "development"
    database_url: str = _resolve_default_db_url()
    redis_url: str = "redis://localhost:6379/0"
    secret_key: str = "change-me-in-production"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days for internal sales operations
    refresh_token_expire_days: int = 14
    provider_name: str = "osm"
    overpass_url: str = "https://overpass-api.de/api/interpreter"
    overpass_endpoints: str = (
        "https://overpass-api.de/api/interpreter,"
        "https://lz4.overpass-api.de/api/interpreter,"
        "https://overpass.kumi.systems/api/interpreter"
    )
    overpass_timeout_seconds: float = 30.0
    overpass_max_retries: int = 3
    overpass_retry_backoff_seconds: float = 1.5
    nominatim_url: str = "https://nominatim.openstreetmap.org/search"
    nominatim_timeout_seconds: float = 12.0
    provider_rate_limit_seconds: float = 1.0
    website_timeout_seconds: float = 8.0
    website_max_response_bytes: int = 1_000_000
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    api_rate_limit_per_minute: int = 120
    discovery_max_records: int = 50

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def overpass_url_list(self) -> list[str]:
        endpoints = [url.strip() for url in self.overpass_endpoints.split(",") if url.strip()]
        if not endpoints and self.overpass_url:
            endpoints = [self.overpass_url.strip()]
        return endpoints

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
