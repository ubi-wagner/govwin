"""Re-run the AI shred on solicitations already in the database.

WHY THIS EXISTS. The shred normally runs once, as the `shred_document` step of OnRfpUploaded,
triggered by finder.rfp.uploaded when a curator uploads. There is no product path to re-run it — and
after a shredder fix there has to be a way to prove the fix against the documents that broke it,
without re-uploading a 3 MB PDF through a browser and getting a NEW solicitation each time.

It calls the same `shred_solicitation` the workflow action calls, with the same Anthropic client
construction, so what runs here is the production path and not a reimplementation of it.

    source scripts/sandbox-env.sh
    cd pipeline && PYTHONPATH=src python3 scripts/reshred.py <solicitation-id> [<solicitation-id>…]

Operator tool. It re-runs an idempotent step against rows that already exist; it creates nothing.
"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import asyncpg  # noqa: E402


async def main(ids: list[str]) -> int:
    dsn = os.environ.get("DATABASE_URL_OWNER") or os.environ.get("DATABASE_URL")
    if not dsn:
        print("DATABASE_URL_OWNER not set — source scripts/sandbox-env.sh")
        return 2

    from anthropic import AsyncAnthropic

    from shredder.runner import shred_solicitation

    client = AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
    conn = await asyncpg.connect(dsn)
    failures = 0
    try:
        for sol in ids:
            chars = await conn.fetchval(
                "SELECT length(coalesce(full_text,'')) FROM curated_solicitations WHERE id = $1::uuid",
                sol,
            )
            print(f"\n── {sol}  ({chars or 0:,} chars of full_text)")
            try:
                result = await shred_solicitation(conn=conn, solicitation_id=sol, anthropic_client=client)
            except Exception as e:
                print(f"   RAISED {type(e).__name__}: {e}")
                failures += 1
                continue
            print(f"   status={result.get('status')} "
                  f"sections={result.get('sections')} "
                  f"compliance={result.get('compliance_matches')}")
            # The provenance the fix exists to produce — printed, not assumed.
            blob = await conn.fetchval(
                "SELECT ai_extracted FROM curated_solicitations WHERE id = $1::uuid", sol
            )
            if isinstance(blob, str):
                import json
                blob = json.loads(blob)
            src = (blob or {}).get("source_excerpt")
            if src:
                print(f"   EXCERPTED {src['excerpt_chars']:,} of {src['source_chars']:,} chars "
                      f"({100 * src['coverage']:.1f}%) across {src['span_count']} passages")
                print(f"   covered={src['topics_covered']} missing={src['topics_missing']}")
            else:
                print("   whole document shredded (fits the section-call budget)")
            if (blob or {}).get("section_extraction_skipped"):
                print(f"   SKIPPED: {blob['section_extraction_skipped']}")
    finally:
        await conn.close()
    return 1 if failures else 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)
    raise SystemExit(asyncio.run(main(sys.argv[1:])))
