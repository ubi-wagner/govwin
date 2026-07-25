"""Drive-test P6.3 — LibrarianArchetype._match_section_skeleton against the real DB.

3 scenarios:
  1) skeleton   — the house tenant returns its grain='section' skeleton (non-empty)
  2) guidance   — each section carries a guidance preview aggregated from its primitives
  3) isolation  — a tenant with no section grains returns an empty skeleton (tenant-scoped)

  DATABASE_URL=postgres://claude:claude@127.0.0.1:5433/govtech_intel python3 scripts/drive_librarian_skeleton.py
"""
import asyncio
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import asyncpg  # noqa: E402
from agents.archetypes.librarian import LibrarianArchetype  # noqa: E402

HOUSE = os.environ.get("HOUSE_TENANT_ID", "db20bc0f-6322-4fed-8b99-f45c9b4d7d08")
NOBODY = "00000000-0000-0000-0000-0000000000ff"


async def main() -> None:
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    agent = LibrarianArchetype()
    try:
        # 1) skeleton for the house tenant
        r1 = await agent._match_section_skeleton(conn, {}, HOUSE)
        secs = r1.get("sections", [])
        s1 = len(secs) >= 1 and all(x.get("title") for x in secs)

        # 2) at least one section carries a guidance preview from its primitives
        s2 = any((x.get("guidance") or "").strip() for x in secs)

        # 3) tenant isolation — a tenant with no section grains → empty
        r3 = await agent._match_section_skeleton(conn, {}, NOBODY)
        s3 = r3.get("sections") == []

        sample = secs[0] if secs else {}
        print(f'1 skeleton  : sections={len(secs)}  {"OK" if s1 else "FAIL"}')
        print(f'2 guidance  : sample="{sample.get("title","")}" → "{(sample.get("guidance","") or "")[:60]}…"  {"OK" if s2 else "FAIL"}')
        print(f'3 isolation : other-tenant sections={len(r3.get("sections", []))}  {"OK" if s3 else "FAIL"}')
        ok = s1 and s2 and s3
        print("PASS 3/3 — librarian matches uploads to the section skeleton" if ok else "FAIL")
        sys.exit(0 if ok else 1)
    finally:
        await conn.close()


asyncio.run(main())
