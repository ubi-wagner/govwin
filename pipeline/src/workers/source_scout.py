"""
Source Scout pipeline worker.

Crawls source_profiles with auto_crawl_enabled, compares content hashes
for each annotated region, calls Claude for analysis on changed regions,
and emits events for downstream workflows.

Designed to run as a pipeline_jobs kind='scout_source' handler.
Can scout a single source (by metadata.source_id) or all due sources.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

import asyncpg
import httpx

from events import emit_event

log = logging.getLogger("pipeline.workers.source_scout")

# Claude model for analysis
CLAUDE_MODEL = "claude-sonnet-4-20250514"
MAX_CONTENT_LENGTH = 50_000
MAX_PROMPT_CONTENT = 12_000
MAX_PREVIOUS_CONTENT = 8_000

# Lazy-loaded anthropic client — tests override via ANTHROPIC_CLIENT attribute
ANTHROPIC_CLIENT = None


def _content_hash(text: str) -> str:
    """SHA-256 hash of text content for change detection."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _html_to_text(html: str) -> str:
    """Strip HTML tags to plain text for hashing and comparison."""
    import re

    text = re.sub(r"<script[^>]*>[\s\S]*?</script>", "", html, flags=re.IGNORECASE)
    text = re.sub(r"<style[^>]*>[\s\S]*?</style>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


async def _fetch_page(url: str) -> tuple[str, Optional[str]]:
    """Fetch page HTML via httpx. Returns (html, warning_or_none)."""
    async with httpx.AsyncClient(
        timeout=30.0,
        follow_redirects=True,
        headers={
            "User-Agent": "GovWin-SourceScout/1.0 (Federal opportunity monitoring)",
            "Accept": "text/html,application/xhtml+xml",
        },
    ) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        html = resp.text

    # Heuristic: JS-only page detection
    import re

    body_match = re.search(r"<body[^>]*>([\s\S]*?)</body>", html, re.IGNORECASE)
    body_text = re.sub(r"<[^>]+>", "", body_match.group(1)).strip() if body_match else ""
    warning = None
    if len(body_text) < 100 and "__NEXT_DATA__" in html:
        warning = (
            "This site appears to require JavaScript rendering. "
            "Content may be incomplete."
        )
    return html, warning


async def _analyze_with_claude(
    source_name: str,
    region_name: str,
    content_context: str,
    previous_text: Optional[str],
    current_text: str,
) -> Optional[dict[str, Any]]:
    """Ask Claude to analyze a region for changes. Returns parsed analysis or None."""
    global ANTHROPIC_CLIENT

    try:
        import anthropic
    except ImportError:
        log.warning("anthropic SDK not available — skipping Claude analysis")
        return None

    if ANTHROPIC_CLIENT is None:
        ANTHROPIC_CLIENT = anthropic.AsyncAnthropic()

    previous_section = (
        f"<previous_content>\n{previous_text[:MAX_PREVIOUS_CONTENT]}\n</previous_content>"
        if previous_text
        else "<previous_content>No previous snapshot available — this is the first scan.</previous_content>"
    )

    prompt = f"""You are analyzing a government opportunity website for changes.

Source: {source_name}
Region: "{region_name}"
Admin guidance: "{content_context or 'No specific guidance provided.'}"

{previous_section}

<current_content>
{current_text[:MAX_PROMPT_CONTENT]}
</current_content>

Analyze the current content for this region. Respond in JSON only:

{{
  "changed": true/false,
  "summary": "Brief description of what changed or 'No changes detected'",
  "severity": "info|low|medium|high|critical",
  "extracted_opportunities": [
    {{
      "title": "...",
      "agency": "...",
      "deadline": "...",
      "url": "...",
      "description": "..."
    }}
  ]
}}

Severity guide:
- info: no meaningful change, cosmetic only
- low: minor text updates, no new opportunities
- medium: updated deadlines or modified requirements
- high: new opportunities or solicitations detected
- critical: imminent deadlines or major program changes

Only include extracted_opportunities if you identify specific, actionable opportunities."""

    try:
        response = await ANTHROPIC_CLIENT.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )

        text = response.content[0].text if response.content else ""
        tokens_used = (response.usage.input_tokens or 0) + (response.usage.output_tokens or 0)

        import re

        json_match = re.search(r"\{[\s\S]*\}", text)
        if not json_match:
            return {
                "changed": False,
                "summary": "Claude response did not contain valid JSON",
                "severity": "info",
                "extracted_opportunities": [],
                "model": response.model,
                "tokens_used": tokens_used,
            }

        parsed = json.loads(json_match.group(0))
        return {
            "changed": parsed.get("changed", False),
            "summary": parsed.get("summary", "No summary provided"),
            "severity": parsed.get("severity", "info"),
            "extracted_opportunities": parsed.get("extracted_opportunities", []),
            "model": response.model,
            "tokens_used": tokens_used,
        }
    except Exception as e:
        log.error("Claude analysis failed: %s", e)
        return None


async def scout_source(
    conn: asyncpg.Connection,
    source_id: str,
) -> dict[str, Any]:
    """Scout a single source profile for changes.

    Returns a result dict with counts of snapshots, diffs, and changes.
    """
    # Load source profile
    profile = await conn.fetchrow(
        """
        SELECT id, name, base_url, bookmark_url, is_active
        FROM source_profiles
        WHERE id = $1
        """,
        source_id,
    )
    if not profile:
        log.warning("source profile not found: %s", source_id)
        return {"error": f"source profile not found: {source_id}"}

    # Load active regions
    regions = await conn.fetch(
        """
        SELECT id, name, selector_hint, content_context, region_type, sample_text
        FROM source_regions
        WHERE profile_id = $1 AND is_active = true
        ORDER BY created_at
        """,
        source_id,
    )

    warnings: list[str] = []

    # Fetch the page
    fetch_url = profile["bookmark_url"] or profile["base_url"]
    try:
        page_html, warning = await _fetch_page(fetch_url)
        if warning:
            warnings.append(warning)
    except Exception as e:
        log.error("failed to fetch %s: %s", fetch_url, e)
        return {"error": f"failed to fetch page: {e}", "warnings": warnings}

    full_page_text = _html_to_text(page_html)

    # Process regions (or full page if no regions)
    snapshots_created = 0
    diffs_found = 0
    meaningful_changes = 0
    region_results: list[dict[str, Any]] = []

    if not regions:
        regions = [
            {
                "id": None,
                "name": "Full Page",
                "selector_hint": None,
                "content_context": "Full page content",
                "region_type": "content",
                "sample_text": None,
            }
        ]
        warnings.append("No active regions defined — scanning full page")

    for region in regions:
        region_id = region["id"]
        region_text = full_page_text
        hash_val = _content_hash(region_text)

        # Get last snapshot
        if region_id:
            last_snapshot = await conn.fetchrow(
                """
                SELECT id, content_hash, content_text
                FROM source_snapshots
                WHERE profile_id = $1 AND region_id = $2
                ORDER BY captured_at DESC
                LIMIT 1
                """,
                source_id,
                region_id,
            )
        else:
            last_snapshot = await conn.fetchrow(
                """
                SELECT id, content_hash, content_text
                FROM source_snapshots
                WHERE profile_id = $1 AND region_id IS NULL
                ORDER BY captured_at DESC
                LIMIT 1
                """,
                source_id,
            )

        hash_changed = not last_snapshot or last_snapshot["content_hash"] != hash_val

        # Create new snapshot
        new_snapshot = await conn.fetchrow(
            """
            INSERT INTO source_snapshots
              (profile_id, region_id, content_hash, content_text)
            VALUES ($1, $2, $3, $4)
            RETURNING id
            """,
            source_id,
            region_id,
            hash_val,
            region_text[:MAX_CONTENT_LENGTH],
        )
        snapshots_created += 1
        new_snapshot_id = new_snapshot["id"]

        if not hash_changed:
            region_results.append({
                "regionId": str(region_id) if region_id else "full-page",
                "regionName": region["name"],
                "changed": False,
                "summary": "No changes detected (content hash match)",
                "severity": "info",
            })
            continue

        # Hash changed — analyze with Claude
        analysis = await _analyze_with_claude(
            profile["name"],
            region["name"],
            region["content_context"] or "",
            (last_snapshot["content_text"] if last_snapshot else None) or region["sample_text"],
            region_text,
        )

        is_meaningful = analysis["changed"] if analysis else hash_changed
        summary = analysis["summary"] if analysis else "Content hash changed but Claude analysis unavailable"
        severity = analysis["severity"] if analysis else "low"
        # source_diffs.severity is CHECK-constrained; an LLM-returned value outside the
        # set would abort the whole scout run at INSERT (not per-row wrapped). Clamp it.
        if severity not in ("info", "low", "medium", "high", "critical"):
            severity = "medium"
        extracted_opps = analysis.get("extracted_opportunities", []) if analysis else []

        # Create diff record
        await conn.execute(
            """
            INSERT INTO source_diffs
              (profile_id, region_id, prev_snapshot_id, next_snapshot_id,
               is_meaningful, summary, extracted_opportunities, severity,
               claude_model, claude_tokens_used)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
            """,
            source_id,
            region_id,
            last_snapshot["id"] if last_snapshot else None,
            new_snapshot_id,
            is_meaningful,
            summary,
            json.dumps(extracted_opps),
            severity,
            analysis.get("model") if analysis else None,
            analysis.get("tokens_used") if analysis else None,
        )

        diffs_found += 1
        if is_meaningful:
            meaningful_changes += 1

        region_results.append({
            "regionId": str(region_id) if region_id else "full-page",
            "regionName": region["name"],
            "changed": is_meaningful,
            "summary": summary,
            "severity": severity,
            "extractedOpportunities": extracted_opps,
        })

    # Update last_crawl_at
    await conn.execute(
        "UPDATE source_profiles SET last_crawl_at = now(), updated_at = now() WHERE id = $1",
        source_id,
    )

    # Emit events
    await emit_event(
        conn,
        namespace="finder",
        type="source.scouted",
        payload={
            "sourceId": str(source_id),
            "sourceName": profile["name"],
            "snapshotsCreated": snapshots_created,
            "diffsFound": diffs_found,
            "meaningfulChanges": meaningful_changes,
            "warnings": warnings,
        },
    )

    if meaningful_changes > 0:
        await emit_event(
            conn,
            namespace="finder",
            type="source.change_detected",
            payload={
                "sourceId": str(source_id),
                "sourceName": profile["name"],
                "meaningfulChanges": meaningful_changes,
                "regionResults": [r for r in region_results if r.get("changed")],
            },
        )

    result = {
        "sourceId": str(source_id),
        "sourceName": profile["name"],
        "snapshotsCreated": snapshots_created,
        "diffsFound": diffs_found,
        "meaningfulChanges": meaningful_changes,
        "warnings": warnings,
    }

    log.info(
        "scout completed for %s: snapshots=%d diffs=%d meaningful=%d",
        profile["name"],
        snapshots_created,
        diffs_found,
        meaningful_changes,
    )

    return result


async def scout_all_due(conn: asyncpg.Connection) -> dict[str, Any]:
    """Scout all source profiles where auto_crawl is enabled and crawl is due.

    A crawl is due when last_crawl_at is NULL or older than the crawl_cron
    interval would dictate. For V1, we use a simple 24-hour check.
    """
    profiles = await conn.fetch(
        """
        SELECT id FROM source_profiles
        WHERE auto_crawl_enabled = true
          AND is_active = true
          AND (last_crawl_at IS NULL
               OR last_crawl_at < now() - INTERVAL '23 hours')
        ORDER BY last_crawl_at ASC NULLS FIRST
        """
    )

    results = []
    for profile in profiles:
        try:
            result = await scout_source(conn, profile["id"])
            results.append(result)
        except Exception as e:
            log.error("scout failed for source %s: %s", profile["id"], e)
            results.append({"sourceId": str(profile["id"]), "error": str(e)})

    return {
        "sourcesChecked": len(profiles),
        "results": results,
    }
