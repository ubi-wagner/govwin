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
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import asyncpg
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


def _extract_tech_focus_areas(raw: dict) -> list[str]:
    """Extract technology focus area keywords from SBIR.gov topic data.

    Pulls from explicit keyword fields when present, otherwise extracts
    technology-related terms from the topic title and description.
    """
    areas: list[str] = []

    # Explicit keyword fields that SBIR.gov sometimes includes
    for key in ("keywords", "technology_areas", "tech_areas", "focus_areas"):
        val = raw.get(key)
        if isinstance(val, list):
            areas.extend(str(v).strip() for v in val if v)
        elif isinstance(val, str) and val.strip():
            areas.extend(k.strip() for k in val.split(",") if k.strip())

    # If no explicit keywords, derive from title/description
    if not areas:
        text = f"{raw.get('solicitation_title', '')} {raw.get('description', '')}"
        # Common DoD SBIR technology domains
        tech_patterns = [
            "hypersonic", "autonomy", "autonomous", "directed energy",
            "propulsion", "quantum", "cybersecurity", "cyber",
            "machine learning", "artificial intelligence", "AI/ML",
            "radar", "lidar", "sensor", "electronic warfare",
            "unmanned", "UAV", "UAS", "robotics", "biotechnology",
            "nanotechnology", "space", "satellite", "communications",
            "signal processing", "materials science", "composite",
            "additive manufacturing", "3D printing", "microelectronics",
        ]
        text_upper = text.upper()
        for pat in tech_patterns:
            if pat.upper() in text_upper:
                areas.append(pat.lower())

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for a in areas:
        lower = a.lower()
        if lower not in seen:
            seen.add(lower)
            unique.append(a)
    return unique


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

    Parent BAA solicitations are tracked so that all topics from the same
    BAA share a single curated_solicitations row (the parent). The cache
    maps solicitation_number -> curated_solicitations.id.
    """

    name = "sbir_gov"
    source = "sbir_gov"

    def __init__(self) -> None:
        super().__init__()
        # Cache: solicitation_number -> curated_solicitations.id
        self._baa_cache: dict[str, str] = {}

    async def _ensure_parent_solicitation(
        self,
        conn: asyncpg.Connection,
        row: dict[str, Any],
    ) -> Optional[str]:
        """Ensure a parent curated_solicitations row exists for the BAA.

        Returns the curated_solicitations.id for this BAA, creating it
        if it doesn't exist yet. Caches the result for the duration of
        the ingest run so we only create one row per BAA.
        """
        from shredder.namespace import compute_namespace_key

        sol_number = row.get("solicitation_number")
        if not sol_number:
            return None

        # Return cached value if we already created/found this BAA
        if sol_number in self._baa_cache:
            return self._baa_cache[sol_number]

        namespace = compute_namespace_key(
            row.get("agency"),
            row.get("office"),
            row.get("program_type"),
        ) or "pending"

        try:
            # Look up existing curated_solicitations by solicitation_number
            existing = await conn.fetchrow(
                """
                SELECT id FROM curated_solicitations
                WHERE solicitation_number = $1
                LIMIT 1
                """,
                sol_number,
            )
            if existing:
                sol_id = str(existing["id"])
                self._baa_cache[sol_number] = sol_id
                return sol_id

            # Create an umbrella opportunity for the BAA container FIRST, then the
            # parent curated_solicitations row that points at it. curated_solicitations
            # .opportunity_id is NOT NULL, so a BAA parent needs a backing opportunity;
            # inserting the parent without one threw NotNullViolation, was swallowed by
            # the except below, and every BAA silently degraded to per-topic 'single'
            # rows (the multi-topic grouping never took). The umbrella is inactive (it is
            # a container, not a fundable unit) and its topic opportunities attach via
            # solicitation_id — the canonical multi-topic shape (see e2e_fixtures.sql c4).
            # source_id is suffixed so it can never collide with a topic's own source_id
            # (SBIR normalize uses topic_number as source_id).
            umbrella_source_id = f"{sol_number}::umbrella"
            umbrella_title = row.get("title") or sol_number
            umbrella_desc = (row.get("description") or "")[:50000] or None
            umbrella_id = await conn.fetchval(
                """
                INSERT INTO opportunities
                  (source, source_id, title, agency, office,
                   solicitation_number, program_type, description,
                   content_hash, is_active)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)
                ON CONFLICT (source, source_id) DO UPDATE SET updated_at = now()
                RETURNING id
                """,
                self.source,
                umbrella_source_id,
                umbrella_title,
                row.get("agency"),
                row.get("office"),
                sol_number,
                row.get("program_type"),
                umbrella_desc,
                # content_hash has its OWN unique constraint — derive it from the
                # umbrella's real fields (source_id carries sol_number) so two BAAs
                # never collide on the empty-fields hash.
                self._hash({
                    "source": self.source,
                    "source_id": umbrella_source_id,
                    "title": umbrella_title,
                    "close_date": row.get("close_date"),
                    "description": row.get("description") or "",
                }),
            )

            # Create the parent multi_topic solicitation, backed by the umbrella opp.
            new_row = await conn.fetchrow(
                """
                INSERT INTO curated_solicitations
                  (opportunity_id, namespace, status, solicitation_type,
                   solicitation_title, solicitation_number, full_text)
                VALUES ($1, $2, 'new', 'multi_topic', $3, $4, $5)
                RETURNING id
                """,
                umbrella_id,
                namespace,
                row.get("title") or sol_number,
                sol_number,
                (row.get("description") or "")[:50000] or None,
            )
            if new_row:
                sol_id = str(new_row["id"])
                self._baa_cache[sol_number] = sol_id
                self.log.info(
                    "created parent curated_solicitation %s (umbrella opp %s) for BAA %s",
                    sol_id, umbrella_id, sol_number,
                )
                return sol_id
        except Exception as e:
            self.log.warning(
                "failed to ensure parent solicitation for %s: %s",
                sol_number, e,
            )

        return None

    async def _create_triage_row(
        self,
        conn: asyncpg.Connection,
        opp_id: Any,
        row: dict[str, Any],
    ) -> None:
        """Override: link topic opportunity to parent BAA's curated_solicitations.

        Instead of creating a new curated_solicitations row per topic,
        we ensure one parent row per BAA and set the opportunity's
        solicitation_id FK to point to it.
        """
        sol_id = await self._ensure_parent_solicitation(conn, row)
        if sol_id:
            try:
                await conn.execute(
                    """
                    UPDATE opportunities
                    SET solicitation_id = $1
                    WHERE id = $2 AND solicitation_id IS NULL
                    """,
                    uuid.UUID(sol_id),
                    opp_id,
                )
            except Exception as e:
                self.log.warning(
                    "failed to link opp %s to solicitation %s: %s",
                    opp_id, sol_id, e,
                )
        else:
            # Fallback: create a per-opportunity triage row (base behavior)
            await super()._create_triage_row(conn, opp_id, row)

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

        Populates topic-level columns (013): topic_number, topic_branch,
        topic_status, tech_focus_areas, poc_name, poc_email, topic_metadata.

        This function is PURE -- no DB access, no side effects.
        """
        # Use topic_number as the unique identifier for each topic/opportunity.
        # Fall back to solicitation_number if topic_number is absent.
        topic_num = raw.get("topic_number")
        source_id = topic_num or raw.get("solicitation_number")

        program = raw.get("program")
        phase = raw.get("phase")
        branch = raw.get("branch")

        # Extract tech focus areas from available data
        tech_focus = _extract_tech_focus_areas(raw)

        # Build topic_metadata with any extra fields not mapped to columns
        topic_meta: dict[str, Any] = {}
        if raw.get("solicitation_year"):
            topic_meta["solicitation_year"] = raw["solicitation_year"]
        if program:
            topic_meta["program"] = program
        if phase:
            topic_meta["phase"] = phase
        if raw.get("application_close_date"):
            topic_meta["application_close_date"] = raw["application_close_date"]
        # Include embedded topics list for reference
        topics_list = raw.get("topics")
        if topics_list and isinstance(topics_list, list):
            topic_meta["embedded_topics"] = topics_list

        # POC info — SBIR.gov sometimes provides contact info
        poc_name = raw.get("poc_name") or raw.get("contact_name")
        poc_email = raw.get("poc_email") or raw.get("contact_email")

        return {
            "source": self.source,
            "source_id": source_id,
            "title": raw.get("solicitation_title") or "",
            "agency": raw.get("agency"),
            "office": branch,
            "solicitation_number": raw.get("solicitation_number"),
            "naics_codes": [],
            "classification_code": None,
            "set_aside_type": None,
            "program_type": _detect_program_type(program, phase),
            "close_date": _parse_date(raw.get("solicitation_close_date")),
            "posted_date": _parse_date(raw.get("release_date")),
            "description": raw.get("description") or "",
            # Topic-level columns (013)
            "topic_number": topic_num,
            "topic_branch": branch,
            "topic_status": "open",
            "tech_focus_areas": tech_focus,
            "poc_name": poc_name,
            "poc_email": poc_email,
            "topic_metadata": topic_meta if topic_meta else {},
        }
