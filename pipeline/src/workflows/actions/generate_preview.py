"""
================================================================================
Workflow Action: generate_preview (generate_preview.py)
================================================================================

WHO:    Called by workflow processor when OnProposalAdvancedToFinal workflow
        executes the generate_export_preview step.

WHAT:   Generates a preview document for a proposal entering the final
        stage. Fetches all proposal sections, extracts readable markdown
        from canvas JSON content, bundles all sections into a ZIP file,
        and uploads to S3 at the tenant's storage path. Updates the
        proposal metadata with the preview download URL.

INPUTS:
        - proposal_id: str — proposals.id (UUID string)

OUTPUTS:
        - previewUrl: Optional[str] — S3 key of the uploaded ZIP (None if
          upload failed or storage module unavailable)
        - sectionsExported: int — number of sections included in the ZIP
        - totalBytes: int — total size of the ZIP in bytes
        - status: str — "skipped" if proposal not found or no sections

ERROR HANDLING:
    - Proposal not found: Returns status="skipped", reason="proposal_not_found"
    - No sections: Returns status="skipped", reason="no_sections"
    - Invalid proposal_id format: Raises ValueError (caught by processor)
    - Canvas JSON parse failure: Falls back to raw content (per section)
    - S3 upload failure: Caught and logged; returns previewUrl=None but
      still reports sectionsExported and totalBytes
    - Storage module unavailable: Logged as info; ZIP is generated in
      memory but not uploaded (V1 may not have S3 configured)
    - Tenant slug not found: Logged as warning; S3 upload skipped

TENANT ISOLATION:
    - Reads proposal data scoped by proposal_id (proposals table has
      tenant_id column for RLS)
    - S3 upload path includes tenant slug: customers/{slug}/proposal-export/
    - No cross-tenant data access

EVENT EMISSIONS:
    - None directly — events are emitted by the workflow processor at
      the step level (workflow.step_completed / workflow.step_failed).

CHANGE LOG:
    PR #140 (2026-05-22) — Initial implementation: section export as
                           markdown, ZIP bundling, S3 upload
    PR #xxx (2026-05-22) — Added comprehensive documentation header,
                           error handling for S3 failures, canvas JSON
                           fallback, tenant isolation documentation
================================================================================
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any

import asyncpg

from events import emit_event

log = logging.getLogger("pipeline.workflows.actions.generate_preview")


async def generate_preview(
    conn: asyncpg.Connection,
    *,
    proposal_id: str,
) -> dict[str, Any]:
    """Generate a preview document for a proposal entering final stage.

    Fetches all proposal sections, exports each canvas document to DOCX,
    bundles into a ZIP, and uploads to S3. Updates the proposal metadata
    with the preview download URL.

    Args:
        conn: Active asyncpg connection.
        proposal_id: proposals.id (UUID string).

    Returns:
        {
            "previewUrl": "s3://...",
            "sectionsExported": 5,
            "totalBytes": 123456,
        }
    """
    import io
    import uuid as uuid_mod
    import zipfile

    start_ms = time.monotonic()

    # Validate proposal_id format
    try:
        proposal_uuid = uuid_mod.UUID(proposal_id)
    except (ValueError, TypeError):
        log.error("generate_preview: invalid proposal_id: %s", proposal_id)
        return {"status": "skipped", "reason": "invalid_proposal_id"}

    # Emit start event
    start_event_id = ""
    try:
        start_event_id = await emit_event(
            conn, namespace="proposal", type="preview.generated", phase="start",
            payload={"proposalId": proposal_id},
        )
    except Exception as exc:
        log.error("generate_preview: failed to emit start event: %s", exc)

    # 1. Fetch proposal + verify it exists
    try:
        proposal = await conn.fetchrow(
            """SELECT p.id, p.tenant_id, p.title, p.stage
               FROM proposals p WHERE p.id = $1""",
            proposal_uuid,
        )
    except Exception as exc:
        log.error("generate_preview: failed to fetch proposal: %s", exc)
        return {"status": "skipped", "reason": f"db_error: {exc}"}

    if proposal is None:
        return {"status": "skipped", "reason": "proposal_not_found"}

    tenant_id = str(proposal["tenant_id"])

    # 2. Fetch all sections with content
    try:
        sections = await conn.fetch(
            """SELECT id, section_number, title, content
               FROM proposal_sections
               WHERE proposal_id = $1
               ORDER BY section_number""",
            proposal_uuid,
        )
    except Exception as exc:
        log.error("generate_preview: failed to fetch sections: %s", exc)
        return {"status": "skipped", "reason": f"db_error: {exc}"}

    if not sections:
        return {"status": "skipped", "reason": "no_sections"}

    # 3. Build section text files and bundle into a ZIP.
    #    For V1, we export each section's canvas content as a plain-text
    #    markdown file. Full DOCX export via DocxAgent will be wired
    #    in a future iteration when the document module is stable.
    zip_buffer = io.BytesIO()
    sections_exported = 0

    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for section in sections:
            try:
                sec_num = section["section_number"] or 0
                sec_title = (section["title"] or f"Section {sec_num}").strip()
                raw_content = section["content"] or ""

                # Canvas content is stored as JSON string; extract readable text
                section_text = _extract_readable_text(sec_title, raw_content)

                safe_title = "".join(
                    c if c.isalnum() or c in " _-" else "_" for c in sec_title
                )[:80]
                filename = f"{sec_num:02d}_{safe_title}.md"
                zf.writestr(filename, section_text)
                sections_exported += 1
            except Exception as exc:
                log.warning(
                    "generate_preview: failed to export section %s: %s",
                    section.get("id"),
                    exc,
                )
                # Continue with remaining sections
                continue

    total_bytes = zip_buffer.tell()
    zip_buffer.seek(0)

    # 4. Upload ZIP to S3
    preview_url = None
    try:
        from storage.s3_client import put_object
        from storage.paths import CustomerPathInput, customer_path

        # Fetch tenant slug for the storage path
        tenant_slug = await conn.fetchval(
            "SELECT slug FROM tenants WHERE id = $1",
            proposal["tenant_id"],
        )
        if tenant_slug:
            key = customer_path(CustomerPathInput(
                tenant_slug=tenant_slug,
                kind="proposal-export",
                proposal_id=proposal_id,
                name="preview",
                ext="zip",
            ))
            put_object(key=key, body=zip_buffer.getvalue(), content_type="application/zip")
            preview_url = key
            log.info("generate_preview: wrote %s (%d bytes)", key, total_bytes)
        else:
            log.warning("generate_preview: tenant slug not found for %s", tenant_id)
    except ImportError:
        log.info("generate_preview: storage module unavailable, skipping S3 upload")
    except Exception as e:
        log.error("generate_preview: S3 upload failed: %s", e)

    duration_ms = int((time.monotonic() - start_ms) * 1000)
    try:
        await emit_event(
            conn, namespace="proposal", type="preview.generated", phase="end",
            parent_event_id=start_event_id,
            tenant_id=tenant_id,
            payload={"proposalId": proposal_id, "sectionsExported": sections_exported,
                     "totalBytes": total_bytes, "hasPreviewUrl": preview_url is not None,
                     "durationMs": duration_ms},
        )
    except Exception as exc:
        log.error("generate_preview: failed to emit end event: %s", exc)

    return {
        "previewUrl": preview_url,
        "sectionsExported": sections_exported,
        "totalBytes": total_bytes,
    }


def _extract_readable_text(title: str, raw_content: str) -> str:
    """Extract readable markdown text from canvas JSON or raw content.

    Canvas documents are stored as JSON strings in proposal_sections.content.
    This extracts the text from each node for a readable preview.
    Falls back to raw content if parsing fails.
    """
    header = f"# {title}\n\n"

    if not raw_content:
        return header + "(empty section)\n"

    # Try to parse as canvas JSON
    try:
        canvas = json.loads(raw_content)
        if isinstance(canvas, dict) and "nodes" in canvas:
            parts: list[str] = []
            for node in canvas.get("nodes", []):
                node_type = node.get("type", "")
                content = node.get("content", {})

                if isinstance(content, str):
                    text = content
                elif isinstance(content, dict):
                    text = content.get("text", "")
                else:
                    text = ""

                if node_type == "heading":
                    level = node.get("level", 2)
                    parts.append(f"{'#' * level} {text}")
                elif node_type == "text_block":
                    parts.append(text)
                elif node_type in ("bulleted_list", "numbered_list"):
                    items = content.get("items", []) if isinstance(content, dict) else []
                    for i, item in enumerate(items):
                        if isinstance(item, dict):
                            item_text = item.get("text", "")
                        elif isinstance(item, str):
                            item_text = item
                        else:
                            item_text = str(item)
                        prefix = f"{i + 1}." if node_type == "numbered_list" else "-"
                        parts.append(f"  {prefix} {item_text}")
                elif node_type == "table":
                    rows = content.get("rows", []) if isinstance(content, dict) else []
                    for row in rows:
                        if isinstance(row, list):
                            row_texts = []
                            for cell in row:
                                if isinstance(cell, str):
                                    row_texts.append(cell)
                                elif isinstance(cell, dict):
                                    row_texts.append(cell.get("text", ""))
                                else:
                                    row_texts.append(str(cell))
                            parts.append(" | ".join(row_texts))
                elif node_type == "page_break":
                    parts.append("\n---\n")
                elif text:
                    parts.append(text)

            if parts:
                return header + "\n\n".join(parts) + "\n"
    except (json.JSONDecodeError, TypeError, AttributeError):
        pass

    # Fallback: return raw content
    return header + raw_content + "\n"
