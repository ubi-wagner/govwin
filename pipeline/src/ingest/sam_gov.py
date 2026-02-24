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

        if not SAM_API_KEY:
            result["errors"].append("SAM_GOV_API_KEY not set")
            log.warning("SAM_GOV_API_KEY not configured, skipping ingest")
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
        description = raw.get("description", {})
        if isinstance(description, dict):
            description = description.get("body", "")

        agency = raw.get("fullParentPathName", "")
        agency_code = raw.get("organizationCode", "")

        naics = raw.get("naicsCode", "")
        naics_codes = [naics] if naics else []

        set_aside = raw.get("typeOfSetAsideDescription", "")
        set_aside_code = raw.get("typeOfSetAside", "")

        opp_type_map = {"o": "solicitation", "k": "sources_sought", "p": "presolicitation"}
        opp_type = opp_type_map.get(raw.get("type", ""), raw.get("type", "other"))

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
                return datetime.strptime(date_str.strip(), fmt).replace(tzinfo=timezone.utc)
            except (ValueError, AttributeError):
                continue
        return None
