"""
RFP Parser Worker — Shreds uploaded RFP documents into structured templates.

Triggered when:
  - A document_fetcher finishes downloading an RFP (emits rfp.parsed)

Pipeline:
  1. Fetch the document record and opportunity metadata
  2. Read the downloaded file and extract text (PDF via pymupdf4llm)
  3. Try to match against rfp_template_library by agency/program_type
  4. Send text to Claude for structured extraction (sections, requirements,
     page limits, evaluation criteria, submission format)
  5. Insert or update rfp_templates record
  6. Emit rfp.template_extracted opportunity event
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
    emit_opportunity_event,
    pipeline_actor,
    trigger_ref,
)

log = logging.getLogger("workers.rfp_parser")

STORAGE_ROOT = os.environ.get("STORAGE_ROOT", "/data")

# Maximum text length sent to Claude (roughly ~2.5M tokens worth of chars)
MAX_TEXT_LENGTH = 10_000_000

EXTRACTION_PROMPT = """\
You are an expert government RFP analyst. Analyze the following RFP document and \
extract its structure into a precise JSON format.

Extract the following:

1. **sections** — An array of section objects, each with:
   - "title": The section title (e.g. "Technical Approach", "Past Performance")
   - "number": The section/volume number if given (e.g. "3.1", "Volume II")
   - "requirements": An array of strings describing what the section requires
   - "page_limit": Integer page limit for this section, or null if not specified
   - "instructions": Any specific formatting or content instructions for this section

2. **constraints** — An object with:
   - "overall_page_limit": Total page limit for the entire proposal, or null
   - "font_requirements": Font name and size if specified, or null
   - "margin_requirements": Margin specifications if given, or null
   - "spacing_requirements": Line spacing requirements if given, or null
   - "other": Array of any other formatting constraints mentioned

3. **submission_format** — An object with:
   - "delivery_method": How to submit (e.g. "email", "SAM.gov", "grants.gov", "portal")
   - "file_types": Array of accepted file types (e.g. ["PDF", "DOCX"])
   - "naming_convention": File naming requirements if specified, or null
   - "submission_deadline": The deadline date/time as a string, or null
   - "submission_address": Email or URL for submission, or null

4. **evaluation_criteria** — An array of objects, each with:
   - "factor": The evaluation factor name
   - "weight": Numeric weight or percentage if given, or null
   - "description": Brief description of what is evaluated
   - "subfactors": Array of subfactor strings if any, or null

Return ONLY valid JSON with keys: "sections", "constraints", "submission_format", \
"evaluation_criteria". Do not include any text outside the JSON block.

--- RFP DOCUMENT START ---
%s
--- RFP DOCUMENT END ---
"""


def _extract_text_pdf(file_path: str) -> str:
    """Extract text from a PDF using pymupdf4llm. Runs in a thread."""
    import pymupdf4llm

    return pymupdf4llm.to_markdown(file_path)


def _extract_text_plain(file_path: str) -> str:
    """Read a plain-text or fallback file. Runs in a thread."""
    return Path(file_path).read_text(encoding="utf-8", errors="replace")


class RfpParserWorker(BaseEventWorker):
    """
    Consumes: rfp.parsed from opportunity_events
    Action: Extracts structured RFP template from downloaded documents via Claude
    Output: Inserts into rfp_templates, emits rfp.template_extracted
    """

    namespace = "rfp.parser"
    event_bus = "opportunity_events"
    event_types = ["rfp.parsed"]
    batch_size = 5  # conservative — each event triggers an LLM call

    async def on_start(self) -> None:
        """Initialize the Anthropic client."""
        try:
            self.client = anthropic.AsyncAnthropic()
        except Exception as e:
            self.log.error(f"[rfp_parser] Failed to initialize Anthropic client: {e}")
            raise

    async def handle_event(self, event: dict) -> None:
        opp_id = event.get("opportunity_id")
        if not opp_id:
            self.log.warning("[rfp_parser] Event missing opportunity_id, skipping")
            return

        # Extract document_id from event metadata if available
        metadata = event.get("metadata")
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except (json.JSONDecodeError, TypeError):
                metadata = {}
        metadata = metadata or {}
        payload = metadata.get("payload", {})
        document_id = payload.get("document_id")

        # -----------------------------------------------------------------
        # 1. Fetch the document record
        # -----------------------------------------------------------------
        doc = None
        try:
            if document_id:
                doc = await self.conn.fetchrow(
                    """
                    SELECT id, opportunity_id, filename, local_path,
                           storage_path, mime_type
                    FROM documents
                    WHERE id = $1 AND opportunity_id = $2
                      AND download_status = 'downloaded'
                    """,
                    document_id,
                    opp_id,
                )
            else:
                # Fall back to finding the most recent downloaded RFP document
                doc = await self.conn.fetchrow(
                    """
                    SELECT id, opportunity_id, filename, local_path,
                           storage_path, mime_type
                    FROM documents
                    WHERE opportunity_id = $1
                      AND download_status = 'downloaded'
                    ORDER BY created_at DESC
                    LIMIT 1
                    """,
                    opp_id,
                )
        except Exception as e:
            self.log.error(f"[rfp_parser] Failed to fetch document for opp {opp_id}: {e}")
            return

        if not doc:
            self.log.warning(
                f"[rfp_parser] No downloaded document found for opportunity {opp_id}, skipping"
            )
            return

        # -----------------------------------------------------------------
        # 2. Fetch opportunity metadata (for template library matching)
        # -----------------------------------------------------------------
        opp = None
        try:
            opp = await self.conn.fetchrow(
                """
                SELECT id, agency, program_type, sub_agency, title
                FROM opportunities
                WHERE id = $1
                """,
                opp_id,
            )
        except Exception as e:
            self.log.error(f"[rfp_parser] Failed to fetch opportunity {opp_id}: {e}")
            return

        if not opp:
            self.log.warning(f"[rfp_parser] Opportunity {opp_id} not found, skipping")
            return

        # -----------------------------------------------------------------
        # 3. Extract text from the document
        # -----------------------------------------------------------------
        file_path = self._resolve_file_path(doc)
        if not file_path or not os.path.isfile(file_path):
            self.log.error(
                f"[rfp_parser] Document file not found at {file_path} "
                f"for doc {doc['id']}, skipping"
            )
            return

        try:
            text = await self._extract_text(
                file_path, doc["mime_type"] or "", doc["filename"] or ""
            )
        except Exception as e:
            self.log.error(
                f"[rfp_parser] Text extraction failed for {doc['filename']}: {e}",
                exc_info=True,
            )
            return

        if not text or not text.strip():
            self.log.warning(
                f"[rfp_parser] No text extracted from {doc['filename']}, skipping"
            )
            return

        if len(text) > MAX_TEXT_LENGTH:
            self.log.warning(
                f"[rfp_parser] Text from {doc['filename']} truncated "
                f"from {len(text)} to {MAX_TEXT_LENGTH} chars"
            )
            text = text[:MAX_TEXT_LENGTH]

        # -----------------------------------------------------------------
        # 4. Try matching against rfp_template_library
        # -----------------------------------------------------------------
        base_template = await self._find_library_template(opp)
        base_template_id = base_template["id"] if base_template else None

        # -----------------------------------------------------------------
        # 5. Call Claude to extract RFP structure
        # -----------------------------------------------------------------
        try:
            extracted = await self._extract_with_claude(text, doc["filename"] or "")
        except Exception as e:
            self.log.error(
                f"[rfp_parser] Claude extraction failed for opp {opp_id}: {e}",
                exc_info=True,
            )
            return

        if not extracted:
            self.log.warning(
                f"[rfp_parser] No structure extracted from {doc['filename']}"
            )
            return

        # Merge with library template if one was found
        if base_template:
            extracted = self._merge_with_template(base_template, extracted)

        # -----------------------------------------------------------------
        # 6. Insert or update rfp_templates record
        # -----------------------------------------------------------------
        sections = extracted.get("sections") or []
        constraints = extracted.get("constraints") or {}
        submission_format = extracted.get("submission_format") or {}
        evaluation_criteria = extracted.get("evaluation_criteria") or []

        template_id = None
        try:
            template_id = await self._upsert_template(
                opp_id=opp_id,
                base_template_id=base_template_id,
                sections=sections,
                constraints=constraints,
                submission_format=submission_format,
                evaluation_criteria=evaluation_criteria,
            )
        except Exception as e:
            self.log.error(
                f"[rfp_parser] Failed to upsert rfp_template for opp {opp_id}: {e}",
                exc_info=True,
            )
            return

        if not template_id:
            self.log.error(f"[rfp_parser] Upsert returned no template_id for opp {opp_id}")
            return

        # -----------------------------------------------------------------
        # 7. Emit rfp.template_extracted event
        # -----------------------------------------------------------------
        await emit_opportunity_event(
            self.conn,
            opportunity_id=str(opp_id),
            event_type="rfp.template_extracted",
            source="rfp_parser",
            actor=pipeline_actor("rfp_parser"),
            trigger=trigger_ref(str(event["id"]), event["event_type"]),
            payload={
                "template_id": str(template_id),
                "sections_found": len(sections),
                "has_evaluation_criteria": len(evaluation_criteria) > 0,
                "has_page_limits": bool(constraints.get("overall_page_limit")),
                "base_template_used": base_template_id is not None,
            },
        )

        self.log.info(
            f"[rfp_parser] Extracted template {template_id} for opp {opp_id}: "
            f"{len(sections)} sections, {len(evaluation_criteria)} eval criteria"
        )

    # -----------------------------------------------------------------
    # File resolution
    # -----------------------------------------------------------------

    def _resolve_file_path(self, doc: dict) -> Optional[str]:
        """
        Resolve the absolute file path from the document record.
        Prefers local_path if set; falls back to STORAGE_ROOT + storage_path.
        """
        local_path = doc.get("local_path")
        if local_path and os.path.isfile(local_path):
            return local_path

        storage_path = doc.get("storage_path")
        if storage_path:
            return os.path.join(STORAGE_ROOT, storage_path)

        return None

    # -----------------------------------------------------------------
    # Text extraction
    # -----------------------------------------------------------------

    async def _extract_text(
        self, file_path: str, mime_type: str, filename: str
    ) -> str:
        """
        Extract text from a document file. Uses asyncio.to_thread for
        blocking I/O operations.
        """
        mime_lower = mime_type.lower() if mime_type else ""
        name_lower = filename.lower() if filename else ""

        if mime_lower == "application/pdf" or name_lower.endswith(".pdf"):
            self.log.info(f"[rfp_parser] Extracting text from PDF: {filename}")
            return await asyncio.to_thread(_extract_text_pdf, file_path)

        # For non-PDF types, attempt plain text as fallback
        self.log.info(
            f"[rfp_parser] Reading as plain text (mime={mime_type}): {filename}"
        )
        return await asyncio.to_thread(_extract_text_plain, file_path)

    # -----------------------------------------------------------------
    # Template library matching
    # -----------------------------------------------------------------

    async def _find_library_template(self, opp: dict) -> Optional[dict]:
        """
        Attempt to find a matching pre-built template in rfp_template_library
        based on agency and program_type from the opportunity.

        Returns the template record or None.
        """
        agency = opp.get("agency")
        program_type = opp.get("program_type")
        sub_agency = opp.get("sub_agency")

        if not agency:
            return None

        try:
            # Try exact match on agency + program_type + sub_agency first
            if program_type and sub_agency:
                template = await self.conn.fetchrow(
                    """
                    SELECT id, agency, program_type, sub_agency,
                           sections, constraints, submission_format,
                           evaluation_criteria
                    FROM rfp_template_library
                    WHERE agency = $1
                      AND program_type = $2
                      AND sub_agency = $3
                    LIMIT 1
                    """,
                    agency,
                    program_type,
                    sub_agency,
                )
                if template:
                    self.log.info(
                        f"[rfp_parser] Found exact library template match: "
                        f"{agency}/{program_type}/{sub_agency}"
                    )
                    return dict(template)

            # Try agency + program_type
            if program_type:
                template = await self.conn.fetchrow(
                    """
                    SELECT id, agency, program_type, sub_agency,
                           sections, constraints, submission_format,
                           evaluation_criteria
                    FROM rfp_template_library
                    WHERE agency = $1
                      AND program_type = $2
                    LIMIT 1
                    """,
                    agency,
                    program_type,
                )
                if template:
                    self.log.info(
                        f"[rfp_parser] Found library template match: "
                        f"{agency}/{program_type}"
                    )
                    return dict(template)

            # Try agency only
            template = await self.conn.fetchrow(
                """
                SELECT id, agency, program_type, sub_agency,
                       sections, constraints, submission_format,
                       evaluation_criteria
                FROM rfp_template_library
                WHERE agency = $1
                LIMIT 1
                """,
                agency,
            )
            if template:
                self.log.info(
                    f"[rfp_parser] Found agency-level library template: {agency}"
                )
                return dict(template)

        except Exception as e:
            self.log.error(f"[rfp_parser] Failed to query template library: {e}")
            # Non-fatal — continue without a base template

        return None

    # -----------------------------------------------------------------
    # Claude extraction
    # -----------------------------------------------------------------

    async def _extract_with_claude(
        self, text: str, filename: str
    ) -> Optional[dict]:
        """
        Send RFP text to Claude for structured extraction.
        Returns the parsed extraction dict or None on failure.
        """
        prompt = EXTRACTION_PROMPT % text

        try:
            response = await self.client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=4096,
                messages=[{"role": "user", "content": prompt}],
            )
        except anthropic.APIConnectionError as e:
            self.log.error(
                f"[rfp_parser] Anthropic API connection error for '{filename}': {e}"
            )
            raise
        except anthropic.RateLimitError as e:
            self.log.error(
                f"[rfp_parser] Anthropic rate limit hit for '{filename}': {e}"
            )
            raise
        except anthropic.APIStatusError as e:
            self.log.error(
                f"[rfp_parser] Anthropic API error for '{filename}': {e}"
            )
            raise

        # Extract text content from the response
        response_text = ""
        for block in response.content:
            if block.type == "text":
                response_text += block.text

        if not response_text.strip():
            self.log.warning(
                f"[rfp_parser] Empty response from Claude for '{filename}'"
            )
            return None

        return self._parse_extraction_response(response_text, filename)

    def _parse_extraction_response(
        self, response_text: str, filename: str
    ) -> Optional[dict]:
        """
        Parse Claude's JSON response into the extraction dict.
        Handles common formatting issues (markdown code blocks, etc.).
        """
        text = response_text.strip()

        # Strip markdown code fence if present
        if text.startswith("```"):
            first_newline = text.index("\n") if "\n" in text else len(text)
            text = text[first_newline + 1:]
            if text.endswith("```"):
                text = text[:-3].strip()

        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as e:
            self.log.error(
                f"[rfp_parser] Failed to parse Claude response as JSON "
                f"for '{filename}': {e}"
            )
            return None

        if not isinstance(parsed, dict):
            self.log.error(
                f"[rfp_parser] Expected JSON object from Claude for '{filename}', "
                f"got {type(parsed).__name__}"
            )
            return None

        # Validate expected top-level keys exist (at least sections)
        sections = parsed.get("sections")
        if not isinstance(sections, list):
            self.log.warning(
                f"[rfp_parser] No valid 'sections' array in Claude response "
                f"for '{filename}'"
            )
            # Still return what we have — partial extraction is better than nothing
            parsed.setdefault("sections", [])

        # Ensure all top-level keys have safe defaults
        parsed.setdefault("constraints", {})
        parsed.setdefault("submission_format", {})
        parsed.setdefault("evaluation_criteria", [])

        # Validate sections have at minimum a title
        valid_sections = []
        for section in parsed.get("sections", []):
            if not isinstance(section, dict):
                continue
            if not section.get("title"):
                continue
            # Normalize requirements to always be a list
            reqs = section.get("requirements")
            if isinstance(reqs, str):
                section["requirements"] = [reqs]
            elif not isinstance(reqs, list):
                section["requirements"] = []
            valid_sections.append(section)
        parsed["sections"] = valid_sections

        # Validate evaluation criteria entries
        valid_criteria = []
        for criterion in parsed.get("evaluation_criteria", []):
            if not isinstance(criterion, dict):
                continue
            if not criterion.get("factor"):
                continue
            valid_criteria.append(criterion)
        parsed["evaluation_criteria"] = valid_criteria

        self.log.info(
            f"[rfp_parser] Parsed {len(valid_sections)} sections and "
            f"{len(valid_criteria)} evaluation criteria from '{filename}'"
        )
        return parsed

    # -----------------------------------------------------------------
    # Template merging
    # -----------------------------------------------------------------

    def _merge_with_template(
        self, library_template: dict, extracted: dict
    ) -> dict:
        """
        Merge AI-extracted data with a library template.
        AI-extracted data takes precedence; library template fills gaps.
        """
        merged = dict(extracted)

        # Parse library template JSONB fields
        lib_sections = library_template.get("sections")
        if isinstance(lib_sections, str):
            try:
                lib_sections = json.loads(lib_sections)
            except (json.JSONDecodeError, TypeError):
                lib_sections = None

        lib_constraints = library_template.get("constraints")
        if isinstance(lib_constraints, str):
            try:
                lib_constraints = json.loads(lib_constraints)
            except (json.JSONDecodeError, TypeError):
                lib_constraints = None

        lib_submission = library_template.get("submission_format")
        if isinstance(lib_submission, str):
            try:
                lib_submission = json.loads(lib_submission)
            except (json.JSONDecodeError, TypeError):
                lib_submission = None

        lib_criteria = library_template.get("evaluation_criteria")
        if isinstance(lib_criteria, str):
            try:
                lib_criteria = json.loads(lib_criteria)
            except (json.JSONDecodeError, TypeError):
                lib_criteria = None

        # Fill in missing constraints from library template
        if lib_constraints and isinstance(lib_constraints, dict):
            merged_constraints = dict(lib_constraints)
            merged_constraints.update(
                {k: v for k, v in (merged.get("constraints") or {}).items() if v is not None}
            )
            merged["constraints"] = merged_constraints

        # Fill in missing submission_format from library template
        if lib_submission and isinstance(lib_submission, dict):
            merged_submission = dict(lib_submission)
            merged_submission.update(
                {k: v for k, v in (merged.get("submission_format") or {}).items() if v is not None}
            )
            merged["submission_format"] = merged_submission

        # If AI extracted no sections but library has them, use library sections
        if not merged.get("sections") and lib_sections and isinstance(lib_sections, list):
            merged["sections"] = lib_sections

        # If AI extracted no criteria but library has them, use library criteria
        if not merged.get("evaluation_criteria") and lib_criteria and isinstance(lib_criteria, list):
            merged["evaluation_criteria"] = lib_criteria

        return merged

    # -----------------------------------------------------------------
    # Database upsert
    # -----------------------------------------------------------------

    async def _upsert_template(
        self,
        opp_id: str,
        base_template_id: Optional[str],
        sections: list,
        constraints: dict,
        submission_format: dict,
        evaluation_criteria: list,
    ) -> Optional[str]:
        """
        Insert a new rfp_templates record or update an existing draft.
        Returns the template UUID string or None on failure.
        """
        sections_json = json.dumps(sections, default=str)
        constraints_json = json.dumps(constraints, default=str)
        submission_json = json.dumps(submission_format, default=str)
        criteria_json = json.dumps(evaluation_criteria, default=str)

        source = "ai_extracted"
        if base_template_id:
            source = "hybrid"

        # Check for existing draft template for this opportunity
        existing_id = None
        try:
            existing_id = await self.conn.fetchval(
                """
                SELECT id FROM rfp_templates
                WHERE opportunity_id = $1
                  AND status = 'draft'
                ORDER BY created_at DESC
                LIMIT 1
                """,
                opp_id,
            )
        except Exception as e:
            self.log.error(
                f"[rfp_parser] Failed to check existing template for opp {opp_id}: {e}"
            )
            # Proceed to insert a new one

        if existing_id:
            # Update existing draft
            try:
                await self.conn.execute(
                    """
                    UPDATE rfp_templates
                    SET base_template_id = $1,
                        source = $2,
                        sections = $3::jsonb,
                        constraints = $4::jsonb,
                        submission_format = $5::jsonb,
                        evaluation_criteria = $6::jsonb,
                        updated_at = NOW()
                    WHERE id = $7
                    """,
                    base_template_id,
                    source,
                    sections_json,
                    constraints_json,
                    submission_json,
                    criteria_json,
                    existing_id,
                )
                self.log.info(
                    f"[rfp_parser] Updated existing draft template {existing_id} "
                    f"for opp {opp_id}"
                )
                return str(existing_id)
            except Exception as e:
                self.log.error(
                    f"[rfp_parser] Failed to update template {existing_id}: {e}"
                )
                raise
        else:
            # Insert new template
            template_id = str(uuid.uuid4())
            try:
                await self.conn.execute(
                    """
                    INSERT INTO rfp_templates (
                        id, opportunity_id, base_template_id,
                        source, status,
                        sections, constraints,
                        submission_format, evaluation_criteria,
                        created_at, updated_at
                    ) VALUES (
                        $1, $2, $3,
                        $4, 'draft',
                        $5::jsonb, $6::jsonb,
                        $7::jsonb, $8::jsonb,
                        NOW(), NOW()
                    )
                    """,
                    uuid.UUID(template_id),
                    opp_id,
                    base_template_id,
                    source,
                    sections_json,
                    constraints_json,
                    submission_json,
                    criteria_json,
                )
                self.log.info(
                    f"[rfp_parser] Inserted new template {template_id} "
                    f"for opp {opp_id}"
                )
                return template_id
            except Exception as e:
                self.log.error(
                    f"[rfp_parser] Failed to insert template for opp {opp_id}: {e}"
                )
                raise
