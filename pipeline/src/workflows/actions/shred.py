"""
Workflow ACTION targets for the shredder pipeline.

These thin wrappers adapt the existing shredder runner to the interface
expected by the workflow processor: async function(conn, **input_map_kwargs).

Called by:
  - OnRfpUploaded.step("shred_document")   → shred()
  - OnRfpUploaded.step("extract_compliance") → extract_compliance()

See pipeline/src/shredder/runner.py for the full shredder implementation.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from typing import Any, Optional

import asyncpg

log = logging.getLogger("pipeline.workflows.actions.shred")


async def shred(
    conn: asyncpg.Connection,
    *,
    solicitation_id: str,
    document_ids: Optional[list[str]] = None,
) -> dict[str, Any]:
    """Shred a solicitation's documents — extract text, call Claude, persist results.

    This is the workflow-callable wrapper around shredder.runner.shred_solicitation.
    It handles Anthropic client instantiation so the runner stays testable with
    injected mocks.

    Args:
        conn: Active asyncpg connection (from workflow processor).
        solicitation_id: curated_solicitations.id (UUID string).
        document_ids: Optional list of solicitation_documents.id to shred.
            If None, the runner processes all linked documents.

    Returns:
        Dict with status, section count, compliance match count, token usage.
    """
    from shredder import runner as shredder_runner
    from shredder.runner import shred_solicitation

    # Use the module-level override if set (e.g. by tests), otherwise
    # instantiate a real Anthropic client from the SDK.
    client = getattr(shredder_runner, "ANTHROPIC_CLIENT", None)
    if client is None:
        try:
            from anthropic import AsyncAnthropic
            client = AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
        except ImportError:
            log.error("anthropic SDK not available — cannot shred")
            return {
                "status": "shredder_failed",
                "reason": "anthropic_sdk_not_installed",
            }

    # Delegate to the runner. ShredderBudgetError is intentionally not
    # caught here — it propagates so the workflow processor records the
    # step as failed.
    result = await shred_solicitation(
        conn=conn,
        solicitation_id=solicitation_id,
        anthropic_client=client,
    )
    return result


async def extract_compliance(
    conn: asyncpg.Connection,
    *,
    solicitation_id: str,
) -> dict[str, Any]:
    """Re-run compliance extraction on an already-shredded solicitation.

    Used when an admin edits solicitation text and wants to re-extract
    compliance variables without re-running the full shredder pipeline.

    The shredder runner already does compliance extraction inline during
    shred_solicitation(). This standalone function extracts from the
    existing ai_extracted.sections data.

    Args:
        conn: Active asyncpg connection.
        solicitation_id: curated_solicitations.id (UUID string).

    Returns:
        Dict with compliance match counts and any errors.
    """
    sol_uuid = uuid.UUID(solicitation_id)

    # 1. Fetch ai_extracted JSONB from curated_solicitations
    row = await conn.fetchrow(
        "SELECT ai_extracted FROM curated_solicitations WHERE id = $1",
        sol_uuid,
    )
    if row is None:
        return {"status": "skipped", "reason": "solicitation_not_found"}

    raw_extracted = row["ai_extracted"]
    if raw_extracted is None:
        return {"status": "skipped", "reason": "not_yet_shredded"}

    # asyncpg may return JSONB as str or dict depending on codec registration
    if isinstance(raw_extracted, str):
        try:
            ai_extracted = json.loads(raw_extracted)
        except (json.JSONDecodeError, TypeError):
            return {"status": "skipped", "reason": "invalid_ai_extracted_json"}
    else:
        ai_extracted = raw_extracted

    sections = ai_extracted.get("sections", [])
    if not sections:
        return {"status": "completed", "compliance_matches": 0, "reason": "no_sections"}

    # 2. Attempt to re-run compliance extraction via Claude
    #    If Anthropic SDK is available, call Claude for each section.
    #    Otherwise, fall back to pattern-based extraction.
    try:
        from anthropic import AsyncAnthropic
        from shredder import runner as shredder_runner
        from shredder.runner import _call_claude, _load_prompt, _split_system_and_examples

        client = getattr(shredder_runner, "ANTHROPIC_CLIENT", None)
        if client is None:
            client = AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))

        compliance_prompt = _load_prompt("compliance_extraction")
        system_comp, comp_template = _split_system_and_examples(compliance_prompt)

        # Master variable list from DB
        variable_rows = await conn.fetch(
            "SELECT name, label, category, data_type FROM compliance_variables ORDER BY name"
        )
        master_list = "\n".join(
            f"- {v['name']} ({v['data_type']}) — {v['label']}"
            for v in variable_rows
        )

        all_matches: list[dict[str, Any]] = []
        total_in_tokens = 0
        total_out_tokens = 0

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
                    client, system_prompt=system_comp, user_message=user_msg
                )
            except Exception as e:
                log.warning(
                    "compliance extraction failed for section %s: %s",
                    section.get("key"), e,
                )
                continue
            total_in_tokens += in_t
            total_out_tokens += out_t
            for m in result.get("matches", []):
                m["_section"] = section.get("key")
                all_matches.append(m)

        # Split matches and upsert compliance row
        from shredder.compliance_mapping import split_matches
        from shredder.runner import _upsert_compliance

        column_updates, custom_vars, skipped = split_matches(all_matches)
        await _upsert_compliance(conn, sol_uuid, column_updates, custom_vars)

        return {
            "status": "completed",
            "compliance_matches": len(all_matches),
            "column_updates": len(column_updates),
            "custom_variables": len(custom_vars),
            "skipped": skipped,
            "total_input_tokens": total_in_tokens,
            "total_output_tokens": total_out_tokens,
        }

    except ImportError:
        log.info("anthropic SDK not available, using pattern-based compliance extraction")

    # 3. Fallback: pattern-based extraction from existing sections
    compliance_vars: list[dict[str, Any]] = []
    for section in sections:
        content = (section.get("raw_text_excerpt") or "").lower()
        if not content:
            continue
        section_key = section.get("key", "unknown")
        if "page limit" in content or "not to exceed" in content:
            compliance_vars.append({
                "type": "page_limit",
                "source_section": section_key,
                "raw_text": content[:200],
            })
        if "font" in content and ("size" in content or "point" in content):
            compliance_vars.append({
                "type": "font_requirement",
                "source_section": section_key,
                "raw_text": content[:200],
            })
        if "submission" in content and ("format" in content or "deadline" in content):
            compliance_vars.append({
                "type": "submission_requirement",
                "source_section": section_key,
                "raw_text": content[:200],
            })
        if "margin" in content:
            compliance_vars.append({
                "type": "margin_requirement",
                "source_section": section_key,
                "raw_text": content[:200],
            })
        if "spacing" in content and "line" in content:
            compliance_vars.append({
                "type": "line_spacing",
                "source_section": section_key,
                "raw_text": content[:200],
            })

    # Store pattern-based results as custom_variables in solicitation_compliance
    if compliance_vars:
        existing = await conn.fetchval(
            "SELECT id FROM solicitation_compliance WHERE solicitation_id = $1",
            sol_uuid,
        )
        custom_blob = json.dumps({
            "pattern_extracted": compliance_vars,
        })
        if existing is None:
            await conn.execute(
                """INSERT INTO solicitation_compliance (solicitation_id, custom_variables)
                   VALUES ($1, $2::jsonb)""",
                sol_uuid,
                custom_blob,
            )
        else:
            await conn.execute(
                """UPDATE solicitation_compliance
                   SET custom_variables = $2::jsonb, updated_at = now()
                   WHERE solicitation_id = $1""",
                sol_uuid,
                custom_blob,
            )

    return {
        "status": "completed",
        "compliance_matches": len(compliance_vars),
        "extraction_method": "pattern_based",
    }
