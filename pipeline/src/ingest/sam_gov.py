"""
SAM.gov Opportunities API Ingester

Fetches opportunities from the SAM.gov Contract Opportunities API v2,
normalizes them to the `opportunities` table schema, and yields them
to the base class run loop for deduplication and insertion.

API docs: https://open.gsa.gov/api/get-opportunities-public-api/
Rate limit: ~1000 requests/day. Tracked via X-RateLimit-Remaining header.
"""

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

import config
from crypto import decrypt_api_key
from errors import IngesterRateLimitError, IngesterContractError
from ingest.base import BaseIngester

log = logging.getLogger("pipeline.ingest.sam-gov")

# ── Constants ─────────────────────────────────────────────────────────
SAM_API_URL = "https://api.sam.gov/opportunities/v2/search"
PAGE_SIZE = 100
MAX_PAGES = 50
HTTP_TIMEOUT = 60
DESCRIPTION_MAX_LEN = 10_000

# Days to look back for each run type
INCREMENTAL_DAYS_BACK = 7
FULL_DAYS_BACK = 365


# ── Helpers ───────────────────────────────────────────────────────────

def _parse_date(date_str: Optional[str]) -> Optional[datetime]:
    """Parse a date/datetime string into a timezone-aware datetime.

    Tries ISO 8601 first, then falls back to common SAM.gov formats.
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


def _extract_top_level_agency(full_parent_path: Optional[str]) -> Optional[str]:
    """Extract the top-level department from SAM.gov fullParentPathName.

    Example: 'DEPT OF DEFENSE.DEPT OF THE AIR FORCE.AFRL/RQ' -> 'DEPT OF DEFENSE'
    """
    if not full_parent_path:
        return None
    parts = full_parent_path.split(".")
    return parts[0].strip() if parts else None


def _detect_program_type(notice_type: Optional[str], title: Optional[str]) -> str:
    """Detect SBIR/STTR/BAA/OTA program type from notice type + title keywords."""
    text = (title or "").upper()

    if "STTR" in text:
        if re.search(r"PHASE\s*(II|2)", text):
            return "sttr_phase_2"
        return "sttr_phase_1"

    if "SBIR" in text:
        if re.search(r"PHASE\s*(III|3)", text):
            return "other"
        if re.search(r"PHASE\s*(II|2)", text):
            return "sbir_phase_2"
        return "sbir_phase_1"

    if "BAA" in text or "BROAD AGENCY ANNOUNCEMENT" in text:
        return "baa"

    if "OTA" in text or "OTHER TRANSACTION" in text:
        return "ota"

    return "other"


def _parse_naics_codes(naics_str: Optional[str]) -> list[str]:
    """Split comma-separated NAICS codes, strip whitespace, return as list."""
    if not naics_str:
        return []
    return [code.strip() for code in naics_str.split(",") if code.strip()]


# ── Stub Data Generator ──────────────────────────────────────────────

def _generate_stub_opportunities() -> list[dict]:
    """Return 5 realistic synthetic SAM.gov API response dicts for dev/testing.

    Each dict mirrors the exact field names from the SAM.gov
    GET /opportunities/v2/search response.
    """
    now = datetime.now(timezone.utc)
    return [
        {
            "noticeId": "stub_sbir_001_af_hypersonics",
            "title": "SBIR Phase I: Advanced Materials for Hypersonic Vehicles (AF241-001)",
            "solicitationNumber": "FA8650-26-S-0001",
            "fullParentPathName": "DEPT OF DEFENSE.DEPT OF THE AIR FORCE.AFRL/RQ WRIGHT-PATTERSON AFB",
            "office": "AFRL/RQ WRIGHT-PATTERSON AFB",
            "postedDate": (now - timedelta(days=3)).strftime("%Y-%m-%d"),
            "type": "Solicitation",
            "typeOfSetAsideDescription": "Small Business SBIR Program",
            "responseDeadLine": (now + timedelta(days=28)).strftime("%Y-%m-%dT17:00:00-05:00"),
            "naicsCode": "541715",
            "classificationCode": "A014",
            "description": (
                "SBIR Phase I topic AF241-001: The Air Force Research Laboratory seeks "
                "innovative solutions for advanced thermal protection materials capable of "
                "withstanding temperatures exceeding 2000C during sustained hypersonic flight. "
                "Research areas include ultra-high temperature ceramics (UHTC), carbon-carbon "
                "composites, and novel ablative materials. Phase I will demonstrate material "
                "feasibility through laboratory testing and computational modeling. "
                "TRL 1-3 expected at Phase I entry. Maximum Phase I award: $250,000."
            ),
        },
        {
            "noticeId": "stub_sbir_002_army_autonomy",
            "title": "SBIR Phase I: Autonomous Navigation for Unmanned Ground Vehicles (A261-003)",
            "solicitationNumber": "W911NF-26-S-0015",
            "fullParentPathName": "DEPT OF DEFENSE.DEPT OF THE ARMY.ACC-APG ADELPHI",
            "office": "ACC-APG ADELPHI",
            "postedDate": (now - timedelta(days=5)).strftime("%Y-%m-%d"),
            "type": "Solicitation",
            "typeOfSetAsideDescription": "Small Business SBIR Program",
            "responseDeadLine": (now + timedelta(days=21)).strftime("%Y-%m-%dT16:00:00-05:00"),
            "naicsCode": "541715",
            "classificationCode": "A014",
            "description": (
                "SBIR Phase I topic A261-003: Army Research Laboratory seeks innovative "
                "approaches for GPS-denied autonomous navigation of unmanned ground vehicles "
                "in complex terrain. Solutions should leverage LiDAR, computer vision, and "
                "machine learning. Phase I feasibility demonstration required. "
                "TRL 2-4 expected. Maximum award: $250,000 over 6 months."
            ),
        },
        {
            "noticeId": "stub_sbir_003_navy_sensors",
            "title": "SBIR Phase II: Compact Underwater Acoustic Sensor Arrays (N261-015)",
            "solicitationNumber": "N68335-26-S-0008",
            "fullParentPathName": "DEPT OF DEFENSE.DEPT OF THE NAVY.NAVSEA WARFARE CENTERS",
            "office": "NAVSEA WARFARE CENTERS",
            "postedDate": (now - timedelta(days=2)).strftime("%Y-%m-%d"),
            "type": "Solicitation",
            "typeOfSetAsideDescription": "Small Business SBIR Program",
            "responseDeadLine": (now + timedelta(days=35)).strftime("%Y-%m-%dT17:00:00-05:00"),
            "naicsCode": "541711",
            "classificationCode": "AC12",
            "description": (
                "SBIR Phase II topic N261-015: Naval Undersea Warfare Center seeks compact "
                "acoustic sensor array designs for submarine detection and classification. "
                "Research should address piezoelectric materials, MEMS-based transducers, and "
                "advanced signal processing algorithms. TRL 4-6 expected. "
                "Maximum Phase II award: $1,500,000 over 24 months."
            ),
        },
        {
            "noticeId": "stub_sttr_004_navy_quantum",
            "title": "STTR Phase I: Quantum Sensing for Undersea Magnetic Anomaly Detection (N261-T01)",
            "solicitationNumber": "N68335-26-T-0003",
            "fullParentPathName": "DEPT OF DEFENSE.DEPT OF THE NAVY.ONR ARLINGTON",
            "office": "ONR ARLINGTON",
            "postedDate": (now - timedelta(days=1)).strftime("%Y-%m-%d"),
            "type": "Solicitation",
            "typeOfSetAsideDescription": "Small Business STTR Program",
            "responseDeadLine": (now + timedelta(days=30)).strftime("%Y-%m-%dT17:00:00-05:00"),
            "naicsCode": "541715",
            "classificationCode": "AC12",
            "description": (
                "STTR Phase I topic N261-T01: Office of Naval Research seeks collaborative "
                "proposals from small businesses partnered with research institutions for "
                "quantum magnetometry sensors for undersea magnetic anomaly detection. "
                "Must demonstrate NV center diamond magnetometer or equivalent approach. "
                "Research institution must perform at least 30% of work. "
                "Maximum STTR Phase I award: $250,000."
            ),
        },
        {
            "noticeId": "stub_baa_005_darpa_ai",
            "title": "BAA: Artificial Intelligence for Command and Control Decision Support",
            "solicitationNumber": "HR001126-BAA-0042",
            "fullParentPathName": "DEPT OF DEFENSE.DEFENSE ADVANCED RESEARCH PROJECTS AGENCY",
            "office": "DARPA/I2O",
            "postedDate": (now - timedelta(days=6)).strftime("%Y-%m-%d"),
            "type": "Presolicitation",
            "typeOfSetAsideDescription": None,
            "responseDeadLine": (now + timedelta(days=45)).strftime("%Y-%m-%dT23:59:59-05:00"),
            "naicsCode": "541715, 518210",
            "classificationCode": "A014",
            "description": (
                "Broad Agency Announcement: DARPA seeks innovative AI/ML approaches for "
                "military command and control decision support systems. Research areas include "
                "multi-domain sensor fusion, adversarial-robust machine learning, human-machine "
                "teaming, and real-time planning under uncertainty. Open to all offeror types."
            ),
        },
    ]


# ── Ingester ──────────────────────────────────────────────────────────

class SamGovIngester(BaseIngester):
    """Ingests federal contract opportunities from the SAM.gov API.

    Supports incremental (last 7 days) and full (last 365 days) run types.
    Uses content_hash deduplication via the base class run loop.
    """

    name = "sam_gov"
    source = "sam_gov"

    def __init__(self) -> None:
        super().__init__()
        self._api_key: Optional[str] = None
        self._run_type: str = "incremental"

    async def resolve_api_key(self, conn) -> str:
        """Resolve SAM.gov API key: DB encrypted value first, env var fallback."""
        if self._api_key:
            return self._api_key

        # Try DB-stored encrypted key first
        try:
            row = await conn.fetchrow(
                "SELECT encrypted_value FROM api_key_registry "
                "WHERE source = 'sam_gov'"
            )
            if row and row["encrypted_value"]:
                self._api_key = decrypt_api_key(row["encrypted_value"])
                log.info("Using SAM.gov API key from database (encrypted)")
                return self._api_key
        except Exception as e:
            log.warning("Could not load encrypted SAM.gov key from DB: %s", e)

        # Fall back to environment variable
        if config.SAM_GOV_API_KEY:
            self._api_key = config.SAM_GOV_API_KEY
            log.info("Using SAM.gov API key from environment variable")
            return self._api_key

        log.error("No SAM.gov API key available (neither DB nor env)")
        return ""

    async def fetch_page(
        self,
        client: httpx.AsyncClient,
        api_key: Optional[str],
        cursor: Optional[str],
    ) -> tuple[list[dict], Optional[str]]:
        """Fetch a single page of opportunities from SAM.gov.

        Args:
            client: httpx async client for making requests.
            api_key: SAM.gov API key (required for real API calls).
            cursor: Opaque cursor — for SAM.gov this is the string offset
                    (e.g. '0', '100', '200').

        Returns:
            Tuple of (list of raw opportunity dicts, next_cursor or None).

        Raises:
            IngesterRateLimitError: If the API returns 429 or rate limit is low.
            IngesterContractError: If the API returns 502/503.
        """
        # ── Stub mode ────────────────────────────────────────────────
        if config.USE_STUB_DATA:
            if cursor is not None:
                # Stub only has one page
                return ([], None)
            log.info("Returning stub SAM.gov data (USE_STUB_DATA=true)")
            return (_generate_stub_opportunities(), None)

        # ── Build request params ─────────────────────────────────────
        offset = int(cursor) if cursor else 0
        now = datetime.now(timezone.utc)

        if self._run_type == "full":
            posted_from = (now - timedelta(days=FULL_DAYS_BACK)).strftime("%m/%d/%Y")
        else:
            posted_from = (now - timedelta(days=INCREMENTAL_DAYS_BACK)).strftime("%m/%d/%Y")

        posted_to = now.strftime("%m/%d/%Y")

        params = {
            "api_key": api_key or "",
            "postedFrom": posted_from,
            "postedTo": posted_to,
            "limit": PAGE_SIZE,
            "offset": offset,
        }

        log.info(
            "Fetching SAM.gov page offset=%d, postedFrom=%s, postedTo=%s",
            offset, posted_from, posted_to,
        )

        # ── Make request ─────────────────────────────────────────────
        try:
            resp = await client.get(
                SAM_API_URL,
                params=params,
                timeout=HTTP_TIMEOUT,
            )
        except httpx.RequestError as exc:
            log.error("SAM.gov network error: %s", exc)
            raise

        # ── Handle error status codes ────────────────────────────────
        if resp.status_code == 429:
            log.warning("SAM.gov rate limit hit (HTTP 429)")
            raise IngesterRateLimitError("SAM.gov rate limit exceeded")

        if resp.status_code in (502, 503):
            log.warning("SAM.gov upstream error (HTTP %d)", resp.status_code)
            raise IngesterContractError(
                f"SAM.gov returned HTTP {resp.status_code}"
            )

        resp.raise_for_status()

        # ── Check rate-limit headers ─────────────────────────────────
        remaining = resp.headers.get("X-RateLimit-Remaining")
        if remaining is not None:
            try:
                if int(remaining) < 10:
                    log.warning(
                        "SAM.gov rate limit nearly exhausted: %s remaining",
                        remaining,
                    )
                    raise IngesterRateLimitError(
                        f"SAM.gov rate limit nearly exhausted ({remaining} remaining)"
                    )
            except ValueError:
                pass

        # ── Parse response ───────────────────────────────────────────
        data = resp.json()
        items = data.get("opportunitiesData", [])

        if not items:
            return ([], None)

        # Determine next cursor
        total = data.get("totalRecords", 0)
        next_offset = offset + PAGE_SIZE

        if next_offset >= total or next_offset >= MAX_PAGES * PAGE_SIZE:
            next_cursor = None
        else:
            next_cursor = str(next_offset)

        log.info(
            "SAM.gov page: got %d items (offset=%d, total=%d)",
            len(items), offset, total,
        )

        return (items, next_cursor)

    def normalize(self, raw: dict) -> dict:
        """Map a raw SAM.gov API response dict to opportunities table columns.

        This function is PURE — no DB access, no side effects.
        """
        title = raw.get("title") or ""
        description = raw.get("description") or ""

        # Truncate description to 10K chars
        if len(description) > DESCRIPTION_MAX_LEN:
            description = description[:DESCRIPTION_MAX_LEN]

        return {
            "source": self.source,
            "source_id": raw.get("noticeId"),
            "title": title,
            "agency": _extract_top_level_agency(raw.get("fullParentPathName")),
            "office": raw.get("office"),
            "solicitation_number": raw.get("solicitationNumber"),
            "naics_codes": _parse_naics_codes(raw.get("naicsCode")),
            "classification_code": raw.get("classificationCode"),
            "set_aside_type": raw.get("typeOfSetAsideDescription"),
            "program_type": _detect_program_type(raw.get("type"), title),
            "close_date": _parse_date(raw.get("responseDeadLine")),
            "posted_date": _parse_date(raw.get("postedDate")),
            "description": description,
        }
