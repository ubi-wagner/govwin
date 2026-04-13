"""
SBIR.gov Solicitations API Ingester

Fetches current SBIR/STTR solicitation topics from the SBIR.gov public API,
normalizes each topic as an individual opportunity, and yields to the base
class run loop for deduplication and insertion.

API docs: https://www.sbir.gov/api
No authentication required. Public data.
"""

import logging
import re
from datetime import datetime, timezone
from typing import Optional

import httpx

import config
from errors import IngesterRateLimitError, IngesterContractError
from ingest.base import BaseIngester

log = logging.getLogger("pipeline.ingest.sbir-gov")

# ── Constants ─────────────────────────────────────────────────────────
SBIR_API_URL = "https://api.www.sbir.gov/public/api/solicitations"
PAGE_SIZE = 50
HTTP_TIMEOUT = 60


# ── Helpers ───────────────────────────────────────────────────────────

def _parse_date(date_str: Optional[str]) -> Optional[datetime]:
    """Parse a date/datetime string into a timezone-aware datetime.

    Tries ISO 8601 first, then falls back to common SBIR.gov date formats.
    Returns None for unparseable values.
    """
    if not date_str:
        return None
    try:
        dt = datetime.fromisoformat(date_str)
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


def _detect_program_type(program: Optional[str], phase: Optional[str]) -> str:
    """Map SBIR.gov program (SBIR/STTR) + phase (I/II) to program_type.

    Returns values like 'sbir_phase_1', 'sttr_phase_2', or 'other'.
    """
    prog = (program or "").upper().strip()
    ph = (phase or "").strip()

    if prog == "STTR":
        if "II" in ph or "2" in ph:
            return "sttr_phase_2"
        return "sttr_phase_1"
    elif prog == "SBIR":
        if "II" in ph or "2" in ph:
            return "sbir_phase_2"
        return "sbir_phase_1"
    return "other"


# ── Stub Data Generator ──────────────────────────────────────────────

def _generate_stub_opportunities() -> list[dict]:
    """Return 3 realistic synthetic SBIR.gov API response dicts for dev/testing.

    Each dict mirrors the field names from the SBIR.gov
    GET /public/api/solicitations response, with topics embedded.
    """
    now = datetime.now(timezone.utc)
    return [
        {
            "solicitation_title": "DoD SBIR 2026.1 Phase I",
            "solicitation_number": "DoD SBIR 2026.1",
            "program": "SBIR",
            "phase": "Phase I",
            "agency": "Department of Defense",
            "branch": "Air Force",
            "solicitation_year": "2026",
            "release_date": now.strftime("%Y-%m-%d"),
            "open_date": now.strftime("%Y-%m-%d"),
            "solicitation_close_date": (
                now + __import__("datetime").timedelta(days=30)
            ).strftime("%Y-%m-%d"),
            "application_close_date": None,
            "description": (
                "The DoD SBIR Phase I program seeks innovative R&D solutions "
                "from small businesses for Air Force technology needs including "
                "advanced propulsion, autonomy, and directed energy."
            ),
            "topic_number": "AF261-001",
            "topics": [
                {
                    "topic_number": "AF261-001",
                    "topic_title": "Advanced Thermal Protection for Hypersonic Flight",
                    "description": "Develop novel ablative materials for Mach 5+ flight.",
                }
            ],
        },
        {
            "solicitation_title": "DoD STTR 2026.A Phase I",
            "solicitation_number": "DoD STTR 2026.A",
            "program": "STTR",
            "phase": "Phase I",
            "agency": "Department of Defense",
            "branch": "Navy",
            "solicitation_year": "2026",
            "release_date": now.strftime("%Y-%m-%d"),
            "open_date": now.strftime("%Y-%m-%d"),
            "solicitation_close_date": (
                now + __import__("datetime").timedelta(days=45)
            ).strftime("%Y-%m-%d"),
            "application_close_date": None,
            "description": (
                "The DoD STTR Phase I program seeks collaborative proposals "
                "from small businesses and research institutions for Navy "
                "undersea warfare technology areas."
            ),
            "topic_number": "N261-T01",
            "topics": [
                {
                    "topic_number": "N261-T01",
                    "topic_title": "Quantum Sensing for Undersea Detection",
                    "description": "Develop quantum magnetometry for submarine detection.",
                }
            ],
        },
        {
            "solicitation_title": "DoD SBIR 2026.1 Phase II",
            "solicitation_number": "DoD SBIR 2026.1-PII",
            "program": "SBIR",
            "phase": "Phase II",
            "agency": "Department of Defense",
            "branch": "Army",
            "solicitation_year": "2026",
            "release_date": now.strftime("%Y-%m-%d"),
            "open_date": now.strftime("%Y-%m-%d"),
            "solicitation_close_date": (
                now + __import__("datetime").timedelta(days=60)
            ).strftime("%Y-%m-%d"),
            "application_close_date": None,
            "description": (
                "The DoD SBIR Phase II program funds prototype development "
                "from successful Phase I awardees. Army research priorities "
                "include autonomous systems and resilient communications."
            ),
            "topic_number": "A261-003",
            "topics": [
                {
                    "topic_number": "A261-003",
                    "topic_title": "Autonomous Navigation for GPS-Denied Environments",
                    "description": "Prototype GPS-denied navigation for ground vehicles.",
                }
            ],
        },
    ]


# ── Ingester ──────────────────────────────────────────────────────────

class SbirGovIngester(BaseIngester):
    """Ingests SBIR/STTR solicitation topics from the SBIR.gov public API.

    Each solicitation may contain multiple topics. We treat each topic
    as its own opportunity row (topic_number -> source_id).
    """

    name = "sbir_gov"
    source = "sbir_gov"

    async def fetch_page(
        self,
        client: httpx.AsyncClient,
        api_key: Optional[str],
        cursor: Optional[str],
    ) -> tuple[list[dict], Optional[str]]:
        """Fetch a single page of solicitations from SBIR.gov.

        Args:
            client: httpx async client.
            api_key: Not used (SBIR.gov is a public API).
            cursor: String offset for pagination (e.g. '0', '50', '100').

        Returns:
            Tuple of (list of raw solicitation dicts, next_cursor or None).

        Raises:
            IngesterRateLimitError: If the API returns 429.
            IngesterContractError: If the API returns 502/503.
        """
        # ── Stub mode ────────────────────────────────────────────────
        if config.USE_STUB_DATA:
            if cursor is not None:
                return ([], None)
            log.info("Returning stub SBIR.gov data (USE_STUB_DATA=true)")
            return (_generate_stub_opportunities(), None)

        # ── Build request ────────────────────────────────────────────
        offset = int(cursor) if cursor else 0

        params = {
            "start": offset,
            "rows": PAGE_SIZE,
        }

        log.info("Fetching SBIR.gov solicitations page offset=%d", offset)

        try:
            resp = await client.get(
                SBIR_API_URL,
                params=params,
                timeout=HTTP_TIMEOUT,
            )
        except httpx.RequestError as exc:
            log.error("SBIR.gov network error: %s", exc)
            raise

        # ── Handle error status codes ────────────────────────────────
        if resp.status_code == 429:
            log.warning("SBIR.gov rate limit hit (HTTP 429)")
            raise IngesterRateLimitError("SBIR.gov rate limit exceeded")

        if resp.status_code in (502, 503):
            log.warning("SBIR.gov upstream error (HTTP %d)", resp.status_code)
            raise IngesterContractError(
                f"SBIR.gov returned HTTP {resp.status_code}"
            )

        resp.raise_for_status()

        # ── Parse response ───────────────────────────────────────────
        data = resp.json()

        # The SBIR.gov API returns a list of solicitation objects directly
        # or a wrapped response depending on the endpoint version.
        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            items = data.get("data", data.get("solicitations", []))
        else:
            items = []

        if not items or len(items) < PAGE_SIZE:
            next_cursor = None
        else:
            next_cursor = str(offset + PAGE_SIZE)

        log.info("SBIR.gov page: got %d solicitations (offset=%d)", len(items), offset)

        return (items, next_cursor)

    def normalize(self, raw: dict) -> dict:
        """Map a raw SBIR.gov solicitation dict to opportunities table columns.

        Each solicitation topic becomes its own opportunity. The topic_number
        field is used as the source_id for per-topic granularity.

        This function is PURE -- no DB access, no side effects.
        """
        # Use topic_number as the unique identifier for each topic/opportunity.
        # Fall back to solicitation_number if topic_number is absent.
        source_id = raw.get("topic_number") or raw.get("solicitation_number")

        program = raw.get("program")
        phase = raw.get("phase")

        return {
            "source": self.source,
            "source_id": source_id,
            "title": raw.get("solicitation_title") or "",
            "agency": raw.get("agency"),
            "office": raw.get("branch"),
            "solicitation_number": raw.get("solicitation_number"),
            "naics_codes": [],
            "classification_code": None,
            "set_aside_type": None,
            "program_type": _detect_program_type(program, phase),
            "close_date": _parse_date(raw.get("solicitation_close_date")),
            "posted_date": _parse_date(raw.get("release_date")),
            "description": raw.get("description") or "",
        }
