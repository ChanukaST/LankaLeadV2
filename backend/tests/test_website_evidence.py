
from app.websites import (
    detect_parked_domain,
    extract_meta_description,
    extract_title,
    match_business_name,
    match_business_phone,
    normalize_url,
)


def test_normalize_url_variations() -> None:
    assert normalize_url("http://example.com/") == "http://example.com"
    assert normalize_url("https://example.com/test/") == "https://example.com/test"
    assert normalize_url("kandyspice.lk") == "https://kandyspice.lk"


def test_extract_title_and_meta_description() -> None:
    html = b"""
    <!DOCTYPE html>
    <html>
      <head>
        <title>  The Grand Kandy Hotel &amp; Resort  </title>
        <meta name="description" content="Luxury boutique hotel in the heart of Kandy, Sri Lanka.">
      </head>
      <body>
        <p>Welcome to our hotel.</p>
      </body>
    </html>
    """
    title = extract_title(html)
    assert title == "The Grand Kandy Hotel &amp; Resort"

    desc = extract_meta_description(html)
    assert desc == "Luxury boutique hotel in the heart of Kandy, Sri Lanka."


def test_detect_parked_domain_keywords() -> None:
    assert detect_parked_domain("Buy this domain - hugeDomains.com", "This domain is for sale.") is True
    assert detect_parked_domain("Welcome to Colombo Rest", "Best food in Colombo.") is False
    assert detect_parked_domain("Parked Domain", "Courtesy of GoDaddy domain parking") is True


def test_match_business_name_ignores_stopwords() -> None:
    assert match_business_name("Kandy Spice Table Restaurant - Sri Lanka", "Welcome to Kandy Spice Table in the hills.") is True
    assert match_business_name("Galle Photography Studio", "Totally unrelated automotive services in Jaffna.") is False


def test_match_business_phone_matches_local_digits() -> None:
    assert match_business_phone("+94112345678", "Call us at (011) 234-5678 or visit our office.") is True
    assert match_business_phone("+94812234567", "Contact: 0771234567") is False
