"""
SBIR.gov Ingesters — Solicitations, Awards, and Companies

Three independent ingesters that pull from SBIR.gov's public API:
  - SbirGovSolicitationIngester: Current topics → opportunities table
  - SbirGovAwardIngester: Award history → sbir_awards table
  - SbirGovCompanyIngester: Firm profiles → sbir_companies table

API docs: https://www.sbir.gov/api
No authentication required. Public data.
"""

import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from typing import Optional

import httpx

from events import emit_opportunity_event, pipeline_actor

log = logging.getLogger("pipeline.ingest.sbir_gov")

# ── API Endpoints ─────────────────────────────────────────────────────
SOLICITATIONS_API = "https://api.www.sbir.gov/public/api/solicitations"
AWARDS_API = "https://api.www.sbir.gov/public/api/awards"
COMPANIES_API = "https://www.sbir.gov/api/company"

# Solicitation API maxes at 50 per request
SOLICITATION_PAGE_SIZE = 50
# Awards and Companies max at 5000 per request
AWARDS_PAGE_SIZE = 5000
COMPANIES_PAGE_SIZE = 5000

HTTP_TIMEOUT = 60


def _content_hash(data: dict) -> str:
    """Generate a short content hash for change detection."""
    content = json.dumps(data, sort_keys=True, default=str)
    return hashlib.sha256(content.encode()).hexdigest()[:16]


def _parse_date(date_str: Optional[str]) -> Optional[datetime]:
    """Parse various date formats from SBIR.gov API responses."""
    if not date_str:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%m/%d/%Y", "%Y-%m-%d", "%b %d, %Y"):
        try:
            dt = datetime.strptime(date_str.strip(), fmt)
            if dt.tzinfo is not None:
                return dt.astimezone(timezone.utc)
            return dt.replace(tzinfo=timezone.utc)
        except (ValueError, AttributeError):
            continue
    return None


def _parse_date_only(date_str: Optional[str]):
    """Parse date string to date object (no time component)."""
    dt = _parse_date(date_str)
    return dt.date() if dt else None


def _detect_program_type(program: Optional[str], phase: Optional[str]) -> str:
    """Map SBIR.gov program + phase to our program_type enum."""
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


def _extract_topic_number(title: str, topics: list) -> Optional[str]:
    """Extract topic number from title or topic data."""
    # Try from topic data first
    for topic in topics:
        tn = topic.get("topic_number")
        if tn:
            return tn
    # Regex from title: patterns like AF241-001, N241-001, etc.
    match = re.search(r"[A-Z]{1,4}\d{2,3}-\d{2,4}", title or "")
    return match.group(0) if match else None


# ══════════════════════════════════════════════════════════════════════
# Solicitation Ingester — topics → opportunities table
# ══════════════════════════════════════════════════════════════════════
class SbirGovSolicitationIngester:
    """
    Fetches current and recent solicitations from SBIR.gov and upserts
    them into the opportunities table (source='sbir_gov').

    Each solicitation may contain multiple topics — we create one
    opportunity per topic for granular matching.
    """

    def __init__(self, conn):
        self.conn = conn

    async def run(self, params: dict | None = None) -> dict:
        """Run solicitation ingestion."""
        result = {
            "opportunities_fetched": 0,
            "opportunities_new": 0,
            "opportunities_updated": 0,
            "amendments_detected": 0,
            "errors": [],
        }

        params = params or {}
        keyword = params.get("keyword", "")
        # Default: fetch open solicitations only
        status = params.get("status", "open")

        try:
            solicitations = await self._fetch_all_solicitations(keyword, status)
            result["opportunities_fetched"] = len(solicitations)
            log.info(f"Fetched {len(solicitations)} solicitations from SBIR.gov")

            for sol in solicitations:
                try:
                    count = await self._process_solicitation(sol, result)
                    log.debug(f"Processed solicitation {sol.get('solicitation_number', '?')}: {count} topics")
                except Exception as e:
                    err = f"Error processing solicitation {sol.get('solicitation_number', '?')}: {e}"
                    log.error(err, exc_info=True)
                    result["errors"].append(err)

        except Exception as e:
            err = f"SBIR.gov solicitation fetch failed: {e}"
            log.error(err, exc_info=True)
            result["errors"].append(err)

        log.info(
            f"SBIR.gov solicitation ingest complete: "
            f"{result['opportunities_new']} new, "
            f"{result['opportunities_updated']} updated, "
            f"{result['opportunities_fetched']} fetched"
        )
        return result

    async def _fetch_all_solicitations(self, keyword: str, status: str) -> list:
        """Paginate through all solicitation results."""
        all_results = []
        offset = 0

        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            while True:
                params = {
                    "rows": SOLICITATION_PAGE_SIZE,
                    "start": offset,
                }
                if keyword:
                    params["keyword"] = keyword
                if status:
                    params["status"] = status

                try:
                    resp = await client.get(SOLICITATIONS_API, params=params)
                    resp.raise_for_status()
                    data = resp.json()
                except httpx.HTTPStatusError as e:
                    log.error(f"SBIR.gov solicitations API error: {e.response.status_code}")
                    break
                except Exception as e:
                    log.error(f"SBIR.gov solicitations request failed: {e}")
                    break

                # API returns a list directly or wrapped in a response object
                records = data if isinstance(data, list) else data.get("data", data.get("results", []))
                if not records:
                    break

                all_results.extend(records)
                offset += len(records)

                # If we got fewer than page size, we're done
                if len(records) < SOLICITATION_PAGE_SIZE:
                    break

                # Safety cap: 2000 solicitations max per run
                if offset >= 2000:
                    log.warning("Hit 2000 solicitation cap, stopping pagination")
                    break

        return all_results

    async def _process_solicitation(self, sol: dict, result: dict) -> int:
        """Process a single solicitation, creating opportunities per topic."""
        topics = sol.get("solicitation_topics", []) or []
        sol_number = sol.get("solicitation_number", "")
        agency = sol.get("agency", "")
        branch = sol.get("branch", "")
        program = sol.get("program", "")
        phase = sol.get("phase", "")
        close_date = _parse_date(
            sol.get("close_date") or sol.get("application_due_date")
        )
        open_date = _parse_date(sol.get("open_date"))
        release_date = _parse_date(sol.get("release_date"))

        program_type = _detect_program_type(program, phase)

        if not topics:
            # Solicitation without topic breakdown — create one opportunity
            await self._upsert_topic_as_opportunity(
                sol=sol,
                topic={"topic_title": sol.get("solicitation_title", ""), "topic_description": ""},
                sol_number=sol_number,
                agency=agency,
                branch=branch,
                program_type=program_type,
                close_date=close_date,
                open_date=open_date or release_date,
                result=result,
            )
            return 1

        count = 0
        for topic in topics:
            await self._upsert_topic_as_opportunity(
                sol=sol,
                topic=topic,
                sol_number=sol_number,
                agency=agency,
                branch=branch,
                program_type=program_type,
                close_date=close_date,
                open_date=open_date or release_date,
                result=result,
            )
            count += 1

        return count

    async def _upsert_topic_as_opportunity(
        self, *, sol, topic, sol_number, agency, branch,
        program_type, close_date, open_date, result,
    ):
        """Upsert a single topic as an opportunity row."""
        topic_number = topic.get("topic_number") or _extract_topic_number(
            topic.get("topic_title", ""), [topic]
        )
        # Build a stable source_id from solicitation + topic
        source_id = f"sbir_{sol_number}_{topic_number}" if topic_number else f"sbir_{sol_number}"

        title = topic.get("topic_title") or sol.get("solicitation_title", "")
        description = topic.get("topic_description", "") or ""

        # Build description from subtopics if available
        subtopics = topic.get("subtopics", [])
        if subtopics:
            sub_text = "\n\n".join(
                f"**{st.get('subtopic_number', '')}**: {st.get('subtopic_title', '')}\n{st.get('subtopic_description', '')}"
                for st in subtopics
            )
            if sub_text:
                description = f"{description}\n\n---\n\nSubtopics:\n{sub_text}"

        raw = {"solicitation": sol, "topic": topic}
        new_hash = _content_hash(raw)

        # Check if already exists
        existing = await self.conn.fetchrow(
            "SELECT id, content_hash FROM opportunities WHERE source = 'sbir_gov' AND source_id = $1",
            source_id,
        )

        if existing:
            if existing["content_hash"] == new_hash:
                return  # Unchanged
            # Update
            await self.conn.execute(
                """
                UPDATE opportunities SET
                    title = $1, description = $2, agency = $3,
                    solicitation_number = $4, close_date = $5, posted_date = $6,
                    program_type = $7, topic_number = $8, solicitation_agency = $9,
                    content_hash = $10, raw_data = $11::jsonb, updated_at = NOW(),
                    status = 'active', source_url = $12
                WHERE id = $13
                """,
                title, description, agency,
                sol_number, close_date, open_date,
                program_type, topic_number, branch or agency,
                new_hash, json.dumps(raw, default=str),
                topic.get("sbir_topic_link"),
                existing["id"],
            )
            result["opportunities_updated"] += 1
            await emit_opportunity_event(
                self.conn,
                opportunity_id=str(existing["id"]),
                event_type="ingest.updated",
                source="sbir_gov",
                actor=pipeline_actor("sbir_gov_solicitations"),
                payload={"topic_number": topic_number, "program_type": program_type, "agency": agency},
            )
        else:
            # Insert new
            row = await self.conn.fetchrow(
                """
                INSERT INTO opportunities (
                    source, source_id, title, description, agency, agency_code,
                    solicitation_number, close_date, posted_date, opportunity_type,
                    program_type, topic_number, solicitation_agency,
                    set_aside_type, naics_codes, content_hash, raw_data,
                    status, source_url
                ) VALUES (
                    'sbir_gov', $1, $2, $3, $4, $5,
                    $6, $7, $8, 'solicitation',
                    $9, $10, $11,
                    $12, $13, $14, $15::jsonb,
                    'active', $16
                )
                RETURNING id
                """,
                source_id, title, description, agency, None,
                sol_number, close_date, open_date,
                program_type, topic_number, branch or agency,
                "SBR",
                ["541715"],  # Default NAICS for R&D
                new_hash, json.dumps(raw, default=str),
                topic.get("sbir_topic_link"),
            )
            result["opportunities_new"] += 1
            if row:
                await emit_opportunity_event(
                    self.conn,
                    opportunity_id=str(row["id"]),
                    event_type="ingest.new",
                    source="sbir_gov",
                    actor=pipeline_actor("sbir_gov_solicitations"),
                    payload={
                        "topic_number": topic_number,
                        "program_type": program_type,
                        "agency": agency,
                        "title": title[:200],
                    },
                )


# ══════════════════════════════════════════════════════════════════════
# Award Ingester — award history → sbir_awards table
# ══════════════════════════════════════════════════════════════════════
class SbirGovAwardIngester:
    """
    Fetches SBIR/STTR award history from SBIR.gov and upserts into sbir_awards.

    Used for competitive intelligence, company research, and understanding
    agency award patterns and budgets.
    """

    def __init__(self, conn):
        self.conn = conn

    async def run(self, params: dict | None = None) -> dict:
        """Run award ingestion."""
        result = {
            "awards_fetched": 0,
            "awards_new": 0,
            "awards_updated": 0,
            "errors": [],
        }

        params = params or {}
        # Default: recent awards (current year)
        year = params.get("year", str(datetime.now(timezone.utc).year))
        agency = params.get("agency")

        try:
            awards = await self._fetch_all_awards(year=year, agency=agency)
            result["awards_fetched"] = len(awards)
            log.info(f"Fetched {len(awards)} awards from SBIR.gov (year={year})")

            for award in awards:
                try:
                    status = await self._upsert_award(award)
                    if status == "new":
                        result["awards_new"] += 1
                    elif status == "updated":
                        result["awards_updated"] += 1
                except Exception as e:
                    err = f"Error upserting award {award.get('agency_tracking_number', '?')}: {e}"
                    log.error(err, exc_info=True)
                    result["errors"].append(err)

        except Exception as e:
            err = f"SBIR.gov award fetch failed: {e}"
            log.error(err, exc_info=True)
            result["errors"].append(err)

        log.info(
            f"SBIR.gov award ingest complete: "
            f"{result['awards_new']} new, {result['awards_updated']} updated"
        )
        return result

    async def _fetch_all_awards(
        self, year: Optional[str] = None, agency: Optional[str] = None
    ) -> list:
        """Paginate through award results."""
        all_results = []
        offset = 0

        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            while True:
                params: dict = {
                    "rows": AWARDS_PAGE_SIZE,
                    "start": offset,
                }
                if year:
                    params["year"] = year
                if agency:
                    params["agency"] = agency

                try:
                    resp = await client.get(AWARDS_API, params=params)
                    resp.raise_for_status()
                    data = resp.json()
                except httpx.HTTPStatusError as e:
                    log.error(f"SBIR.gov awards API error: {e.response.status_code}")
                    break
                except Exception as e:
                    log.error(f"SBIR.gov awards request failed: {e}")
                    break

                records = data if isinstance(data, list) else data.get("data", data.get("results", []))
                if not records:
                    break

                all_results.extend(records)
                offset += len(records)

                if len(records) < AWARDS_PAGE_SIZE:
                    break

                # Safety cap: 50,000 awards per run
                if offset >= 50000:
                    log.warning("Hit 50,000 award cap, stopping pagination")
                    break

        return all_results

    async def _upsert_award(self, raw: dict) -> str:
        """Upsert a single award record. Returns 'new', 'updated', or 'unchanged'."""
        # Build stable source_id
        tracking = raw.get("agency_tracking_number") or ""
        contract = raw.get("contract") or ""
        source_id = tracking or contract or _content_hash(raw)[:12]

        new_hash = _content_hash(raw)

        existing = await self.conn.fetchrow(
            "SELECT id, content_hash FROM sbir_awards WHERE source_id = $1",
            source_id,
        )

        if existing and existing["content_hash"] == new_hash:
            return "unchanged"

        firm = raw.get("firm", "")
        award_title = raw.get("award_title", "")
        agency = raw.get("agency", "")
        branch = raw.get("branch", "")
        phase = raw.get("phase", "")
        program = raw.get("program", "")
        award_amount = None
        try:
            award_amount = float(raw.get("award_amount", 0) or 0)
        except (ValueError, TypeError):
            pass

        award_year = None
        try:
            award_year = int(raw.get("award_year", 0) or 0) or None
        except (ValueError, TypeError):
            pass

        num_employees = None
        try:
            num_employees = int(raw.get("number_employees", 0) or 0) or None
        except (ValueError, TypeError):
            pass

        if existing:
            await self.conn.execute(
                """
                UPDATE sbir_awards SET
                    firm = $1, award_title = $2, agency = $3, branch = $4,
                    phase = $5, program = $6, agency_tracking_number = $7,
                    contract = $8, proposal_award_date = $9, contract_end_date = $10,
                    solicitation_number = $11, solicitation_year = $12,
                    topic_code = $13, award_year = $14, award_amount = $15,
                    duns = $16, uei = $17, hubzone_owned = $18,
                    socially_economically_disadvantaged = $19, women_owned = $20,
                    number_employees = $21, company_url = $22,
                    address1 = $23, address2 = $24, city = $25, state = $26, zip = $27,
                    poc_name = $28, poc_title = $29, poc_phone = $30, poc_email = $31,
                    pi_name = $32, pi_phone = $33, pi_email = $34,
                    ri_name = $35, ri_poc_name = $36, ri_poc_phone = $37,
                    research_keywords = $38, abstract = $39, award_link = $40,
                    content_hash = $41, raw_data = $42::jsonb, updated_at = NOW()
                WHERE id = $43
                """,
                firm, award_title, agency, branch,
                phase, program, tracking,
                contract, _parse_date_only(raw.get("proposal_award_date")),
                _parse_date_only(raw.get("contract_end_date")),
                raw.get("solicitation_number"), raw.get("solicitation_year"),
                raw.get("topic_code"), award_year, award_amount,
                raw.get("duns"), raw.get("uei"), raw.get("hubzone_owned"),
                raw.get("socially_economically_disadvantaged"), raw.get("women_owned"),
                num_employees, raw.get("company_url"),
                raw.get("address1"), raw.get("address2"),
                raw.get("city"), raw.get("state"), raw.get("zip"),
                raw.get("poc_name"), raw.get("poc_title"),
                raw.get("poc_phone"), raw.get("poc_email"),
                raw.get("pi_name"), raw.get("pi_phone"), raw.get("pi_email"),
                raw.get("ri_name"), raw.get("ri_poc_name"), raw.get("ri_poc_phone"),
                raw.get("research_area_keywords"), raw.get("abstract"),
                raw.get("award_link"),
                new_hash, json.dumps(raw, default=str),
                existing["id"],
            )
            return "updated"
        else:
            await self.conn.execute(
                """
                INSERT INTO sbir_awards (
                    source_id, firm, award_title, agency, branch,
                    phase, program, agency_tracking_number,
                    contract, proposal_award_date, contract_end_date,
                    solicitation_number, solicitation_year,
                    topic_code, award_year, award_amount,
                    duns, uei, hubzone_owned,
                    socially_economically_disadvantaged, women_owned,
                    number_employees, company_url,
                    address1, address2, city, state, zip,
                    poc_name, poc_title, poc_phone, poc_email,
                    pi_name, pi_phone, pi_email,
                    ri_name, ri_poc_name, ri_poc_phone,
                    research_keywords, abstract, award_link,
                    content_hash, raw_data
                ) VALUES (
                    $1, $2, $3, $4, $5,
                    $6, $7, $8,
                    $9, $10, $11,
                    $12, $13,
                    $14, $15, $16,
                    $17, $18, $19,
                    $20, $21,
                    $22, $23,
                    $24, $25, $26, $27, $28,
                    $29, $30, $31, $32,
                    $33, $34, $35,
                    $36, $37, $38,
                    $39, $40, $41,
                    $42, $43::jsonb
                )
                """,
                source_id, firm, award_title, agency, branch,
                phase, program, tracking,
                contract, _parse_date_only(raw.get("proposal_award_date")),
                _parse_date_only(raw.get("contract_end_date")),
                raw.get("solicitation_number"), raw.get("solicitation_year"),
                raw.get("topic_code"), award_year, award_amount,
                raw.get("duns"), raw.get("uei"), raw.get("hubzone_owned"),
                raw.get("socially_economically_disadvantaged"), raw.get("women_owned"),
                num_employees, raw.get("company_url"),
                raw.get("address1"), raw.get("address2"),
                raw.get("city"), raw.get("state"), raw.get("zip"),
                raw.get("poc_name"), raw.get("poc_title"),
                raw.get("poc_phone"), raw.get("poc_email"),
                raw.get("pi_name"), raw.get("pi_phone"), raw.get("pi_email"),
                raw.get("ri_name"), raw.get("ri_poc_name"), raw.get("ri_poc_phone"),
                raw.get("research_area_keywords"), raw.get("abstract"),
                raw.get("award_link"),
                new_hash, json.dumps(raw, default=str),
            )
            return "new"


# ══════════════════════════════════════════════════════════════════════
# Company Ingester — firm profiles → sbir_companies table
# ══════════════════════════════════════════════════════════════════════
class SbirGovCompanyIngester:
    """
    Fetches SBIR/STTR company profiles from SBIR.gov.

    Used for competitive landscape analysis, teaming partner discovery,
    and understanding who wins in specific technology areas.
    """

    def __init__(self, conn):
        self.conn = conn

    async def run(self, params: dict | None = None) -> dict:
        """Run company ingestion."""
        result = {
            "companies_fetched": 0,
            "companies_new": 0,
            "companies_updated": 0,
            "errors": [],
        }

        params = params or {}
        state = params.get("state")
        keyword = params.get("keyword")

        try:
            companies = await self._fetch_all_companies(state=state, keyword=keyword)
            result["companies_fetched"] = len(companies)
            log.info(f"Fetched {len(companies)} companies from SBIR.gov")

            for company in companies:
                try:
                    status = await self._upsert_company(company)
                    if status == "new":
                        result["companies_new"] += 1
                    elif status == "updated":
                        result["companies_updated"] += 1
                except Exception as e:
                    err = f"Error upserting company {company.get('company_name', '?')}: {e}"
                    log.error(err, exc_info=True)
                    result["errors"].append(err)

        except Exception as e:
            err = f"SBIR.gov company fetch failed: {e}"
            log.error(err, exc_info=True)
            result["errors"].append(err)

        log.info(
            f"SBIR.gov company ingest complete: "
            f"{result['companies_new']} new, {result['companies_updated']} updated"
        )
        return result

    async def _fetch_all_companies(
        self, state: Optional[str] = None, keyword: Optional[str] = None
    ) -> list:
        """Paginate through company results."""
        all_results = []
        offset = 0

        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            while True:
                params: dict = {
                    "rows": COMPANIES_PAGE_SIZE,
                    "start": offset,
                }
                if state:
                    params["state"] = state
                if keyword:
                    params["keyword"] = keyword

                try:
                    resp = await client.get(COMPANIES_API, params=params)
                    resp.raise_for_status()
                    data = resp.json()
                except httpx.HTTPStatusError as e:
                    log.error(f"SBIR.gov companies API error: {e.response.status_code}")
                    break
                except Exception as e:
                    log.error(f"SBIR.gov companies request failed: {e}")
                    break

                records = data if isinstance(data, list) else data.get("data", data.get("results", []))
                if not records:
                    break

                all_results.extend(records)
                offset += len(records)

                if len(records) < COMPANIES_PAGE_SIZE:
                    break

                # Safety cap: 100,000 companies per run
                if offset >= 100000:
                    log.warning("Hit 100,000 company cap, stopping pagination")
                    break

        return all_results

    async def _upsert_company(self, raw: dict) -> str:
        """Upsert a single company record. Returns 'new', 'updated', or 'unchanged'."""
        source_id = str(raw.get("firm_nid", "")) or _content_hash(raw)[:12]
        new_hash = _content_hash(raw)

        existing = await self.conn.fetchrow(
            "SELECT id, content_hash FROM sbir_companies WHERE source_id = $1",
            source_id,
        )

        if existing and existing["content_hash"] == new_hash:
            return "unchanged"

        company_name = raw.get("company_name", "")
        num_awards = None
        try:
            num_awards = int(raw.get("number_awards", 0) or 0) or None
        except (ValueError, TypeError):
            pass

        if existing:
            await self.conn.execute(
                """
                UPDATE sbir_companies SET
                    company_name = $1, sbir_url = $2, uei = $3, duns = $4,
                    address = $5, city = $6, state = $7, zip = $8,
                    company_url = $9, hubzone_owned = $10,
                    socially_economically_disadvantaged = $11, woman_owned = $12,
                    number_awards = $13, content_hash = $14,
                    raw_data = $15::jsonb, updated_at = NOW()
                WHERE id = $16
                """,
                company_name, raw.get("sbir_url"), raw.get("uei"), raw.get("duns"),
                raw.get("address"), raw.get("city"), raw.get("state"), raw.get("zip"),
                raw.get("company_url"), raw.get("hubzone_owned"),
                raw.get("socially_economically_disadvantaged"), raw.get("woman_owned"),
                num_awards, new_hash,
                json.dumps(raw, default=str),
                existing["id"],
            )
            return "updated"
        else:
            await self.conn.execute(
                """
                INSERT INTO sbir_companies (
                    source_id, company_name, sbir_url, uei, duns,
                    address, city, state, zip, company_url,
                    hubzone_owned, socially_economically_disadvantaged, woman_owned,
                    number_awards, content_hash, raw_data
                ) VALUES (
                    $1, $2, $3, $4, $5,
                    $6, $7, $8, $9, $10,
                    $11, $12, $13,
                    $14, $15, $16::jsonb
                )
                """,
                source_id, company_name, raw.get("sbir_url"), raw.get("uei"), raw.get("duns"),
                raw.get("address"), raw.get("city"), raw.get("state"), raw.get("zip"),
                raw.get("company_url"), raw.get("hubzone_owned"),
                raw.get("socially_economically_disadvantaged"), raw.get("woman_owned"),
                num_awards, new_hash,
                json.dumps(raw, default=str),
            )
            return "new"
