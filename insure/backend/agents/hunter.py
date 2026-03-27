"""
Hunter Agent — polls for PENDING RegionOfInterest entries,
determines county via reverse geocoding, crawls for properties,
and saves results to Entity + LeadLedger.
"""

import asyncio
import os
import re
import time

from sqlalchemy.orm import Session

from database.models import (
    ActionType,
    Entity,
    LeadLedger,
    RegionOfInterest,
    RegionStatus,
)
from database.session import SessionLocal
from agents.geo_helper import (
    get_bounding_box_center,
    is_within_bounds,
    reverse_geocode_county,
)


PROXY_URL = os.getenv("PROXY_URL", "")
POLL_INTERVAL = int(os.getenv("HUNTER_POLL_INTERVAL", "30"))


async def crawl_region(region: RegionOfInterest, county: str) -> list[dict]:
    """
    Use Crawl4AI to scrape a public directory for properties in the given
    county that fall within the region's bounding box.

    Returns a list of dicts: {name, address, latitude, longitude}
    """
    try:
        from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig

        browser_cfg = BrowserConfig(headless=True)
        if PROXY_URL:
            browser_cfg = BrowserConfig(headless=True, proxy=PROXY_URL)

        # Target a generic public property search filtered by county
        search_url = (
            f"https://www.google.com/search?q={county}+county+florida+"
            "condominiums+associations+directory"
        )

        run_cfg = CrawlerRunConfig()

        async with AsyncWebCrawler(config=browser_cfg) as crawler:
            result = await crawler.arun(url=search_url, config=run_cfg)

            if not result.success:
                print(f"[hunter] Crawl failed for region {region.name}: {result.error_message}")
                return []

            # Extract potential property mentions from the markdown content
            text = result.markdown or ""
            properties = _parse_properties_from_text(text, region.bounding_box)
            return properties

    except ImportError:
        print("[hunter] Crawl4AI not installed — skipping live crawl")
        return []
    except Exception as e:
        print(f"[hunter] Crawl error for region {region.name}: {e}")
        return []


def _parse_properties_from_text(text: str, bbox: dict) -> list[dict]:
    """
    Parse crawled text for property/condo association mentions.
    In production, this would use structured extraction.
    For now, returns any address-like matches found.
    """
    properties = []

    # Simple pattern: look for lines mentioning "condo" or "association"
    lines = text.split("\n")
    for line in lines:
        lower = line.lower()
        if any(kw in lower for kw in ["condo", "association", "tower", "plaza", "building"]):
            # Try to extract a name (first capitalized phrase)
            name_match = re.search(r"([A-Z][A-Za-z\s&']+(?:Condo|Association|Tower|Plaza|Building)[A-Za-z\s]*)", line)
            if name_match:
                properties.append({
                    "name": name_match.group(1).strip(),
                    "address": line.strip()[:200],
                    "latitude": None,
                    "longitude": None,
                })

    return properties


def process_region(region: RegionOfInterest, db: Session) -> int:
    """Process a single PENDING region. Returns count of entities created."""
    bbox = region.bounding_box
    center_lat, center_lng = get_bounding_box_center(bbox)

    # Determine county via reverse geocoding
    county = reverse_geocode_county(center_lat, center_lng)
    if not county:
        county = "Unknown"
        print(f"[hunter] Could not determine county for region '{region.name}', using 'Unknown'")

    # Update region with detected county
    region.target_county = county

    # Crawl for properties
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        raw_properties = loop.run_until_complete(crawl_region(region, county))
        loop.close()
    except Exception as e:
        print(f"[hunter] Async crawl error: {e}")
        raw_properties = []

    # Filter to bounding box and save
    created = 0
    for prop in raw_properties:
        lat = prop.get("latitude")
        lng = prop.get("longitude")

        # If coords available, enforce bounding box
        if lat is not None and lng is not None:
            if not is_within_bounds(lat, lng, bbox):
                continue

        entity = Entity(
            name=prop["name"],
            address=prop.get("address"),
            county=county,
            latitude=lat,
            longitude=lng,
            characteristics={"source": "hunter", "region_id": region.id},
        )
        db.add(entity)
        db.flush()

        # Write HUNT_FOUND ledger event
        ledger = LeadLedger(
            entity_id=entity.id,
            action_type=ActionType.HUNT_FOUND,
        )
        db.add(ledger)
        created += 1

    # Mark region as completed
    region.status = RegionStatus.COMPLETED
    db.commit()

    print(f"[hunter] Region '{region.name}' ({county} County): {created} entities found")
    return created


def run_hunter_poll():
    """Main polling loop — checks for PENDING regions and processes them."""
    print("[hunter] Starting hunter poll loop...")
    while True:
        try:
            db = SessionLocal()
            pending = (
                db.query(RegionOfInterest)
                .filter(RegionOfInterest.status == RegionStatus.PENDING)
                .all()
            )

            if pending:
                print(f"[hunter] Found {len(pending)} pending region(s)")
                for region in pending:
                    try:
                        process_region(region, db)
                    except Exception as e:
                        db.rollback()
                        print(f"[hunter] Error processing region {region.id}: {e}")

            db.close()
        except Exception as e:
            print(f"[hunter] Poll loop error: {e}")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run_hunter_poll()
