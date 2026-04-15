"""Grants.gov NOFO ingester.

Fetches federal funding opportunities from the Grants.gov public API,
filters to SBIR/STTR/BAA relevance by keyword matching, normalizes to
the opportunities table shape.

Grants.gov uses CFDA/ALN numbers instead of NAICS codes — we store
them in classification_code, not naics_codes.

API docs: https://www.grants.gov/web/grants/s2s/grantor/schemas/grants-search2-service.html
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Optional

import httpx

import config
from errors import IngesterContractError, IngesterRateLimitError
from ingest.base import BaseIngester

log = logging.getLogger("pipeline.ingest.grants-gov")

GRANTS_API_URL = "https://api.grants.gov/v1/api/search2"
PAGE_SIZE = 250

# Keywords that mark an opportunity as SBIR/STTR/BAA-relevant.
_RELEVANT_KEYWORDS = (
    "sbir", "sttr", "broad agency announcement", "baa",
    "small business innovation", "small business technology",
    "other transaction", "ota",
)


def _parse_date(date_str: Optional[str]) -> Optional[datetime]:
    """Parse a date string from Grants.gov. Handles multiple formats."""
    if not date_str:
        return None
    try:
        return datetime.fromisoformat(date_str.replace("Z", "+00:00"))
    except ValueError:
        pass
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%Y%m%d"):
        try:
            return datetime.strptime(date_str, fmt)
        except ValueError:
            continue
    log.debug("Failed to parse date: %r", date_str)
    return None


def _is_relevant(raw: dict[str, Any]) -> bool:
    """Return True if the opportunity looks like SBIR/STTR/BAA-adjacent."""
    haystack = (
        (raw.get("title") or "") + " " +
        (raw.get("description") or "") + " " +
        (raw.get("opportunityCategory") or "")
    ).lower()
    return any(kw in haystack for kw in _RELEVANT_KEYWORDS)


def _generate_stub_opportunities() -> list[dict[str, Any]]:
    """Synthetic Grants.gov responses for offline development."""
    return [
        {
            "id": "stub_grants_356789",
            "number": "NSF-26-001",
            "title": "NSF SBIR Phase I: Quantum Sensing for National Infrastructure",
            "agencyName": "National Science Foundation",
            "agencyCode": "NSF",
            "cfdaNumbers": "47.084",
            "openDate": "2026-04-01",
            "closeDate": "2026-07-15",
            "description": "Phase I small business innovation research grants "
                           "for quantum sensing technologies applied to critical "
                           "infrastructure monitoring.",
            "opportunityCategory": "Discretionary",
        },
        {
            "id": "stub_grants_356790",
            "number": "NIH-26-RFA-AI-015",
            "title": "NIH STTR Phase I: Pathogen Detection Platforms",
            "agencyName": "National Institutes of Health",
            "agencyCode": "NIH",
            "cfdaNumbers": "93.855,93.856",
            "openDate": "2026-04-15",
            "closeDate": "2026-08-01",
            "description": "Small business technology transfer program for "
                           "next-generation rapid pathogen detection platforms "
                           "with university research partners.",
            "opportunityCategory": "Discretionary",
        },
        {
            "id": "stub_grants_356791",
            "number": "DOE-26-BAA-001",
            "title": "DOE Broad Agency Announcement: Grid Resilience Research",
            "agencyName": "Department of Energy",
            "agencyCode": "DOE",
            "cfdaNumbers": "81.087",
            "openDate": "2026-03-01",
            "closeDate": "2026-12-31",
            "description": "Broad Agency Announcement soliciting research "
                           "proposals for electric grid resilience under "
                           "extreme weather and cyber threat scenarios.",
            "opportunityCategory": "Discretionary",
        },
    ]


class GrantsGovIngester(BaseIngester):
    """Ingests federal funding opportunities from Grants.gov.

    Filters the Grants.gov firehose (tens of thousands of
    opportunities) to just SBIR/STTR/BAA/OTA-relevant records via
    keyword matching in the title/description.
    """

    name = "grants_gov"
    source = "grants_gov"

    async def fetch_page(
        self,
        client: httpx.AsyncClient,
        api_key: Optional[str],
        cursor: Optional[str],
    ) -> tuple[list[dict[str, Any]], Optional[str]]:
        """Fetch one page of opportunities from Grants.gov."""
        if config.USE_STUB_DATA:
            if cursor is not None:
                return ([], None)
            log.info("Returning stub Grants.gov data (USE_STUB_DATA=true)")
            return (_generate_stub_opportunities(), None)

        offset = int(cursor) if cursor else 0

        body = {
            "rows": PAGE_SIZE,
            "startRecordNum": offset,
            "oppStatuses": "forecasted|posted",
            "sortBy": "openDate|desc",
        }

        log.info("Fetching Grants.gov offset=%d", offset)

        try:
            resp = await client.post(
                GRANTS_API_URL,
                json=body,
                headers={"Content-Type": "application/json"},
            )
        except httpx.RequestError as e:
            log.error("Grants.gov network error: %s", e)
            raise IngesterContractError(
                "Grants.gov request failed",
                details={"source": "grants_gov", "error": str(e)[:200]},
            )

        if resp.status_code == 429:
            retry_after = int(resp.headers.get("Retry-After", "300"))
            log.warning("Grants.gov rate limited, retry_after=%d", retry_after)
            raise IngesterRateLimitError(
                "Grants.gov rate limit hit",
                details={"source": "grants_gov", "retry_after_seconds": retry_after},
            )

        if resp.status_code in (502, 503, 504):
            raise IngesterContractError(
                f"Grants.gov returned {resp.status_code}",
                details={"source": "grants_gov", "status": resp.status_code},
            )

        if resp.status_code != 200:
            log.error(
                "Grants.gov unexpected status %d: %s",
                resp.status_code, resp.text[:200],
            )
            raise IngesterContractError(
                f"Grants.gov returned {resp.status_code}",
                details={"source": "grants_gov", "status": resp.status_code},
            )

        try:
            data = resp.json()
        except json.JSONDecodeError as e:
            raise IngesterContractError(
                "Grants.gov returned invalid JSON",
                details={"source": "grants_gov", "error": str(e)[:200]},
            )

        hits_wrapper = data.get("data") or {}
        hits = hits_wrapper.get("oppHits") or []
        total = hits_wrapper.get("hitCount") or 0

        relevant = [h for h in hits if _is_relevant(h)]
        log.info(
            "Grants.gov page: %d hits, %d relevant (SBIR/STTR/BAA filter)",
            len(hits), len(relevant),
        )

        next_offset = offset + PAGE_SIZE
        next_cursor = str(next_offset) if next_offset < total else None

        return (relevant, next_cursor)

    def normalize(self, raw: dict[str, Any]) -> dict[str, Any]:
        """Map a Grants.gov response item to an opportunities row.

        Note: Grants.gov uses CFDA/ALN numbers, not NAICS codes, so
        we store them in classification_code rather than naics_codes.
        """
        title = (raw.get("title") or "").strip()
        description = (raw.get("description") or "").strip()

        # Detect program type from title + description keywords
        program_type = None
        combined = (title + " " + description).lower()
        if "sbir" in combined and "phase ii" in combined:
            program_type = "sbir_phase_2"
        elif "sbir" in combined:
            program_type = "sbir_phase_1"
        elif "sttr" in combined and "phase ii" in combined:
            program_type = "sttr_phase_2"
        elif "sttr" in combined:
            program_type = "sttr_phase_1"
        elif "broad agency announcement" in combined or " baa " in combined or combined.endswith(" baa"):
            program_type = "baa"
        elif "other transaction" in combined or " ota " in combined or combined.endswith(" ota"):
            program_type = "ota"

        return {
            "source_id": str(raw.get("id") or "").strip() or None,
            "title": title[:500],
            "agency": (raw.get("agencyName") or "").strip() or None,
            "office": (raw.get("agencyCode") or "").strip() or None,
            "solicitation_number": (raw.get("number") or "").strip() or None,
            "naics_codes": [],
            "classification_code": (raw.get("cfdaNumbers") or "").strip() or None,
            "set_aside_type": None,
            "program_type": program_type,
            "close_date": _parse_date(raw.get("closeDate")),
            "posted_date": _parse_date(raw.get("openDate")),
            "estimated_value_min": None,
            "estimated_value_max": None,
            "description": description[:10000],
        }
