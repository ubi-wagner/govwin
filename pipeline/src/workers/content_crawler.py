"""
================================================================================
Content / Opportunity Crawler  (the WORKER that feeds the scouts)
================================================================================

Reads enabled `scout_sources` (org websites / social handles / RSS), fetches candidate
items via a PLUGGABLE fetcher, dedups, and writes them to `scout_findings` — plus a
`scout_runs` history row (role scout|watcher, kind='crawl') carrying the run's outcome.
The agents READ the findings: content_curator (reshare drafts) and opportunity_scout
(triage leads). This is the content/opportunity analog of how the ingesters populate
`opportunities`.

ARCHITECTURE (same as everything else):
  - Runs on the SHARED cron: a scheduled `library:content.crawl_requested` event → an ACTION
    step calls crawl_all(). One time manager, one audit trail (scout_runs), forward-only.
  - The FETCHER is injected. On deploy it is an RSS/HTML/social fetcher making outbound HTTPS
    via the agent proxy (respecting robots + rate limits) or an org's social API; in tests it's
    a stub. Keeping fetch pluggable means the DB write/dedup/history loop is testable without
    network, and new source kinds (mailing lists, etc.) are a new fetcher, not a new pipeline.
  - Idempotent: dedup_hash(source,url,title) + ON CONFLICT DO NOTHING, so re-crawls don't
    duplicate. Findings start status='new'; their OUTCOME (reposted/pursued/dismissed) is set
    downstream by the curator/scout landing.
================================================================================
"""
import hashlib
import json
import logging

logger = logging.getLogger("pipeline.workers.content_crawler")


def dedup_hash(source_id, url: str | None, title: str | None) -> str:
    """Stable idempotency key for a finding."""
    return hashlib.sha256(f"{source_id}|{url or ''}|{title or ''}".encode("utf-8")).hexdigest()


async def crawl_source(conn, source: dict, fetch_fn) -> dict:
    """Crawl one source: open a scout_runs row, fetch candidate items, upsert findings
    (idempotent), then finalize the run with counts + outcome. `fetch_fn(source)` returns a
    list of dicts: {title, url, snippet, author, published_at, kind}. Never raises — a failed
    source is recorded as a failed run and the crawl continues."""
    purpose = source.get("purpose", "content")
    role = "watcher" if purpose == "opportunity" else "scout"
    run_id = await conn.fetchval(
        """INSERT INTO scout_runs (role, kind, source_id, triggered_by, started_at, status)
           VALUES ($1, 'crawl', $2, 'cron', now(), 'running') RETURNING id""",
        role, source["id"],
    )
    found = new = 0
    error = None
    status = "completed"
    try:
        items = await fetch_fn(source)
        for it in (items or []):
            found += 1
            dh = dedup_hash(source["id"], it.get("url"), it.get("title"))
            inserted = await conn.fetchrow(
                """INSERT INTO scout_findings
                       (source_id, run_id, purpose, kind, title, url, snippet, author, published_at, dedup_hash, raw)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
                   ON CONFLICT (dedup_hash) WHERE dedup_hash IS NOT NULL DO NOTHING
                   RETURNING id""",
                source["id"], run_id, purpose, it.get("kind"), it.get("title"), it.get("url"),
                it.get("snippet"), it.get("author"), it.get("published_at"), dh, json.dumps(it),
            )
            if inserted:
                new += 1
    except Exception as e:
        error = str(e)[:300]
        status = "failed"
        logger.warning("crawl_source %s failed: %s", source.get("name"), e)

    await conn.execute(
        """UPDATE scout_runs
           SET finished_at = now(), found_count = $1, new_count = $2, status = $3, error = $4, outcome = $5
           WHERE id = $6""",
        found, new, status, error, f"{new} new / {found} found", run_id,
    )
    try:
        await conn.execute("UPDATE scout_sources SET last_crawled_at = now() WHERE id = $1", source["id"])
    except Exception:
        pass
    return {"run_id": str(run_id), "source": source.get("name"), "found": found, "new": new, "status": status}


async def crawl_all(conn, fetch_fn) -> list[dict]:
    """Crawl every enabled scout_source and return a per-source summary. Called from a
    scheduled ACTION step on the shared cron."""
    sources = await conn.fetch(
        "SELECT id, name, url, kind, purpose FROM scout_sources WHERE enabled = true ORDER BY name"
    )
    summary = []
    for s in sources:
        summary.append(await crawl_source(conn, dict(s), fetch_fn))
    logger.info("content crawler: %d source(s), %d new finding(s)",
                len(summary), sum(x["new"] for x in summary))
    return summary


async def _null_fetch(_source) -> list[dict]:
    """Default fetcher — no network. Deploy injects a real RSS/HTML/social fetcher."""
    return []
