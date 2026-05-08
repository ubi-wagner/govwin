"""
DSIP (DoD SBIR/STTR Innovation Portal) Topic Listing Ingester

Fetches active SBIR/STTR/CSO topics from the DSIP topics application at
https://www.dodsbirsttr.mil/topics-app/. The site serves topic data via
a JSON API endpoint that backs its Angular frontend.

Falls back to HTML scraping if the JSON API is unavailable or returns
an unexpected shape.

Each topic is normalized to an opportunities table row with:
  - topic_number (e.g. "AF241-001")
  - solicitation_number (parent BAA number)
  - agency (derived from the BAA component/service)
  - program_type (sbir_phase_1, sbir_phase_2, sttr_phase_1, sttr_phase_2, cso)
  - close_date
  - description (from the topic listing, not the full PDF)

Deduplication uses BaseIngester._hash on (source, source_id, title,
close_date, description[:500]).
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional
from html.parser import HTMLParser

import httpx

import config
from ingest.base import BaseIngester

log = logging.getLogger("pipeline.ingest.dsip")

# ── Constants ─────────────────────────────────────────────────────────

# JSON API endpoint used by the DSIP Angular frontend
DSIP_API_URL = "https://www.dodsbirsttr.mil/topics-app/api/public/topics"
# Fallback HTML page with topic listings
DSIP_HTML_URL = "https://www.dodsbirsttr.mil/topics-app/"
PAGE_SIZE = 100
HTTP_TIMEOUT = 60
DESCRIPTION_MAX_LEN = 10_000

# Service/component abbreviation → full agency name
_AGENCY_MAP: dict[str, str] = {
    "AF": "Department of the Air Force",
    "A": "Department of the Army",
    "N": "Department of the Navy",
    "DHA": "Defense Health Agency",
    "CBD": "Chemical and Biological Defense",
    "DARPA": "Defense Advanced Research Projects Agency",
    "DTRA": "Defense Threat Reduction Agency",
    "MDA": "Missile Defense Agency",
    "SOCOM": "U.S. Special Operations Command",
    "DLA": "Defense Logistics Agency",
    "OSD": "Office of the Secretary of Defense",
    "DISA": "Defense Information Systems Agency",
    "NGA": "National Geospatial-Intelligence Agency",
    "NRO": "National Reconnaissance Office",
    "NSA": "National Security Agency",
    "STRATCOM": "U.S. Strategic Command",
    "TRANSCOM": "U.S. Transportation Command",
    "CYBERCOM": "U.S. Cyber Command",
    "SPACECOM": "U.S. Space Command",
    "INDOPACOM": "U.S. Indo-Pacific Command",
    "CENTCOM": "U.S. Central Command",
    "EUCOM": "U.S. European Command",
    "SOUTHCOM": "U.S. Southern Command",
    "AFRICOM": "U.S. Africa Command",
    "NORTHCOM": "U.S. Northern Command",
}


# ── Stub data for development/testing ─────────────────────────────────

def _generate_stub_topics() -> list[dict[str, Any]]:
    """Return synthetic DSIP topic dicts for dev/testing."""
    now = datetime.now(timezone.utc)
    return [
        {
            "topicNumber": "AF241-001",
            "title": "Advanced Thermal Protection Materials for Hypersonic Vehicles",
            "component": "AF",
            "baaNumber": "DoD SBIR 2024.1",
            "solicType": "SBIR",
            "phase": "Phase I",
            "closeDate": "2026-06-15T17:00:00Z",
            "description": (
                "The Air Force seeks innovative thermal protection materials "
                "capable of withstanding temperatures exceeding 2000C during "
                "sustained hypersonic flight. Research areas include ultra-high "
                "temperature ceramics and carbon-carbon composites."
            ),
            "status": "Open",
        },
        {
            "topicNumber": "N241-015",
            "title": "Compact Underwater Acoustic Sensor Arrays",
            "component": "N",
            "baaNumber": "DoD SBIR 2024.1",
            "solicType": "SBIR",
            "phase": "Phase II",
            "closeDate": "2026-07-01T17:00:00Z",
            "description": (
                "The Navy seeks compact acoustic sensor array designs for "
                "submarine detection and classification using advanced "
                "piezoelectric materials and MEMS-based transducers."
            ),
            "status": "Open",
        },
        {
            "topicNumber": "A241-003",
            "title": "Autonomous Navigation for GPS-Denied Environments",
            "component": "A",
            "baaNumber": "DoD STTR 2024.1",
            "solicType": "STTR",
            "phase": "Phase I",
            "closeDate": "2026-06-30T16:00:00Z",
            "description": (
                "The Army seeks collaborative research on GPS-denied autonomous "
                "navigation using LiDAR, computer vision, and ML approaches "
                "for unmanned ground vehicles in complex terrain."
            ),
            "status": "Open",
        },
        {
            "topicNumber": "CBD241-001",
            "title": "AI-Driven Chemical Agent Detection",
            "component": "CBD",
            "baaNumber": "DoD CSO 2024.1",
            "solicType": "CSO",
            "phase": "",
            "closeDate": "2026-08-01T17:00:00Z",
            "description": (
                "CBD seeks AI/ML approaches for real-time chemical agent "
                "detection and classification from multi-sensor fusion data."
            ),
            "status": "Open",
        },
    ]


# ── Helpers ───────────────────────────────────────────────────────────

def _parse_date(date_str: Optional[str]) -> Optional[datetime]:
    """Parse a date/datetime string into a timezone-aware datetime.

    Handles ISO 8601 and common DSIP date formats.
    Returns None for unparseable values.
    """
    if not date_str:
        return None
    try:
        dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, TypeError):
        pass
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%m/%d/%Y", "%Y-%m-%d", "%b %d, %Y"):
        try:
            dt = datetime.strptime(date_str.strip(), fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except (ValueError, TypeError):
            continue
    return None


def _detect_program_type(solic_type: Optional[str], phase: Optional[str]) -> str:
    """Map DSIP solicitationType + phase to a program_type enum value."""
    st = (solic_type or "").upper().strip()
    ph = (phase or "").upper().strip()

    if st == "CSO":
        return "cso"

    if "STTR" in st:
        if "II" in ph or "2" in ph:
            return "sttr_phase_2"
        return "sttr_phase_1"

    if "SBIR" in st:
        if "III" in ph or "3" in ph:
            return "other"
        if "II" in ph or "2" in ph:
            return "sbir_phase_2"
        return "sbir_phase_1"

    return "other"


def _extract_agency(component: Optional[str]) -> Optional[str]:
    """Map a DSIP component abbreviation to a full agency name."""
    if not component:
        return "Department of Defense"
    key = component.strip().upper()
    return _AGENCY_MAP.get(key, f"Department of Defense ({component})")


def _extract_topic_prefix(topic_number: Optional[str]) -> Optional[str]:
    """Extract the component prefix from a topic number like 'AF241-001'."""
    if not topic_number:
        return None
    match = re.match(r"^([A-Z]+)", topic_number)
    return match.group(1) if match else None


# ── Simple HTML topic parser (fallback) ───────────────────────────────

class _DsipTopicHTMLParser(HTMLParser):
    """Minimal HTML parser that extracts topic data from DSIP's listing page.

    Looks for repeated patterns of topic cards with topic_number, title,
    status, close_date, and solicitation info.
    """

    def __init__(self) -> None:
        super().__init__()
        self.topics: list[dict[str, Any]] = []
        self._current: dict[str, Any] = {}
        self._capture: str | None = None
        self._depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_dict = dict(attrs)
        cls = attr_dict.get("class", "") or ""

        # Look for topic card containers
        if "topic-number" in cls or "topicNumber" in cls:
            self._capture = "topicNumber"
        elif "topic-title" in cls or "topicTitle" in cls:
            self._capture = "title"
        elif "close-date" in cls or "closeDate" in cls:
            self._capture = "closeDate"
        elif "topic-status" in cls or "topicStatus" in cls:
            self._capture = "status"
        elif "baa-number" in cls or "baaNumber" in cls or "solicitation" in cls.lower():
            self._capture = "baaNumber"
        elif "component" in cls.lower():
            self._capture = "component"

    def handle_data(self, data: str) -> None:
        if self._capture and data.strip():
            self._current[self._capture] = data.strip()
            self._capture = None

            # When we have enough fields, emit the topic
            if "topicNumber" in self._current and "title" in self._current:
                if len(self._current) >= 3:
                    self.topics.append(self._current)
                    self._current = {}

    def handle_endtag(self, tag: str) -> None:
        pass


# ── Ingester ──────────────────────────────────────────────────────────

class DsipIngester(BaseIngester):
    """Ingests DoD SBIR/STTR/CSO topics from the DSIP portal.

    Tries the JSON API first (used by the Angular frontend). Falls back
    to HTML scraping if the API is unavailable. In stub mode, returns
    synthetic data.

    Uses content_hash deduplication via the base class run loop.
    """

    name = "dsip"
    source = "dsip"
    max_pages = 20

    def __init__(self) -> None:
        super().__init__()
        self._run_type: str = "incremental"

    async def fetch_page(
        self,
        client: httpx.AsyncClient,
        api_key: str | None,
        cursor: str | None,
    ) -> tuple[list[dict[str, Any]], str | None]:
        """Fetch one page of DSIP topics.

        Tries the JSON API first, falls back to HTML parsing.
        cursor is a string page number (0-indexed).
        """
        # ── Stub mode ────────────────────────────────────────────────
        if config.USE_STUB_DATA:
            if cursor is not None:
                return ([], None)
            log.info("Returning stub DSIP data (USE_STUB_DATA=true)")
            return (_generate_stub_topics(), None)

        page = int(cursor) if cursor else 0

        # ── Try JSON API first ───────────────────────────────────────
        try:
            items, next_cursor = await self._fetch_json_page(client, page)
            if items:
                return (items, next_cursor)
        except Exception as e:
            log.warning("DSIP JSON API failed (page %d), falling back to HTML: %s", page, e)

        # ── Fallback: HTML scraping ──────────────────────────────────
        if page > 0:
            # HTML fallback only works for the first page
            return ([], None)

        try:
            return await self._fetch_html_page(client)
        except Exception as e:
            log.error("DSIP HTML fallback also failed: %s", e)
            return ([], None)

    async def _fetch_json_page(
        self,
        client: httpx.AsyncClient,
        page: int,
    ) -> tuple[list[dict[str, Any]], str | None]:
        """Fetch from the DSIP JSON API endpoint."""
        params: dict[str, Any] = {
            "page": page,
            "size": PAGE_SIZE,
            "status": "Open",
        }

        resp = await client.get(
            DSIP_API_URL,
            params=params,
            timeout=HTTP_TIMEOUT,
            headers={
                "Accept": "application/json",
                "User-Agent": "GovWin-Pipeline/1.0 (opportunity-monitor)",
            },
        )

        if resp.status_code in (502, 503):
            log.warning("DSIP API upstream error (HTTP %d)", resp.status_code)
            raise Exception(f"DSIP returned HTTP {resp.status_code}")

        resp.raise_for_status()
        data = resp.json()

        # The API may return a paginated wrapper or a flat list
        if isinstance(data, dict):
            items = data.get("topics", data.get("content", data.get("data", [])))
            total_pages = data.get("totalPages", 1)
        elif isinstance(data, list):
            items = data
            total_pages = 1
        else:
            items = []
            total_pages = 1

        if not items:
            return ([], None)

        next_cursor = str(page + 1) if page + 1 < total_pages else None

        log.info("DSIP JSON API: got %d topics (page=%d)", len(items), page)
        return (items, next_cursor)

    async def _fetch_html_page(
        self,
        client: httpx.AsyncClient,
    ) -> tuple[list[dict[str, Any]], str | None]:
        """Fallback: scrape the DSIP topics HTML page."""
        resp = await client.get(
            DSIP_HTML_URL,
            timeout=HTTP_TIMEOUT,
            headers={
                "Accept": "text/html",
                "User-Agent": "GovWin-Pipeline/1.0 (opportunity-monitor)",
            },
        )
        resp.raise_for_status()

        parser = _DsipTopicHTMLParser()
        parser.feed(resp.text)

        log.info("DSIP HTML fallback: parsed %d topics", len(parser.topics))
        return (parser.topics, None)

    def normalize(self, raw: dict[str, Any]) -> dict[str, Any]:
        """Map a raw DSIP topic dict to opportunities table columns.

        This function is PURE -- no DB access, no side effects.
        Handles both the JSON API shape and the HTML-scraped shape.
        """
        topic_number = raw.get("topicNumber", raw.get("topic_number", ""))
        title = raw.get("title", "")
        description = raw.get("description", "") or ""

        if len(description) > DESCRIPTION_MAX_LEN:
            description = description[:DESCRIPTION_MAX_LEN]

        # Determine component/agency from the topic number or explicit field
        component = raw.get("component") or _extract_topic_prefix(topic_number)
        agency = _extract_agency(component)

        # Program type from solicitation type + phase
        solic_type = raw.get("solicType", raw.get("solicitationType", ""))
        phase = raw.get("phase", "")
        program_type = _detect_program_type(solic_type, phase)

        # BAA / solicitation number
        baa_number = raw.get("baaNumber", raw.get("solicitationNumber", ""))

        # Close date
        close_date_str = raw.get("closeDate", raw.get("close_date", ""))
        close_date = _parse_date(close_date_str)

        # Posted date (may not be present in all API shapes)
        posted_date_str = raw.get("openDate", raw.get("postedDate", ""))
        posted_date = _parse_date(posted_date_str)

        # Use topic_number as source_id for dedup
        source_id = topic_number or raw.get("id", "")

        return {
            "source": self.source,
            "source_id": source_id,
            "title": f"{topic_number}: {title}" if topic_number else title,
            "agency": agency,
            "office": component,
            "solicitation_number": baa_number,
            "naics_codes": [],
            "classification_code": None,
            "set_aside_type": "Small Business SBIR/STTR Program",
            "program_type": program_type,
            "close_date": close_date,
            "posted_date": posted_date,
            "description": description,
        }
