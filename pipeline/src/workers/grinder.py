"""
Document Grinder Worker — Decomposes uploaded documents into atomic library units.

Triggered when:
  - A document upload is ingested into the library (library.upload_ingested)
  - A document is added via the binder (binder.upload_added)

Pipeline:
  1. Read the upload record from tenant_uploads
  2. Load and extract text from the file (PDF, DOCX, or plain text)
  3. Send text to Claude for decomposition into atomic library units
  4. Insert units into library_units table
  5. Update tenant_uploads.library_status to 'atomized'
  6. Emit library.atoms_extracted customer event
"""

import asyncio
import json
import logging
import os
import uuid
from pathlib import Path
from typing import Optional

import anthropic

from .base import BaseEventWorker
from events import (
    emit_customer_event,
    pipeline_actor,
    trigger_ref,
)

log = logging.getLogger("workers.grinder")

# Maximum document size we will attempt to process (10 MB of text)
MAX_TEXT_LENGTH = 10_000_000

# Valid library unit categories (must match DB constraint)
VALID_CATEGORIES = frozenset({
    "bio", "facility", "tech_approach", "past_performance", "management",
    "commercialization", "budget", "timeline", "innovation", "team",
    "references", "appendix", "cover_letter", "executive_summary", "other",
})

DECOMPOSITION_PROMPT = """\
You are a proposal library analyst. Your job is to decompose the following document \
into discrete, reusable atomic units for a government proposal library.

Each unit should be a self-contained piece of content that can be reused across \
multiple proposals. Units should be granular — one concept, one past performance \
example, one bio, one capability statement, etc.

For each unit, provide:
- "content": The full text of the unit (preserve important details, numbers, dates)
- "category": One of: bio, facility, tech_approach, past_performance, management, \
commercialization, budget, timeline, innovation, team, references, appendix, \
cover_letter, executive_summary, other
- "subcategory": A more specific label (e.g. "key_personnel" under "bio", \
"contract_summary" under "past_performance")
- "tags": An array of 2-6 keyword tags for search/retrieval
- "confidence_score": 0.0-1.0 indicating how confident you are this is a coherent, \
reusable unit

Return ONLY valid JSON — an object with a single key "units" containing an array of unit objects.
Do not include any text outside the JSON block.

Example format:
{
  "units": [
    {
      "content": "Dr. Jane Smith has 15 years of experience in...",
      "category": "bio",
      "subcategory": "key_personnel",
      "tags": ["cybersecurity", "PhD", "project_lead"],
      "confidence_score": 0.92
    }
  ]
}

--- DOCUMENT START ---
%s
--- DOCUMENT END ---
"""


def _extract_text_pdf(file_path: str) -> str:
    """Extract text from a PDF file using pymupdf4llm. Runs in thread."""
    import pymupdf4llm

    return pymupdf4llm.to_markdown(file_path)


def _extract_text_docx(file_path: str) -> str:
    """Extract text from a DOCX file using python-docx. Runs in thread."""
    import docx

    doc = docx.Document(file_path)
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    return "\n\n".join(paragraphs)


def _extract_text_plain(file_path: str) -> str:
    """Read a plain text file. Runs in thread."""
    return Path(file_path).read_text(encoding="utf-8", errors="replace")


class GrinderUploadWorker(BaseEventWorker):
    """
    Consumes: library.upload_ingested, binder.upload_added from customer_events
    Action: Decomposes uploaded documents into atomic library units via Claude
    Output: Inserts rows into library_units, emits library.atoms_extracted
    """

    namespace = "grinder.upload"
    event_bus = "customer_events"
    event_types = ["library.upload_ingested", "binder.upload_added"]
    batch_size = 5  # conservative — each event triggers an LLM call

    async def on_start(self) -> None:
        """Initialize the Anthropic client."""
        try:
            self.client = anthropic.AsyncAnthropic()
        except Exception as e:
            self.log.error(f"[grinder] Failed to initialize Anthropic client: {e}")
            raise

    async def handle_event(self, event: dict) -> None:
        tenant_id = event.get("tenant_id")
        entity_id = event.get("entity_id")
        upload_id = entity_id

        if not tenant_id or not upload_id:
            self.log.warning(
                "[grinder] Event missing tenant_id or entity_id, skipping"
            )
            return

        # -----------------------------------------------------------
        # 1. Fetch the upload record
        # -----------------------------------------------------------
        upload = None
        try:
            upload = await self.conn.fetchrow(
                """
                SELECT id, tenant_id, filename, original_filename,
                       file_path, mime_type, library_status, upload_category,
                       description
                FROM tenant_uploads
                WHERE id = $1 AND tenant_id = $2
                """,
                upload_id,
                tenant_id,
            )
        except Exception as e:
            self.log.error(f"[grinder] Failed to fetch upload {upload_id}: {e}")
            return

        if not upload:
            self.log.warning(f"[grinder] Upload {upload_id} not found, skipping")
            return

        # Skip if already processed or currently processing
        if upload["library_status"] not in ("pending", None):
            self.log.info(
                f"[grinder] Upload {upload_id} status is '{upload['library_status']}', skipping"
            )
            return

        filename = upload["filename"] or ""
        original_filename = upload["original_filename"] or filename

        # -----------------------------------------------------------
        # 2. Mark as processing
        # -----------------------------------------------------------
        try:
            locked = await self.conn.fetchval(
                """
                UPDATE tenant_uploads
                SET library_status = 'processing'
                WHERE id = $1 AND library_status IN ('pending')
                RETURNING id
                """,
                upload_id,
            )
            if not locked:
                self.log.info(f"[grinder] Upload {upload_id} already being processed, skipping")
                return
        except Exception as e:
            self.log.error(f"[grinder] Failed to lock upload {upload_id}: {e}")
            return

        # From here on, any failure should mark the upload as 'failed'
        try:
            await self._process_upload(event, upload)
        except Exception as e:
            self.log.error(f"[grinder] Failed to process upload {upload_id}: {e}", exc_info=True)
            try:
                await self.conn.execute(
                    """
                    UPDATE tenant_uploads
                    SET library_status = 'failed'
                    WHERE id = $1
                    """,
                    upload_id,
                )
            except Exception as db_err:
                self.log.error(f"[grinder] Failed to mark upload {upload_id} as failed: {db_err}")

    async def _process_upload(self, event: dict, upload: dict) -> None:
        """Core processing logic. Raises on failure so caller can mark as failed."""
        upload_id = upload["id"]
        tenant_id = upload["tenant_id"]
        filename = upload["filename"] or ""
        original_filename = upload["original_filename"] or filename
        mime_type = upload["mime_type"] or ""

        # -----------------------------------------------------------
        # 3. Read and extract text from the file
        # -----------------------------------------------------------
        # file_path column stores the relative path (e.g. "customers/slug/uploads/123-doc.pdf")
        # STORAGE_ROOT (default /data) is prepended to get the absolute path
        storage_root = os.environ.get("STORAGE_ROOT", "/data")
        relative_path = upload["file_path"] or ""
        file_path = os.path.join(storage_root, relative_path) if relative_path else ""
        if not file_path or not os.path.isfile(file_path):
            raise FileNotFoundError(f"Upload file not found at {file_path}")

        text = await self._extract_text(file_path, mime_type, filename)

        if not text or not text.strip():
            self.log.warning(f"[grinder] No text extracted from {original_filename}, skipping")
            await self.conn.execute(
                """
                UPDATE tenant_uploads
                SET library_status = 'skipped'
                WHERE id = $1
                """,
                upload_id,
            )
            return

        # Truncate very long documents to stay within token limits
        if len(text) > MAX_TEXT_LENGTH:
            self.log.warning(
                f"[grinder] Text from {original_filename} truncated from {len(text)} to {MAX_TEXT_LENGTH} chars"
            )
            text = text[:MAX_TEXT_LENGTH]

        # -----------------------------------------------------------
        # 4. Call Claude to decompose into atomic units
        # -----------------------------------------------------------
        units = await self._decompose_with_claude(text, original_filename)

        if not units:
            self.log.warning(f"[grinder] No units extracted from {original_filename}")
            await self.conn.execute(
                """
                UPDATE tenant_uploads
                SET library_status = 'skipped'
                WHERE id = $1
                """,
                upload_id,
            )
            return

        # -----------------------------------------------------------
        # 5. Insert units into library_units
        # -----------------------------------------------------------
        categories_seen: set[str] = set()

        for unit in units:
            unit_id = str(uuid.uuid4())
            category = unit.get("category", "other")
            if category not in VALID_CATEGORIES:
                category = "other"
            categories_seen.add(category)

            subcategory = unit.get("subcategory") or None
            tags = unit.get("tags") or []
            # Ensure tags is a list of strings
            tags = [str(t) for t in tags if t][:10]
            confidence = unit.get("confidence_score")
            if confidence is not None:
                try:
                    confidence = float(confidence)
                    confidence = max(0.0, min(1.0, confidence))
                except (ValueError, TypeError):
                    confidence = None

            content = unit.get("content", "")
            if not content or not content.strip():
                continue

            try:
                await self.conn.execute(
                    """
                    INSERT INTO library_units (
                        id, tenant_id, content, content_type, category,
                        subcategory, tags, confidence_score, status,
                        source_upload_id, origin_type, created_at, updated_at
                    ) VALUES (
                        $1, $2, $3, $4, $5,
                        $6, $7, $8, $9,
                        $10, $11, NOW(), NOW()
                    )
                    """,
                    uuid.UUID(unit_id),
                    tenant_id,
                    content.strip(),
                    "text",
                    category,
                    subcategory,
                    tags,
                    confidence,
                    "draft",
                    upload_id,
                    "upload",
                )
            except Exception as e:
                self.log.error(
                    f"[grinder] Failed to insert unit for upload {upload_id}: {e}"
                )
                # Continue inserting remaining units rather than aborting
                continue

        inserted_count = len(units)

        # -----------------------------------------------------------
        # 6. Update upload status to atomized
        # -----------------------------------------------------------
        try:
            await self.conn.execute(
                """
                UPDATE tenant_uploads
                SET library_status = 'atomized'
                WHERE id = $1
                """,
                upload_id,
            )
        except Exception as e:
            self.log.error(f"[grinder] Failed to update upload {upload_id} status: {e}")
            raise

        # -----------------------------------------------------------
        # 7. Emit library.atoms_extracted event
        # -----------------------------------------------------------
        await emit_customer_event(
            self.conn,
            tenant_id=str(tenant_id),
            event_type="library.atoms_extracted",
            entity_type="upload",
            entity_id=str(upload_id),
            description=f"Extracted {inserted_count} atomic units from '{original_filename}'",
            actor=pipeline_actor("grinder"),
            trigger=trigger_ref(str(event["id"]), event["event_type"]),
            payload={
                "upload_id": str(upload_id),
                "atoms_extracted": inserted_count,
                "categories": list(categories_seen),
            },
        )

        self.log.info(
            f"[grinder] Extracted {inserted_count} units from '{original_filename}' "
            f"(categories: {', '.join(sorted(categories_seen))})"
        )

    async def _extract_text(
        self, file_path: str, mime_type: str, filename: str
    ) -> str:
        """
        Extract text from a file based on its MIME type or extension.
        Uses asyncio.to_thread for blocking I/O.
        """
        mime_lower = mime_type.lower() if mime_type else ""
        name_lower = filename.lower() if filename else ""

        if mime_lower == "application/pdf" or name_lower.endswith(".pdf"):
            self.log.info(f"[grinder] Extracting text from PDF: {filename}")
            return await asyncio.to_thread(_extract_text_pdf, file_path)

        if (
            mime_lower
            == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            or name_lower.endswith(".docx")
        ):
            self.log.info(f"[grinder] Extracting text from DOCX: {filename}")
            return await asyncio.to_thread(_extract_text_docx, file_path)

        if (
            mime_lower.startswith("text/")
            or name_lower.endswith(".txt")
            or name_lower.endswith(".md")
            or name_lower.endswith(".csv")
        ):
            self.log.info(f"[grinder] Reading plain text: {filename}")
            return await asyncio.to_thread(_extract_text_plain, file_path)

        # Attempt plain text as a fallback for unknown types
        self.log.warning(
            f"[grinder] Unknown mime type '{mime_type}' for {filename}, "
            f"attempting plain text extraction"
        )
        return await asyncio.to_thread(_extract_text_plain, file_path)

    async def _decompose_with_claude(
        self, text: str, filename: str
    ) -> list[dict]:
        """
        Send document text to Claude for decomposition into atomic units.
        Returns a list of unit dicts, or empty list on failure.
        """
        prompt = DECOMPOSITION_PROMPT % text

        try:
            response = await self.client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=4096,
                messages=[{"role": "user", "content": prompt}],
            )
        except anthropic.APIConnectionError as e:
            self.log.error(f"[grinder] Anthropic API connection error for '{filename}': {e}")
            raise
        except anthropic.RateLimitError as e:
            self.log.error(f"[grinder] Anthropic rate limit hit for '{filename}': {e}")
            raise
        except anthropic.APIStatusError as e:
            self.log.error(f"[grinder] Anthropic API error for '{filename}': {e}")
            raise

        # Extract the text content from the response
        response_text = ""
        for block in response.content:
            if block.type == "text":
                response_text += block.text

        if not response_text.strip():
            self.log.warning(f"[grinder] Empty response from Claude for '{filename}'")
            return []

        # Parse JSON response
        return self._parse_units_response(response_text, filename)

    def _parse_units_response(self, response_text: str, filename: str) -> list[dict]:
        """
        Parse Claude's JSON response into a list of unit dicts.
        Handles common formatting issues (markdown code blocks, etc.).
        """
        text = response_text.strip()

        # Strip markdown code fence if present
        if text.startswith("```"):
            # Remove opening fence (```json or ```)
            first_newline = text.index("\n") if "\n" in text else len(text)
            text = text[first_newline + 1:]
            # Remove closing fence
            if text.endswith("```"):
                text = text[:-3].strip()

        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as e:
            self.log.error(
                f"[grinder] Failed to parse Claude response as JSON for '{filename}': {e}"
            )
            return []

        if isinstance(parsed, dict) and "units" in parsed:
            units = parsed["units"]
        elif isinstance(parsed, list):
            units = parsed
        else:
            self.log.error(
                f"[grinder] Unexpected JSON structure from Claude for '{filename}': "
                f"expected object with 'units' key or array"
            )
            return []

        if not isinstance(units, list):
            self.log.error(f"[grinder] 'units' is not a list for '{filename}'")
            return []

        # Validate each unit has at minimum a content field
        valid_units = []
        for unit in units:
            if not isinstance(unit, dict):
                continue
            if not unit.get("content"):
                continue
            valid_units.append(unit)

        self.log.info(
            f"[grinder] Parsed {len(valid_units)} valid units from Claude response "
            f"for '{filename}' (raw: {len(units)})"
        )
        return valid_units
