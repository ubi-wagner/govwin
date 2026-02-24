"""
End-to-end test suite for the Python pipeline worker.

Tests the SAM.gov ingester (stub mode), scoring engine, and job queue
against the live test database with seed data.

Usage:
  DATABASE_URL=postgresql://govwin:govwin_test_pass@localhost:5432/govwin_test \
  USE_STUB_DATA=true \
  python3 scripts/test_pipeline.py
"""

import asyncio
import json
import os
import sys

# Add pipeline source to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'pipeline', 'src'))

import asyncpg

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://govwin:govwin_test_pass@localhost:5432/govwin_test"
)

# Force stub mode for testing
os.environ["USE_STUB_DATA"] = "true"

passed = 0
failed = 0


def assert_true(description: str, condition: bool):
    global passed, failed
    if condition:
        passed += 1
        print(f"  PASS: {description}")
    else:
        failed += 1
        print(f"  FAIL: {description}")


def assert_equals(description: str, expected, actual):
    global passed, failed
    if expected == actual:
        passed += 1
        print(f"  PASS: {description}")
    else:
        failed += 1
        print(f"  FAIL: {description} — expected {expected!r}, got {actual!r}")


async def test_sam_gov_ingester(conn: asyncpg.Connection):
    """Test the SAM.gov ingester in stub mode."""
    print("\n" + "=" * 60)
    print(" TEST: SAM.gov Ingester (Stub Mode)")
    print("=" * 60)

    from ingest.sam_gov import SamGovIngester, _generate_stub_opportunities

    # Test 1: Stub data generation
    stub_opps = _generate_stub_opportunities()
    assert_true("stub generates 5 opportunities", len(stub_opps) == 5)

    # Test 2: Verify stub data matches SAM.gov API field names exactly
    opp = stub_opps[0]
    required_fields = [
        "noticeId", "title", "solicitationNumber",
        "fullParentPathName", "fullParentPathCode",
        "postedDate", "type", "typeOfSetAside",
        "typeOfSetAsideDescription", "responseDeadLine",
        "naicsCode", "active", "uiLink", "description",
    ]
    for field in required_fields:
        assert_true(f"stub opp[0] has field: {field}", field in opp)

    # Test 3: Verify date format matches SAM.gov
    assert_true(
        "postedDate is YYYY-MM-DD format",
        len(opp["postedDate"]) == 10 and opp["postedDate"][4] == "-"
    )
    assert_true(
        "responseDeadLine is ISO 8601 with timezone",
        "T" in opp["responseDeadLine"] and "-05:00" in opp["responseDeadLine"]
    )

    # Test 4: Verify notice types match SAM.gov vocabulary
    valid_types = {"Solicitation", "Combined Synopsis/Solicitation", "Sources Sought", "Presolicitation", "Award Notice", "Special Notice"}
    for s in stub_opps:
        assert_true(
            f"notice type '{s['type']}' is valid SAM.gov type",
            s["type"] in valid_types
        )

    # Test 5: Verify set-aside codes match SAM.gov vocabulary
    valid_set_asides = {"SBA", "SDVOSBA", "WOSB", "HZC", "8A", "8AN", "VSA", None}
    for s in stub_opps:
        assert_true(
            f"set-aside '{s.get('typeOfSetAside')}' is valid",
            s.get("typeOfSetAside") in valid_set_asides
        )

    # Test 6: Verify NAICS codes are valid format (6-digit string)
    for s in stub_opps:
        code = s.get("naicsCode")
        assert_true(
            f"naicsCode '{code}' is 6-digit string",
            code is not None and len(code) == 6 and code.isdigit()
        )

    # Test 7: Verify pointOfContact is array
    for s in stub_opps:
        assert_true(
            f"pointOfContact is list for '{s['noticeId']}'",
            isinstance(s.get("pointOfContact", []), list)
        )

    # Test 8: Verify uiLink matches SAM.gov URL pattern
    for s in stub_opps:
        assert_true(
            f"uiLink starts with sam.gov for '{s['noticeId']}'",
            s["uiLink"].startswith("https://sam.gov/opp/")
        )

    # Test 9: Run the ingester against the test database
    ingester = SamGovIngester(conn)
    result = await ingester.run({})
    assert_true("ingester.run returns dict", isinstance(result, dict))
    assert_equals("opportunities_fetched", 5, result["opportunities_fetched"])
    assert_equals("opportunities_new", 5, result["opportunities_new"])
    assert_true("no errors", len(result["errors"]) == 0)

    # Test 10: Verify opportunities were inserted into DB
    count = await conn.fetchval(
        "SELECT COUNT(*) FROM opportunities WHERE source_id LIKE 'stub_%'"
    )
    assert_equals("5 stub opps in DB", 5, count)

    # Test 11: Verify field mapping from SAM.gov → our schema
    row = await conn.fetchrow(
        "SELECT * FROM opportunities WHERE source_id = 'stub_001_cloud_migration_disa'"
    )
    assert_true("stub opp exists in DB", row is not None)
    assert_equals("source is sam_gov", "sam_gov", row["source"])
    assert_true("title populated", len(row["title"]) > 10)
    assert_true("agency populated", "DEPT OF DEFENSE" in row["agency"])
    assert_equals("agency_code extracted", "097", row["agency_code"])
    assert_true("naics_codes is array", isinstance(row["naics_codes"], list))
    assert_equals("naics_codes[0]", "541512", row["naics_codes"][0])
    assert_equals("set_aside_code", "SDVOSBA", row["set_aside_code"])
    assert_true("set_aside_type populated", "SDVOSB" in (row["set_aside_type"] or ""))
    assert_equals("opportunity_type", "solicitation", row["opportunity_type"])
    assert_true("source_url is SAM.gov link", row["source_url"].startswith("https://sam.gov/opp/"))
    assert_true("raw_data is JSONB with noticeId", "noticeId" in json.loads(row["raw_data"]) if isinstance(row["raw_data"], str) else "noticeId" in row["raw_data"])
    assert_true("posted_date not null", row["posted_date"] is not None)
    assert_true("close_date not null", row["close_date"] is not None)

    # Test 12: Run again — should not create duplicates (content_hash dedup)
    result2 = await ingester.run({})
    assert_equals("second run fetched", 5, result2["opportunities_fetched"])
    # Should be updates, not new
    count2 = await conn.fetchval(
        "SELECT COUNT(*) FROM opportunities WHERE source_id LIKE 'stub_%'"
    )
    assert_equals("still 5 stub opps (no dupes)", 5, count2)


async def test_scoring_engine(conn: asyncpg.Connection):
    """Test the scoring engine against seed tenants and opportunities."""
    print("\n" + "=" * 60)
    print(" TEST: Scoring Engine")
    print("=" * 60)

    from scoring.engine import ScoringEngine

    engine = ScoringEngine(conn)

    # Score all active tenants against stub opportunities
    result = await engine.score_all_tenants()
    assert_true("scoring returns dict", isinstance(result, dict))
    assert_true("tenants_scored >= 2", result["tenants_scored"] >= 2)

    # Verify TechForward got scored against stub opps
    tf_scores = await conn.fetch(
        """SELECT total_score, matched_keywords, matched_domains, pursuit_recommendation
           FROM tenant_opportunities
           WHERE tenant_id = 'a1111111-1111-1111-1111-111111111111'
             AND opportunity_id IN (
               SELECT id FROM opportunities WHERE source_id LIKE 'stub_%'
             )
           ORDER BY total_score DESC"""
    )
    assert_true("TechForward has scores for stub opps", len(tf_scores) > 0)
    assert_true(
        "top stub score > 50 (cloud migration should score high)",
        tf_scores[0]["total_score"] > 50
    )

    # Verify ClearPath got scored for the PMO stub opp
    cp_scores = await conn.fetch(
        """SELECT total_score
           FROM tenant_opportunities
           WHERE tenant_id = 'b2222222-2222-2222-2222-222222222222'
             AND opportunity_id IN (
               SELECT id FROM opportunities WHERE source_id LIKE 'stub_%'
             )"""
    )
    assert_true("ClearPath has scores for stub opps", len(cp_scores) > 0)


async def test_job_queue(conn: asyncpg.Connection):
    """Test the pipeline job queue system."""
    print("\n" + "=" * 60)
    print(" TEST: Job Queue (dequeue_job)")
    print("=" * 60)

    # Insert a test job
    await conn.execute("""
        INSERT INTO pipeline_jobs (source, run_type, priority, triggered_by, parameters)
        VALUES ('test_source', 'test_run', 5, 'test_pipeline.py', '{}')
    """)

    # Dequeue it
    row = await conn.fetchrow("SELECT * FROM dequeue_job($1)", "test-worker-py")
    assert_true("dequeue returns a job", row is not None and row["id"] is not None)
    assert_equals("dequeued source", "test_source", row["source"])
    assert_equals("dequeued status", "running", row["status"])
    assert_equals("worker_id set", "test-worker-py", row["worker_id"])

    # Complete the job
    await conn.execute(
        "UPDATE pipeline_jobs SET status = 'completed', completed_at = NOW() WHERE id = $1",
        row["id"]
    )

    # Dequeue again — should get NULL
    row2 = await conn.fetchrow("SELECT * FROM dequeue_job($1)", "test-worker-py")
    assert_true("second dequeue returns null id", row2["id"] is None)


async def test_rate_limit(conn: asyncpg.Connection):
    """Test the rate limit checking function."""
    print("\n" + "=" * 60)
    print(" TEST: Rate Limit (get_remaining_quota)")
    print("=" * 60)

    row = await conn.fetchrow("SELECT * FROM get_remaining_quota('sam_gov')")
    assert_true("rate limit row returned", row is not None)
    assert_true("can_proceed is true (no usage yet)", row["can_proceed"] is True)
    assert_true("remaining > 0", row["remaining"] > 0)


async def main():
    print("=" * 60)
    print(" GOVWIN PIPELINE — End-to-End Test Suite")
    print("=" * 60)
    print(f" Database: {DATABASE_URL.split('@')[1] if '@' in DATABASE_URL else DATABASE_URL}")
    print(f" Stub mode: {os.environ.get('USE_STUB_DATA')}")

    conn = await asyncpg.connect(DATABASE_URL)

    try:
        await test_sam_gov_ingester(conn)
        await test_scoring_engine(conn)
        await test_job_queue(conn)
        await test_rate_limit(conn)
    finally:
        await conn.close()

    print("\n" + "=" * 60)
    print(f" RESULTS: {passed} passed, {failed} failed")
    print("=" * 60)

    if failed > 0:
        sys.exit(1)
    else:
        print(" ALL TESTS PASSED")
        sys.exit(0)


if __name__ == "__main__":
    asyncio.run(main())
