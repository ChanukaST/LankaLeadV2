import asyncio
import ipaddress
import re
import socket
import time
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

import httpx

from app.core.config import get_settings
from app.models import WebsiteStatus

PARKED_PHRASES = (
    "domain is for sale",
    "buy this domain",
    "this domain is for sale",
    "domain may be for sale",
    "parked free",
    "courtesy of godaddy",
    "godaddy domain parking",
    "parked domain",
    "domain parking",
    "hugedomains",
    "dan.com",
    "sedo domain",
    "domain has expired",
    "under construction",
    "renew now",
    "namecheap.com/domains/registration/parking",
    "this page is parked",
    "parkingcrew",
    "bodis.com",
)


def normalize_url(value: str) -> str:
    value = value.strip()
    if "://" in value and not value.startswith(("http://", "https://")):
        raise ValueError("Only HTTP and HTTPS URLs are supported")
    if not value.startswith(("http://", "https://")):
        value = f"https://{value}"
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("A valid HTTP or HTTPS URL is required")
    return value.rstrip("/")


def _is_public_ip(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


async def assert_public_host(hostname: str) -> None:
    lowered = hostname.casefold().rstrip(".")
    if lowered in {"localhost", "metadata.google.internal"} or lowered.endswith(".local"):
        raise ValueError("Internal hostnames are not allowed")
    try:
        records = await asyncio.to_thread(socket.getaddrinfo, hostname, None)
    except socket.gaierror as exc:
        raise ValueError("Host could not be resolved") from exc
    addresses = {str(record[4][0]) for record in records}
    if not addresses or any(not _is_public_ip(address) for address in addresses):
        raise ValueError("Private or internal addresses are not allowed")


def extract_title(content: bytes) -> str | None:
    marker = content.lower().find(b"<title")
    if marker >= 0:
        start = content.find(b">", marker)
        end = content.find(b"</title>", start)
        if start >= 0 and end > start:
            raw = content[start + 1 : end].decode("utf-8", errors="replace").strip()
            cleaned = re.sub(r"\s+", " ", raw)
            return cleaned[:500] if cleaned else None
    return None


def extract_meta_description(content: bytes) -> str | None:
    text = content[:65536].decode("utf-8", errors="replace")
    match = re.search(
        r'<meta\s+[^>]*?(?:name|property)=["\'](?:description|og:description)["\'][^>]*?content=["\']([^"\']+)["\']',
        text,
        re.IGNORECASE,
    ) or re.search(
        r'<meta\s+[^>]*?content=["\']([^"\']+)["\'][^>]*?(?:name|property)=["\'](?:description|og:description)["\']',
        text,
        re.IGNORECASE,
    )
    if match:
        raw = match.group(1).strip()
        cleaned = re.sub(r"\s+", " ", raw)
        return cleaned[:500] if cleaned else None
    return None


def detect_parked_domain(title: str | None, text_sample: str) -> bool:
    combined = f"{title or ''} {text_sample}".lower()
    return any(phrase in combined for phrase in PARKED_PHRASES)


def match_business_name(name: str | None, text: str) -> bool | None:
    if not name:
        return None
    norm_name = re.sub(r"[^a-z0-9\s]+", " ", name.casefold())
    stopwords = {"and", "the", "restaurant", "cafe", "hotel", "salon", "ltd", "pvt", "services", "sri", "lanka", "lk"}
    tokens = [t for t in norm_name.split() if len(t) >= 3 and t not in stopwords]
    if not tokens:
        tokens = [t for t in norm_name.split() if len(t) >= 2]
    if not tokens:
        return None
    norm_text = text.casefold()
    if norm_name.strip() in norm_text:
        return True
    matched_count = sum(1 for t in tokens if t in norm_text)
    return matched_count >= max(1, len(tokens) // 2)


def match_business_phone(phone: str | None, text: str) -> bool | None:
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if len(digits) < 7:
        return None
    local_digits = digits[-7:]
    stripped_text = re.sub(r"\D", "", text)
    return local_digits in stripped_text


async def check_robots_and_sitemap(
    client: httpx.AsyncClient, origin: str
) -> tuple[bool, bool]:
    has_robots = False
    has_sitemap = False
    robots_url = f"{origin}/robots.txt"
    sitemap_candidate: str | None = None
    try:
        parsed_robots = urlparse(robots_url)
        await assert_public_host(parsed_robots.hostname or "")
        robots_res = await client.get(robots_url, headers={"User-Agent": "LankaLead/0.1"})
        if robots_res.status_code == 200:
            text = robots_res.text[:10000].lower()
            if "user-agent:" in text or "disallow:" in text or "allow:" in text:
                has_robots = True
                sitemap_match = re.search(r"sitemap:\s*(https?://\S+)", robots_res.text, re.IGNORECASE)
                if sitemap_match:
                    sitemap_candidate = sitemap_match.group(1).strip()
    except (httpx.HTTPError, OSError, ValueError):
        pass

    target_sitemap = sitemap_candidate or f"{origin}/sitemap.xml"
    try:
        parsed_sm = urlparse(target_sitemap)
        await assert_public_host(parsed_sm.hostname or "")
        sm_res = await client.get(target_sitemap, headers={"User-Agent": "LankaLead/0.1"})
        if sm_res.status_code == 200:
            content = sm_res.text[:5000].lower()
            if "<urlset" in content or "<sitemapindex" in content or "xml" in sm_res.headers.get("content-type", ""):
                has_sitemap = True
    except (httpx.HTTPError, OSError, ValueError):
        pass

    return has_robots, has_sitemap


LINKEDIN_URL_PATTERN = re.compile(
    r"https?://(?:[a-z]{2,3}\.)?linkedin\.com/(?:company|in)/[a-zA-Z0-9_\-]+/?", re.IGNORECASE
)
FACEBOOK_URL_PATTERN = re.compile(
    r"https?://(?:www\.)?facebook\.com/(?:pages/[^/]+/|profile\.php\?id=\d+|[a-zA-Z0-9.\-_]{3,50})/?", re.IGNORECASE
)
INSTAGRAM_URL_PATTERN = re.compile(
    r"https?://(?:www\.)?instagram\.com/[a-zA-Z0-9._]{2,30}/?", re.IGNORECASE
)
TWITTER_URL_PATTERN = re.compile(
    r"https?://(?:www\.)?(?:twitter\.com|x\.com)/[a-zA-Z0-9_]{1,20}/?", re.IGNORECASE
)
YOUTUBE_URL_PATTERN = re.compile(
    r"https?://(?:www\.)?youtube\.com/(?:@[a-zA-Z0-9_\-]+|channel/[a-zA-Z0-9_\-]+|c/[a-zA-Z0-9_\-]+)/?", re.IGNORECASE
)
TIKTOK_URL_PATTERN = re.compile(
    r"https?://(?:www\.)?tiktok\.com/@[a-zA-Z0-9_.\-]+/?", re.IGNORECASE
)

EXCLUDED_SOCIAL_WORDS = {
    "sharer", "share", "intent", "login", "dialog", "home", "about", "help",
    "privacy", "terms", "policies", "explore", "p", "reels", "stories", "accounts",
    "video", "tag", "discover"
}


def extract_social_links_from_html(html: str) -> tuple[tuple[str, str], ...]:
    """Scrapes company social presence linked from the website HTML."""
    results: list[tuple[str, str]] = []

    for url in LINKEDIN_URL_PATTERN.findall(html):
        results.append(("LinkedIn", url.rstrip("/")))

    for url in FACEBOOK_URL_PATTERN.findall(html):
        clean_url = url.rstrip("/")
        slug = clean_url.split("/")[-1].lower()
        if slug not in EXCLUDED_SOCIAL_WORDS and not any(w in slug for w in ("sharer", "dialog", "share")):
            results.append(("Facebook", clean_url))

    for url in INSTAGRAM_URL_PATTERN.findall(html):
        clean_url = url.rstrip("/")
        slug = clean_url.split("/")[-1].lower()
        if slug not in EXCLUDED_SOCIAL_WORDS:
            results.append(("Instagram", clean_url))

    for url in TIKTOK_URL_PATTERN.findall(html):
        clean_url = url.rstrip("/")
        slug = clean_url.split("@")[-1].lower()
        if slug not in EXCLUDED_SOCIAL_WORDS and not any(w in slug for w in ("sharer", "dialog", "share", "video")):
            results.append(("TikTok", clean_url))

    for url in TWITTER_URL_PATTERN.findall(html):
        clean_url = url.rstrip("/")
        slug = clean_url.split("/")[-1].lower()
        if slug not in EXCLUDED_SOCIAL_WORDS:
            results.append(("Twitter", clean_url))

    for url in YOUTUBE_URL_PATTERN.findall(html):
        results.append(("YouTube", url.rstrip("/")))


    seen: set[tuple[str, str]] = set()
    deduped: list[tuple[str, str]] = []
    for item in results:
        if item not in seen:
            seen.add(item)
            deduped.append(item)
    return tuple(deduped)


EMAIL_PATTERN = re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b')
MAILTO_PATTERN = re.compile(r'mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7})', re.IGNORECASE)
TEL_PATTERN = re.compile(r'tel:([+0-9\s\-()]+)', re.IGNORECASE)
SL_PHONE_PATTERN = re.compile(r'(?:\+94|0)\s*(?:7[0-9]|11|2[1-8]|3[1-8]|4[1-7]|5[1-7]|6[3-7]|8[1-3])\s*\d{3}\s*\d{4}')

EXCLUDED_EMAIL_EXTENSIONS = (".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".css", ".js")
EXCLUDED_EMAIL_DOMAINS = {
    "example.com", "domain.com", "test.com", "yoursite.com", "yourcompany.com",
    "wixpress.com", "sentry.io", "schema.org", "w3.org", "wordpress.org", "cloudflare.com",
    "google.com", "facebook.com", "twitter.com", "instagram.com", "linkedin.com",
}


def extract_contacts_from_html(html: str) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Extracts candidate business emails and phone numbers from website HTML."""
    emails: list[str] = []
    for m in MAILTO_PATTERN.findall(html):
        clean = m.strip().lower()
        if not any(clean.endswith(ext) for ext in EXCLUDED_EMAIL_EXTENSIONS):
            domain = clean.split("@")[-1]
            if domain not in EXCLUDED_EMAIL_DOMAINS and len(clean) <= 100:
                emails.append(clean)

    for m in EMAIL_PATTERN.findall(html):
        clean = m.strip().lower()
        if not any(clean.endswith(ext) for ext in EXCLUDED_EMAIL_EXTENSIONS):
            domain = clean.split("@")[-1]
            if domain not in EXCLUDED_EMAIL_DOMAINS and len(clean) <= 100 and clean not in emails:
                emails.append(clean)

    seen_emails: set[str] = set()
    deduped_emails: list[str] = []
    for e in emails:
        if e not in seen_emails:
            seen_emails.add(e)
            deduped_emails.append(e)

    phones: list[str] = []
    for t in TEL_PATTERN.findall(html):
        cleaned_tel = re.sub(r"[^\d+]", "", t)
        digits_only = re.sub(r"\D", "", cleaned_tel)
        if 9 <= len(digits_only) <= 14:
            phones.append(cleaned_tel)

    for p in SL_PHONE_PATTERN.findall(html):
        cleaned_p = re.sub(r"\s+", " ", p).strip()
        if cleaned_p not in phones:
            phones.append(cleaned_p)

    seen_phones: set[str] = set()
    deduped_phones: list[str] = []
    for p in phones:
        if p not in seen_phones:
            seen_phones.add(p)
            deduped_phones.append(p)

    return tuple(deduped_emails[:5]), tuple(deduped_phones[:5])


async def crawl_contact_page(
    client: httpx.AsyncClient,
    base_url: str,
    html: str,
) -> tuple[tuple[str, ...], tuple[str, ...], tuple[tuple[str, str], ...]]:
    """Crawls a detected /contact or /about page on the same domain to extract additional contacts."""
    parsed_base = urlparse(base_url)

    raw_hrefs = re.findall(r'<a\s+[^>]*?href=["\']([^"\']+)["\']', html, re.IGNORECASE)
    contact_url: str | None = None

    for href in raw_hrefs:
        clean_href = href.strip()
        lower_href = clean_href.lower()
        if any(term in lower_href for term in ("contact", "reach", "about", "touch")):
            if clean_href.startswith(("mailto:", "tel:", "javascript:", "#")):
                continue
            full_url = urljoin(base_url, clean_href)
            parsed_candidate = urlparse(full_url)
            if parsed_candidate.netloc.lower() == parsed_base.netloc.lower():
                contact_url = full_url
                break

    if not contact_url:
        return (), (), ()

    try:
        parsed_contact = urlparse(contact_url)
        await assert_public_host(parsed_contact.hostname or "")
        resp = await client.get(contact_url, headers={"User-Agent": "LankaLead/0.1 (contact-crawler)"})
        if resp.status_code == 200:
            contact_html = resp.content[:65536].decode("utf-8", errors="replace")
            new_emails, new_phones = extract_contacts_from_html(contact_html)
            new_socials = extract_social_links_from_html(contact_html)
            return new_emails, new_phones, new_socials
    except (httpx.HTTPError, OSError, ValueError):
        pass

    return (), (), ()


async def probe_candidate_domains(
    business_name: str,
) -> list[str]:
    """Generates and tests candidate .lk and .com domains for a business name using DNS resolution."""
    clean = re.sub(r'[^a-zA-Z0-9\s]', '', business_name.lower())
    stopwords = {"pvt", "ltd", "limited", "private", "services", "sri", "lanka", "and", "the"}
    words = [w for w in clean.split() if w not in stopwords]
    if not words:
        words = clean.split()
    slug = "".join(words)
    if len(slug) < 3 or len(slug) > 35:
        return []

    candidates = [
        f"https://{slug}.lk",
        f"https://www.{slug}.lk",
        f"https://{slug}.com",
    ]
    resolved_candidates: list[str] = []
    loop = asyncio.get_running_loop()
    for candidate_url in candidates:
        hostname = urlparse(candidate_url).hostname or ""
        try:
            ip_info = await loop.getaddrinfo(hostname, None)
            if ip_info:
                ip_address = ip_info[0][4][0]
                ip_obj = ipaddress.ip_address(ip_address)
                if not (ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_reserved or ip_obj.is_link_local):
                    resolved_candidates.append(candidate_url)
        except (socket.gaierror, ValueError, OSError):
            continue

    return resolved_candidates


@dataclass(frozen=True)
class WebsiteCheckResult:
    url: str
    final_url: str | None
    status: WebsiteStatus
    http_status: int | None
    response_time_ms: int | None
    https: bool
    title: str | None
    meta_description: str | None
    redirect_chain: tuple[str, ...]
    has_robots_txt: bool | None
    has_sitemap: bool | None
    is_parked: bool
    name_matched: bool | None
    phone_matched: bool | None
    confidence_score: float
    error: str | None
    discovered_social_links: tuple[tuple[str, str], ...] = ()
    discovered_emails: tuple[str, ...] = ()
    discovered_phones: tuple[str, ...] = ()


async def check_website(
    url: str,
    business_name: str | None = None,
    business_phone: str | None = None,
) -> WebsiteCheckResult:
    if not url or url.strip().lower() in {"none", "null", "n/a", ""}:
        return WebsiteCheckResult(
            url=url,
            final_url=None,
            status=WebsiteStatus.NOT_DETECTED,
            http_status=None,
            response_time_ms=None,
            https=False,
            title=None,
            meta_description=None,
            redirect_chain=(),
            has_robots_txt=None,
            has_sitemap=None,
            is_parked=False,
            name_matched=None,
            phone_matched=None,
            confidence_score=0.0,
            error=None,
        )
    settings = get_settings()
    started = time.perf_counter()
    normalized = url
    parsed = None
    try:
        normalized = normalize_url(url)
        parsed = urlparse(normalized)
        await assert_public_host(parsed.hostname or "")
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=httpx.Timeout(settings.website_timeout_seconds),
            limits=httpx.Limits(max_connections=10),
        ) as client:
            response = await client.get(normalized, headers={"User-Agent": "LankaLead/0.1"})
            content = response.content[: settings.website_max_response_bytes]

            # Revalidate all redirect hops for SSRF safety
            redirects: list[str] = [str(r.url) for r in response.history]
            for hist_res in response.history:
                hist_parsed = urlparse(str(hist_res.url))
                await assert_public_host(hist_parsed.hostname or "")

            final = normalize_url(str(response.url))
            parsed_final = urlparse(final)
            await assert_public_host(parsed_final.hostname or "")
            redirect_chain = tuple(redirects + [final])

            title = extract_title(content)
            meta_description = extract_meta_description(content)
            body_text = content[:100000].decode("utf-8", errors="replace")

            is_parked = detect_parked_domain(title, body_text[:20000])
            discovered_social_links = extract_social_links_from_html(body_text)
            discovered_emails, discovered_phones = extract_contacts_from_html(body_text)

            origin = f"{parsed_final.scheme}://{parsed_final.netloc}"
            has_robots, has_sitemap = await check_robots_and_sitemap(client, origin)

            name_matched = match_business_name(business_name, f"{title or ''} {meta_description or ''} {body_text}")
            phone_matched = match_business_phone(business_phone, body_text)

            is_https = parsed_final.scheme == "https"
            http_status = response.status_code

            if is_parked:
                status = WebsiteStatus.PARKED
                confidence = 0.0
            elif 200 <= http_status < 400:
                status = WebsiteStatus.FOUND
                score = 0.5
                if is_https:
                    score += 0.1
                if name_matched is True:
                    score += 0.25
                elif name_matched is False:
                    score -= 0.1
                if phone_matched is True:
                    score += 0.15
                if has_robots:
                    score += 0.05
                if has_sitemap:
                    score += 0.05
                confidence = round(max(0.1, min(1.0, score)), 2)
            elif http_status in {404, 410} or http_status >= 500:
                status = WebsiteStatus.UNREACHABLE
                confidence = 0.0
            else:
                status = WebsiteStatus.UNCLEAR
                confidence = 0.2

            if not is_parked and 200 <= http_status < 400:
                more_emails, more_phones, more_socials = await crawl_contact_page(client, final, body_text)
                merged_emails = list(discovered_emails)
                for e in more_emails:
                    if e not in merged_emails:
                        merged_emails.append(e)
                discovered_emails = tuple(merged_emails)

                merged_phones = list(discovered_phones)
                for p in more_phones:
                    if p not in merged_phones:
                        merged_phones.append(p)
                discovered_phones = tuple(merged_phones)

                merged_socials = list(discovered_social_links)
                for s in more_socials:
                    if s not in merged_socials:
                        merged_socials.append(s)
                discovered_social_links = tuple(merged_socials)

            return WebsiteCheckResult(
                url=normalized,
                final_url=final,
                status=status,
                http_status=http_status,
                response_time_ms=round((time.perf_counter() - started) * 1000),
                https=is_https,
                title=title,
                meta_description=meta_description,
                redirect_chain=redirect_chain,
                has_robots_txt=has_robots,
                has_sitemap=has_sitemap,
                is_parked=is_parked,
                name_matched=name_matched,
                phone_matched=phone_matched,
                confidence_score=confidence,
                error=None,
                discovered_social_links=discovered_social_links,
                discovered_emails=discovered_emails,
                discovered_phones=discovered_phones,
            )
    except (httpx.HTTPError, ValueError, OSError) as exc:
        return WebsiteCheckResult(
            url=normalized,
            final_url=None,
            status=WebsiteStatus.UNREACHABLE,
            http_status=None,
            response_time_ms=round((time.perf_counter() - started) * 1000),
            https=bool(parsed and parsed.scheme == "https"),
            title=None,
            meta_description=None,
            redirect_chain=(normalized,),
            has_robots_txt=None,
            has_sitemap=None,
            is_parked=False,
            name_matched=None,
            phone_matched=None,
            confidence_score=0.0,
            error=str(exc),
            discovered_social_links=(),
            discovered_emails=(),
            discovered_phones=(),
        )
