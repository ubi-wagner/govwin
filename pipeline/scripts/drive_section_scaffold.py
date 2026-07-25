"""Drive-test P6.2 — SectionDrafterArchetype._match_section_grain against the real DB.

3 scenarios on the house tenant's seeded starter sections:
  1) match      — a real section title returns the section + its guidance skeleton
  2) no-match   — an unknown title returns matched=False, empty skeleton
  3) isolation  — the same title under a different tenant returns nothing (tenant-scoped)

  DATABASE_URL=postgres://claude:claude@127.0.0.1:5433/govtech_intel python3 scripts/drive_section_scaffold.py
"""
import asyncio
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import asyncpg  # noqa: E402
from agents.archetypes.section_drafter import SectionDrafterArchetype  # noqa: E402

HOUSE = os.environ.get("HOUSE_TENANT_ID", "db20bc0f-6322-4fed-8b99-f45c9b4d7d08")
NOBODY = "00000000-0000-0000-0000-0000000000ff"  # a valid uuid with no starter sections


async def main() -> None:
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    agent = SectionDrafterArchetype()
    try:
        title = await conn.fetchval(
            """
            SELECT title FROM library_atoms
            WHERE tenant_id = $1 AND grain = 'section'
              AND id IN (SELECT atom_id FROM atom_tags WHERE dimension = 'collection' AND value = 'system_starter')
            ORDER BY title LIMIT 1
            """,
            uuid.UUID(HOUSE),
        )
        assert title, "house tenant has no starter section grains — seed first"

        # 1) match
        r1 = await agent._match_section_grain(conn, HOUSE, title)
        s1 = bool(r1.get("matched")) and bool(r1.get("section_title")) \
            and len(r1.get("skeleton", [])) >= 1 and any(x.get("guidance") for x in r1["skeleton"])

        # 2) no-match
        r2 = await agent._match_section_grain(conn, HOUSE, "Zzz Nonexistent Section 9137")
        s2 = r2.get("matched") is False and r2.get("skeleton") == []

        # 3) tenant isolation — same title, a tenant with no starter grains → no leak
        r3 = await agent._match_section_grain(conn, NOBODY, title)
        s3 = r3.get("matched") is False

        print(f'1 match     : title="{title}" matched={r1.get("matched")} skeleton={len(r1.get("skeleton", []))}  {"OK" if s1 else "FAIL"}')
        print(f'2 no-match  : matched={r2.get("matched")} skeleton={len(r2.get("skeleton", []))}  {"OK" if s2 else "FAIL"}')
        print(f'3 isolation : other-tenant matched={r3.get("matched")}  {"OK" if s3 else "FAIL"}')
        ok = s1 and s2 and s3
        print("PASS 3/3 — section_drafter grounds on the starter scaffold" if ok else "FAIL")
        sys.exit(0 if ok else 1)
    finally:
        await conn.close()


asyncio.run(main())
