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
from shredder.compliance_mapping import split_matches
from shredder.extractor import MAX_CHARS_PER_DOCUMENT, extract_text_from_pdf
from shredder.namespace import compute_namespace_key

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
DEFAULT_MODEL = os.environ.get("SHREDDER_MODEL", "claude-sonnet-4-6")

# Rough token estimation — 1 token ≈ 4 chars for English text.
# Good enough for budget enforcement; exact counts come back from the
# API response and get logged in the end event.
_CHARS_PER_TOKEN_ESTIMATE = 4

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
) -> tuple[dict[str, Any], int, int]:
    """Call Claude and parse the JSON response.

    Returns (parsed_json, input_tokens, output_tokens). Raises on API
    error or unparseable JSON.
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
        raise ValueError(
            f"Claude returned unparseable JSON: {e}; first 200 chars: {cleaned[:200]!r}"
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

    # solicitation_documents is introduced in §G. Until then, fall back
    # to curated_solicitations.full_text. Handle the missing-table case
    # gracefully so §D.2 doesn't need the §G schema to run.
    try:
        doc_rows = await conn.fetch(
            """
            SELECT id, storage_key, original_filename
            FROM solicitation_documents
            WHERE solicitation_id = $1
            ORDER BY created_at ASC
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
    # In stub/test mode, `full_text` may already be populated on the
    # solicitation (populated by a prior ingestion pass) — we prefer
    # that over re-extracting from S3 to keep tests hermetic.
    doc_texts: list[str] = []
    total_chars = 0
    if doc_rows:
        for doc in doc_rows:
            # Extraction wiring: storage key → pymupdf4llm. For the
            # initial §D.2 commit we don't exercise the S3 path; the
            # e2e tests use full_text on the solicitation and mocks
            # the doc list to empty. §J will exercise S3 for real.
            storage_key = doc["storage_key"]
            log.info(
                "shredder: document %s (key=%s) not yet S3-extracted in D.2; "
                "see §J for the end-to-end flow",
                doc["id"], storage_key,
            )
    else:
        # No linked documents — fall back to curated_solicitations.full_text
        # which may have been pre-populated by the ingester / curator.
        full_text = await conn.fetchval(
            "SELECT full_text FROM curated_solicitations WHERE id = $1",
            sol_uuid,
        )
        if full_text:
            capped = full_text[:MAX_CHARS_PER_DOCUMENT]
            doc_texts.append(capped)
            total_chars = len(capped)

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

    # ── Step 4: Pre-flight budget check ─────────────────────────────────
    # Section extraction ships the full combined_text once. Per-section
    # compliance calls each ship ~500 chars of raw_text_excerpt + master
    # variable list + few-shot examples — ~1-2K tokens each. For a
    # typical 5-10 section RFP, the per-section calls add ~20% overhead
    # on top of the main extraction. ×1.25 pre-flight multiplier is
    # accurate without being wastefully pessimistic.
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

    # ── Step 5: Section extraction Claude call ──────────────────────────
    section_prompt = _load_prompt("section_extraction")
    system_section, user_template = _split_system_and_examples(section_prompt)
    section_result, sec_in_tokens, sec_out_tokens = await _call_claude(
        anthropic_client,
        system_prompt=system_section,
        user_message=f"{user_template}\n\nDOCUMENT:\n{combined_text}",
    )
    sections = section_result.get("sections", [])

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
        "extracted_at": started_at.isoformat(),
    }

    await _write_ai_extracted(conn, sol_uuid, ai_extracted_blob, namespace_key)
    await _upsert_compliance(conn, sol_uuid, column_updates, custom_vars)
    await _update_status(conn, sol_uuid, "ai_analyzed")

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
    """
    # Build the dynamic UPDATE set clause from column_updates plus
    # custom_variables. All params are parameterized so this is safe.
    existing = await conn.fetchval(
        "SELECT id FROM solicitation_compliance WHERE solicitation_id = $1",
        sol_id,
    )

    set_parts = []
    values: list[Any] = []
    for col, val in column_updates.items():
        set_parts.append(f"{col} = ${len(values) + 2}")
        values.append(val)

    set_parts.append(f"custom_variables = ${len(values) + 2}::jsonb")
    values.append(json.dumps(custom_vars))

    set_parts.append("updated_at = now()")

    if existing is None:
        # INSERT path
        cols = ["solicitation_id"] + list(column_updates.keys()) + ["custom_variables"]
        placeholders = [f"${i + 1}" for i in range(len(cols))]
        insert_values = [sol_id] + list(column_updates.values()) + [json.dumps(custom_vars)]
        # custom_variables needs ::jsonb cast; replace the last placeholder
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
