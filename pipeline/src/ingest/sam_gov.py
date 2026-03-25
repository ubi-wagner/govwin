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

from crypto import decrypt_api_key

log = logging.getLogger("pipeline.ingest.sam_gov")

SAM_API_BASE = "https://api.sam.gov/opportunities/v2/search"
SAM_API_KEY_ENV = os.environ.get("SAM_GOV_API_KEY", "")
DEFAULT_DAYS_BACK = 7
PAGE_SIZE = 25  # SAM.gov max per request

# Stub mode: USE_STUB_DATA=true enables seed data for local development/demos.
# In production, set SAM_GOV_API_KEY and leave USE_STUB_DATA unset.
USE_STUB_DATA = os.environ.get("USE_STUB_DATA", "false").lower() == "true"


async def _resolve_api_key(conn) -> str:
    """Resolve SAM.gov API key: DB encrypted value first, env var fallback."""
    try:
        row = await conn.fetchrow(
            "SELECT encrypted_value FROM api_key_registry WHERE source = 'sam_gov'"
        )
        if row and row["encrypted_value"]:
            key = decrypt_api_key(row["encrypted_value"])
            log.info("Using SAM.gov API key from database (encrypted)")
            return key
    except Exception as e:
        log.warning("Could not load encrypted SAM.gov key from DB: %s", e)

    if SAM_API_KEY_ENV:
        log.info("Using SAM.gov API key from environment variable")
    return SAM_API_KEY_ENV


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
                    "title": "Contract Specialist",
                },
            ],
            "officeAddress": {
                "zipcode": "20405",
                "city": "Washington",
                "countryCode": "USA",
                "state": "DC",
            },
            "placeOfPerformance": {
                "city": {"code": "50000", "name": "Washington"},
                "state": {"code": "DC", "name": "District of Columbia"},
                "country": {"code": "USA", "name": "UNITED STATES"},
            },
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
            "organizationType": "OFFICE",
            "uiLink": "https://sam.gov/opp/stub_003_pmo_hhs/view",
            "additionalInfoLink": None,
            "archiveType": "autocustom",
            "archiveDate": (now + timedelta(days=45)).strftime("%Y-%m-%d"),
            "award": None,
            "pointOfContact": [
                {
                    "type": "primary",
                    "fullName": "James Williams",
                    "email": "james.williams.test@hhs.gov",
                    "phone": "202-555-0300",
                    "title": "Contracting Officer",
                },
            ],
            "officeAddress": {
                "zipcode": "20201",
                "city": "Washington",
                "countryCode": "USA",
                "state": "DC",
            },
            "placeOfPerformance": {
                "city": {"code": "50000", "name": "Washington"},
                "state": {"code": "DC", "name": "District of Columbia"},
                "country": {"code": "USA", "name": "UNITED STATES"},
            },
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
            "organizationType": "OFFICE",
            "archiveType": "autocustom",
            "archiveDate": (now + timedelta(days=75)).strftime("%Y-%m-%d"),
            "additionalInfoLink": None,
            "uiLink": "https://sam.gov/opp/stub_004_devsecops_army/view",
            "award": None,
            "pointOfContact": [],
            "officeAddress": {
                "zipcode": "01760",
                "city": "Natick",
                "countryCode": "USA",
                "state": "MA",
            },
            "placeOfPerformance": {
                "city": {"code": "45000", "name": "Natick"},
                "state": {"code": "MA", "name": "Massachusetts"},
                "country": {"code": "USA", "name": "UNITED STATES"},
            },
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
            "organizationType": "OFFICE",
            "archiveType": "auto15",
            "archiveDate": (now + timedelta(days=30)).strftime("%Y-%m-%d"),
            "additionalInfoLink": None,
            "uiLink": "https://sam.gov/opp/stub_005_training_va/view",
            "award": None,
            "pointOfContact": [
                {
                    "type": "primary",
                    "fullName": "Sarah Johnson",
                    "email": "sarah.johnson.test@va.gov",
                    "phone": "202-555-0500",
                    "title": "Contracting Specialist",
                },
            ],
            "officeAddress": {
                "zipcode": "20420",
                "city": "Washington",
                "countryCode": "USA",
                "state": "DC",
            },
            "placeOfPerformance": {
                "city": {"code": "50000", "name": "Washington"},
                "state": {"code": "DC", "name": "District of Columbia"},
                "country": {"code": "USA", "name": "UNITED STATES"},
            },
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

        # Resolve API key from DB (encrypted) or env var fallback
        sam_api_key = await _resolve_api_key(self.conn)

        # ── Stub mode: return seed data when USE_STUB_DATA=true or no API key ──
        if USE_STUB_DATA or not sam_api_key:
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
                            "api_key": sam_api_key,
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

        # ── Parse all fields from SAM.gov response ──
        fields = self._extract_all_fields(raw, source_id)

        if existing:
            await self.conn.execute(
                """
                UPDATE opportunities SET
                    title = $1, description = $2, agency = $3, agency_code = $4,
                    naics_codes = $5, set_aside_type = $6, set_aside_code = $7,
                    opportunity_type = $8, posted_date = $9, close_date = $10,
                    solicitation_number = $11, source_url = $12, content_hash = $13,
                    raw_data = $14::jsonb,
                    classification_code = $15, department = $16, sub_tier = $17,
                    office = $18, organization_type = $19, full_parent_path_code = $20,
                    pop_city = $21, pop_state = $22, pop_country = $23, pop_zip = $24,
                    office_city = $25, office_state = $26, office_zip = $27, office_country = $28,
                    contact_name = $29, contact_email = $30, contact_phone = $31, contact_title = $32,
                    award_date = $33, award_number = $34, award_amount = $35,
                    awardee_name = $36, awardee_uei = $37, awardee_city = $38, awardee_state = $39,
                    base_type = $40, archive_type = $41, archive_date = $42,
                    is_active = $43, sam_ui_link = $44, additional_info_link = $45,
                    resource_links = $46::jsonb, document_urls = $47::jsonb,
                    estimated_value_min = $48, estimated_value_max = $49,
                    updated_at = NOW()
                WHERE id = $50
                """,
                fields["title"], fields["description"], fields["agency"], fields["agency_code"],
                fields["naics_codes"], fields["set_aside"], fields["set_aside_code"],
                fields["opp_type"], fields["posted_date"], fields["close_date"],
                fields["sol_number"], fields["source_url"], content_hash,
                json.dumps(raw, default=str),
                fields["classification_code"], fields["department"], fields["sub_tier"],
                fields["office"], fields["organization_type"], fields["full_parent_path_code"],
                fields["pop_city"], fields["pop_state"], fields["pop_country"], fields["pop_zip"],
                fields["office_city"], fields["office_state"], fields["office_zip"], fields["office_country"],
                fields["contact_name"], fields["contact_email"], fields["contact_phone"], fields["contact_title"],
                fields["award_date"], fields["award_number"], fields["award_amount"],
                fields["awardee_name"], fields["awardee_uei"], fields["awardee_city"], fields["awardee_state"],
                fields["base_type"], fields["archive_type"], fields["archive_date"],
                fields["is_active"], fields["sam_ui_link"], fields["additional_info_link"],
                json.dumps(fields["resource_links"], default=str),       # $46 resource_links
                json.dumps(fields["resource_links"], default=str),       # $47 document_urls (same data — SAM resourceLinks ARE the attachments)
                fields["award_amount"],                                  # $48 estimated_value_min (SAM only provides award.amount, no separate estimate)
                fields["award_amount"],                                  # $49 estimated_value_max (same — exact figure when awarded, NULL otherwise)
                existing["id"],
            )

            # Legacy amendment record (kept for backward compat)
            await self.conn.execute(
                """
                INSERT INTO amendments (opportunity_id, change_type, old_value, new_value)
                VALUES ($1, 'content_update', $2, $3)
                """,
                existing["id"], existing["content_hash"], content_hash,
            )

            # Emit opportunity event: ingest.updated
            from events import emit_opportunity_event, pipeline_actor
            await emit_opportunity_event(
                self.conn,
                opportunity_id=str(existing["id"]),
                event_type="ingest.updated",
                source="sam_gov",
                old_value=existing["content_hash"],
                new_value=content_hash,
                snapshot_hash=content_hash,
                actor=pipeline_actor("sam_gov_ingest"),
                refs={"source_id": source_id},
                payload={
                    "title": fields["title"],
                    "solicitation_number": fields["sol_number"],
                    "agency": fields["agency"],
                    "department": fields["department"],
                    "opp_type": fields["opp_type"],
                },
            )
            return "updated"
        else:
            row = await self.conn.fetchrow(
                """
                INSERT INTO opportunities (
                    source, source_id, title, description, agency, agency_code,
                    naics_codes, set_aside_type, set_aside_code, opportunity_type,
                    posted_date, close_date, solicitation_number, source_url,
                    content_hash, raw_data,
                    classification_code, department, sub_tier, office,
                    organization_type, full_parent_path_code,
                    pop_city, pop_state, pop_country, pop_zip,
                    office_city, office_state, office_zip, office_country,
                    contact_name, contact_email, contact_phone, contact_title,
                    award_date, award_number, award_amount,
                    awardee_name, awardee_uei, awardee_city, awardee_state,
                    base_type, archive_type, archive_date,
                    is_active, sam_ui_link, additional_info_link,
                    resource_links, document_urls,
                    estimated_value_min, estimated_value_max
                ) VALUES (
                    'sam_gov', $1, $2, $3, $4, $5,
                    $6, $7, $8, $9,
                    $10, $11, $12, $13,
                    $14, $15::jsonb,
                    $16, $17, $18, $19,
                    $20, $21,
                    $22, $23, $24, $25,
                    $26, $27, $28, $29,
                    $30, $31, $32, $33,
                    $34, $35, $36,
                    $37, $38, $39, $40,
                    $41, $42, $43,
                    $44, $45, $46,
                    $47::jsonb, $48::jsonb,
                    $49, $50
                )
                RETURNING id
                """,
                source_id, fields["title"], fields["description"], fields["agency"], fields["agency_code"],
                fields["naics_codes"], fields["set_aside"], fields["set_aside_code"], fields["opp_type"],
                fields["posted_date"], fields["close_date"], fields["sol_number"], fields["source_url"],
                content_hash, json.dumps(raw, default=str),
                fields["classification_code"], fields["department"], fields["sub_tier"], fields["office"],
                fields["organization_type"], fields["full_parent_path_code"],
                fields["pop_city"], fields["pop_state"], fields["pop_country"], fields["pop_zip"],
                fields["office_city"], fields["office_state"], fields["office_zip"], fields["office_country"],
                fields["contact_name"], fields["contact_email"], fields["contact_phone"], fields["contact_title"],
                fields["award_date"], fields["award_number"], fields["award_amount"],
                fields["awardee_name"], fields["awardee_uei"], fields["awardee_city"], fields["awardee_state"],
                fields["base_type"], fields["archive_type"], fields["archive_date"],
                fields["is_active"], fields["sam_ui_link"], fields["additional_info_link"],
                json.dumps(fields["resource_links"], default=str),       # $47 resource_links
                json.dumps(fields["resource_links"], default=str),       # $48 document_urls (same — SAM resourceLinks ARE the attachments)
                fields["award_amount"],                                  # $49 estimated_value_min (SAM only provides award.amount, no separate estimate)
                fields["award_amount"],                                  # $50 estimated_value_max (same — exact figure when awarded, NULL otherwise)
            )

            # Emit opportunity event: ingest.new
            if row:
                from events import emit_opportunity_event, pipeline_actor
                await emit_opportunity_event(
                    self.conn,
                    opportunity_id=str(row["id"]),
                    event_type="ingest.new",
                    source="sam_gov",
                    snapshot_hash=content_hash,
                    actor=pipeline_actor("sam_gov_ingest"),
                    refs={"source_id": source_id},
                    payload={
                        "title": fields["title"],
                        "solicitation_number": fields["sol_number"],
                        "agency": fields["agency"],
                        "agency_code": fields["agency_code"],
                        "naics_codes": fields["naics_codes"],
                        "set_aside": fields["set_aside_code"],
                        "opp_type": fields["opp_type"],
                        "department": fields["department"],
                        "classification_code": fields["classification_code"],
                        "pop_state": fields["pop_state"],
                    },
                )
            return "new"

    def _extract_all_fields(self, raw: dict, source_id: str) -> dict:
        """Extract all metadata fields from a SAM.gov API response record."""
        # ── Core fields ──
        title = raw.get("title", "Untitled")[:500]
        description = raw.get("description", "")
        if isinstance(description, dict):
            description = description.get("body", "")
        if not isinstance(description, str):
            description = str(description) if description else ""

        # ── Organization hierarchy ──
        agency = raw.get("fullParentPathName", "")
        full_parent_code = raw.get("fullParentPathCode", "")
        agency_code = full_parent_code.split(".")[0] if full_parent_code else ""
        department = raw.get("department", "")
        sub_tier = raw.get("subTier", "")
        office = raw.get("office", "")
        organization_type = raw.get("organizationType", "")

        # ── Classification ──
        naics = raw.get("naicsCode", "")
        naics_codes = [naics] if naics else []
        classification_code = raw.get("classificationCode", "")

        # ── Set-aside ──
        set_aside = raw.get("typeOfSetAsideDescription", "")
        set_aside_code = raw.get("typeOfSetAside", "")

        # ── Opportunity type mapping ──
        opp_type_map = {
            "o": "solicitation",
            "k": "sources_sought",
            "p": "presolicitation",
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
        base_type = raw.get("baseType", "")

        # ── Dates ──
        posted_date = self._parse_date(raw.get("postedDate"))
        close_date = self._parse_date(raw.get("responseDeadLine") or raw.get("archiveDate"))
        archive_date = self._parse_date(raw.get("archiveDate"))
        archive_type = raw.get("archiveType", "")

        # ── Active flag ──
        is_active = (raw.get("active", "Yes") or "Yes").lower() == "yes"

        # ── Identifiers & links ──
        sol_number = raw.get("solicitationNumber", "")
        source_url = f"https://sam.gov/opp/{source_id}/view"
        sam_ui_link = raw.get("uiLink", "") or source_url
        additional_info_link = raw.get("additionalInfoLink", "")

        # ── Resource / attachment links ──
        resource_links = raw.get("resourceLinks", []) or []
        if not isinstance(resource_links, list):
            resource_links = []

        # ── Place of performance ──
        pop = raw.get("placeOfPerformance") or {}
        pop_city_obj = pop.get("city") or {}
        pop_state_obj = pop.get("state") or {}
        pop_country_obj = pop.get("country") or {}
        pop_city = pop_city_obj.get("name", "") if isinstance(pop_city_obj, dict) else str(pop_city_obj)
        pop_state = pop_state_obj.get("code", "") if isinstance(pop_state_obj, dict) else str(pop_state_obj)
        pop_country = pop_country_obj.get("code", "USA") if isinstance(pop_country_obj, dict) else str(pop_country_obj or "USA")
        pop_zip = pop.get("zip", "")

        # ── Office address ──
        off_addr = raw.get("officeAddress") or {}
        office_city = off_addr.get("city", "")
        office_state = off_addr.get("state", "")
        office_zip = off_addr.get("zipcode", "")
        office_country = off_addr.get("countryCode", "")

        # ── Primary point of contact ──
        contacts = raw.get("pointOfContact") or []
        primary_contact = next(
            (c for c in contacts if isinstance(c, dict) and c.get("type") == "primary"),
            contacts[0] if contacts and isinstance(contacts[0], dict) else {},
        )
        contact_name = primary_contact.get("fullName", "")
        contact_email = primary_contact.get("email", "")
        contact_phone = primary_contact.get("phone", "")
        contact_title = primary_contact.get("title", "")

        # ── Award info (populated when type is "Award Notice") ──
        award = raw.get("award") or {}
        award_date = self._parse_date(award.get("date")) if award else None
        award_number = award.get("number", "") if award else ""
        award_amount_raw = award.get("amount") if award else None
        award_amount = None
        if award_amount_raw is not None:
            try:
                award_amount = float(str(award_amount_raw).replace(",", "").replace("$", ""))
            except (ValueError, TypeError):
                award_amount = None

        awardee = award.get("awardee") or {} if award else {}
        awardee_name = awardee.get("name", "") if awardee else ""
        awardee_uei = awardee.get("ueiSAM", "") if awardee else ""
        awardee_loc = awardee.get("location") or {} if awardee else {}
        awardee_city = awardee_loc.get("city", "") if awardee_loc else ""
        awardee_state = awardee_loc.get("state", "") if awardee_loc else ""

        return {
            "title": title,
            "description": description,
            "agency": agency,
            "agency_code": agency_code,
            "naics_codes": naics_codes,
            "set_aside": set_aside,
            "set_aside_code": set_aside_code,
            "opp_type": opp_type,
            "posted_date": posted_date,
            "close_date": close_date,
            "sol_number": sol_number,
            "source_url": source_url,
            "classification_code": classification_code or None,
            "department": department or None,
            "sub_tier": sub_tier or None,
            "office": office or None,
            "organization_type": organization_type or None,
            "full_parent_path_code": full_parent_code or None,
            "pop_city": pop_city or None,
            "pop_state": pop_state or None,
            "pop_country": pop_country or None,
            "pop_zip": pop_zip or None,
            "office_city": office_city or None,
            "office_state": office_state or None,
            "office_zip": office_zip or None,
            "office_country": office_country or None,
            "contact_name": contact_name or None,
            "contact_email": contact_email or None,
            "contact_phone": contact_phone or None,
            "contact_title": contact_title or None,
            "award_date": award_date,
            "award_number": award_number or None,
            "award_amount": award_amount,
            "awardee_name": awardee_name or None,
            "awardee_uei": awardee_uei or None,
            "awardee_city": awardee_city or None,
            "awardee_state": awardee_state or None,
            "base_type": base_type or None,
            "archive_type": archive_type or None,
            "archive_date": archive_date,
            "is_active": is_active,
            "sam_ui_link": sam_ui_link or None,
            "additional_info_link": additional_info_link or None,
            "resource_links": resource_links,
        }

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
