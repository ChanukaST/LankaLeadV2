import json
import logging
from datetime import UTC, datetime
from uuid import UUID

import httpx

logger = logging.getLogger(__name__)
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

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
from app.sources import ProviderError, get_business_source
from app.websites import check_website, probe_candidate_domains


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
            business_source = get_business_source()
            records = await business_source.search_businesses(
                province=run.province, district=run.district, city=run.city, category=category.name
            )
            source = await db.scalar(select(Source).where(Source.name == business_source.name))
            if not source:
                source = Source(name=business_source.name)
                db.add(source)
                await db.flush()
            records = records[: get_settings().discovery_max_records]
            run.businesses_found = 0
            run.websites_checked = 0
            run.websites_found = 0
            run.websites_not_detected = 0
            await db.commit()

            for record in records:
                await db.refresh(run)
                if run.status == RunStatus.CANCELLED:
                    await db.commit()
                    return
                existing = await db.scalar(
                    select(Business).where(Business.normalized_name == normalize_business_name(record.name))
                )
                if existing:
                    business = existing
                    if not business.phone and record.phone:
                        business.phone = record.phone
                    if not business.email and record.email:
                        business.email = record.email
                else:
                    business = Business(
                        name=record.name,
                        normalized_name=normalize_business_name(record.name),
                        phone=record.phone,
                        email=record.email,
                        address=record.address,
                        city=record.city,
                        district=record.district,
                        province=record.province,
                        category_id=category.id,
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

                    # If website check discovered contact info and business record is missing it, populate it!
                    if check.discovered_emails and not business.email:
                        business.email = check.discovered_emails[0]
                    if check.discovered_phones and not business.phone:
                        business.phone = check.discovered_phones[0]

                    # Save any discovered social profiles from website (e.g. LinkedIn, Facebook, Instagram)
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
                run.businesses_found += 1
                await db.commit()

            run.status = RunStatus.COMPLETED
            run.completed_at = datetime.now(UTC)
            await db.commit()
        except (ValueError, OSError, httpx.HTTPError, SQLAlchemyError, ProviderError) as exc:
            run.status = RunStatus.FAILED
            run.error = str(exc)
            run.completed_at = datetime.now(UTC)
            await db.commit()


class WorkerSettings:
    functions = [run_discovery]
