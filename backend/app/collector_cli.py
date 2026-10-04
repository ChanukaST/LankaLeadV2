"""Collector Scraper CLI runner for LankaLead.

Run standalone scraper discovery runs directly from the terminal with real-time feedback.

Usage:
    python -m app.collector_cli --help
    python -m app.collector_cli --list-providers
    python -m app.collector_cli --province "Western" --category "Restaurants" --provider "composite" --limit 10
    python -m app.collector_cli --city "Colombo" --category "all" --provider "osm" --limit 20
"""

import argparse
import asyncio
import logging
import sys
from datetime import UTC, datetime

from sqlalchemy import select, text

from app.database import SessionLocal, engine
from app.models import Base, Category, DiscoveryRun, User
from app.sources import get_available_providers
from app.worker import run_discovery

logger = logging.getLogger(__name__)


async def setup_environment() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for col_sql in (
            "ALTER TABLE businesses ADD COLUMN email VARCHAR(320)",
            "ALTER TABLE businesses ADD COLUMN outreach_status VARCHAR(50) DEFAULT 'NEW'",
            "ALTER TABLE businesses ADD COLUMN outreach_notes TEXT",
            "ALTER TABLE businesses ADD COLUMN last_contacted_at TIMESTAMP",
            "ALTER TABLE website_checks ADD COLUMN emails_found TEXT",
            "ALTER TABLE website_checks ADD COLUMN phones_found TEXT",
            "ALTER TABLE discovery_runs ADD COLUMN source_provider VARCHAR(50) DEFAULT 'composite'",
            "ALTER TABLE discovery_runs ADD COLUMN max_records INTEGER DEFAULT 50",
        ):
            try:
                await conn.execute(text(col_sql))
            except Exception as exc:  # noqa: BLE001
                logger.debug("Migration notice: %s", exc)
    async with SessionLocal() as db:
        all_cat = await db.scalar(select(Category).where(Category.slug == "all"))
        if not all_cat:
            db.add(Category(name="All Categories", slug="all"))
            await db.commit()


async def get_or_create_cli_user() -> User:
    async with SessionLocal() as db:
        user = await db.scalar(select(User).where(User.email == "cli-runner@lankalead.local"))
        if not user:
            user = User(
                email="cli-runner@lankalead.local",
                password_hash="cli-managed-account",
                is_active=True,
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)
        return user


async def execute_cli_run(
    province: str | None,
    district: str | None,
    city: str | None,
    category_slug: str,
    provider: str,
    limit: int,
) -> None:
    await setup_environment()
    user = await get_or_create_cli_user()

    async with SessionLocal() as db:
        if category_slug.lower() in {"all", "all-categories", "any"}:
            category = await db.scalar(select(Category).where(Category.slug == "all"))
        else:
            category = await db.scalar(
                select(Category).where(
                    (Category.slug == category_slug.lower()) | (Category.name.ilike(category_slug))
                )
            )

        if not category:
            cats = list((await db.scalars(select(Category))).all())
            print(f"Error: Category '{category_slug}' not found.")
            print(f"Available categories: {', '.join(c.slug for c in cats)}")
            sys.exit(1)

        run = DiscoveryRun(
            user_id=user.id,
            province=province,
            district=district,
            city=city,
            category_id=category.id,
            source_provider=provider,
            max_records=limit,
        )
        db.add(run)
        await db.commit()
        await db.refresh(run)
        run_id = str(run.id)

    loc_str = city or district or (f"{province} Province" if province else "All Sri Lanka")
    print("\n=======================================================")
    print(f"  LankaLead Scraper Run: [{run_id[:8]}]")
    print(f"  Provider  : {provider}")
    print(f"  Target Area: {loc_str}")
    print(f"  Category  : {category.name}")
    print(f"  Max Leads : {limit}")
    print("=======================================================\n")
    print("[*] Dispatching worker run...")

    start_time = datetime.now(UTC)
    await run_discovery({}, run_id)
    elapsed = (datetime.now(UTC) - start_time).total_seconds()

    async with SessionLocal() as db:
        completed_run = await db.get(DiscoveryRun, run.id)
        if not completed_run:
            print("Error: Run record missing after execution.")
            sys.exit(1)

        print(f"\n[+] Scraper Run Status: {completed_run.status.value.upper()} in {elapsed:.1f}s")
        print(f"    - Businesses Discovered   : {completed_run.businesses_found}")
        print(f"    - Websites Checked        : {completed_run.websites_checked}")
        print(f"    - Websites Verified Found : {completed_run.websites_found}")
        print(f"    - Targets with NO Website : {completed_run.websites_not_detected} (Prime Calling Opportunities!)")
        if completed_run.error:
            print(f"    - Scraper Notice/Error    : {completed_run.error}")

    print("\n[+] Finished scraper execution. Leads are stored in the database.\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="lankalead-collector",
        description="LankaLead Business Scraper & Collector Runner",
    )
    parser.add_argument(
        "--list-providers", action="store_true", help="List all available business data providers"
    )
    parser.add_argument("--province", type=str, default=None, help="Province filter (e.g. Western, Central)")
    parser.add_argument("--district", type=str, default=None, help="District filter (e.g. Colombo, Kandy)")
    parser.add_argument("--city", type=str, default=None, help="City filter (e.g. Negombo, Galle)")
    parser.add_argument(
        "--category", type=str, default="all", help="Category name or slug (e.g. restaurants, hotels, all)"
    )
    parser.add_argument(
        "--provider",
        type=str,
        default="composite",
        choices=["composite", "osm", "directory", "search", "mock"],
        help="Provider to execute (default: composite)",
    )
    parser.add_argument(
        "--limit", type=int, default=25, help="Maximum number of leads to scrape (default: 25)"
    )

    args = parser.parse_args()

    if args.list_providers:
        print("\nAvailable LankaLead Data Providers:")
        print("-----------------------------------")
        for p in get_available_providers():
            print(f"- {p['id']:<12} | {p['badge']:<15} | {p['name']}: {p['description']}")
        print()
        return

    asyncio.run(
        execute_cli_run(
            province=args.province,
            district=args.district,
            city=args.city,
            category_slug=args.category,
            provider=args.provider,
            limit=args.limit,
        )
    )


if __name__ == "__main__":
    main()
