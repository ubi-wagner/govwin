"""
Workflow ACTION target for proposal preview generation.

Called by OnProposalAdvancedToFinal workflow when a proposal enters the
"final" stage. Generates a preview document (DOCX or ZIP of all sections)
and stores it to S3 for download.

Trigger chain:
  customer advances proposal to final → proposal:proposal.advanced:single
  → OnProposalAdvancedToFinal.generate_export_preview → this function
"""
from __future__ import annotations

import json
import logging
from typing import Any

import asyncpg

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

    proposal_uuid = uuid_mod.UUID(proposal_id)

    # 1. Fetch proposal + verify it exists
    proposal = await conn.fetchrow(
        """SELECT p.id, p.tenant_id, p.title, p.stage
           FROM proposals p WHERE p.id = $1""",
        proposal_uuid,
    )
    if proposal is None:
        return {"status": "skipped", "reason": "proposal_not_found"}

    tenant_id = str(proposal["tenant_id"])

    # 2. Fetch all sections with content
    sections = await conn.fetch(
        """SELECT id, section_number, title, content
           FROM proposal_sections
           WHERE proposal_id = $1
           ORDER BY section_number""",
        proposal_uuid,
    )

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

    total_bytes = zip_buffer.tell()
    zip_buffer.seek(0)

    # 4. Upload ZIP to S3
    preview_url = None
    try:
        from storage.s3_client import put_bytes
        from storage.paths import customer_proposal_path

        key = customer_proposal_path(
            tenant_id=tenant_id,
            proposal_id=proposal_id,
            name="preview.zip",
        )
        put_bytes(key=key, data=zip_buffer.getvalue(), content_type="application/zip")
        preview_url = key
        log.info("generate_preview: wrote %s (%d bytes)", key, total_bytes)
    except ImportError:
        log.info("generate_preview: storage module unavailable, skipping S3 upload")
    except Exception as e:
        log.error("generate_preview: S3 upload failed: %s", e)

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
                text = node.get("text") or node.get("content") or ""

                if node_type == "heading":
                    level = node.get("level", 2)
                    parts.append(f"{'#' * level} {text}")
                elif node_type == "text_block":
                    parts.append(text)
                elif node_type in ("bulleted_list", "numbered_list"):
                    items = node.get("items", [])
                    for i, item in enumerate(items):
                        item_text = item if isinstance(item, str) else str(item)
                        prefix = f"{i + 1}." if node_type == "numbered_list" else "-"
                        parts.append(f"  {prefix} {item_text}")
                elif node_type == "table":
                    parts.append(str(node.get("data", text)))
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
