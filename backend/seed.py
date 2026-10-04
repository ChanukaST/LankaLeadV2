import asyncio

from sqlalchemy import select

from app.database import SessionLocal, engine
from app.models import Base, Category, Location

CATEGORIES = ["Restaurants", "Cafes", "Hotels", "Salons", "Photography", "Travel Agencies", "Gyms", "Auto Garages"]
LOCATIONS = [
    # Western Province
    ("Western", "Colombo", "Colombo"),
    ("Western", "Gampaha", "Negombo"),
    ("Western", "Kalutara", "Kalutara"),
    # Central Province
    ("Central", "Kandy", "Kandy"),
    ("Central", "Matale", "Matale"),
    ("Central", "Nuwara Eliya", "Nuwara Eliya"),
    # Southern Province
    ("Southern", "Galle", "Galle"),
    ("Southern", "Matara", "Matara"),
    ("Southern", "Hambantota", "Hambantota"),
    # North Western Province
    ("North Western", "Kurunegala", "Kurunegala"),
    ("North Western", "Puttalam", "Chilaw"),
    # Northern Province
    ("Northern", "Jaffna", "Jaffna"),
    ("Northern", "Vavuniya", "Vavuniya"),
    ("Northern", "Kilinochchi", "Kilinochchi"),
    # North Central Province
    ("North Central", "Anuradhapura", "Anuradhapura"),
    ("North Central", "Polonnaruwa", "Polonnaruwa"),
    # Eastern Province
    ("Eastern", "Batticaloa", "Batticaloa"),
    ("Eastern", "Trincomalee", "Trincomalee"),
    ("Eastern", "Ampara", "Ampara"),
    # Uva Province
    ("Uva", "Badulla", "Badulla"),
    ("Uva", "Monaragala", "Monaragala"),
    # Sabaragamuwa Province
    ("Sabaragamuwa", "Ratnapura", "Ratnapura"),
    ("Sabaragamuwa", "Kegalle", "Kegalle"),
]


async def seed() -> None:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with SessionLocal() as db:
        for name in CATEGORIES:
            if not await db.scalar(select(Category).where(Category.name == name)):
                db.add(Category(name=name, slug=name.lower().replace(" ", "-")))
        for province, district, city in LOCATIONS:
            if not await db.scalar(select(Location).where(Location.city == city, Location.district == district)):
                db.add(Location(province=province, district=district, city=city))
        await db.commit()


if __name__ == "__main__":
    asyncio.run(seed())
