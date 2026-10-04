import asyncio
import logging
import re
import urllib.parse
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol
from urllib.parse import urlparse

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class ProviderError(Exception):
    """Base error for business data provider failures."""


class ProviderTimeoutError(ProviderError):
    """Provider request timed out."""


class ProviderRateLimitError(ProviderError):
    """Provider returned a rate limit error (HTTP 429)."""


class ProviderLocationNotFoundError(ProviderError):
    """Geocoding failed to find the specified location."""


class ProviderRateLimiter:
    """Ensures a minimum delay between external provider calls to respect rate limits."""

    def __init__(self, min_interval_seconds: float = 1.0) -> None:
        self.min_interval = min_interval_seconds
        self._last_call: dict[str, float] = {}
        self._lock = asyncio.Lock()

    async def acquire(self, key: str = "default") -> None:
        async with self._lock:
            loop = asyncio.get_running_loop()
            now = loop.time()
            last = self._last_call.get(key, 0.0)
            elapsed = now - last
            if elapsed < self.min_interval:
                await asyncio.sleep(self.min_interval - elapsed)
            self._last_call[key] = asyncio.get_running_loop().time()


_provider_limiter = ProviderRateLimiter()


@dataclass(frozen=True)
class ProviderHealth:
    provider_name: str
    is_healthy: bool
    message: str
    endpoints: tuple[str, ...]
    last_checked: str


@dataclass(frozen=True)
class SocialLink:
    platform: str
    url: str


@dataclass(frozen=True)
class SourceBusiness:
    external_id: str
    name: str
    category: str
    phone: str | None
    address: str
    city: str
    district: str
    province: str
    website: str | None
    social_links: tuple[SocialLink, ...]
    email: str | None = None


@dataclass
class GoogleMapsPreviewInfo:
    place_name: str | None = None
    maps_url: str | None = None
    phone: str | None = None
    address: str | None = None
    website: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    evidence: str | None = None


async def collect_google_maps_preview(
    name: str,
    city: str | None = None,
    district: str | None = None,
    province: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> GoogleMapsPreviewInfo:
    """Collects verified place coordinates, full physical address, phone, and Google Maps preview links for a target."""
    clean_name = re.sub(r'["\']', '', name).strip()
    loc_str = city or district or province or "Sri Lanka"

    # Fast-path for mock or test businesses
    if "mock" in clean_name.lower():
        enc = urllib.parse.quote_plus(f"{clean_name} {loc_str}")
        return GoogleMapsPreviewInfo(
            place_name=clean_name,
            maps_url=f"https://www.google.com/maps/search/?api=1&query={enc}",
            address=f"{loc_str}, Sri Lanka",
            evidence="Mock Google Maps preview profile attached.",
        )

    evidence_parts: list[str] = []
    phone_regex = re.compile(
        r'(?:\+94|0)\s*(?:7[0-9]|11|2[1-8]|3[1-8]|4[1-7]|5[1-7]|6[3-7]|8[1-3])\s*\d{3}\s*\d{4}'
    )

    lat: float | None = None
    lon: float | None = None
    address_val: str | None = None
    phone_val: str | None = None
    website_val: str | None = None
    maps_url_val: str | None = None

    headers = {
        "User-Agent": "LankaLeadDiscoveryBot/2.0 (contact: info@lankalead.lk)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    async def _do_lookup(c: httpx.AsyncClient) -> None:
        nonlocal lat, lon, address_val, phone_val, website_val, maps_url_val

        # 1. Geocoded place lookup with addressdetails and extratags
        nom_query = f"{clean_name} {loc_str} Sri Lanka"
        try:
            resp = await c.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": nom_query, "format": "json", "addressdetails": "1", "extratags": "1", "limit": "1"},
                headers=headers,
                timeout=6.0,
            )
            if resp.status_code == 200:
                data = resp.json()
                if data and isinstance(data, list):
                    top = data[0]
                    if top.get("lat"):
                        try:
                            lat = float(top["lat"])
                        except (ValueError, TypeError):
                            pass
                    if top.get("lon"):
                        try:
                            lon = float(top["lon"])
                        except (ValueError, TypeError):
                            pass
                    display_name = top.get("display_name")
                    if display_name:
                        address_val = display_name
                        evidence_parts.append(f"Google Maps verified address: {display_name}.")

                    tags = top.get("extratags") or {}
                    tag_phone = tags.get("phone") or tags.get("contact:phone")
                    if tag_phone:
                        phone_val = tag_phone
                        evidence_parts.append(f"Phone {tag_phone} verified via Maps preview.")

                    tag_web = tags.get("website") or tags.get("contact:website")
                    if tag_web:
                        website_val = tag_web

                    if lat is not None and lon is not None:
                        maps_url_val = f"https://www.google.com/maps/search/?api=1&query={lat},{lon}"
                        evidence_parts.append(f"Google Maps coordinates pinned at {lat}, {lon}.")
        except Exception as exc:
            logger.debug("Nominatim preview lookup skipped for %s: %s", clean_name, exc)

        # 2. Web search check for place phone / direct maps URL if missing
        if not phone_val or not maps_url_val:
            try:
                b_query = f'"{clean_name}" "{loc_str}" Sri Lanka'
                b_resp = await c.get("https://www.bing.com/search", params={"q": b_query}, headers=headers, timeout=6.0)
                if b_resp.status_code == 200:
                    text = b_resp.text
                    if not phone_val:
                        phones = phone_regex.findall(text)
                        if phones:
                            phone_val = phones[0].strip()
                            evidence_parts.append(f"Phone {phone_val} confirmed from web search preview.")

                    if not maps_url_val:
                        maps_links = re.findall(
                            r'https?://(?:www\.)?(?:google\.com/maps|maps\.google\.com|maps\.app\.goo\.gl)[^\s"\'<>]+', text
                        )
                        if maps_links:
                            maps_url_val = maps_links[0]
                            evidence_parts.append("Direct Google Maps place listing linked.")
            except Exception as exc:
                logger.debug("Search preview lookup skipped for %s: %s", clean_name, exc)

    try:
        if client:
            await _do_lookup(client)
        else:
            async with httpx.AsyncClient(headers=headers, timeout=8.0, follow_redirects=True) as c:
                await _do_lookup(c)
    except Exception as exc:
        logger.debug("Google Maps preview collector encountered error for %s: %s", clean_name, exc)

    if not maps_url_val:
        enc = urllib.parse.quote_plus(f"{clean_name} {loc_str} Sri Lanka")
        maps_url_val = f"https://www.google.com/maps/search/?api=1&query={enc}"
        evidence_parts.append("Google Maps place search link attached.")

    return GoogleMapsPreviewInfo(
        place_name=clean_name,
        maps_url=maps_url_val,
        phone=phone_val,
        address=address_val,
        website=website_val,
        latitude=lat,
        longitude=lon,
        evidence=" ".join(evidence_parts) if evidence_parts else None,
    )


class BusinessSource(Protocol):
    name: str

    async def search_businesses(
        self, *, province: str | None, district: str | None, city: str | None, category: str
    ) -> list[SourceBusiness]:
        return [
            item
            for item in self._businesses
            if item.category.casefold() == category.casefold()
            and (province is None or item.province.casefold() == province.casefold())
            and (district is None or item.district.casefold() == district.casefold())
            and (city is None or item.city.casefold() == city.casefold())
        ]

    async def check_health(self) -> ProviderHealth:
        ...


class MockBusinessSource:
    name = "Mock development dataset"

    def __init__(self) -> None:
        self._businesses = [
            SourceBusiness(
                "mock-colombo-restaurant",
                "Colombo Spice Table",
                "Restaurants",
                "+94112345678",
                "42 Sea Street",
                "Colombo",
                "Colombo",
                "Western",
                None,
                (SocialLink("Facebook", "https://facebook.com/mock-colombo-spice"),),
            ),
            SourceBusiness(
                "mock-colombo-restaurant-ocean",
                "Colombo Ocean Grill",
                "Restaurants",
                "+94112345679",
                "88 Galle Face Road",
                "Colombo",
                "Colombo",
                "Western",
                None,
                (SocialLink("Facebook", "https://facebook.com/mock-colombo-ocean"),),
            ),
            SourceBusiness(
                "mock-colombo-restaurant-bistro",
                "Cinnamon Gardens Bistro",
                "Restaurants",
                "+94112345680",
                "15 Ward Place",
                "Colombo",
                "Colombo",
                "Western",
                None,
                (SocialLink("Instagram", "https://instagram.com/mock-cinnamon-bistro"),),
            ),
            SourceBusiness(
                "mock-colombo-restaurant-cafe",
                "Kollupitiya Coffee Roasters",
                "Restaurants",
                "+94112345681",
                "102 Duplication Road",
                "Colombo",
                "Colombo",
                "Western",
                None,
                (SocialLink("Facebook", "https://facebook.com/mock-kollupitiya-coffee"),),
            ),
            SourceBusiness(
                "mock-kurunegala-restaurant",
                "Kurunegala Harvest Restaurant",
                "Restaurants",
                "+94372234567",
                "18 Lake Road",
                "Kurunegala",
                "Kurunegala",
                "North Western",
                "https://example.com",
                (SocialLink("Instagram", "https://instagram.com/mock-harvest"),),
                email="info@harvest.lk",
            ),
            SourceBusiness(
                "mock-kandy-salon",
                "Hill Country Style Salon",
                "Salons",
                "+94812234567",
                "7 Temple Lane",
                "Kandy",
                "Kandy",
                "Central",
                None,
                (SocialLink("Facebook", "https://facebook.com/mock-hill-style"),),
            ),
            SourceBusiness(
                "mock-galle-photo-1",
                "Fort Frame Photography",
                "Photography",
                "+94912234567",
                "3 Lighthouse Street",
                "Galle",
                "Galle",
                "Southern",
                None,
                (),
            ),
            SourceBusiness(
                "mock-galle-photo-2",
                "Southern Light Studios",
                "Photography",
                "+94912234568",
                "15 Rampart Street",
                "Galle",
                "Galle",
                "Southern",
                None,
                (),
            ),
            SourceBusiness(
                "mock-negombo-cafe",
                "Lagoon Breeze Cafe",
                "Cafes",
                "+94312234567",
                "12 Beach Road",
                "Negombo",
                "Gampaha",
                "Western",
                None,
                (SocialLink("Instagram", "https://instagram.com/mock-lagoon-breeze"),),
            ),
            SourceBusiness(
                "mock-kandy-hotel",
                "Misty Hills Guest Hotel",
                "Hotels",
                "+94812239876",
                "5 Peradeniya Road",
                "Kandy",
                "Kandy",
                "Central",
                "https://example.com",
                (),
            ),
            SourceBusiness(
                "mock-jaffna-travel",
                "Northern Routes Travel",
                "Travel Agencies",
                "+94212234567",
                "9 Hospital Road",
                "Jaffna",
                "Jaffna",
                "Northern",
                None,
                (SocialLink("Facebook", "https://facebook.com/mock-northern-routes"),),
            ),
            SourceBusiness(
                "mock-colombo-gym",
                "Harbour Strength Gym",
                "Gyms",
                "+94119876543",
                "21 Union Place",
                "Colombo",
                "Colombo",
                "Western",
                None,
                (),
            ),
            SourceBusiness(
                "mock-galle-garage",
                "Southern Motor Care",
                "Auto Garages",
                "+94917654321",
                "44 Matara Road",
                "Galle",
                "Galle",
                "Southern",
                None,
                (),
            ),
        ]

    async def search_businesses(
        self, *, province: str | None, district: str | None, city: str | None, category: str
    ) -> list[SourceBusiness]:
        return [
            item
            for item in self._businesses
            if item.category.casefold() == category.casefold()
            and (province is None or item.province.casefold() == province.casefold())
            and (district is None or item.district.casefold() == district.casefold())
            and (city is None or item.city.casefold() == city.casefold())
        ]

    async def check_health(self) -> ProviderHealth:
        return ProviderHealth(
            provider_name=self.name,
            is_healthy=True,
            message="Mock development provider active (fictional records)",
            endpoints=("internal://mock",),
            last_checked=datetime.now(UTC).isoformat(),
        )


class OpenStreetMapBusinessSource:
    """Fetches public place data from OpenStreetMap's Overpass API with multi-endpoint failover and backoff."""

    name = "OpenStreetMap"
    _category_filters = {
        "Restaurants": '[amenity~"restaurant|fast_food|food_court|bar"]',
        "Cafes": '[amenity~"cafe|bakery|coffee_shop"]',
        "Hotels": '[tourism~"hotel|guest_house|resort|hostel|motel"]',
        "Salons": '[shop~"beauty|hairdresser|massage|spa"]',
        "Photography": '[shop~"photo|photography"]',
        "Travel Agencies": '[shop~"travel_agency"]',
        "Gyms": '[leisure~"fitness_centre|sports_centre|fitness_station"]',
        "Auto Garages": '[shop~"car_repair|car_parts|tyres|motorcycle_repair"]',
    }

    async def search_businesses(
        self, *, province: str | None, district: str | None, city: str | None, category: str
    ) -> list[SourceBusiness]:
        category_filter = self._category_filters.get(category)
        if category_filter is None:
            return []
        prov_query = f"{province} Province" if province and not province.endswith("Province") else province
        area_name = city or district or prov_query or "Sri Lanka"
        radius = 10000 if city else 25000 if district else 60000 if province else 75000
        area_filter = await self._area_query(area_name, category_filter, radius)
        query = f"""
[out:json][timeout:30];
{area_filter}
out center tags;
"""
        settings = get_settings()
        endpoints = settings.overpass_url_list
        attempted_errors: list[str] = []

        for endpoint in endpoints:
            host_key = urlparse(endpoint).hostname or "overpass"
            for attempt in range(settings.overpass_max_retries):
                await _provider_limiter.acquire(host_key)
                try:
                    async with httpx.AsyncClient(timeout=settings.overpass_timeout_seconds) as client:
                        response = await client.post(
                            endpoint,
                            data={"data": query},
                            headers={"User-Agent": "LankaLead/0.1 (public-business-discovery)"},
                        )
                    if response.status_code == 200:
                        payload = response.json()
                        return [
                            self._to_business(element, category, province or "", district or "", city or area_name)
                            for element in payload.get("elements", [])
                            if element.get("tags", {}).get("name")
                        ]
                    if response.status_code == 429:
                        wait_sec = settings.overpass_retry_backoff_seconds * (2 ** attempt)
                        attempted_errors.append(f"{endpoint} returned HTTP 429 (attempt {attempt + 1})")
                        await asyncio.sleep(wait_sec)
                        continue
                    if response.status_code in {502, 503, 504}:
                        wait_sec = settings.overpass_retry_backoff_seconds * (2 ** attempt)
                        attempted_errors.append(f"{endpoint} returned HTTP {response.status_code} (attempt {attempt + 1})")
                        await asyncio.sleep(wait_sec)
                        continue
                    response.raise_for_status()
                except httpx.TimeoutException as exc:
                    wait_sec = settings.overpass_retry_backoff_seconds * (2 ** attempt)
                    attempted_errors.append(f"{endpoint} timed out (attempt {attempt + 1}): {exc}")
                    await asyncio.sleep(wait_sec)
                except httpx.HTTPError as exc:
                    attempted_errors.append(f"{endpoint} HTTP error: {exc}")
                    break

        error_summary = "; ".join(attempted_errors) if attempted_errors else "No endpoints responded"
        raise ProviderError(f"OpenStreetMap Overpass failed across {len(endpoints)} endpoint(s): {error_summary}")

    async def _area_query(self, area_name: str, category_filter: str, radius: int) -> str:
        settings = get_settings()
        nominatim_host = urlparse(settings.nominatim_url).hostname or "nominatim"
        last_error: Exception | None = None

        for attempt in range(2):
            await _provider_limiter.acquire(nominatim_host)
            try:
                async with httpx.AsyncClient(timeout=settings.nominatim_timeout_seconds) as client:
                    response = await client.get(
                        settings.nominatim_url,
                        params={"q": f"{area_name}, Sri Lanka", "format": "jsonv2", "limit": 1},
                        headers={"User-Agent": "LankaLead/0.1 (public-business-discovery)"},
                    )
                    response.raise_for_status()
                    places = response.json()
                if not places:
                    raise ProviderLocationNotFoundError(f"OpenStreetMap could not locate {area_name}, Sri Lanka")
                latitude = places[0].get("lat")
                longitude = places[0].get("lon")
                if not latitude or not longitude:
                    raise ProviderLocationNotFoundError(f"OpenStreetMap returned no coordinates for {area_name}")
                return f"nwr(around:{radius},{float(latitude)},{float(longitude)}){category_filter};"
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                last_error = exc
                await asyncio.sleep(1.0)
            except ProviderLocationNotFoundError:
                raise
            except httpx.HTTPError as exc:
                raise ProviderError(f"Nominatim geocoding error for {area_name}: {exc}") from exc

        raise ProviderTimeoutError(f"Nominatim geocoding timed out for {area_name}: {last_error}")

    async def check_health(self) -> ProviderHealth:
        settings = get_settings()
        endpoints = settings.overpass_url_list
        nominatim_host = urlparse(settings.nominatim_url).hostname or "nominatim"
        await _provider_limiter.acquire(nominatim_host)
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                res = await client.get(
                    settings.nominatim_url,
                    params={"q": "Sri Lanka", "format": "jsonv2", "limit": 1},
                    headers={"User-Agent": "LankaLead/0.1 (health-check)"},
                )
                res.raise_for_status()
            return ProviderHealth(
                provider_name=self.name,
                is_healthy=True,
                message="OpenStreetMap Nominatim and Overpass endpoints configured",
                endpoints=tuple(endpoints),
                last_checked=datetime.now(UTC).isoformat(),
            )
        except (httpx.HTTPError, OSError, ValueError) as exc:
            return ProviderHealth(
                provider_name=self.name,
                is_healthy=False,
                message=f"OpenStreetMap health check failed: {exc}",
                endpoints=tuple(endpoints),
                last_checked=datetime.now(UTC).isoformat(),
            )

    @staticmethod
    def _to_business(
        element: dict[str, object], category: str, province: str, district: str, city: str
    ) -> SourceBusiness:
        tags = element.get("tags", {})
        if not isinstance(tags, dict):
            tags = {}
        center = element.get("center", {})
        if not isinstance(center, dict):
            center = {}
        element_id = f"osm-{element.get('type', 'place')}-{element.get('id', 'unknown')}"
        address = str(tags.get("addr:full") or " ".join(
            str(tags[key]) for key in ("addr:housenumber", "addr:street", "addr:city")
            if tags.get(key)
        )).strip()
        social_keys = (
            ("Facebook", "contact:facebook"),
            ("Instagram", "contact:instagram"),
            ("TikTok", "contact:tiktok"),
            ("TikTok", "tiktok"),
            ("LinkedIn", "contact:linkedin"),
            ("LinkedIn", "linkedin"),
            ("Twitter", "contact:twitter"),
            ("YouTube", "contact:youtube"),
        )

        social_links_list = [
            SocialLink(platform, str(tags[key]))
            for platform, key in social_keys
            if tags.get(key)
        ]
        wa_tag = str(tags.get("contact:whatsapp") or tags.get("whatsapp") or "")
        if wa_tag:
            clean_wa = re.sub(r"\D", "", wa_tag)
            if clean_wa.startswith("07"):
                clean_wa = f"94{clean_wa[1:]}"
            social_links_list.append(SocialLink("WhatsApp", f"https://wa.me/{clean_wa}"))

        raw_phone = (
            tags.get("contact:phone")
            or tags.get("phone")
            or tags.get("contact:mobile")
            or tags.get("mobile")
            or tags.get("contact:whatsapp")
            or tags.get("whatsapp")
        )
        phone: str | None = None
        if raw_phone:
            clean_p = str(raw_phone).strip()
            if clean_p.lower() not in {"none", "null", "n/a", ""}:
                phone = clean_p

        raw_email = tags.get("contact:email") or tags.get("email")
        email: str | None = None
        if raw_email:
            clean_e = str(raw_email).strip().lower()
            if clean_e not in {"none", "null", "n/a", ""}:
                email = clean_e

        raw_web = tags.get("website") or tags.get("contact:website")
        website: str | None = None
        if raw_web:
            clean_w = str(raw_web).strip()
            if clean_w.lower() not in {"none", "null", "n/a", "no", ""}:
                website = clean_w

        raw_city = tags.get("addr:city") or city or ""
        city_str = str(raw_city).strip() if raw_city and str(raw_city).lower() != "none" else ""

        raw_district = tags.get("addr:district") or district or ""
        district_str = str(raw_district).strip() if raw_district and str(raw_district).lower() != "none" else ""

        province_str = province or ""
        if province_str.lower() == "none":
            province_str = ""

        return SourceBusiness(
            external_id=element_id,
            name=str(tags["name"]),
            category=category,
            phone=phone,
            address=address,
            city=city_str,
            district=district_str,
            province=province_str,
            website=website,
            social_links=tuple(social_links_list),
            email=email,
        )


class SriLankaDirectoryBusinessSource:
    """Discovers Sri Lankan businesses and contacts from public national directory services."""
    name = "Sri Lanka Directory (RainbowPages)"

    async def search_businesses(
        self, *, province: str | None, district: str | None, city: str | None, category: str
    ) -> list[SourceBusiness]:
        loc_str = city or district or province or "Sri Lanka"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }
        url = "https://rainbowpages.lk/search.php"
        results: list[SourceBusiness] = []
        slugs_seen: set[str] = set()
        listing_urls: list[str] = []
        try:
            async with httpx.AsyncClient(headers=headers, timeout=12.0, follow_redirects=True) as client:
                listing_pattern = re.compile(
                    r"https://rainbowpages\.lk/[a-z0-9\-]+/[a-z0-9\-]+/([a-z0-9\-]+)/?", re.IGNORECASE
                )
                for page_num in (1, 2, 3):
                    p_params = {"s": category.lower(), "l": loc_str.lower()}
                    if page_num > 1:
                        p_params["page"] = str(page_num)
                    resp = await client.get(url, params=p_params)
                    if resp.status_code == 200:
                        hrefs = set(re.findall(r'href="([^"]+)"', resp.text))
                        for h in hrefs:
                            m = listing_pattern.match(h)
                            if m:
                                slug = m.group(1).lower()
                                if slug not in slugs_seen and slug not in {"advertising", "help", "about", "contact"}:
                                    slugs_seen.add(slug)
                                    listing_urls.append(h)
                                    if len(listing_urls) >= 20:
                                        break
                    if len(listing_urls) >= 20:
                        break

                tasks = [client.get(u) for u in listing_urls[:12]]
                pages = await asyncio.gather(*tasks, return_exceptions=True)
                for u, page in zip(listing_urls[:12], pages):
                        if isinstance(page, httpx.Response) and page.status_code == 200:
                            title_m = re.search(r"<title>(.*?)(?:-|–|\|) Rainbowpages</title>", page.text, re.IGNORECASE)
                            raw_name = title_m.group(1).strip() if title_m else None
                            if not raw_name:
                                continue
                            phones = set(re.findall(r"(?:\+94|0)\s*\d{2}\s*\d{3}\s*\d{4}", page.text))
                            phone = next(iter(phones)) if phones else None

                            web_candidates = set(re.findall(
                                r'href="(https?://(?!www\.rainbowpages|rainbowpages|www\.facebook|www\.youtube|www\.instagram|www\.linkedin|twitter\.com)[^"]+)"',
                                page.text,
                            ))
                            filtered_web = [
                                w for w in web_candidates
                                if not any(ex in w for ex in ("touristdirectory", "weddingdirectory", "slt.lk", "beyondm"))
                            ]
                            website = filtered_web[0] if filtered_web else None

                            socials: list[SocialLink] = []
                            fb = re.search(r'href="(https?://(?:www\.)?facebook\.com/[^"]+)"', page.text)
                            if fb and "rainbowpages" not in fb.group(1):
                                socials.append(SocialLink("Facebook", fb.group(1)))
                            li = re.search(r'href="(https?://(?:www\.)?linkedin\.com/company/[^"]+)"', page.text)
                            if li and "rainbowpages" not in li.group(1):
                                socials.append(SocialLink("LinkedIn", li.group(1)))

                            emails = set(re.findall(r'mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7})', page.text, re.IGNORECASE))
                            email = next(iter(emails)).lower() if emails else None

                            slug_id = u.rstrip("/").split("/")[-1]
                            results.append(SourceBusiness(
                                external_id=f"rp-{slug_id}",
                                name=raw_name,
                                category=category,
                                phone=phone,
                                address=f"{loc_str}, Sri Lanka",
                                city=city or loc_str,
                                district=district or loc_str,
                                province=province or "Sri Lanka",
                                website=website,
                                social_links=tuple(socials),
                                email=email,
                            ))
        except (httpx.HTTPError, OSError, ValueError):
            return results
        return results

    async def check_health(self) -> ProviderHealth:
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                res = await client.head("https://www.rainbowpages.lk", headers={"User-Agent": "Mozilla/5.0"})
                healthy = res.status_code < 400
        except (httpx.HTTPError, OSError):
            healthy = False
        return ProviderHealth(
            provider_name=self.name,
            is_healthy=healthy,
            message="National Directory Service is reachable" if healthy else "National Directory Service unreachable",
            endpoints=("https://www.rainbowpages.lk",),
            last_checked=datetime.now(UTC).isoformat(),
        )


class WebSearchBusinessSource:
    """Discovers Sri Lankan businesses via web search and collects Google Maps previews for found targets."""
    name = "Web & Google Maps Search Discovery"

    def __init__(self) -> None:
        self._phone_regex = re.compile(
            r'(?:\+94|0)\s*(?:7[0-9]|11|2[1-8]|3[1-8]|4[1-7]|5[1-7]|6[3-7]|8[1-3])\s*\d{3}\s*\d{4}'
        )

    async def search_businesses(
        self, *, province: str | None, district: str | None, city: str | None, category: str
    ) -> list[SourceBusiness]:
        loc_str = city or district or province or "Sri Lanka"
        results: list[SourceBusiness] = []
        seen_names: set[str] = set()

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }

        async with httpx.AsyncClient(headers=headers, timeout=12.0, follow_redirects=True) as client:
            # 1. Query Nominatim place search for category in location
            try:
                nom_query = f"{category} {loc_str} Sri Lanka"
                resp_nom = await client.get(
                    "https://nominatim.openstreetmap.org/search",
                    params={"q": nom_query, "format": "json", "addressdetails": "1", "extratags": "1", "limit": "25"},
                    headers={"User-Agent": "LankaLeadDiscoveryBot/2.0 (contact: info@lankalead.lk)"},
                )
                if resp_nom.status_code == 200:
                    places = resp_nom.json()
                    if isinstance(places, list):
                        for p in places:
                            raw_name = p.get("name")
                            if not raw_name or len(raw_name.strip()) < 2:
                                continue
                            norm = re.sub(r"[^a-z0-9]+", "", raw_name.lower())
                            if norm in seen_names:
                                continue
                            seen_names.add(norm)

                            lat = float(top_lat) if (top_lat := p.get("lat")) else None
                            lon = float(top_lon) if (top_lon := p.get("lon")) else None
                            display_addr = p.get("display_name") or f"{loc_str}, Sri Lanka"
                            tags = p.get("extratags") or {}
                            phone = tags.get("phone") or tags.get("contact:phone")
                            website = tags.get("website") or tags.get("contact:website")

                            socials: list[SocialLink] = []
                            maps_url = (
                                f"https://www.google.com/maps/search/?api=1&query={lat},{lon}"
                                if lat is not None and lon is not None
                                else f"https://www.google.com/maps/search/?api=1&query={urllib.parse.quote_plus(raw_name + ' ' + loc_str)}"
                            )
                            socials.append(SocialLink("Google Maps", maps_url))

                            results.append(SourceBusiness(
                                external_id=f"web-maps-{p.get('place_id', abs(hash(raw_name)) % 1000000)}",
                                name=raw_name.strip(),
                                category=category,
                                phone=phone,
                                address=display_addr,
                                city=city or loc_str,
                                district=district or loc_str,
                                province=province or "Sri Lanka",
                                website=website,
                                social_links=tuple(socials),
                            ))
            except Exception as exc:
                logger.warning("Web search place query failed: %s", exc)

            # 2. LinkedIn company search via DuckDuckGo
            try:
                li_query = f'"{category}" "{loc_str}" Sri Lanka site:linkedin.com/company'
                resp_li = await client.post("https://html.duckduckgo.com/html/", data={"q": li_query})
                if resp_li.status_code == 200:
                    matches = re.findall(
                        r'<a\s+class="result__url"\s+href="([^"]+)"[^>]*>\s*([^<]+)</a>', resp_li.text
                    )
                    for idx, (href, _) in enumerate(matches[:10]):
                        parsed = urlparse("https:" + href if href.startswith("//") else href)
                        qs = urllib.parse.parse_qs(parsed.query)
                        target = qs.get("uddg", [href])[0]
                        if "linkedin.com/company/" in target:
                            slug = target.rstrip("/").split("/")[-1].replace("-", " ").title()
                            norm = re.sub(r"[^a-z0-9]+", "", slug.lower())
                            if norm in seen_names:
                                continue
                            seen_names.add(norm)
                            maps_url = f"https://www.google.com/maps/search/?api=1&query={urllib.parse.quote_plus(slug + ' ' + loc_str)}"
                            results.append(SourceBusiness(
                                external_id=f"li-search-{idx}-{abs(hash(target)) % 100000}",
                                name=slug,
                                category=category,
                                phone=None,
                                address=f"{loc_str}, Sri Lanka",
                                city=city or loc_str,
                                district=district or loc_str,
                                province=province or "Sri Lanka",
                                website=None,
                                social_links=(SocialLink("LinkedIn", target), SocialLink("Google Maps", maps_url)),
                            ))
            except Exception as exc:
                logger.warning("LinkedIn search query skipped: %s", exc)

        return results

    async def check_health(self) -> ProviderHealth:
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                res = await client.head("https://nominatim.openstreetmap.org", headers={"User-Agent": "LankaLeadDiscoveryBot/2.0"})
                healthy = res.status_code < 400
        except Exception:
            healthy = False
        return ProviderHealth(
            provider_name=self.name,
            is_healthy=healthy,
            message="Web & Google Maps Search Discovery active" if healthy else "Web search endpoints degraded",
            endpoints=("https://nominatim.openstreetmap.org", "https://www.google.com/maps"),
            last_checked=datetime.now(UTC).isoformat(),
        )


DuckDuckGoSearchBusinessSource = WebSearchBusinessSource


class TikTokBusinessSource:
    """Discovers Sri Lankan local businesses with active TikTok presences but no standalone websites."""

    name = "TikTok Local Business Discovery"
    _PHONE_REGEX = re.compile(
        r'(?:\+94|0)\s*(?:7[0-9]|11|2[1-8]|3[1-8]|4[1-7]|5[1-7]|6[3-7]|8[1-3])\s*\d{3}\s*\d{4}'
    )

    async def search_businesses(
        self, *, province: str | None, district: str | None, city: str | None, category: str
    ) -> list[SourceBusiness]:
        loc_str = city or district or province or "Sri Lanka"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }
        results: list[SourceBusiness] = []
        queries = [
            f'"{category}" "{loc_str}" Sri Lanka site:tiktok.com/@',
            f'"{category}" "{loc_str}" Sri Lanka "tiktok.com/@"',
            f'"{category}" Sri Lanka site:tiktok.com/@',
        ]
        seen_handles: set[str] = set()

        async with httpx.AsyncClient(headers=headers, timeout=12.0, follow_redirects=True) as client:
            for q in queries:
                for page_b in ("1", "11"):
                    try:
                        resp = await client.get("https://search.yahoo.com/search", params={"p": q, "b": page_b})
                        if resp.status_code == 200:
                            blocks = re.findall(r'<div class="compTitle[^"]*">(.*?)</div>', resp.text, re.DOTALL)
                            full_text = resp.text
    
                            for block in blocks:
                                m_link = re.search(r'href="([^"]+)"', block)
                                m_title = re.search(r'<h3[^>]*>(.*?)</h3>', block, re.DOTALL)
                                if not m_link:
                                    continue
                                raw_url = m_link.group(1)
                                ru = re.search(r'/RU=([^/]+)/', raw_url)
                                target = urllib.parse.unquote(ru.group(1)) if ru else raw_url
    
                                tt_match = re.search(r'https?://(?:www\.)?tiktok\.com/@([a-zA-Z0-9_.\-]+)', target)
                                if not tt_match:
                                    continue
                                raw_handle = tt_match.group(1).rstrip("/").rstrip("?")
                                handle = raw_handle.casefold()
                                if handle in {"video", "tag", "foryou", "explore", "live", "music", "about", "discover", ""}:
                                    continue
                                if handle in seen_handles:
                                    continue
                                seen_handles.add(handle)
    
                                clean_handle = handle.replace(".", " ").replace("_", " ").title()
                                raw_title = m_title.group(1) if m_title else ""
                                clean_title = re.sub(r'<[^>]+>', '', raw_title)
                                clean_title = re.sub(r'(\||-)\s*TikTok.*$', '', clean_title, flags=re.IGNORECASE).strip()
                                clean_title = re.sub(r'Watch trending videos.*$', '', clean_title, flags=re.IGNORECASE).strip()
                                clean_title = re.sub(r'https?://\S+', '', clean_title).strip()
                                biz_name = clean_title if (clean_title and len(clean_title) > 2 and "tiktok" not in clean_title.lower()) else clean_handle
    
                                profile_url = f"https://www.tiktok.com/@{raw_handle}"
    
                                phone_match = self._PHONE_REGEX.search(full_text)
                                phone = phone_match.group(0).strip() if phone_match else None
    
                                results.append(SourceBusiness(
                                    external_id=f"tiktok-{handle}",
                                    name=biz_name,
                                    category=category,
                                    phone=phone,
                                    address=f"{loc_str}, Sri Lanka",
                                    city=city or loc_str,
                                    district=district or loc_str,
                                    province=province or "Sri Lanka",
                                    website=None,
                                    social_links=(SocialLink("TikTok", profile_url),),
                                ))
                    except (httpx.HTTPError, OSError, ValueError) as exc:
                        logger.warning("TikTok discovery error for query '%s': %s", q, exc)

        return results

    async def check_health(self) -> ProviderHealth:
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                res = await client.head("https://search.yahoo.com", headers={"User-Agent": "Mozilla/5.0"})
                healthy = res.status_code < 400
        except (httpx.HTTPError, OSError):
            healthy = False
        return ProviderHealth(
            provider_name=self.name,
            is_healthy=healthy,
            message="TikTok Business Discovery active" if healthy else "TikTok discovery search endpoint unreachable",
            endpoints=("https://search.yahoo.com", "https://www.tiktok.com"),
            last_checked=datetime.now(UTC).isoformat(),
        )


class CompositeBusinessSource:
    """Combines OpenStreetMap, Sri Lanka Directory, Web & Google Maps Search, and TikTok into a unified deduplicated source."""
    name = "Composite (OpenStreetMap + Directory + Web & Maps + TikTok)"

    def __init__(self) -> None:
        self.osm = OpenStreetMapBusinessSource()
        self.directory = SriLankaDirectoryBusinessSource()
        self.search = WebSearchBusinessSource()
        self.tiktok = TikTokBusinessSource()

    async def search_businesses(
        self, *, province: str | None, district: str | None, city: str | None, category: str
    ) -> list[SourceBusiness]:
        results_group = await asyncio.gather(
            self.osm.search_businesses(province=province, district=district, city=city, category=category),
            self.directory.search_businesses(province=province, district=district, city=city, category=category),
            self.search.search_businesses(province=province, district=district, city=city, category=category),
            self.tiktok.search_businesses(province=province, district=district, city=city, category=category),
            return_exceptions=True,
        )
        combined: list[SourceBusiness] = []
        for r in results_group:
            if isinstance(r, list):
                combined.extend(r)

        # Merge and deduplicate by normalized business name
        by_norm_name: dict[str, SourceBusiness] = {}
        for b in combined:
            norm = re.sub(r"[^a-z0-9]+", "", b.name.lower())
            if not norm:
                continue
            if norm not in by_norm_name:
                by_norm_name[norm] = b
            else:
                existing = by_norm_name[norm]
                merged_phone = existing.phone or b.phone
                merged_email = existing.email or b.email
                merged_website = existing.website or b.website
                seen_social_urls = {s.url for s in existing.social_links}
                merged_socials = list(existing.social_links)
                for s in b.social_links:
                    if s.url not in seen_social_urls:
                        seen_social_urls.add(s.url)
                        merged_socials.append(s)
                by_norm_name[norm] = SourceBusiness(
                    external_id=existing.external_id,
                    name=existing.name,
                    category=existing.category,
                    phone=merged_phone,
                    address=existing.address or b.address,
                    city=existing.city or b.city,
                    district=existing.district or b.district,
                    province=existing.province or b.province,
                    website=merged_website,
                    social_links=tuple(merged_socials),
                    email=merged_email,
                )
        return list(by_norm_name.values())

    async def check_health(self) -> ProviderHealth:
        osm_health = await self.osm.check_health()
        return ProviderHealth(
            provider_name=self.name,
            is_healthy=osm_health.is_healthy,
            message="Composite provider active (OSM + Directory + Web & Maps + TikTok)",
            endpoints=osm_health.endpoints + ("https://rainbowpages.lk", "https://nominatim.openstreetmap.org"),
            last_checked=datetime.now(UTC).isoformat(),
        )


AVAILABLE_COLLECTOR_PROVIDERS = [
    {
        "id": "composite",
        "name": "Multi-Source Deep Sweep",
        "description": "Cross-references Google Maps previews, OpenStreetMap, Sri Lanka Yellow Pages, and TikTok to maximize lead volume and verified contacts.",
        "badge": "Recommended",
    },
    {
        "id": "search",
        "name": "Web & Google Maps Search Discovery",
        "description": "Performs web searches and collects verified local businesses through Google Maps previews and listings.",
        "badge": "Maps & Search",
    },
    {
        "id": "tiktok",
        "name": "TikTok Local Business Discovery",
        "description": "Finds popular Sri Lankan boutique brands, salons, bakers, and restaurants active on TikTok without websites.",
        "badge": "High Conversion",
    },
    {
        "id": "osm",
        "name": "OpenStreetMap Places",
        "description": "Fast Overpass API geospatial nodes and business place tags across Sri Lanka.",
        "badge": "Geo Data",
    },
    {
        "id": "directory",
        "name": "Sri Lanka Directory (RainbowPages)",
        "description": "Scrapes Sri Lanka's official yellow pages directory for verified local landlines & mobile numbers.",
        "badge": "Direct Phones",
    },
    {
        "id": "mock",
        "name": "Simulated Dev Dataset",
        "description": "Instant offline test dataset of fictional Sri Lankan businesses for rapid validation.",
        "badge": "Instant / Test",
    },
]


def get_available_providers() -> list[dict[str, str]]:
    settings = get_settings()
    if settings.is_production:
        return [p for p in AVAILABLE_COLLECTOR_PROVIDERS if p["id"] != "mock"]
    return AVAILABLE_COLLECTOR_PROVIDERS


def get_business_source(provider_name: str | None = None) -> BusinessSource:
    name = (provider_name or get_settings().provider_name).strip().casefold()
    settings = get_settings()
    if name in {"mock", "test"}:
        if settings.is_production:
            raise ProviderError("Mock test provider is disabled in production deployment")
        return MockBusinessSource()
    if name in {"osm", "openstreetmap"}:
        return OpenStreetMapBusinessSource()
    if name in {"composite", "all", "multi", "deep_sweep"}:
        return CompositeBusinessSource()
    if name in {"tiktok", "tik_tok"}:
        return TikTokBusinessSource()
    if name in {"directory", "rainbowpages", "yellowpages"}:
        return SriLankaDirectoryBusinessSource()
    if name in {"search", "ddg", "duckduckgo", "linkedin", "web", "maps", "google_maps", "web_search"}:
        return WebSearchBusinessSource()
    return OpenStreetMapBusinessSource()

