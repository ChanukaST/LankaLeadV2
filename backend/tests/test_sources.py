import pytest

from app.sources import MockBusinessSource, OpenStreetMapBusinessSource


@pytest.mark.asyncio
async def test_mock_source_filters_by_location_and_category() -> None:
    results = await MockBusinessSource().search_businesses(
        province="North Western", district="Kurunegala", city="Kurunegala", category="Restaurants"
    )
    assert len(results) == 1
    assert results[0].external_id == "mock-kurunegala-restaurant"


def test_osm_source_maps_public_place_tags() -> None:
    result = OpenStreetMapBusinessSource._to_business(
        {
            "type": "node",
            "id": 123,
            "tags": {
                "name": "Public Cafe",
                "phone": "+94112223344",
                "website": "https://example.org",
                "addr:street": "Main Street",
                "addr:city": "Colombo",
                "contact:facebook": "https://facebook.com/public-cafe",
            },
        },
        "Cafes",
        "Western",
        "Colombo",
        "Colombo",
    )
    assert result.external_id == "osm-node-123"
    assert result.website == "https://example.org"
    assert result.social_links[0].platform == "Facebook"


def test_osm_source_maps_linkedin_tag() -> None:
    result = OpenStreetMapBusinessSource._to_business(
        {
            "type": "node",
            "id": 456,
            "tags": {
                "name": "Colombo Tech Solutions",
                "contact:linkedin": "https://lk.linkedin.com/company/colombo-tech",
            },
        },
        "Services",
        "Western",
        "Colombo",
        "Colombo",
    )
    assert result.social_links[0].platform == "LinkedIn"
    assert result.social_links[0].url == "https://lk.linkedin.com/company/colombo-tech"


def test_get_business_source_provider_resolution(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core.config import get_settings
    from app.sources import CompositeBusinessSource, get_business_source

    monkeypatch.setattr(get_settings(), "provider_name", "composite")
    source = get_business_source()
    assert isinstance(source, CompositeBusinessSource)
    assert "Composite" in source.name
