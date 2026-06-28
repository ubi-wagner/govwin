"""
================================================================================
Workflow Action: shred / extract_compliance
================================================================================

WHO:    Called by workflow processor when OnRfpUploaded workflow executes
        the shred_document and extract_compliance steps.

WHAT:   Provides two action functions:
        1. shred() — Wrapper around shredder.runner.shred_solicitation that
           handles Anthropic client instantiation. Extracts text, structure,
           and embeddings from uploaded RFP documents via Claude.
        2. extract_compliance() — Re-runs compliance variable extraction on
           already-shredded solicitation data. Tries Claude-based extraction
           first, falls back to pattern-based extraction (page limits, font
           requirements, submission deadlines, margins, line spacing).

INPUTS:
    shred():
        - solicitation_id: str — curated_solicitations.id (UUID string)
        - document_ids: Optional[list[str]] — specific document IDs to shred.
          If None, processes all linked documents.

    extract_compliance():
        - solicitation_id: str — curated_solicitations.id (UUID string)

OUTPUTS:
    shred():
        - status: str — "completed" or "shredder_failed"
        - reason: str — failure reason if applicable
        - sections_extracted: int — number of sections found (on success)
        - token_usage: dict — input/output token counts (on success)

    extract_compliance():
        - status: str — "completed" or "skipped"
        - reason: str — skip reason if applicable
        - compliance_matches: int — total matches found
        - extraction_method: str — "claude" or "pattern_based"
        - column_updates: int — DB columns updated (Claude method)
        - custom_variables: int — custom vars created (Claude method)

ERROR HANDLING:
    - Missing Anthropic SDK: Returns status="shredder_failed" with reason
      rather than crashing. Allows workflow to continue to notification.
    - Missing API key: Anthropic client instantiates with empty key;
      SDK will fail on first call — caught by shredder runner.
    - ShredderBudgetError: Intentionally NOT caught — propagates to
      processor so the step is recorded as failed.
    - Invalid solicitation_id: Returns status="skipped" with reason.
    - JSONB parse errors: Returns status="skipped" for malformed data.
    - Per-section extraction errors: Logged and skipped; other sections
      continue processing.

TENANT ISOLATION:
    - Not tenant-scoped — curated_solicitations are global resources
      managed by rfp_admin. No tenant_id filtering required.

EVENT EMISSIONS:
    - finder:shred.executed:start/end — shred() start/end with duration
    - finder:compliance.extracted:start/end — extract_compliance()
      start/end with duration and match counts

CHANGE LOG:
    PR #140 (2026-05-22) — Initial implementation: shred wrapper,
                           compliance extraction with Claude + pattern
                           fallback
    PR #xxx (2026-05-22) — Added comprehensive documentation header,
                           error handling documentation, idempotency notes
    PR #xxx (2026-05-29) — Added start/end event pairs for shred and
                           extract_compliance actions
================================================================================
"""
from __future__ import annotations

import json
import logging
import os
import time
import uuid
from typing import Any, Optional

import asyncpg

from events import emit_event

log = logging.getLogger("pipeline.workflows.actions.shred")


async def shred(
    conn: asyncpg.Connection,
    *,
    solicitation_id: str,
    document_ids: Optional[list[str]] = None,
) -> dict[str, Any]:
    """Shred a solicitation's documents -- extract text, call Claude, persist results.

    This is the workflow-callable wrapper around shredder.runner.shred_solicitation.
    It handles Anthropic client instantiation so the runner stays testable with
    injected mocks.

    Idempotency: The shredder runner checks if ai_extracted data already exists
    for the solicitation. If it does, the runner skips re-processing unless
    force=True is passed (not exposed at workflow level).

    Args:
        conn: Active asyncpg connection (from workflow processor).
        solicitation_id: curated_solicitations.id (UUID string).
        document_ids: Optional list of solicitation_documents.id to shred.
            If None, the runner processes all linked documents.

    Returns:
        Dict with status, section count, compliance match count, token usage.
    """
    start_ms = time.monotonic()

    # Validate solicitation_id format
    try:
        uuid.UUID(solicitation_id)
    except (ValueError, TypeError):
        log.error("shred: invalid solicitation_id format: %s", solicitation_id)
        return {
            "status": "shredder_failed",
            "reason": "invalid_solicitation_id",
        }

    # Emit start event
    start_event_id = ""
    try:
        start_event_id = await emit_event(
            conn, namespace="finder", type="shred.executed", phase="start",
            payload={"solicitationId": solicitation_id},
        )
    except Exception as exc:
        log.error("shred: failed to emit start event: %s", exc)

    try:
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
                log.error("anthropic SDK not available -- cannot shred")
                duration_ms = int((time.monotonic() - start_ms) * 1000)
                try:
                    await emit_event(
                        conn, namespace="finder", type="shred.executed", phase="end",
                        parent_event_id=start_event_id,
                        payload={"solicitationId": solicitation_id,
                                 "error": "anthropic_sdk_not_installed", "durationMs": duration_ms},
                    )
                except Exception:
                    pass
                return {
                    "status": "shredder_failed",
                    "reason": "anthropic_sdk_not_installed",
                }

        # G1: platform spend guard — the shredder runs per-ingest with no tenant,
        # so gate it on the platform monthly cap before spending and log the spend
        # after, so platform_agent_config.platform_monthly_cap accounts for it.
        from agents.platform_guard import platform_ai_allowed, log_platform_call
        if not await platform_ai_allowed(conn):
            duration_ms = int((time.monotonic() - start_ms) * 1000)
            try:
                await emit_event(
                    conn, namespace="finder", type="shred.executed", phase="end",
                    parent_event_id=start_event_id,
                    payload={"solicitationId": solicitation_id,
                             "error": "platform_ai_cap_reached", "durationMs": duration_ms},
                )
            except Exception:
                pass
            return {"status": "shredder_blocked", "reason": "platform_ai_cap_reached"}

        # Delegate to the runner. ShredderBudgetError is intentionally not
        # caught here -- it propagates so the workflow processor records the
        # step as failed.
        result = await shred_solicitation(
            conn=conn,
            solicitation_id=solicitation_id,
            anthropic_client=client,
        )

        # Log the platform (non-tenant) AI spend so the cap + admin usage see it.
        try:
            from agents.fabric import _cost_for
            # Cost against the SHREDDER's model (not fabric's default) so spend is
            # priced correctly when SHREDDER_MODEL differs.
            shred_model = getattr(shredder_runner, "DEFAULT_MODEL", None) or "claude-sonnet-4-20250514"
            in_tok = int(result.get("total_input_tokens", 0) or 0)
            out_tok = int(result.get("total_output_tokens", 0) or 0)
            await log_platform_call(
                conn, agent_role="shredder", task_type="shred",
                input_tokens=in_tok, output_tokens=out_tok,
                cost_usd=_cost_for(shred_model, in_tok, out_tok),
                duration_ms=int((time.monotonic() - start_ms) * 1000),
            )
        except Exception as exc:
            log.error("shred: platform spend log failed: %s", exc)

        duration_ms = int((time.monotonic() - start_ms) * 1000)
        try:
            await emit_event(
                conn, namespace="finder", type="shred.executed", phase="end",
                parent_event_id=start_event_id,
                payload={"solicitationId": solicitation_id,
                         "status": result.get("status", "unknown"),
                         "sectionsExtracted": result.get("sections_extracted", 0),
                         "durationMs": duration_ms},
            )
        except Exception as exc:
            log.error("shred: failed to emit end event: %s", exc)

        return result

    except Exception as exc:
        duration_ms = int((time.monotonic() - start_ms) * 1000)
        try:
            await emit_event(
                conn, namespace="finder", type="shred.executed", phase="end",
                parent_event_id=start_event_id,
                payload={"solicitationId": solicitation_id,
                         "error": str(exc)[:500], "durationMs": duration_ms},
            )
        except Exception:
            pass
        raise


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
    start_ms = time.monotonic()

    # Validate solicitation_id format
    try:
        sol_uuid = uuid.UUID(solicitation_id)
    except (ValueError, TypeError):
        log.error("extract_compliance: invalid solicitation_id: %s", solicitation_id)
        return {"status": "skipped", "reason": "invalid_solicitation_id"}

    # Emit start event
    start_event_id = ""
    try:
        start_event_id = await emit_event(
            conn, namespace="finder", type="compliance.extracted", phase="start",
            payload={"solicitationId": solicitation_id},
        )
    except Exception as exc:
        log.error("extract_compliance: failed to emit start event: %s", exc)

    # 1. Fetch ai_extracted JSONB from curated_solicitations
    try:
        row = await conn.fetchrow(
            "SELECT ai_extracted FROM curated_solicitations WHERE id = $1",
            sol_uuid,
        )
    except Exception as exc:
        log.error("extract_compliance: DB query failed: %s", exc)
        duration_ms = int((time.monotonic() - start_ms) * 1000)
        try:
            await emit_event(
                conn, namespace="finder", type="compliance.extracted", phase="end",
                parent_event_id=start_event_id,
                payload={"solicitationId": solicitation_id,
                         "error": f"db_error: {exc}", "durationMs": duration_ms},
            )
        except Exception:
            pass
        return {"status": "skipped", "reason": f"db_error: {exc}"}

    if row is None:
        duration_ms = int((time.monotonic() - start_ms) * 1000)
        try:
            await emit_event(
                conn, namespace="finder", type="compliance.extracted", phase="end",
                parent_event_id=start_event_id,
                payload={"solicitationId": solicitation_id,
                         "status": "skipped", "reason": "solicitation_not_found",
                         "durationMs": duration_ms},
            )
        except Exception:
            pass
        return {"status": "skipped", "reason": "solicitation_not_found"}

    raw_extracted = row["ai_extracted"]
    if raw_extracted is None:
        duration_ms = int((time.monotonic() - start_ms) * 1000)
        try:
            await emit_event(
                conn, namespace="finder", type="compliance.extracted", phase="end",
                parent_event_id=start_event_id,
                payload={"solicitationId": solicitation_id,
                         "status": "skipped", "reason": "not_yet_shredded",
                         "durationMs": duration_ms},
            )
        except Exception:
            pass
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
        duration_ms = int((time.monotonic() - start_ms) * 1000)
        try:
            await emit_event(
                conn, namespace="finder", type="compliance.extracted", phase="end",
                parent_event_id=start_event_id,
                payload={"solicitationId": solicitation_id,
                         "complianceMatches": 0, "status": "completed",
                         "durationMs": duration_ms},
            )
        except Exception:
            pass
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
        try:
            variable_rows = await conn.fetch(
                "SELECT name, label, category, data_type FROM compliance_variables ORDER BY name"
            )
        except Exception as exc:
            log.error("extract_compliance: failed to fetch compliance_variables: %s", exc)
            variable_rows = []

        master_list = "\n".join(
            f"- {v['name']} ({v['data_type']}) -- {v['label']}"
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

        result = {
            "status": "completed",
            "compliance_matches": len(all_matches),
            "column_updates": len(column_updates),
            "custom_variables": len(custom_vars),
            "skipped": skipped,
            "total_input_tokens": total_in_tokens,
            "total_output_tokens": total_out_tokens,
        }
        duration_ms = int((time.monotonic() - start_ms) * 1000)
        try:
            await emit_event(
                conn, namespace="finder", type="compliance.extracted", phase="end",
                parent_event_id=start_event_id,
                payload={"solicitationId": solicitation_id,
                         "complianceMatches": len(all_matches),
                         "extractionMethod": "claude",
                         "durationMs": duration_ms},
            )
        except Exception:
            pass
        return result

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
        try:
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
        except Exception as exc:
            log.error(
                "extract_compliance: failed to upsert solicitation_compliance: %s", exc
            )
            return {
                "status": "completed",
                "compliance_matches": len(compliance_vars),
                "extraction_method": "pattern_based",
                "db_error": str(exc)[:200],
            }

    result = {
        "status": "completed",
        "compliance_matches": len(compliance_vars),
        "extraction_method": "pattern_based",
    }
    duration_ms = int((time.monotonic() - start_ms) * 1000)
    try:
        await emit_event(
            conn, namespace="finder", type="compliance.extracted", phase="end",
            parent_event_id=start_event_id,
            payload={"solicitationId": solicitation_id,
                     "complianceMatches": len(compliance_vars),
                     "extractionMethod": "pattern_based",
                     "durationMs": duration_ms},
        )
    except Exception:
        pass
    return result
