import asyncio

import pytest

from app.websites import normalize_url, probe_candidate_domains


def test_normalize_url_adds_https() -> None:
    assert normalize_url("example.com") == "https://example.com"


def test_normalize_url_rejects_non_http() -> None:
    with pytest.raises(ValueError):
        normalize_url("file:///etc/passwd")


def test_extract_social_links_from_html() -> None:
    from app.websites import extract_social_links_from_html

    sample_html = """
    <html>
        <body>
            <h1>Welcome to Colombo Ceylon Cafe</h1>
            <footer>
                <a href="https://lk.linkedin.com/company/ceylon-cafe-colombo/">LinkedIn</a>
                <a href="https://www.facebook.com/ceyloncafecolombo">Facebook</a>
                <a href="https://instagram.com/ceyloncafe_lk/">Instagram</a>
                <a href="https://twitter.com/ceyloncafe">Twitter</a>
                <a href="https://www.facebook.com/sharer/sharer.php?u=foo">Share on FB</a>
            </footer>
        </body>
    </html>
    """
    socials = extract_social_links_from_html(sample_html)
    assert ("LinkedIn", "https://lk.linkedin.com/company/ceylon-cafe-colombo") in socials
    assert ("Facebook", "https://www.facebook.com/ceyloncafecolombo") in socials
    assert ("Instagram", "https://instagram.com/ceyloncafe_lk") in socials
    assert ("Twitter", "https://twitter.com/ceyloncafe") in socials
    assert not any("sharer" in url for _, url in socials)


def test_extract_contacts_from_html() -> None:
    from app.websites import extract_contacts_from_html

    sample_html = """
    <html>
        <body>
            <p>Call us at 011 234 5678 or mobile +94 77 123 4567.</p>
            <a href="tel:+94771234567">Call Now</a>
            <a href="mailto:info@ceyloncafe.lk">Email Us</a>
            <p>Inquiries: contact@ceyloncafe.lk</p>
            <img src="banner@2x.png" alt="banner" />
        </body>
    </html>
    """
    emails, phones = extract_contacts_from_html(sample_html)
    assert "info@ceyloncafe.lk" in emails
    assert "contact@ceyloncafe.lk" in emails
    assert not any("banner" in e for e in emails)
    assert any("771234567" in p.replace(" ", "") for p in phones)


@pytest.mark.asyncio
async def test_probe_candidate_domains(monkeypatch: pytest.MonkeyPatch) -> None:
    async def mock_getaddrinfo(host: str, port: object) -> list[tuple[int, int, int, str, tuple[str, int]]]:
        if "ceyloncafe" in host:
            return [(2, 1, 0, "", ("93.184.216.34", 80))]
        raise OSError("Host not found")

    loop = asyncio.get_running_loop()
    monkeypatch.setattr(loop, "getaddrinfo", mock_getaddrinfo)

    candidates = await probe_candidate_domains("Ceylon Cafe (Pvt) Ltd")
    assert any("ceyloncafe.lk" in c for c in candidates)

