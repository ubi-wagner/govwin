"""
Grants.gov Ingester — NOFOs (Notices of Funding Opportunities)

Fetches SBIR/STTR-relevant grant opportunities from the Grants.gov REST API
and upserts them into the opportunities table (source='grants_gov').

Covers agencies that post grant-based SBIR/STTR on Grants.gov instead of SAM.gov:
  NIH, DOE, NSF, USDA, NASA, NIST (under DOC), NOAA (under DOC)

API docs: https://grants.gov/api/api-guide
Endpoints: search2 (no auth), fetchOpportunity (no auth)
"""

import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from typing import Optional

import httpx

from events import emit_opportunity_event, pipeline_actor

log = logging.getLogger("pipeline.ingest.grants_gov")

# ── API Endpoints ─────────────────────────────────────────────────────
SEARCH_API = "https://api.grants.gov/v1/api/search2"
DETAIL_API = "https://api.grants.gov/v1/api/fetchOpportunity"

# Page size: Grants.gov default is 25, max appears to be 250
PAGE_SIZE = 250
HTTP_TIMEOUT = 60

# SBIR/STTR target agencies — these post grants, not contracts
SBIR_GRANT_AGENCIES = [
    "HHS",       # NIH → HHS parent
    "DOE",       # Department of Energy
    "NSF",       # National Science Foundation
    "USDA",      # USDA
    "NASA",      # NASA
    "DOC",       # NIST and NOAA are under Commerce
]

# Keywords to identify SBIR/STTR opportunities
SBIR_KEYWORDS = ["SBIR", "STTR", "Small Business Innovation Research",
                 "Small Business Technology Transfer"]


def _content_hash(data: dict) -> str:
    """Generate a short content hash for change detection."""
    content = json.dumps(data, sort_keys=True, default=str)
    return hashlib.sha256(content.encode()).hexdigest()[:16]


def _parse_date(date_str: Optional[str]) -> Optional[datetime]:
    """Parse date strings from Grants.gov API."""
    if not date_str:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S%z",
                "%m-%d-%Y", "%b %d, %Y"):
        try:
            dt = datetime.strptime(date_str.strip(), fmt)
            if dt.tzinfo is not None:
                return dt.astimezone(timezone.utc)
            return dt.replace(tzinfo=timezone.utc)
        except (ValueError, AttributeError):
            continue
    return None


def _detect_program_type(title: str, description: str) -> str:
    """Detect SBIR/STTR program type from title and description text."""
    text = f"{title} {description}".upper()

    # Check for STTR first (more specific)
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

    return "other"


def _extract_aln_codes(aln_str: Optional[str]) -> list[str]:
    """Extract ALN (Assistance Listing Numbers, formerly CFDA) from string."""
    if not aln_str:
        return []
    return [code.strip() for code in re.findall(r"\d{2}\.\d{3}", aln_str)]


# ══════════════════════════════════════════════════════════════════════
# Main Ingester
# ══════════════════════════════════════════════════════════════════════
class GrantsGovIngester:
    """
    Fetches SBIR/STTR grant opportunities from Grants.gov and upserts
    into the opportunities table (source='grants_gov').

    Strategy:
      1. Search for posted opportunities matching SBIR/STTR keywords
         across target agencies (NIH, DOE, NSF, USDA, NASA, NIST, NOAA)
      2. Optionally fetch full details for new/changed opportunities
      3. Upsert into opportunities table with content_hash deduplication
    """

    def __init__(self, conn):
        self.conn = conn

    async def run(self, params: dict | None = None) -> dict:
        """Run Grants.gov ingestion."""
        result = {
            "opportunities_fetched": 0,
            "opportunities_new": 0,
            "opportunities_updated": 0,
            "details_fetched": 0,
            "errors": [],
        }

        params = params or {}
        # Allow overriding keywords and agencies via job params
        keywords = params.get("keywords", SBIR_KEYWORDS)
        agencies = params.get("agencies", SBIR_GRANT_AGENCIES)
        statuses = params.get("statuses", "posted|forecasted")
        fetch_details = params.get("fetch_details", True)

        try:
            all_opps = []
            for keyword in keywords:
                opps = await self._search_opportunities(
                    keyword=keyword,
                    agencies=agencies,
                    statuses=statuses,
                )
                all_opps.extend(opps)

            # Deduplicate by opportunity ID (overlapping keyword hits)
            seen_ids = set()
            unique_opps = []
            for opp in all_opps:
                opp_id = str(opp.get("id", ""))
                if opp_id and opp_id not in seen_ids:
                    seen_ids.add(opp_id)
                    unique_opps.append(opp)

            result["opportunities_fetched"] = len(unique_opps)
            log.info(f"Fetched {len(unique_opps)} unique opportunities from Grants.gov")

            for opp in unique_opps:
                try:
                    detail = None
                    if fetch_details:
                        detail = await self._fetch_detail(opp.get("id"))
                        if detail:
                            result["details_fetched"] += 1

                    status = await self._upsert_opportunity(opp, detail, result)
                    if status == "new":
                        result["opportunities_new"] += 1
                    elif status == "updated":
                        result["opportunities_updated"] += 1
                except Exception as e:
                    err = f"Error processing opportunity {opp.get('number', opp.get('id', '?'))}: {e}"
                    log.error(err, exc_info=True)
                    result["errors"].append(err)

        except Exception as e:
            err = f"Grants.gov ingestion failed: {e}"
            log.error(err, exc_info=True)
            result["errors"].append(err)

        log.info(
            f"Grants.gov ingest complete: "
            f"{result['opportunities_new']} new, "
            f"{result['opportunities_updated']} updated, "
            f"{result['opportunities_fetched']} fetched"
        )
        return result

    async def _search_opportunities(
        self, keyword: str, agencies: list[str], statuses: str
    ) -> list:
        """Search Grants.gov for opportunities matching keyword and agencies."""
        all_results = []
        start = 0

        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            while True:
                body: dict = {
                    "keyword": keyword,
                    "oppStatuses": statuses,
                    "rows": PAGE_SIZE,
                    "startRecordNum": start,
                }
                # Grants.gov agencies param takes pipe-separated values
                if agencies:
                    body["agencies"] = "|".join(agencies)

                try:
                    resp = await client.post(
                        SEARCH_API,
                        json=body,
                        headers={"Content-Type": "application/json"},
                    )
                    resp.raise_for_status()
                    data = resp.json()
                except httpx.HTTPStatusError as e:
                    log.error(f"Grants.gov search API error: {e.response.status_code}")
                    break
                except Exception as e:
                    log.error(f"Grants.gov search request failed: {e}")
                    break

                # Response: { data: { hitCount, oppHits: [...] } }
                inner = data.get("data", data) if isinstance(data, dict) else {}
                hits = inner.get("oppHits", [])
                hit_count = inner.get("hitCount", 0)

                if not hits:
                    break

                all_results.extend(hits)
                start += len(hits)

                log.debug(
                    f"Grants.gov search '{keyword}': page fetched "
                    f"{len(hits)} records, {start}/{hit_count} total"
                )

                if start >= hit_count:
                    break

                # Safety cap: 5,000 per keyword per run
                if start >= 5000:
                    log.warning(f"Hit 5,000 cap for keyword '{keyword}', stopping")
                    break

        log.info(f"Grants.gov search '{keyword}': {len(all_results)} total results")
        return all_results

    async def _fetch_detail(self, opportunity_id) -> Optional[dict]:
        """Fetch full opportunity details from fetchOpportunity endpoint."""
        if not opportunity_id:
            return None

        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
                resp = await client.post(
                    DETAIL_API,
                    json={"oppId": str(opportunity_id)},
                    headers={"Content-Type": "application/json"},
                )
                resp.raise_for_status()
                data = resp.json()
                return data.get("data", data) if isinstance(data, dict) else None
        except httpx.HTTPStatusError as e:
            log.warning(f"Grants.gov detail API error for {opportunity_id}: {e.response.status_code}")
            return None
        except Exception as e:
            log.warning(f"Grants.gov detail fetch failed for {opportunity_id}: {e}")
            return None

    async def _upsert_opportunity(self, opp: dict, detail: Optional[dict], result: dict) -> str:
        """Upsert a single Grants.gov opportunity. Returns 'new', 'updated', or 'unchanged'."""
        # Build stable source_id from opportunity number or ID
        opp_number = opp.get("number") or opp.get("oppNumber") or ""
        opp_id = str(opp.get("id", ""))
        source_id = f"grants_{opp_number}" if opp_number else f"grants_{opp_id}"

        title = opp.get("title") or opp.get("oppTitle") or ""
        agency = opp.get("agency") or opp.get("agencyCode") or ""
        agency_code = opp.get("agencyCode") or opp.get("agency") or ""
        open_date = _parse_date(opp.get("openDate") or opp.get("postDate"))
        close_date = _parse_date(opp.get("closeDate"))
        opp_status = opp.get("oppStatus") or ""

        # Extract description from detail if available
        description = ""
        synopsis = {}
        award_ceiling = None
        award_floor = None
        if detail:
            synopsis = detail.get("synopsis", {}) or {}
            description = (
                synopsis.get("synopsisDesc")
                or detail.get("description")
                or detail.get("summary")
                or ""
            )
            try:
                award_ceiling = float(synopsis.get("awardCeiling") or 0) or None
            except (ValueError, TypeError):
                pass
            try:
                award_floor = float(synopsis.get("awardFloor") or 0) or None
            except (ValueError, TypeError):
                pass
            # Use detail close date if more accurate
            detail_close = _parse_date(
                synopsis.get("closingDate")
                or synopsis.get("responseDate")
            )
            if detail_close:
                close_date = detail_close

        # Detect program type from title + description
        program_type = _detect_program_type(title, description)

        # Extract ALN/CFDA codes
        aln_str = opp.get("aln") or opp.get("cfda") or ""
        if detail:
            cfda_list = detail.get("cfdaList", []) or []
            if cfda_list:
                aln_str = ",".join(
                    str(c.get("cfdaNumber", "")) for c in cfda_list if c.get("cfdaNumber")
                ) or aln_str
        aln_codes = _extract_aln_codes(aln_str)

        # Determine funding instruments
        instruments = opp.get("fundingInstruments") or ""

        # Build raw data for hashing
        raw = {"search": opp}
        if detail:
            raw["detail"] = detail
        new_hash = _content_hash(raw)

        # Check existing
        existing = await self.conn.fetchrow(
            "SELECT id, content_hash FROM opportunities WHERE source = 'grants_gov' AND source_id = $1",
            source_id,
        )

        if existing:
            if existing["content_hash"] == new_hash:
                return "unchanged"
            # Update
            await self.conn.execute(
                """
                UPDATE opportunities SET
                    title = $1, description = $2, agency = $3, agency_code = $4,
                    solicitation_number = $5, close_date = $6, posted_date = $7,
                    program_type = $8, set_aside_type = $9,
                    content_hash = $10, raw_data = $11::jsonb, updated_at = NOW(),
                    status = CASE WHEN $12 = 'posted' THEN 'active'
                                  WHEN $12 = 'forecasted' THEN 'forecasted'
                                  WHEN $12 = 'closed' THEN 'closed'
                                  ELSE 'active' END,
                    source_url = $13,
                    estimated_value_min = $14, estimated_value_max = $15
                WHERE id = $16
                """,
                title, description[:50000] if description else "",
                agency, agency_code,
                opp_number, close_date, open_date,
                program_type, "SBR" if "SBIR" in title.upper() else "STTR" if "STTR" in title.upper() else None,
                new_hash, json.dumps(raw, default=str),
                opp_status.lower(),
                f"https://www.grants.gov/search-results-detail/{opp_id}" if opp_id else None,
                award_floor, award_ceiling,
                existing["id"],
            )
            await emit_opportunity_event(
                self.conn,
                opportunity_id=str(existing["id"]),
                event_type="ingest.updated",
                source="grants_gov",
                actor=pipeline_actor("grants_gov"),
                payload={"program_type": program_type, "agency": agency, "number": opp_number},
            )
            return "updated"
        else:
            # Insert
            row = await self.conn.fetchrow(
                """
                INSERT INTO opportunities (
                    source, source_id, title, description, agency, agency_code,
                    solicitation_number, close_date, posted_date, opportunity_type,
                    program_type, set_aside_type, naics_codes,
                    content_hash, raw_data, status, source_url,
                    estimated_value_min, estimated_value_max
                ) VALUES (
                    'grants_gov', $1, $2, $3, $4, $5,
                    $6, $7, $8, 'grant',
                    $9, $10, $11,
                    $12, $13::jsonb,
                    CASE WHEN $14 = 'posted' THEN 'active'
                         WHEN $14 = 'forecasted' THEN 'forecasted'
                         WHEN $14 = 'closed' THEN 'closed'
                         ELSE 'active' END,
                    $15, $16, $17
                )
                ON CONFLICT (source, source_id) DO NOTHING
                RETURNING id
                """,
                source_id, title, description[:50000] if description else "",
                agency, agency_code,
                opp_number, close_date, open_date,
                program_type,
                "SBR" if "SBIR" in title.upper() else "STTR" if "STTR" in title.upper() else None,
                ["541715"],  # Default R&D NAICS
                new_hash, json.dumps(raw, default=str),
                opp_status.lower(),
                f"https://www.grants.gov/search-results-detail/{opp_id}" if opp_id else None,
                award_floor, award_ceiling,
            )
            if row:
                await emit_opportunity_event(
                    self.conn,
                    opportunity_id=str(row["id"]),
                    event_type="ingest.new",
                    source="grants_gov",
                    actor=pipeline_actor("grants_gov"),
                    payload={
                        "program_type": program_type,
                        "agency": agency,
                        "number": opp_number,
                        "title": title[:200],
                    },
                )
            return "new"
