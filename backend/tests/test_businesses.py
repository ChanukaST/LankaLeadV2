from app.businesses import normalize_business_name


def test_normalize_business_name_removes_common_suffixes() -> None:
    assert normalize_business_name("ABC Restaurant - Sri Lanka") == "abc"
