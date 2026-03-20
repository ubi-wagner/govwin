"""
SAM.gov Opportunities API Ingester

Fetches opportunities from the SAM.gov public API, deduplicates via content_hash,
and inserts/updates the global opportunities table.

API docs: https://open.gsa.gov/api/get-opportunities-public-api/
Rate limit: ~1000 requests/day (tracked in rate_limit_state).
"""

import hashlib
import json
import logging
import os
from datetime import datetime, timedelta, timezone

import httpx

log = logging.getLogger("pipeline.ingest.sam_gov")

SAM_API_BASE = "https://api.sam.gov/opportunities/v2/search"
SAM_API_KEY = os.environ.get("SAM_GOV_API_KEY", "")
DEFAULT_DAYS_BACK = 7
PAGE_SIZE = 25  # SAM.gov max per request

# Stub mode: USE_STUB_DATA=true enables seed data for local development/demos.
# In production, set SAM_GOV_API_KEY and leave USE_STUB_DATA unset.
USE_STUB_DATA = os.environ.get("USE_STUB_DATA", "false").lower() == "true"


def _generate_stub_opportunities() -> list[dict]:
    """Return realistic SAM.gov API response data for testing/development.

    Each dict matches the exact field names from the SAM.gov GET /opportunities/v2/search
    response as documented at https://open.gsa.gov/api/get-opportunities-public-api/

    Fields included:
      noticeId, title, solicitationNumber, department, subTier, office,
      fullParentPathName, fullParentPathCode, postedDate, type, baseType,
      archiveType, archiveDate, typeOfSetAside, typeOfSetAsideDescription,
      responseDeadLine, naicsCode, classificationCode, active,
      organizationType, additionalInfoLink, uiLink, description,
      award, pointOfContact, officeAddress, placeOfPerformance
    """
    now = datetime.now(timezone.utc)
    return [
        {
            "noticeId": "stub_001_cloud_migration_disa",
            "title": "Enterprise Cloud Migration and Managed Services — DISA",
            "solicitationNumber": "HC1028-25-R-0042",
            "department": "DEPT OF DEFENSE",
            "subTier": "DEFENSE INFORMATION SYSTEMS AGENCY",
            "office": "DISA PL8",
            "fullParentPathName": "DEPT OF DEFENSE.DEFENSE INFORMATION SYSTEMS AGENCY.DISA PL8",
            "fullParentPathCode": "097.DISA.PL8",
            "postedDate": (now - timedelta(days=3)).strftime("%Y-%m-%d"),
            "type": "Solicitation",
            "baseType": "Solicitation",
            "archiveType": "autocustom",
            "archiveDate": (now + timedelta(days=60)).strftime("%Y-%m-%d"),
            "typeOfSetAside": "SDVOSBA",
            "typeOfSetAsideDescription": "Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside",
            "responseDeadLine": (now + timedelta(days=25)).strftime("%Y-%m-%dT17:00:00-05:00"),
            "naicsCode": "541512",
            "classificationCode": "D302",
            "active": "Yes",
            "description": (
                "The Department of Defense seeks a qualified SDVOSB to provide enterprise "
                "cloud migration services including assessment, planning, and execution of "
                "migration from on-premises infrastructure to AWS GovCloud. Scope includes "
                "FedRAMP authorization support, continuous monitoring, and 24/7 managed cloud "
                "infrastructure services. Requires NIST 800-53 compliance and STIG hardening."
            ),
            "organizationType": "OFFICE",
            "additionalInfoLink": None,
            "uiLink": "https://sam.gov/opp/stub_001_cloud_migration_disa/view",
            "award": None,
            "pointOfContact": [
                {
                    "type": "primary",
                    "fullName": "John Smith",
                    "email": "john.smith.test@disa.mil",
                    "phone": "571-555-0100",
                    "fax": None,
                    "title": "Contracting Officer",
                },
            ],
            "officeAddress": {
                "zipcode": "22060",
                "city": "Fort Belvoir",
                "countryCode": "USA",
                "state": "VA",
            },
            "placeOfPerformance": {
                "city": {"code": "24000", "name": "Fort Belvoir"},
                "state": {"code": "VA", "name": "Virginia"},
                "country": {"code": "USA", "name": "UNITED STATES"},
            },
        },
        {
            "noticeId": "stub_002_cybersecurity_gsa",
            "title": "Cybersecurity Risk Assessment and Continuous Monitoring Services",
            "solicitationNumber": "47QTCA-25-R-0089",
            "department": "GENERAL SERVICES ADMINISTRATION",
            "subTier": "FEDERAL ACQUISITION SERVICE",
            "office": "GSA/FAS OFFICE OF IT CATEGORY",
            "fullParentPathName": "GENERAL SERVICES ADMINISTRATION.FEDERAL ACQUISITION SERVICE.GSA/FAS OFFICE OF IT CATEGORY",
            "fullParentPathCode": "047.4732.47QTCA",
            "postedDate": (now - timedelta(days=5)).strftime("%Y-%m-%d"),
            "type": "Combined Synopsis/Solicitation",
            "baseType": "Combined Synopsis/Solicitation",
            "archiveType": "auto15",
            "typeOfSetAside": "SBA",
            "typeOfSetAsideDescription": "Small Business Set-Aside (FAR 19.5)",
            "responseDeadLine": (now + timedelta(days=18)).strftime("%Y-%m-%dT14:00:00-05:00"),
            "naicsCode": "541512",
            "classificationCode": "D310",
            "active": "Yes",
            "description": (
                "GSA requires a contractor to perform comprehensive cybersecurity risk "
                "assessments across multiple agency information systems. Services include "
                "vulnerability assessment, penetration testing, NIST 800-53 Rev 5 security "
                "control assessment, Risk Management Framework (RMF) support, and continuous "
                "monitoring. Requires Secret clearance and CISSP or CEH certifications."
            ),
            "organizationType": "OFFICE",
            "additionalInfoLink": None,
            "uiLink": "https://sam.gov/opp/stub_002_cybersecurity_gsa/view",
            "award": None,
            "pointOfContact": [
                {
                    "type": "primary",
                    "fullName": "Maria Rodriguez",
                    "email": "maria.rodriguez.test@gsa.gov",
                    "phone": "202-555-0200",
                },
            ],
        },
        {
            "noticeId": "stub_003_pmo_hhs",
            "title": "Program Management Office (PMO) Support Services — HHS OCIO",
            "solicitationNumber": "OS-OCIO-25-R-0015",
            "department": "DEPARTMENT OF HEALTH AND HUMAN SERVICES",
            "subTier": "OFFICE OF THE SECRETARY",
            "office": "OS OFFICE OF THE CIO",
            "fullParentPathName": "DEPARTMENT OF HEALTH AND HUMAN SERVICES.OFFICE OF THE SECRETARY.OS OFFICE OF THE CIO",
            "fullParentPathCode": "075.OS.OCIO",
            "postedDate": (now - timedelta(days=7)).strftime("%Y-%m-%d"),
            "type": "Solicitation",
            "baseType": "Solicitation",
            "typeOfSetAside": "SBA",
            "typeOfSetAsideDescription": "Total Small Business Set-Aside",
            "responseDeadLine": (now + timedelta(days=10)).strftime("%Y-%m-%dT17:00:00-05:00"),
            "naicsCode": "541611",
            "classificationCode": "R408",
            "active": "Yes",
            "description": (
                "HHS requires program management support including EVMS, Agile program "
                "management, risk management, stakeholder reporting, and organizational "
                "change management for the Office of the CIO."
            ),
            "uiLink": "https://sam.gov/opp/stub_003_pmo_hhs/view",
            "award": None,
            "pointOfContact": [
                {
                    "type": "primary",
                    "fullName": "James Williams",
                    "email": "james.williams.test@hhs.gov",
                    "phone": "202-555-0300",
                },
            ],
        },
        {
            "noticeId": "stub_004_devsecops_army",
            "title": "DevSecOps CI/CD Pipeline Implementation and Kubernetes Platform",
            "solicitationNumber": "W911QY-25-R-0108",
            "department": "DEPT OF DEFENSE",
            "subTier": "DEPT OF THE ARMY",
            "office": "W6QK ACC-APG NATICK",
            "fullParentPathName": "DEPT OF DEFENSE.DEPT OF THE ARMY.W6QK ACC-APG NATICK",
            "fullParentPathCode": "012.21A1.W6QK",
            "postedDate": (now - timedelta(days=2)).strftime("%Y-%m-%d"),
            "type": "Solicitation",
            "baseType": "Solicitation",
            "typeOfSetAside": "SDVOSBA",
            "typeOfSetAsideDescription": "Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside",
            "responseDeadLine": (now + timedelta(days=30)).strftime("%Y-%m-%dT16:00:00-05:00"),
            "naicsCode": "541512",
            "active": "Yes",
            "description": (
                "U.S. Army requires a qualified small business to design, implement, and "
                "maintain a DevSecOps CI/CD pipeline based on Kubernetes, Docker, and GitLab CI/CD. "
                "Includes zero trust architecture, STIG hardening, and FedRAMP High authorization."
            ),
            "uiLink": "https://sam.gov/opp/stub_004_devsecops_army/view",
            "award": None,
            "pointOfContact": [],
        },
        {
            "noticeId": "stub_005_training_va",
            "title": "Workforce Development and Training Program Support — VA",
            "solicitationNumber": "VA-HRA-25-I-0033",
            "department": "DEPARTMENT OF VETERANS AFFAIRS",
            "subTier": "VA HUMAN RESOURCES AND ADMINISTRATION",
            "office": None,
            "fullParentPathName": "DEPARTMENT OF VETERANS AFFAIRS.VA HUMAN RESOURCES AND ADMINISTRATION",
            "fullParentPathCode": "036.HRA",
            "postedDate": (now - timedelta(days=1)).strftime("%Y-%m-%d"),
            "type": "Sources Sought",
            "baseType": "Sources Sought",
            "typeOfSetAside": "SBA",
            "typeOfSetAsideDescription": "Total Small Business Set-Aside",
            "responseDeadLine": (now + timedelta(days=14)).strftime("%Y-%m-%dT12:00:00-05:00"),
            "naicsCode": "611430",
            "active": "Yes",
            "description": (
                "VA seeks information from qualified small businesses for workforce development, "
                "instructor-led training, LMS administration, curriculum development, strategic "
                "planning, and Lean Six Sigma process improvement support."
            ),
            "uiLink": "https://sam.gov/opp/stub_005_training_va/view",
            "award": None,
            "pointOfContact": [
                {
                    "type": "primary",
                    "fullName": "Sarah Johnson",
                    "email": "sarah.johnson.test@va.gov",
                    "phone": "202-555-0500",
                },
            ],
        },
    ]


class SamGovIngester:
    def __init__(self, conn):
        self.conn = conn

    async def run(self, params: dict | None = None) -> dict:
        """Run a full or incremental SAM.gov ingest."""
        params = params or {}
        days_back = params.get("days_back", DEFAULT_DAYS_BACK)

        result = {
            "opportunities_fetched": 0,
            "opportunities_new": 0,
            "opportunities_updated": 0,
            "amendments_detected": 0,
            "errors": [],
        }

        # ── Stub mode: return seed data when USE_STUB_DATA=true or no API key ──
        if USE_STUB_DATA or not SAM_API_KEY:
            if USE_STUB_DATA:
                log.info("USE_STUB_DATA=true — returning stub SAM.gov data")
            else:
                log.warning("SAM_GOV_API_KEY not configured — using stub data")
            stub_opps = _generate_stub_opportunities()
            for opp in stub_opps:
                try:
                    await self._upsert_opportunity(opp)
                    result["opportunities_fetched"] += 1
                    result["opportunities_new"] += 1
                except Exception as e:
                    result["errors"].append(f"Stub upsert error for {opp.get('noticeId')}: {e}")
                    log.error("Stub upsert error: %s", e)
            return result

        # Check rate limit
        quota = await self.conn.fetchrow(
            "SELECT * FROM get_remaining_quota('sam_gov')"
        )
        if quota and quota.get("can_proceed") is False:
            result["errors"].append("SAM.gov rate limit reached")
            log.warning("Rate limit reached for SAM.gov")
            return result

        posted_from = (datetime.now(timezone.utc) - timedelta(days=days_back)).strftime("%m/%d/%Y")
        posted_to = datetime.now(timezone.utc).strftime("%m/%d/%Y")

        offset = 0
        total_fetched = 0

        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                try:
                    resp = await client.get(
                        SAM_API_BASE,
                        params={
                            "api_key": SAM_API_KEY,
                            "postedFrom": posted_from,
                            "postedTo": posted_to,
                            "limit": PAGE_SIZE,
                            "offset": offset,
                            "ptype": "o,k,p",  # Opportunities, sources sought, presolicitations
                        },
                    )

                    # Track rate limit
                    await self.conn.execute(
                        """
                        UPDATE rate_limit_state
                        SET requests_today = requests_today + 1,
                            requests_this_hour = requests_this_hour + 1,
                            last_request_at = NOW()
                        WHERE source = 'sam_gov'
                        """
                    )

                    if resp.status_code != 200:
                        result["errors"].append(f"SAM API returned {resp.status_code}")
                        log.error(f"SAM API error: {resp.status_code} - {resp.text[:200]}")
                        break

                    data = resp.json()
                    opps = data.get("opportunitiesData", [])

                    if not opps:
                        break

                    for raw_opp in opps:
                        try:
                            stats = await self._upsert_opportunity(raw_opp)
                            result["opportunities_fetched"] += 1
                            if stats == "new":
                                result["opportunities_new"] += 1
                            elif stats == "updated":
                                result["opportunities_updated"] += 1
                                result["amendments_detected"] += 1
                        except Exception as e:
                            log.error(f"Error processing opp {raw_opp.get('noticeId', '?')}: {e}")
                            result["errors"].append(f"Process error: {e}")

                    total_fetched += len(opps)
                    log.info(f"Fetched {total_fetched} opportunities so far (page offset={offset})")

                    # If fewer than page size, we're done
                    if len(opps) < PAGE_SIZE:
                        break

                    offset += PAGE_SIZE

                    # Re-check rate limit
                    quota = await self.conn.fetchrow(
                        "SELECT * FROM get_remaining_quota('sam_gov')"
                    )
                    if quota and quota.get("can_proceed") is False:
                        log.warning("Rate limit reached mid-ingest, stopping")
                        break

                except httpx.TimeoutException:
                    result["errors"].append("SAM API timeout")
                    log.error("SAM API request timed out")
                    break
                except Exception as e:
                    result["errors"].append(f"Fetch error: {e}")
                    log.error(f"Fetch error: {e}", exc_info=True)
                    break

        log.info(
            f"SAM.gov ingest complete: {result['opportunities_fetched']} fetched, "
            f"{result['opportunities_new']} new, {result['opportunities_updated']} updated"
        )
        return result

    async def _upsert_opportunity(self, raw: dict) -> str:
        """Insert or update an opportunity. Returns 'new', 'updated', or 'unchanged'."""
        source_id = raw.get("noticeId", "")
        if not source_id:
            return "unchanged"

        # Build content hash for change detection
        content_str = json.dumps(raw, sort_keys=True, default=str)
        content_hash = hashlib.sha256(content_str.encode()).hexdigest()[:16]

        # Check existing
        existing = await self.conn.fetchrow(
            "SELECT id, content_hash FROM opportunities WHERE source = 'sam_gov' AND source_id = $1",
            source_id,
        )

        if existing and existing["content_hash"] == content_hash:
            return "unchanged"

        # Parse fields
        title = raw.get("title", "Untitled")[:500]
        description = raw.get("description", "")
        if isinstance(description, dict):
            description = description.get("body", "")
        if not isinstance(description, str):
            description = str(description) if description else ""

        agency = raw.get("fullParentPathName", "")
        # Extract top-level agency code from fullParentPathCode (e.g., "097.DISA.PL8" → "097")
        full_parent_code = raw.get("fullParentPathCode", "")
        agency_code = full_parent_code.split(".")[0] if full_parent_code else ""

        naics = raw.get("naicsCode", "")
        naics_codes = [naics] if naics else []

        set_aside = raw.get("typeOfSetAsideDescription", "")
        set_aside_code = raw.get("typeOfSetAside", "")

        # SAM.gov returns full type names; map to our normalized enum values
        opp_type_map = {
            # Short codes (ptype query param values)
            "o": "solicitation",
            "k": "sources_sought",
            "p": "presolicitation",
            # Full names (actual response values from SAM.gov type field)
            "Solicitation": "solicitation",
            "Combined Synopsis/Solicitation": "solicitation",
            "Sources Sought": "sources_sought",
            "Presolicitation": "presolicitation",
            "Special Notice": "special_notice",
            "Award Notice": "award",
            "Intent to Bundle Requirements": "intent_bundle",
            "Justification and Approval": "justification",
        }
        opp_type = opp_type_map.get(raw.get("type", ""), "other")

        posted_date = self._parse_date(raw.get("postedDate"))
        close_date = self._parse_date(raw.get("responseDeadLine") or raw.get("archiveDate"))

        sol_number = raw.get("solicitationNumber", "")
        source_url = f"https://sam.gov/opp/{source_id}/view"

        if existing:
            # Update + record amendment
            await self.conn.execute(
                """
                UPDATE opportunities SET
                    title = $1, description = $2, agency = $3, agency_code = $4,
                    naics_codes = $5, set_aside_type = $6, set_aside_code = $7,
                    opportunity_type = $8, posted_date = $9, close_date = $10,
                    solicitation_number = $11, source_url = $12, content_hash = $13,
                    raw_data = $14::jsonb, updated_at = NOW()
                WHERE id = $15
                """,
                title, description, agency, agency_code,
                naics_codes, set_aside, set_aside_code,
                opp_type, posted_date, close_date,
                sol_number, source_url, content_hash,
                json.dumps(raw, default=str), existing["id"],
            )

            await self.conn.execute(
                """
                INSERT INTO amendments (opportunity_id, change_type, old_value, new_value)
                VALUES ($1, 'content_update', $2, $3)
                """,
                existing["id"], existing["content_hash"], content_hash,
            )
            return "updated"
        else:
            # Insert new
            await self.conn.execute(
                """
                INSERT INTO opportunities (
                    source, source_id, title, description, agency, agency_code,
                    naics_codes, set_aside_type, set_aside_code, opportunity_type,
                    posted_date, close_date, solicitation_number, source_url,
                    content_hash, raw_data
                ) VALUES (
                    'sam_gov', $1, $2, $3, $4, $5,
                    $6, $7, $8, $9,
                    $10, $11, $12, $13,
                    $14, $15::jsonb
                )
                """,
                source_id, title, description, agency, agency_code,
                naics_codes, set_aside, set_aside_code, opp_type,
                posted_date, close_date, sol_number, source_url,
                content_hash, json.dumps(raw, default=str),
            )
            return "new"

    @staticmethod
    def _parse_date(date_str: str | None) -> datetime | None:
        if not date_str:
            return None
        for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%m/%d/%Y", "%Y-%m-%d"):
            try:
                dt = datetime.strptime(date_str.strip(), fmt)
                # For tz-aware formats, convert to UTC (don't replace, which drops the offset)
                if dt.tzinfo is not None:
                    return dt.astimezone(timezone.utc)
                # For naive formats, assume UTC
                return dt.replace(tzinfo=timezone.utc)
            except (ValueError, AttributeError):
                continue
        return None
