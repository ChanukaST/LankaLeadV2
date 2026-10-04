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
    from app.sources import CompositeBusinessSource, TikTokBusinessSource, get_business_source

    monkeypatch.setattr(get_settings(), "provider_name", "composite")
    source = get_business_source()
    assert isinstance(source, CompositeBusinessSource)
    assert "Composite" in source.name

    tt_source = get_business_source("tiktok")
    assert isinstance(tt_source, TikTokBusinessSource)
    assert "TikTok" in tt_source.name


def test_osm_source_maps_tiktok_tag() -> None:
    result = OpenStreetMapBusinessSource._to_business(
        {
            "type": "node",
            "id": 789,
            "tags": {
                "name": "Trendy Colombo Boutique",
                "contact:tiktok": "https://www.tiktok.com/@trendycolombo",
            },
        },
        "Salons",
        "Western",
        "Colombo",
        "Colombo",
    )
    assert any(s.platform == "TikTok" and "@trendycolombo" in s.url for s in result.social_links)


def test_production_environment_excludes_mock_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core.config import get_settings
    from app.sources import ProviderError, get_available_providers, get_business_source


    monkeypatch.setattr(get_settings(), "environment", "production")
    providers = get_available_providers()
    provider_ids = [p["id"] for p in providers]
    assert "mock" not in provider_ids
    assert "tiktok" in provider_ids
    assert "composite" in provider_ids

    with pytest.raises(ProviderError, match="disabled in production"):
        get_business_source("mock")


def test_website_html_extracts_tiktok_link() -> None:
    from app.websites import extract_social_links_from_html

    html = """
    <html>
        <body>
            <a href="https://www.tiktok.com/@kandygems_official">Follow our TikTok</a>
            <a href="https://facebook.com/kandygems">Facebook</a>
        </body>
    </html>
    """
    socials = extract_social_links_from_html(html)
    social_dict = dict(socials)
    assert "TikTok" in social_dict
    assert social_dict["TikTok"] == "https://www.tiktok.com/@kandygems_official"
    assert "Facebook" in social_dict


@pytest.mark.asyncio
async def test_collect_google_maps_preview_mock_fast_path() -> None:
    from app.sources import collect_google_maps_preview

    preview = await collect_google_maps_preview(
        name="Mock Colombo Cafe",
        city="Colombo",
        district="Colombo",
        province="Western",
    )
    assert preview.maps_url is not None
    assert preview.maps_url.startswith("https://www.google.com/maps/search/?api=1")
    assert "Colombo" in preview.maps_url
    assert preview.evidence is not None


def test_web_search_business_source_provider_resolution() -> None:
    from app.sources import WebSearchBusinessSource, get_available_providers, get_business_source

    web_source = get_business_source("web")
    assert isinstance(web_source, WebSearchBusinessSource)
    assert "Web & Google Maps" in web_source.name

    maps_source = get_business_source("maps")
    assert isinstance(maps_source, WebSearchBusinessSource)

    providers = get_available_providers()
    provider_ids = [p["id"] for p in providers]
    assert "search" in provider_ids


