import json
import logging
import re
from datetime import UTC, datetime
from uuid import UUID

import httpx
from sqlalchemy import select

from app.businesses import normalize_business_name
from app.core.config import get_settings
from app.database import SessionLocal
from app.models import (
    Business,
    BusinessSource,
    Category,
    DiscoveryResult,
    DiscoveryRun,
    RunStatus,
    SocialProfile,
    Source,
    Website,
    WebsiteCheck,
    WebsiteStatus,
)
from app.sources import (
    collect_google_maps_preview,
    get_business_source,
    is_sri_lankan_coordinate,
    validate_and_normalize_sl_phone,
)
from app.websites import check_website, probe_candidate_domains

logger = logging.getLogger(__name__)


async def run_discovery(ctx: dict[str, object], run_id: str) -> None:
    async with SessionLocal() as db:
        run = await db.get(DiscoveryRun, UUID(run_id))
        if not run:
            return
        if run.status == RunStatus.CANCELLED:
            return
        run.status = RunStatus.RUNNING
        run.started_at = datetime.now(UTC)
        await db.commit()
        try:
            category = await db.get(Category, run.category_id)
            if not category:
                raise ValueError("Category no longer exists")

            provider_key = getattr(run, "source_provider", None) or "composite"
            business_source = get_business_source(provider_key)

            if category.slug == "all" or category.name.strip().lower() in {"all", "all categories", "multi-category"}:
                categories_to_search = list(
                    (await db.scalars(select(Category).where(Category.slug != "all").order_by(Category.name))).all()
                )
            else:
                categories_to_search = [category]

            source = await db.scalar(select(Source).where(Source.name == business_source.name))
            if not source:
                source = Source(name=business_source.name)
                db.add(source)
                await db.flush()

            max_limit = getattr(run, "max_records", None) or get_settings().discovery_max_records
            run.businesses_found = 0
            run.websites_checked = 0
            run.websites_found = 0
            run.websites_not_detected = 0
            await db.commit()

            # Query targets already discovered across database to exclude them from future searches
            existing_norm_names: set[str] = set((await db.scalars(select(Business.normalized_name))).all())
            existing_ext_ids: set[str] = set(
                (await db.scalars(
                    select(BusinessSource.external_id).join(Business, Business.id == BusinessSource.business_id)
                )).all()
            )
            existing_phones_raw = (await db.scalars(select(Business.phone).where(Business.phone.isnot(None)))).all()
            existing_phones: set[str] = {
                re.sub(r"\D", "", p) for p in existing_phones_raw if p and len(re.sub(r"\D", "", p)) >= 7
            }

            discovered_count = 0
            for cat in categories_to_search:
                await db.refresh(run)
                if run.status == RunStatus.CANCELLED or discovered_count >= max_limit:
                    break

                cat_records = await business_source.search_businesses(
                    province=run.province, district=run.district, city=run.city, category=cat.name
                )

                for record in cat_records:
                    if discovered_count >= max_limit:
                        break
                    await db.refresh(run)
                    if run.status == RunStatus.CANCELLED:
                        await db.commit()
                        return

                    norm_name = normalize_business_name(record.name)
                    # Strictly validate genuine Sri Lankan phone number
                    validated_phone = validate_and_normalize_sl_phone(record.phone)
                    clean_phone = re.sub(r"\D", "", validated_phone) if validated_phone else ""

                    # Exclude targets that were already discovered in previous runs or exist in database
                    if (
                        norm_name in existing_norm_names
                        or (record.external_id and record.external_id in existing_ext_ids)
                        or (clean_phone and len(clean_phone) >= 7 and clean_phone in existing_phones)
                    ):
                        logger.debug("Skipping previously discovered target: %s (%s)", record.name, record.external_id)
                        continue

                    # Register newly identified target in sets so duplicates within this run are excluded
                    existing_norm_names.add(norm_name)
                    if record.external_id:
                        existing_ext_ids.add(record.external_id)
                    if clean_phone and len(clean_phone) >= 7:
                        existing_phones.add(clean_phone)

                    target_city = record.city if (record.city and record.city.strip().lower() != "sri lanka") else ""
                    target_district = record.district if (record.district and record.district.strip().lower() != "sri lanka") else ""
                    target_province = record.province if (record.province and record.province.strip().lower() != "sri lanka") else ""

                    business = Business(
                        name=record.name,
                        normalized_name=norm_name,
                        phone=validated_phone,
                        email=record.email,
                        address=record.address,
                        city=target_city,
                        district=target_district,
                        province=target_province,
                        category_id=cat.id,
                    )
                    db.add(business)
                    await db.flush()
                    db.add(BusinessSource(
                        business_id=business.id, source_id=source.id, external_id=record.external_id,
                        confidence=0.95 if "OpenStreetMap" in business_source.name else 0.7,
                    ))

                    for social_link in record.social_links:
                        existing_soc = await db.scalar(
                            select(SocialProfile).where(
                                SocialProfile.business_id == business.id,
                                SocialProfile.platform == social_link.platform,
                                SocialProfile.profile_url == social_link.url,
                            )
                        )
                        if not existing_soc:
                            db.add(SocialProfile(
                                business_id=business.id, platform=social_link.platform, profile_url=social_link.url
                            ))

                    website_candidate = record.website
                    if website_candidate and website_candidate.strip().lower() in {"none", "null", "n/a", ""}:
                        website_candidate = None

                    # Check if provider already supplied Google Maps profile
                    maps_profile = next((s for s in record.social_links if s.platform.lower() == "google maps"), None)
                    maps_url = maps_profile.url if maps_profile else None
                    maps_evidence: str | None = None

                    # Collect information of target through Google Maps preview strictly in Sri Lanka
                    try:
                        maps_preview = await collect_google_maps_preview(
                            name=record.name,
                            city=target_city or record.city,
                            district=target_district or record.district,
                            province=target_province or record.province,
                            is_mock=record.external_id.startswith("mock"),
                        )
                        if maps_preview:
                            if not business.phone and maps_preview.phone:
                                 v_prev_p = validate_and_normalize_sl_phone(maps_preview.phone)
                                 if v_prev_p:
                                     business.phone = v_prev_p
                            if (
                                maps_preview.address
                                and "Sri Lanka" in maps_preview.address
                                and (not business.address or business.address in {"", "Sri Lanka"} or business.address.endswith(", Sri Lanka"))
                            ):
                                business.address = maps_preview.address
                            if (
                                maps_preview.latitude
                                and maps_preview.longitude
                                and not business.latitude
                                and is_sri_lankan_coordinate(maps_preview.latitude, maps_preview.longitude)
                            ):
                                business.latitude = maps_preview.latitude
                                business.longitude = maps_preview.longitude
                            if not website_candidate and maps_preview.website:
                                website_candidate = maps_preview.website
                            if not maps_url and maps_preview.maps_url:
                                maps_url = maps_preview.maps_url
                            if maps_preview.evidence:
                                maps_evidence = maps_preview.evidence
                    except Exception as maps_exc:  # noqa: BLE001
                        logger.debug("Google Maps preview enrichment error for %s: %s", record.name, maps_exc)

                    if maps_url:
                        existing_maps_sp = await db.scalar(
                            select(SocialProfile).where(
                                SocialProfile.business_id == business.id,
                                SocialProfile.platform == "Google Maps",
                            )
                        )
                        if not existing_maps_sp:
                            db.add(SocialProfile(
                                business_id=business.id,
                                platform="Google Maps",
                                profile_url=maps_url,
                            ))

                    check = None
                    probed = False

                    if not website_candidate:
                        try:
                            candidates = await probe_candidate_domains(record.name)
                            if candidates:
                                cand_url = candidates[0]
                                check_cand = await check_website(
                                    cand_url, business_name=record.name, business_phone=record.phone
                                )
                                if check_cand.status == WebsiteStatus.FOUND and (
                                    check_cand.name_matched is True or check_cand.phone_matched is True
                                ):
                                    website_candidate = cand_url
                                    check = check_cand
                                    probed = True
                        except (httpx.HTTPError, OSError, ValueError) as probe_exc:
                            logger.debug("Domain probe skipped for %s: %s", record.name, probe_exc)

                    website_status = WebsiteStatus.FOUND if website_candidate else (
                        WebsiteStatus.SOCIAL_ONLY if record.social_links else WebsiteStatus.NOT_DETECTED
                    )
                    if website_candidate:
                        run.websites_checked += 1
                        existing_website = await db.scalar(
                            select(Website).where(Website.business_id == business.id, Website.url == website_candidate)
                        )
                        if not existing_website:
                            existing_website = Website(
                                business_id=business.id, url=website_candidate, status=WebsiteStatus.UNCLEAR
                            )
                            db.add(existing_website)
                            await db.flush()
                        if check is None:
                            check = await check_website(
                                website_candidate, business_name=record.name, business_phone=record.phone
                            )
                        existing_website.status = check.status
                        existing_website.last_checked_at = datetime.now(UTC)
                        db.add(WebsiteCheck(
                            website_id=existing_website.id,
                            final_url=check.final_url,
                            http_status=check.http_status,
                            response_time_ms=check.response_time_ms,
                            https=check.https,
                            title=check.title,
                            meta_description=check.meta_description,
                            redirect_chain=json.dumps(list(check.redirect_chain)),
                            has_robots_txt=check.has_robots_txt,
                            has_sitemap=check.has_sitemap,
                            is_parked=check.is_parked,
                            name_matched=check.name_matched,
                            phone_matched=check.phone_matched,
                            emails_found=json.dumps(list(check.discovered_emails)) if check.discovered_emails else None,
                            phones_found=json.dumps(list(check.discovered_phones)) if check.discovered_phones else None,
                            confidence_score=check.confidence_score,
                            error=check.error,
                        ))
                        website_status = check.status

                        if check.discovered_emails and not business.email:
                            business.email = check.discovered_emails[0]
                        if check.discovered_phones and not business.phone:
                            for disc_p in check.discovered_phones:
                                norm_p = validate_and_normalize_sl_phone(disc_p)
                                if norm_p:
                                    business.phone = norm_p
                                    break

                        for disc_platform, disc_url in check.discovered_social_links:
                            existing_sp = await db.scalar(
                                select(SocialProfile).where(
                                    SocialProfile.business_id == business.id,
                                    SocialProfile.platform == disc_platform,
                                    SocialProfile.profile_url == disc_url,
                                )
                            )
                            if not existing_sp:
                                db.add(SocialProfile(
                                    business_id=business.id,
                                    platform=disc_platform,
                                    profile_url=disc_url,
                                ))

                    if website_status == WebsiteStatus.FOUND:
                        run.websites_found += 1
                    elif website_status in {WebsiteStatus.NOT_DETECTED, WebsiteStatus.SOCIAL_ONLY}:
                        run.websites_not_detected += 1

                    evidence_parts: list[str] = [f"{business_source.name} public source evidence."]
                    if maps_evidence:
                        evidence_parts.append(maps_evidence)
                    if record.website:
                        evidence_parts.append(
                            f"Website candidate {record.website} analyzed (status: {website_status.value}, "
                            f"confidence: {int((check.confidence_score if check else 0.5) * 100)}%)."
                        )
                    elif probed and website_candidate:
                        evidence_parts.append(
                            f"Proactive domain probing discovered and verified {website_candidate} "
                            f"(status: {website_status.value}, confidence: {int((check.confidence_score if check else 0.5) * 100)}%)."
                        )
                    elif record.social_links:
                        platforms = ", ".join(s.platform for s in record.social_links)
                        evidence_parts.append(f"No website candidate supplied by source; social presence detected on {platforms}.")
                    else:
                        evidence_parts.append("No website candidate supplied by source or found via domain probing.")

                    db.add(DiscoveryResult(
                        run_id=run.id, business_id=business.id, website_status=website_status,
                        evidence=" ".join(evidence_parts),
                    ))
                    discovered_count += 1
                    run.businesses_found = discovered_count
                    await db.commit()

            run.status = RunStatus.COMPLETED
            run.completed_at = datetime.now(UTC)
            await db.commit()
        except Exception as exc:
            logger.exception("Discovery run %s failed", run_id)
            run.status = RunStatus.FAILED
            run.error = str(exc)
            run.completed_at = datetime.now(UTC)
            await db.commit()


class WorkerSettings:
    functions = [run_discovery]
