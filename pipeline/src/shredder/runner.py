"""Shredder orchestrator — Phase 1 §D4.

Takes a `curated_solicitations.id`, fetches any linked documents from
S3, extracts their text, calls Claude twice per solicitation (section
extraction + compliance extraction per section), and writes the
structured output back to:

  - curated_solicitations.ai_extracted  (full JSON from both prompts)
  - curated_solicitations.namespace     (computed cross-cycle key)
  - curated_solicitations.status        ('ai_analyzed' on success,
                                          'shredder_failed' on unrecoverable error)
  - solicitation_compliance.<columns>    (named columns per compliance_mapping)
  - solicitation_compliance.custom_variables  (unmapped long tail)

Emits finder.rfp.shredding.start and .end events with correlated
parent_event_id so the admin events browser can reconstruct the full
job. Budget enforcement happens at two points:

  1. Text extraction — hard 200K char cap per document (extractor.py)
  2. Token budget — hard 50K total input token cap per run; raises
     ShredderBudgetError and flips status to 'shredder_failed'

The runner is idempotent: re-running on the same solicitation_id
overwrites ai_extracted wholesale and UPSERTs the solicitation_compliance
row by solicitation_id. verified_by STAYS NULL — the shredder never
claims human verification.
"""
from __future__ import annotations

import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import asyncpg

from errors import ShredderBudgetError
from safe_skip import MAX_MODEL_RETRIES, skip_evidence
from shredder.compliance_mapping import split_matches
from shredder.extractor import (
    MAX_CHARS_PER_DOCUMENT,
    cap_source_text,
    extract_text_from_pdf,
    pdf_page_count,
)
from shredder.namespace import compute_namespace_key
from shredder.section_locate import TOPICS, locate_sections

log = logging.getLogger("pipeline.shredder.runner")

# Absolute cap on total input tokens per shredding run. Claude Sonnet
# costs ~$3 / 1M input tokens, so 150K = ~$0.45 per run. Sized to fit
# a typical DoD SBIR/STTR umbrella BAA (the extractor caps at 200K
# chars, which is ~50K tokens — plus ~10 section-level compliance
# calls at 500 chars + master list + few-shot each). If a single
# solicitation needs more than this, the doc is too large and we flag
# it to the admin rather than burn runaway cost.
MAX_INPUT_TOKENS_PER_RUN = 150_000

# Model name env var. Defaults to Sonnet 4.6 per the V2 conventions.
DEFAULT_MODEL = os.environ.get("SHREDDER_MODEL", "claude-sonnet-4-20250514")

# Rough token estimation — 1 token ≈ 4 chars for English text.
# Good enough for budget enforcement; exact counts come back from the
# API response and get logged in the end event.
_CHARS_PER_TOKEN_ESTIMATE = 4

# Share of the run budget the ONE section-extraction call may spend. The rest covers the per-section
# compliance calls (~1-2K tokens each) plus the ×1.25 pre-flight multiplier. 0.55 leaves room for
# roughly forty section calls, well above the ~10 a real BAA yields.
_SECTION_CALL_BUDGET_SHARE = 0.55

#: Character ceiling for the section-extraction call, DERIVED from the token budget rather than
#: written down beside it. The two were independent before and drifted: the extractor's own cap was
#: raised to 2M chars so a full BAA is READ, which pushed every real BAA past the token budget and
#: turned the pre-flight guard from a runaway-cost backstop into an unconditional failure. Deriving
#: it means raising one raises the other.
MAX_SECTION_CALL_CHARS = int(
    MAX_INPUT_TOKENS_PER_RUN * _SECTION_CALL_BUDGET_SHARE * _CHARS_PER_TOKEN_ESTIMATE
)

# Cached prompt contents to avoid disk reads per invocation.
_PROMPT_CACHE: dict[str, str] = {}

# Module-level override hook for tests. When the dispatcher routes a
# shred_solicitation job, it checks `runner.ANTHROPIC_CLIENT` before
# instantiating a real SDK client, so e2e tests can inject a mock
# without patching the import path.
ANTHROPIC_CLIENT: Any = None


def _load_prompt(name: str) -> str:
    """Load a versioned prompt file from pipeline/src/shredder/prompts/v1/."""
    if name in _PROMPT_CACHE:
        return _PROMPT_CACHE[name]
    prompt_path = Path(__file__).parent / "prompts" / "v1" / f"{name}.txt"
    if not prompt_path.exists():
        raise FileNotFoundError(f"prompt not found: {prompt_path}")
    text = prompt_path.read_text(encoding="utf-8")
    _PROMPT_CACHE[name] = text
    return text


def _estimate_tokens(text: str) -> int:
    """Rough char-based token estimator for pre-flight budget checks."""
    return len(text) // _CHARS_PER_TOKEN_ESTIMATE


# ── Claude call wrapper ────────────────────────────────────────────────


async def _call_claude(
    client: Any,
    system_prompt: str,
    user_message: str,
    model: str = DEFAULT_MODEL,
    max_tokens: int = 4096,
    _attempt: int = 0,
) -> tuple[dict[str, Any], int, int]:
    """Call Claude and parse the JSON response.

    Retries ONCE on unparseable JSON with an explicit repair instruction, then raises — callers
    decide whether that is fatal or a safe skip (safe_skip.py: evidence steps skip with a comment
    and never fabricate; artifact steps land a labelled placeholder).
    """
    response = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )

    # Extract the text from the first content block. The Anthropic SDK
    # returns a list of content blocks; for our prompts there should
    # only be one text block.
    content_blocks = getattr(response, "content", [])
    if not content_blocks:
        raise ValueError("Claude returned no content blocks")
    text_response = content_blocks[0].text

    # Usage tokens (SDK returns a Usage object with input/output counts)
    usage = getattr(response, "usage", None)
    input_tokens = getattr(usage, "input_tokens", 0) if usage else 0
    output_tokens = getattr(usage, "output_tokens", 0) if usage else 0

    # Claude sometimes wraps JSON in ```json ... ``` fences despite
    # our "no markdown" system prompt. Strip them defensively before parse.
    cleaned = _strip_markdown_fence(text_response)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as e:
        # RETRY ONCE. A malformed reply is usually transient — the model opened with prose, or
        # fenced the object in a way the stripper missed — and re-asking costs one call, which is
        # what a person would do. The retry SAYS what was wrong, so it is a repair request rather
        # than a hopeful repeat.
        if _attempt < MAX_MODEL_RETRIES:
            log.warning("shredder: unparseable JSON on attempt %d (%s) — re-asking", _attempt + 1, e)
            return await _call_claude(
                client, system_prompt=system_prompt,
                user_message=(
                    f"{user_message}\n\nYOUR PREVIOUS REPLY WAS NOT VALID JSON. Reply with the "
                    "JSON object only — no preamble, no explanation, no markdown fences."
                ),
                model=model, max_tokens=max_tokens, _attempt=_attempt + 1,
            )
        raise ValueError(
            f"Claude returned unparseable JSON after {_attempt + 1} attempt(s): {e}; "
            f"first 200 chars: {cleaned[:200]!r}"
        ) from e

    return parsed, input_tokens, output_tokens


def _strip_markdown_fence(text: str) -> str:
    """Remove ```json ... ``` fences that Claude sometimes adds."""
    stripped = text.strip()
    if stripped.startswith("```"):
        # Remove opening fence (with optional language tag)
        stripped = re.sub(r"^```(?:json)?\s*\n?", "", stripped)
        # Remove closing fence
        stripped = re.sub(r"\n?```\s*$", "", stripped)
    return stripped.strip()


# ── Main orchestrator ─────────────────────────────────────────────────


async def shred_solicitation(
    conn: asyncpg.Connection,
    solicitation_id: str,
    anthropic_client: Any,
    parent_event_id: Optional[str] = None,
) -> dict[str, Any]:
    """Run the full shredder pipeline for one curated_solicitation row.

    Args:
        conn: asyncpg connection. MUST be a dedicated connection (not
            pool-acquired) if the caller wraps this in a transaction.
        solicitation_id: curated_solicitations.id (UUID string).
        anthropic_client: an `anthropic.AsyncAnthropic` instance (or
            any object with `messages.create(...)` matching the SDK).
            Injected so tests can pass a mock.
        parent_event_id: optional system_events.id to link this run
            to an outer workflow (e.g. the dispatcher job event).

    Returns:
        Summary dict with counts, token usage, and the namespace key.

    Raises:
        ShredderBudgetError: if the estimated input tokens exceed
            MAX_INPUT_TOKENS_PER_RUN before any Claude call.
    """
    sol_uuid = uuid.UUID(solicitation_id)
    started_at = datetime.now(timezone.utc)

    # ── Step 1: Load the solicitation + its opportunity + its documents ──
    sol_row = await conn.fetchrow(
        """
        SELECT cs.id, cs.opportunity_id, cs.status,
               o.agency, o.office, o.program_type, o.title
        FROM curated_solicitations cs
        JOIN opportunities o ON o.id = cs.opportunity_id
        WHERE cs.id = $1
        """,
        sol_uuid,
    )
    if sol_row is None:
        raise ValueError(f"curated_solicitations {solicitation_id} not found")

    agency = sol_row["agency"]
    office = sol_row["office"]
    program_type = sol_row["program_type"]

    # solicitation_documents — EVERY document that can carry a rule, not just the umbrella.
    #
    # This used to read `document_type IN ('source','topic')`, which silently excluded the one
    # document class that most often holds the binding numbers. A federal solicitation routinely
    # states its rules across files: the DoW 2026 SBIR BAA sets the format requirements but
    # explicitly DEFERS the technical-volume page limit to the Component-specific instructions,
    # which arrive as a separate PDF. The admin upload form types every non-primary file
    # 'attachment' (rfp-upload/route.ts), so attaching those instructions could never help —
    # they were never extracted, `full_text` never contained them, and the compliance matrix
    # was left with a permanently unresolvable deferral. Proven live: a 9-page instructions PDF
    # stating "The Technical Volume is not to exceed 10 pages" sat in the row with
    # extracted_text NULL while the matrix showed no page limit at all.
    #
    # So: shred every type. 'template' is excluded because a blank form contributes formatting
    # noise, not rules. Ordering puts the umbrella first, then the documents it defers to, then
    # topics — which is also the order the page-marker segmentation reads most sensibly.
    try:
        doc_rows = await conn.fetch(
            """
            SELECT id, storage_key, original_filename, document_type
            FROM solicitation_documents
            WHERE solicitation_id = $1
              AND document_type <> 'template'
              AND storage_key IS NOT NULL
            ORDER BY
              CASE document_type
                WHEN 'source' THEN 0 WHEN 'rfp' THEN 0 WHEN 'nofo' THEN 0
                WHEN 'instructions' THEN 1 WHEN 'amendment' THEN 1 WHEN 'qa' THEN 1
                WHEN 'topic' THEN 2
                ELSE 3
              END,
              created_at ASC
            """,
            sol_uuid,
        )
    except asyncpg.exceptions.UndefinedTableError:
        doc_rows = []

    # ── Step 2: Emit start event ────────────────────────────────────────
    start_event_id = await _emit_event(
        conn,
        "finder",
        "rfp.shredding.start",
        {
            "solicitation_id": solicitation_id,
            "document_count": len(doc_rows),
            "opportunity_title": sol_row["title"],
            "prompt_version": 1,
            "model": DEFAULT_MODEL,
        },
        phase="start",
        parent_event_id=parent_event_id,
    )

    # ── Step 3: Extract text from all documents ─────────────────────────
    # For each source/topic document with a storage_key:
    #   a) Fetch PDF bytes from S3
    #   b) Extract markdown via pymupdf4llm
    #   c) Write extracted text to S3 as text.md artifact
    #   d) Update solicitation_documents.extracted_text + extracted_at
    #   e) Emit artifact.stored event
    #
    # Falls back to curated_solicitations.full_text when no docs exist
    # (e.g. opportunities seeded from ingesters without file upload).
    doc_texts: list[str] = []
    opp_id_str = str(sol_row["opportunity_id"])
    artifact_keys: list[str] = []

    if doc_rows:
        from storage.s3_client import get_object_bytes, put_text as s3_put_text
        from storage.paths import rfp_pipeline_path

        for doc in doc_rows:
            storage_key = doc["storage_key"]
            doc_id = doc["id"]

            # Skip if already extracted (idempotent re-runs)
            existing_text = await conn.fetchval(
                "SELECT extracted_text FROM solicitation_documents WHERE id = $1",
                doc_id,
            )
            if existing_text:
                capped, _reused = cap_source_text(existing_text)
                doc_texts.append(capped)
                log.info(
                    "shredder: document %s already extracted (%d chars), reusing",
                    doc_id, len(capped),
                )
                continue

            # Fetch PDF bytes from S3
            log.info("shredder: fetching %s from S3", storage_key)
            try:
                pdf_bytes = get_object_bytes(storage_key)
            except Exception as e:
                log.warning(
                    "shredder: S3 fetch failed for %s: %s — skipping",
                    storage_key, e,
                )
                continue

            if not pdf_bytes:
                log.warning("shredder: S3 returned empty for %s — skipping", storage_key)
                continue

            # Extract text via pymupdf4llm
            try:
                extracted = extract_text_from_pdf(pdf_bytes)
            except Exception as e:
                log.warning(
                    "shredder: text extraction failed for %s: %s — skipping",
                    storage_key, e,
                )
                continue

            capped, extraction = cap_source_text(extracted)
            if extraction["truncated"]:
                log.error(
                    "shredder: document %s TRUNCATED at %d of %d chars — %d%% of the source was not "
                    "read; any 'not stated in the source' result for this solicitation is unverified",
                    doc_id, extraction["chars"], extraction["original_chars"],
                    round(100 * (1 - extraction["chars"] / max(extraction["original_chars"], 1))),
                )
            # Persist the coverage record beside the text. A cap nobody can see downstream is the
            # bug this replaces (docs/INGEST_PROVENANCE.md).
            await conn.execute(
                "UPDATE solicitation_documents "
                "SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('extraction', $2::jsonb) "
                "WHERE id = $1",
                doc_id, json.dumps(extraction),
            )
            doc_texts.append(capped)

            # Write text.md artifact to S3 (alongside the source PDF)
            text_key = None
            try:
                text_key = rfp_pipeline_path(
                    opportunity_id=opp_id_str, kind="text",
                )
                s3_put_text(key=text_key, text=capped)
                artifact_keys.append(text_key)
                log.info("shredder: wrote %s (%d chars)", text_key, len(capped))
            except Exception as e:
                log.warning("shredder: text.md S3 write failed: %s", e)

            # Update the document row with extracted text + timestamp
            try:
                await conn.execute(
                    """
                    UPDATE solicitation_documents
                    SET extracted_text = $2,
                        extracted_at = now(),
                        page_count = $3,
                        updated_at = now()
                    WHERE id = $1
                    """,
                    doc_id,
                    capped,
                    # The real count, or NULL. This was `len(pdf_bytes) // 40000 + 1` — a byte-size
                    # guess stored under the name of a measurement and passed to the packaging
                    # specialist next to values genuinely read from the document. Unknown must
                    # read as unknown (docs/INGEST_PROVENANCE.md).
                    pdf_page_count(pdf_bytes),
                )
            except Exception as e:
                log.warning("shredder: doc row update failed for %s: %s", doc_id, e)

            # Emit artifact event
            await _emit_event(
                conn, "finder", "artifact.stored",
                {
                    "solicitation_id": solicitation_id,
                    "document_id": str(doc_id),
                    "artifact_type": "extracted_text",
                    "storage_key": text_key if text_key else None,
                    "chars": len(capped),
                    "source_key": storage_key,
                },
                parent_event_id=start_event_id,
            )
    else:
        # No linked documents — fall back to curated_solicitations.full_text
        full_text = await conn.fetchval(
            "SELECT full_text FROM curated_solicitations WHERE id = $1",
            sol_uuid,
        )
        if full_text:
            capped, _fallback = cap_source_text(full_text)
            doc_texts.append(capped)

    # Also update curated_solicitations.full_text with the combined extraction
    if doc_texts:
        combined_full = "\n\n---DOCUMENT---\n\n".join(doc_texts)
        # This carried its own bare 500_000 literal, tighter than the per-document cap and
        # independent of it — so a solicitation could pass every per-document check and still lose
        # its tail here. One ceiling, one helper, reported the same way.
        combined_capped, combined_extraction = cap_source_text(combined_full)
        if combined_extraction["truncated"]:
            log.error(
                "shredder: COMBINED text for %s truncated at %d of %d chars",
                sol_uuid, combined_extraction["chars"], combined_extraction["original_chars"],
            )
        await conn.execute(
            "UPDATE curated_solicitations SET full_text = $2, updated_at = now() WHERE id = $1",
            sol_uuid, combined_capped,
        )

    if not doc_texts:
        # Nothing to shred — still emit an end event and flip status
        # to 'shredder_failed' so the admin sees it in the queue.
        await _update_status(conn, sol_uuid, "shredder_failed")
        await _emit_event(
            conn,
            "finder",
            "rfp.shredding.end",
            {
                "solicitation_id": solicitation_id,
                "status": "shredder_failed",
                "reason": "no_text_available",
                "duration_ms": _ms_since(started_at),
            },
            phase="end",
            parent_event_id=start_event_id,
        )
        return {"status": "shredder_failed", "reason": "no_text_available"}

    combined_text = "\n\n---DOCUMENT---\n\n".join(doc_texts)

    # ── Step 4: Fit the document to the budget by LOCATING, not by failing ──
    #
    # Section extraction ships combined_text once. Per-section compliance calls each ship ~500 chars
    # of raw_text_excerpt + master variable list + few-shot examples — ~1-2K tokens each. For a
    # typical 5-10 section RFP the per-section calls add ~20% on top, so ×1.25 pre-flight.
    #
    # WHAT THIS REPLACES, and why an unconditional raise was wrong. The guard was written when the
    # extractor capped documents at 200K chars (~50K tokens), so exceeding 150K meant something
    # pathological. Raising that cap to 2M — so a full BAA is actually READ rather than silently
    # truncated at the cover page — put every real federal BAA over the line. Measured on the three
    # in this repo: DoW 2026 SBIR 316,863 tokens, DoD 25.1 SBIR 419,138, DoD 25.A STTR similar. The
    # guard fired on all of them. Not one AI shred of a real BAA has ever succeeded.
    #
    # Both old behaviours were wrong in the same way: shred a truncated prefix (the cover page and
    # the table of contents) and call it the document, or refuse the document entirely. The product
    # requirement is neither — it is to SCAN a large BAA for the sections that state the rules and
    # shred those. section_locate.py exists for exactly that and was already wired into six agents;
    # this is the shred path finally using it.
    #
    # Documents that already fit are passed through untouched — byte-for-byte the previous
    # behaviour, so no normal-sized RFP changes.
    excerpt_meta: dict[str, Any] | None = None
    if len(combined_text) > MAX_SECTION_CALL_CHARS:
        located = locate_sections(combined_text, budget=MAX_SECTION_CALL_CHARS)
        if not located.text:
            # The locator found no rule-stating passage anywhere. Falling back to a prefix here
            # would reintroduce the cover-page bug with none of the honesty, so the run stops and
            # says which topics it searched for. Pattern-match assist still lands a draft.
            await _update_status(conn, sol_uuid, "shredder_failed")
            await _emit_event(
                conn, "finder", "rfp.shredding.end",
                {
                    "solicitation_id": solicitation_id,
                    "status": "shredder_failed",
                    "reason": "no_locatable_sections",
                    "source_chars": len(combined_text),
                    "topics_searched": sorted(TOPICS),
                    "duration_ms": _ms_since(started_at),
                },
                phase="end",
                parent_event_id=start_event_id,
            )
            raise ShredderBudgetError(
                f"{len(combined_text)} chars exceed the {MAX_SECTION_CALL_CHARS}-char section-call "
                "budget and no rule-stating passage could be located",
                details={"solicitation_id": solicitation_id, "chars": len(combined_text)},
            )
        # PROVENANCE. Everything downstream reads `sections` as "what the solicitation says". If it
        # was derived from 4% of the document, that has to travel with it, or a missing page limit
        # reads as "the BAA does not state one" when it means "we did not send that part".
        # docs/INGEST_PROVENANCE.md: a value the product did not read must never look like one it did.
        excerpt_meta = {
            "excerpted": True,
            "source_chars": len(combined_text),
            "excerpt_chars": len(located.text),
            "coverage": round(len(located.text) / len(combined_text), 4),
            "budget_chars": MAX_SECTION_CALL_CHARS,
            "topics_covered": located.covered,
            "topics_missing": located.missing,
            "span_count": len(located.spans),
            # Capped for payload size, like artifact_keys below — a 1.3M-char BAA locates ~80
            # passages and the full list would dominate the event row. span_count carries the total.
            "spans": [
                {"topic": s.topic, "start": s.start, "end": s.end, "heading": s.heading}
                for s in sorted(located.spans, key=lambda s: s.score, reverse=True)[:20]
            ],
        }
        log.warning(
            "shredder: %s is %d chars — shredding %d located chars (%.1f%%) across %d passages: %s",
            solicitation_id, len(combined_text), len(located.text),
            100 * len(located.text) / len(combined_text), len(located.spans),
            ", ".join(s.heading or s.topic for s in located.spans),
        )
        await _emit_event(
            conn, "finder", "rfp.sections_located",
            {"solicitation_id": solicitation_id, **excerpt_meta},
            parent_event_id=start_event_id,
        )
        combined_text = located.text

    # The guard stays, now as the runaway-cost backstop it was meant to be rather than the normal
    # path. After locating, exceeding it means the derived ceiling itself is wrong.
    est_input = int(_estimate_tokens(combined_text) * 1.25)
    if est_input > MAX_INPUT_TOKENS_PER_RUN:
        await _update_status(conn, sol_uuid, "shredder_failed")
        await _emit_event(
            conn,
            "finder",
            "rfp.shredding.end",
            {
                "solicitation_id": solicitation_id,
                "status": "shredder_failed",
                "reason": "budget_exceeded",
                "estimated_input_tokens": est_input,
                "budget": MAX_INPUT_TOKENS_PER_RUN,
                "duration_ms": _ms_since(started_at),
            },
            phase="end",
            parent_event_id=start_event_id,
        )
        raise ShredderBudgetError(
            f"estimated {est_input} input tokens exceeds budget {MAX_INPUT_TOKENS_PER_RUN}",
            details={"solicitation_id": solicitation_id, "estimated": est_input},
        )

    # AUDIT FIX (PATTERN_AUDIT HIGH-2): any throw below (Claude calls, DB reads, Step-7
    # writes) previously propagated with the rfp.shredding bracket left OPEN — 36 live
    # orphan starts. Close the bracket with an error end before re-raising.
    try:
        # ── Step 5: Section extraction Claude call ──────────────────────────
        #
        # EVIDENCE, so it SKIPS rather than fabricates (safe_skip.py). Sections carry
        # raw_text_excerpt — an assertion about what this solicitation says and where — and there is
        # no honest way to generate one. On a skip the run continues with no sections: every
        # compliance field falls to source='default', renders as "Default — unverified", and the
        # readiness bar counts it until a person closes it. That is machinery that already exists,
        # and it beats failing the workflow instance, which is what killed 7 OnRfpUploaded runs.
        #
        # _call_claude already retried once with a repair instruction before it got here.
        section_skip: dict[str, Any] | None = None
        section_prompt = _load_prompt("section_extraction")
        system_section, user_template = _split_system_and_examples(section_prompt)
        sections: list[dict[str, Any]] = []
        sec_in_tokens = sec_out_tokens = 0
        try:
            section_result, sec_in_tokens, sec_out_tokens = await _call_claude(
                anthropic_client,
                system_prompt=system_section,
                user_message=f"{user_template}\n\nDOCUMENT:\n{combined_text}",
            )
            sections = section_result.get("sections", [])
        except Exception as e:
            log.warning("shredder: section extraction failed for %s — skipping: %s",
                        solicitation_id, e)
            section_skip = skip_evidence(
                "section_extraction", str(e), attempts=MAX_MODEL_RETRIES + 1,
            ).as_result()

        # ── Step 6: Compliance extraction per section ───────────────────────
        compliance_prompt = _load_prompt("compliance_extraction")
        system_comp, comp_template = _split_system_and_examples(compliance_prompt)

        # Master variable list from DB (injected into the user message)
        variable_rows = await conn.fetch(
            "SELECT name, label, category, data_type FROM compliance_variables ORDER BY name"
        )
        master_list = "\n".join(
            f"- {v['name']} ({v['data_type']}) — {v['label']}"
            for v in variable_rows
        )

        all_matches: list[dict[str, Any]] = []
        comp_in_tokens = 0
        comp_out_tokens = 0
        for section in sections:
            section_text = section.get("raw_text_excerpt") or ""
            if not section_text:
                continue
            user_msg = (
                f"{comp_template}\n\n"
                f"MASTER VARIABLES:\n{master_list}\n\n"
                f"SECTION: {section.get('title', '')}\n{section_text}"
            )
            try:
                result, in_t, out_t = await _call_claude(
                    anthropic_client, system_prompt=system_comp, user_message=user_msg
                )
            except Exception as e:  # single-section failure doesn't kill the run
                log.warning("compliance extraction failed for section %s: %s",
                            section.get("key"), e)
                continue
            comp_in_tokens += in_t
            comp_out_tokens += out_t
            for m in result.get("matches", []):
                m["_section"] = section.get("key")
                all_matches.append(m)

        # ── Step 7: Split matches, compute namespace, write to DB ───────────
        column_updates, custom_vars, skipped = split_matches(all_matches)

        namespace_key = compute_namespace_key(agency, office, program_type)

        ai_extracted_blob = {
            "prompt_version": 1,
            "model": DEFAULT_MODEL,
            "sections": sections,
            "compliance_matches": all_matches,
            "skipped_matches": skipped,
            # A skipped evidence step must be visible, or "no sections" reads like a document that
            # genuinely had none.
            **({"section_extraction_skipped": section_skip} if section_skip else {}),
            # Likewise an excerpted read: "no page limit found" means something different when only
            # 4% of the document was sent.
            **({"source_excerpt": excerpt_meta} if excerpt_meta else {}),
            "extracted_at": started_at.isoformat(),
        }

        await _write_ai_extracted(conn, sol_uuid, ai_extracted_blob, namespace_key)
        await _upsert_compliance(conn, sol_uuid, column_updates, custom_vars)
        await _update_status(conn, sol_uuid, "ai_analyzed")

        # ── Step 7b: Write section + metadata artifacts to S3 ──────────────
        # Each atomized section → rfp-pipeline/{oppId}/shredded/{key}.md
        # Full extraction metadata → rfp-pipeline/{oppId}/metadata.json
        # These are the artifacts that customer agents will read from their
        # isolated copies after portal purchase.
        try:
            from storage.s3_client import put_text as s3_put_text, put_json as s3_put_json
            from storage.paths import rfp_pipeline_path

            # Per-section markdown artifacts
            section_artifact_failures: list[dict[str, str]] = []
            for section in sections:
                sec_key = section.get("key", "").strip()
                if not sec_key:
                    continue
                sec_text = section.get("raw_text_excerpt") or section.get("summary") or ""
                sec_header = f"# {section.get('title', sec_key)}\n\n"
                sec_header += f"**Section key:** {sec_key}\n"
                if section.get("page_range"):
                    sec_header += f"**Pages:** {section['page_range']}\n"
                if section.get("summary"):
                    sec_header += f"\n{section['summary']}\n"
                sec_header += "\n---\n\n"

                try:
                    section_path = rfp_pipeline_path(
                        opportunity_id=opp_id_str,
                        kind="shredded",
                        name=sec_key,
                    )
                    s3_put_text(key=section_path, text=sec_header + sec_text)
                    artifact_keys.append(section_path)
                except Exception as e:
                    # Recorded, not just logged. This guard hid a real defect for as long as it has
                    # existed: the section-slug rule rejected half the canonical keys, so five of
                    # every ten sections never got an artifact and the only trace was a warning
                    # line. metadata.json listed all ten in section_keys and five in artifact_keys,
                    # and nothing reconciled the two. Same rule as section_extraction_skipped below
                    # — a step that did not happen has to be visible in the record.
                    section_artifact_failures.append({"key": sec_key, "error": str(e)})
                    log.warning("shredder: section %s S3 write failed: %s", sec_key, e)

            # Metadata.json — full extraction record for auditability
            metadata_blob = {
                "solicitation_id": solicitation_id,
                "opportunity_id": opp_id_str,
                "namespace": namespace_key,
                "prompt_version": 1,
                "model": DEFAULT_MODEL,
                "extracted_at": started_at.isoformat(),
                "sections_found": len(sections),
                "section_keys": [s.get("key") for s in sections if s.get("key")],
                "compliance_matches_found": len(all_matches),
                "column_updates_applied": len(column_updates),
                "custom_variables_stored": len(custom_vars),
                "skipped_matches": skipped,
                # A skipped evidence step must be visible, or "no sections" reads like a document
                # that genuinely had none.
                **({"section_extraction_skipped": section_skip} if section_skip else {}),
                **({"section_artifacts_failed": section_artifact_failures}
                   if section_artifact_failures else {}),
                **({"source_excerpt": excerpt_meta} if excerpt_meta else {}),
                "total_input_tokens": sec_in_tokens + comp_in_tokens,
                "total_output_tokens": sec_out_tokens + comp_out_tokens,
                "artifact_keys": artifact_keys,
            }
            try:
                meta_path = rfp_pipeline_path(
                    opportunity_id=opp_id_str, kind="metadata",
                )
                s3_put_json(key=meta_path, obj=metadata_blob)
                artifact_keys.append(meta_path)
            except Exception as e:
                log.warning("shredder: metadata.json S3 write failed: %s", e)

            # Emit artifact summary event
            await _emit_event(
                conn, "finder", "artifacts.written",
                {
                    "solicitation_id": solicitation_id,
                    "artifact_count": len(artifact_keys),
                    "artifact_keys": artifact_keys[:20],  # cap for payload size
                },
                parent_event_id=start_event_id,
            )
        except ImportError:
            # Storage module not available in test — skip artifact writes
            log.info("shredder: storage module unavailable, skipping S3 artifact writes")

        # ── Step 8: Emit end event ──────────────────────────────────────────
        total_in = sec_in_tokens + comp_in_tokens
        total_out = sec_out_tokens + comp_out_tokens
        await _emit_event(
            conn,
            "finder",
            "rfp.shredding.end",
            {
                "solicitation_id": solicitation_id,
                "status": "ai_analyzed",
                "sections_extracted": len(sections),
                "compliance_variables_extracted": len(all_matches),
                "column_updates_applied": len(column_updates),
                "custom_variables_stored": len(custom_vars),
                "skipped": len(skipped),
                "namespace": namespace_key,
                "prompt_version": 1,
                "model": DEFAULT_MODEL,
                # The end event is what the admin queue and the workflow monitor read. A run that
                # shredded a located excerpt has to look different there from one that read the
                # whole document, or "6 sections extracted" carries an accuracy it did not earn.
                **({"section_extraction_skipped": True,
                    "section_skip_reason": section_skip.get("reason")} if section_skip else {}),
                **({"source_excerpt": excerpt_meta} if excerpt_meta else {}),
                "total_input_tokens": total_in,
                "total_output_tokens": total_out,
                "duration_ms": _ms_since(started_at),
            },
            phase="end",
            parent_event_id=start_event_id,
        )

        return {
            "status": "ai_analyzed",
            "solicitation_id": solicitation_id,
            "namespace": namespace_key,
            "sections": len(sections),
            "compliance_matches": len(all_matches),
            "column_updates": len(column_updates),
            "custom_variables": len(custom_vars),
            "skipped": skipped,
            "total_input_tokens": total_in,
            "total_output_tokens": total_out,
        }
    except Exception as shred_err:
        try:
            await _emit_event(
                conn, "finder", "rfp.shredding.end",
                {"solicitation_id": solicitation_id, "status": "shredder_failed",
                 "reason": "unhandled_error", "error": str(shred_err)[:500],
                 "duration_ms": _ms_since(started_at)},
                phase="end", parent_event_id=start_event_id,
            )
        except Exception:
            log.warning("shredder: error-end emit failed while handling %s", shred_err)
        raise


# ── Helpers ───────────────────────────────────────────────────────────


def _split_system_and_examples(prompt_file: str) -> tuple[str, str]:
    """Split a prompt file into (system_prompt, user_message_body).

    The file format uses `---SYSTEM---`, `---FEW_SHOT_N---`, `---END---`
    markers. The system prompt is the block between ---SYSTEM--- and
    the first ---FEW_SHOT. The rest (few-shot examples + closing marker)
    becomes the user-message template that the runner appends its
    real input to.
    """
    # Extract system prompt: between ---SYSTEM--- and ---FEW_SHOT_1---
    system_match = re.search(
        r"---SYSTEM---\s*\n(.*?)\n---FEW_SHOT", prompt_file, re.DOTALL
    )
    if not system_match:
        # If no FEW_SHOT section, system prompt is everything after ---SYSTEM---
        system_match = re.search(
            r"---SYSTEM---\s*\n(.*?)(?:\n---END---|\Z)", prompt_file, re.DOTALL
        )
    system_prompt = system_match.group(1).strip() if system_match else prompt_file

    # Few-shot examples: everything from ---FEW_SHOT_1--- to ---END--- (exclusive)
    few_shot_match = re.search(
        r"(---FEW_SHOT_1---.*?)(?:\n---END---|\Z)", prompt_file, re.DOTALL
    )
    few_shot = few_shot_match.group(1).strip() if few_shot_match else ""
    return system_prompt, few_shot


async def _emit_event(
    conn: asyncpg.Connection,
    namespace: str,
    event_type: str,
    payload: dict[str, Any],
    phase: str = "single",
    parent_event_id: Optional[str] = None,
) -> str:
    """Write a row to system_events. Never raises — instrumentation
    failures must not break the business path."""
    event_id = str(uuid.uuid4())
    try:
        await conn.execute(
            """
            INSERT INTO system_events
              (id, namespace, type, phase, actor_type, actor_id,
               parent_event_id, payload, created_at)
            VALUES ($1, $2, $3, $4, 'pipeline', 'shredder',
                    $5, $6::jsonb, now())
            """,
            uuid.UUID(event_id),
            namespace,
            event_type,
            phase,
            uuid.UUID(parent_event_id) if parent_event_id else None,
            json.dumps(payload),
        )
    except Exception as e:
        log.error("failed to emit event %s.%s: %s", namespace, event_type, e)
    return event_id


async def _update_status(
    conn: asyncpg.Connection, sol_id: uuid.UUID, status: str
) -> None:
    await conn.execute(
        """
        UPDATE curated_solicitations
        SET status = $2, updated_at = now()
        WHERE id = $1
        """,
        sol_id, status,
    )


async def _write_ai_extracted(
    conn: asyncpg.Connection,
    sol_id: uuid.UUID,
    blob: dict[str, Any],
    namespace: Optional[str],
) -> None:
    # Only overwrite namespace when we computed one; otherwise leave
    # whatever was there (possibly from a prior run).
    if namespace:
        await conn.execute(
            """
            UPDATE curated_solicitations
            SET ai_extracted = $2::jsonb,
                namespace = $3,
                updated_at = now()
            WHERE id = $1
            """,
            sol_id, json.dumps(blob), namespace,
        )
    else:
        await conn.execute(
            """
            UPDATE curated_solicitations
            SET ai_extracted = $2::jsonb,
                updated_at = now()
            WHERE id = $1
            """,
            sol_id, json.dumps(blob),
        )


async def _upsert_compliance(
    conn: asyncpg.Connection,
    sol_id: uuid.UUID,
    column_updates: dict[str, Any],
    custom_vars: dict[str, Any],
) -> None:
    """Insert or update the solicitation_compliance row for this solicitation.

    verified_by is deliberately NOT set here — the shredder is
    automated suggestion, not human verification. A curator confirms
    values later via the /admin/rfp-curation/[id] workspace.

    TRUST-ORDERED + STAMPED (mig 187/188: hitl > verified > override > pattern_match > ai >
    default). These values come off the Claude compliance-extraction prompt, so every column
    this writer sets is stamped source='ai' in field_provenance — an unstamped value is
    indistinguishable from a rule a human verified, which is the failure the whole provenance
    spine exists to stop. And a column whose EXISTING provenance is stronger than 'ai' is
    dropped from the update entirely: the shredder re-running must never overwrite a curator's
    highlighted/verified value, or an admin's reviewed override, with a machine's re-read.
    """
    # Build the dynamic UPDATE set clause from column_updates plus
    # custom_variables. All params are parameterized so this is safe.
    existing_row = await conn.fetchrow(
        "SELECT id, field_provenance FROM solicitation_compliance WHERE solicitation_id = $1",
        sol_id,
    )
    existing = existing_row["id"] if existing_row else None

    # Existing per-column provenance (may be a jsonb string on some drivers).
    prior_prov: dict[str, Any] = {}
    if existing_row and existing_row["field_provenance"] is not None:
        raw_prov = existing_row["field_provenance"]
        if isinstance(raw_prov, str):
            try:
                prior_prov = json.loads(raw_prov)
            except (json.JSONDecodeError, TypeError):
                prior_prov = {}
        elif isinstance(raw_prov, dict):
            prior_prov = raw_prov

    _PROTECTED = {"hitl", "verified", "override"}
    protected_cols = {
        col for col, entry in prior_prov.items()
        if isinstance(entry, dict) and entry.get("source") in _PROTECTED
    }
    dropped = protected_cols & set(column_updates.keys())
    if dropped:
        log.info(
            "shredder: skipping %d compliance column(s) with stronger provenance than 'ai': %s",
            len(dropped), ", ".join(sorted(dropped)),
        )
        column_updates = {k: v for k, v in column_updates.items() if k not in dropped}

    # Merge the 'ai' stamps for the columns we ARE writing over whatever provenance exists.
    merged_prov = dict(prior_prov)
    for col in column_updates:
        merged_prov[col] = {"source": "ai"}

    import re as _re
    _SAFE_COL = _re.compile(r'^[a-z_][a-z0-9_]*$')
    for col in column_updates:
        if not _SAFE_COL.match(col):
            raise ValueError(f"unsafe column name in compliance upsert: {col!r}")

    set_parts = []
    values: list[Any] = []
    for col, val in column_updates.items():
        set_parts.append(f"{col} = ${len(values) + 2}")
        values.append(val)

    set_parts.append(f"custom_variables = ${len(values) + 2}::jsonb")
    values.append(json.dumps(custom_vars))

    set_parts.append(f"field_provenance = ${len(values) + 2}::jsonb")
    values.append(json.dumps(merged_prov))

    set_parts.append("updated_at = now()")

    if existing is None:
        # INSERT path
        cols = ["solicitation_id"] + list(column_updates.keys()) + ["custom_variables", "field_provenance"]
        placeholders = [f"${i + 1}" for i in range(len(cols))]
        insert_values = [sol_id] + list(column_updates.values()) + [json.dumps(custom_vars), json.dumps(merged_prov)]
        # the two jsonb tails need ::jsonb casts
        placeholders[-2] = f"${len(cols) - 1}::jsonb"
        placeholders[-1] = f"${len(cols)}::jsonb"
        await conn.execute(
            f"INSERT INTO solicitation_compliance ({', '.join(cols)}) "
            f"VALUES ({', '.join(placeholders)})",
            *insert_values,
        )
    else:
        # UPDATE path
        await conn.execute(
            f"UPDATE solicitation_compliance SET {', '.join(set_parts)} "
            f"WHERE solicitation_id = $1",
            sol_id, *values,
        )


def _ms_since(started_at: datetime) -> int:
    return int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000)
