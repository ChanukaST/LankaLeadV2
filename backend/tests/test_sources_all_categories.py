import pytest

from app.sources import MockBusinessSource


@pytest.mark.asyncio
async def test_mock_source_has_a_record_for_each_seeded_category() -> None:
    source = MockBusinessSource()
    for category in ["Restaurants", "Cafes", "Hotels", "Salons", "Photography",
                     "Travel Agencies", "Gyms", "Auto Garages"]:
        results = await source.search_businesses(
            province=None, district=None, city=None, category=category
        )
        assert results, f"No mock businesses configured for {category}"
