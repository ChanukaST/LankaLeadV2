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


def test_validate_and_normalize_sl_phone() -> None:
    from app.sources import validate_and_normalize_sl_phone

    # Valid mobiles
    assert validate_and_normalize_sl_phone("0771234567") == "+94 77 123 4567"
    assert validate_and_normalize_sl_phone("+94 71 234 5678") == "+94 71 234 5678"
    assert validate_and_normalize_sl_phone("94701234567") == "+94 70 123 4567"
    assert validate_and_normalize_sl_phone("+94 (0)76 123 4567") == "+94 76 123 4567"

    # Valid geographic landlines (Colombo, Kandy, Galle, Kurunegala)
    assert validate_and_normalize_sl_phone("0112345678") == "+94 11 234 5678"
    assert validate_and_normalize_sl_phone("081 223 4567") == "+94 81 223 4567"
    assert validate_and_normalize_sl_phone("091-2234567") == "+94 91 223 4567"
    assert validate_and_normalize_sl_phone("037 222 3344") == "+94 37 222 3344"

    # Strict rejection of non-Sri Lankan / foreign phone numbers
    assert validate_and_normalize_sl_phone("+39 06 6988 3456") is None  # Italy
    assert validate_and_normalize_sl_phone("+1 212 555 1234") is None   # USA
    assert validate_and_normalize_sl_phone("+44 20 7946 0958") is None  # UK
    assert validate_and_normalize_sl_phone("+91 98765 43210") is None   # India

    # Strict rejection of non-existent area codes (e.g. 082, 028, 043, 056)
    assert validate_and_normalize_sl_phone("0826216304") is None
    assert validate_and_normalize_sl_phone("0288214040") is None
    assert validate_and_normalize_sl_phone("0435923440") is None
    assert validate_and_normalize_sl_phone("0569920391") is None

    # Invalid lengths or empty values
    assert validate_and_normalize_sl_phone("12345") is None
    assert validate_and_normalize_sl_phone(None) is None
    assert validate_and_normalize_sl_phone("") is None
    assert validate_and_normalize_sl_phone("none") is None


def test_is_sri_lankan_coordinate() -> None:
    from app.sources import is_sri_lankan_coordinate

    # Valid Sri Lankan locations
    assert is_sri_lankan_coordinate(6.9271, 79.8612) is True    # Colombo
    assert is_sri_lankan_coordinate(7.2906, 80.6337) is True    # Kandy
    assert is_sri_lankan_coordinate(6.0535, 80.2210) is True    # Galle
    assert is_sri_lankan_coordinate(9.6615, 80.0255) is True    # Jaffna

    # Coordinates outside Sri Lanka
    assert is_sri_lankan_coordinate(41.9028, 12.4964) is False  # Rome, Italy
    assert is_sri_lankan_coordinate(51.5074, -0.1278) is False  # London, UK
    assert is_sri_lankan_coordinate(13.0827, 80.2707) is False  # Chennai, India
    assert is_sri_lankan_coordinate(0.0, 0.0) is False          # Equator
    assert is_sri_lankan_coordinate(None, 80.0) is False
    assert is_sri_lankan_coordinate(7.0, None) is False



