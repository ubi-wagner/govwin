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
    # TODO: Implement proposal preview generation
    #
    # Implementation steps:
    # 1. Fetch proposal + verify it exists and is in 'final' stage:
    #      SELECT p.id, p.tenant_id, p.title, p.stage
    #      FROM proposals p WHERE p.id = $1
    #
    # 2. Fetch all sections with content:
    #      SELECT id, section_number, title, content
    #      FROM proposal_sections
    #      WHERE proposal_id = $1
    #      ORDER BY section_number
    #
    # 3. For each section with canvas JSON content:
    #    a. Parse the canvas JSON
    #    b. Call the frontend export API or use a Python DOCX generation
    #       library directly. Since the DocxAgent exists in pipeline/src/document/,
    #       use that:
    #         from document.docx_agent import DocxAgent
    #         agent = DocxAgent()
    #         buffer = agent.export(canvas_doc)
    #
    # 4. Bundle all section DOCXs into a ZIP:
    #      import zipfile, io
    #      zip_buffer = io.BytesIO()
    #      with zipfile.ZipFile(zip_buffer, 'w') as zf:
    #          for section in sections:
    #              zf.writestr(f"{section.number}_{section.title}.docx", buffer)
    #
    # 5. Upload ZIP to S3:
    #      from storage.s3_client import put_bytes
    #      from storage.paths import customer_proposal_path
    #      key = customer_proposal_path(tenant_id, proposal_id, "preview.zip")
    #      put_bytes(key=key, data=zip_buffer.getvalue())
    #
    # 6. Generate presigned URL and return

    raise NotImplementedError(
        "generate_preview() action not yet implemented — see inline TODO for steps"
    )
