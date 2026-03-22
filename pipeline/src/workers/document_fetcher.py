"""
Document Fetcher Worker — Downloads opportunity attachments on demand.

Triggered when:
  - A customer pins an opportunity (seeds documents table with status='pending')
  - Future: scoring worker flags a high-relevance opp

Architecture:
  - Documents are stored per-OPPORTUNITY, not per-customer
  - Multiple customers pinning the same opp = one download
  - Storage: /data/opportunities/YYYY-WNN/SAM-{solNum}-{title}/attachments/
  - Customer-specific analysis lives in /data/customers/{slug}/ (separate concern)

Consumes: opportunity_events with type 'ingest.document_added'
Downloads: pending rows from the documents table
"""

import hashlib
import json
import logging
import mimetypes
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse

import httpx

from .base import BaseEventWorker

log = logging.getLogger("workers.document_fetcher")

STORAGE_ROOT = os.environ.get("STORAGE_ROOT", "/data")

# Limits
MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024  # 100 MB per file
DOWNLOAD_TIMEOUT_SECONDS = 120
MAX_RETRIES = 3


def _sanitize(name: str) -> str:
    """Sanitize a string for use as a filename/folder name."""
    return re.sub(r'[/\\:*?"<>|]', "-", name).strip()


def _build_opp_folder_path(
    solicitation_number: str | None,
    title: str | None,
    posted_date: datetime | None,
) -> str:
    """
    Build the opportunity folder path:
      opportunities/YYYY-WNN/SAM-{solNum}-{title}/attachments/

    Matches the structure in storage.ts archiveOpportunity().
    """
    date = posted_date or datetime.now(timezone.utc)

    # ISO week label — use Python's isocalendar() for correctness
    iso_year, iso_week, _ = date.isocalendar()
    week_label = f"{iso_year}-W{iso_week:02d}"

    sol_part = _sanitize(solicitation_number) if solicitation_number else "NOSOL"
    title_part = _sanitize((title or "untitled")[:60])
    folder_name = f"SAM-{sol_part}-{title_part}"

    return f"opportunities/{week_label}/{folder_name}/attachments"


def _extract_filename(url: str, content_disposition: str | None) -> str:
    """Extract a safe filename from Content-Disposition header or URL."""
    # Try Content-Disposition first
    if content_disposition:
        # Look for filename*= (RFC 5987) or filename=
        match = re.search(r"filename\*?=['\"]?(?:UTF-8'')?([^'\";\r\n]+)", content_disposition, re.IGNORECASE)
        if match:
            name = unquote(match.group(1).strip().strip("'\""))
            if name:
                return _sanitize(name)

    # Fall back to URL path
    parsed = urlparse(url)
    path = parsed.path or ""
    basename = path.rstrip("/").split("/")[-1] if path else ""
    if basename:
        decoded = unquote(basename)
        return _sanitize(decoded)

    # Last resort
    url_hash = hashlib.md5(url.encode()).hexdigest()[:8]
    return f"attachment-{url_hash}"


class DocumentFetcherWorker(BaseEventWorker):
    """
    Consumes: ingest.document_added from opportunity_events
    Action: Downloads all pending documents for the referenced opportunity
    Storage: Per-opportunity folder in /data/opportunities/...
    """

    namespace = "finder.document_fetch"
    event_bus = "opportunity_events"
    event_types = ["ingest.document_added"]
    batch_size = 10  # conservative — each event may trigger multiple downloads

    async def handle_event(self, event: dict) -> None:
        opp_id = event.get("opportunity_id")
        if not opp_id:
            self.log.warning("[document_fetch] Event missing opportunity_id, skipping")
            return

        # Fetch opportunity metadata for folder path
        opp = None
        try:
            opp = await self.conn.fetchrow(
                """
                SELECT id, solicitation_number, title, posted_date
                FROM opportunities WHERE id = $1
                """,
                opp_id,
            )
        except Exception as e:
            self.log.error(f"[document_fetch] Failed to fetch opportunity {opp_id}: {e}")
            return

        if not opp:
            self.log.warning(f"[document_fetch] Opportunity {opp_id} not found, skipping")
            return

        # Get all pending documents for this opportunity
        pending_docs = []
        try:
            pending_docs = await self.conn.fetch(
                """
                SELECT id, filename, original_url
                FROM documents
                WHERE opportunity_id = $1
                  AND download_status = 'pending'
                ORDER BY created_at ASC
                """,
                opp_id,
            )
        except Exception as e:
            self.log.error(f"[document_fetch] Failed to query pending docs for {opp_id}: {e}")
            return

        if not pending_docs:
            self.log.info(f"[document_fetch] No pending documents for opportunity {opp_id}")
            return

        # Build the opportunity attachment folder path
        folder_path = _build_opp_folder_path(
            opp["solicitation_number"],
            opp["title"],
            opp["posted_date"],
        )
        abs_folder = os.path.join(STORAGE_ROOT, folder_path)
        os.makedirs(abs_folder, exist_ok=True)

        downloaded = 0
        errors = 0

        for doc in pending_docs:
            doc_id = doc["id"]
            url = doc["original_url"]
            seed_filename = doc["filename"]

            try:
                result = await self._download_one(
                    doc_id=doc_id,
                    url=url,
                    seed_filename=seed_filename,
                    folder_path=folder_path,
                    abs_folder=abs_folder,
                    opp_id=opp_id,
                )
                if result:
                    downloaded += 1
                else:
                    errors += 1
            except Exception as e:
                errors += 1
                self.log.error(f"[document_fetch] Unexpected error downloading {url}: {e}")
                try:
                    await self.conn.execute(
                        """
                        UPDATE documents
                        SET download_status = 'error',
                            download_error = $1
                        WHERE id = $2
                        """,
                        str(e)[:500],
                        doc_id,
                    )
                except Exception as db_err:
                    self.log.error(f"[document_fetch] Failed to update error status for doc {doc_id}: {db_err}")

        self.log.info(
            f"[document_fetch] Opportunity {opp_id}: "
            f"{downloaded} downloaded, {errors} errors out of {len(pending_docs)} pending"
        )

    async def _download_one(
        self,
        doc_id: str,
        url: str,
        seed_filename: str,
        folder_path: str,
        abs_folder: str,
        opp_id: str,
    ) -> bool:
        """
        Download a single document. Returns True on success, False on failure.
        Updates the documents row in either case.
        """
        # Mark as downloading to prevent double-processing
        try:
            updated = await self.conn.fetchval(
                """
                UPDATE documents
                SET download_status = 'downloading'
                WHERE id = $1 AND download_status = 'pending'
                RETURNING id
                """,
                doc_id,
            )
            if not updated:
                # Already being processed by another worker
                self.log.info(f"[document_fetch] Doc {doc_id} already being processed, skipping")
                return True
        except Exception as e:
            self.log.error(f"[document_fetch] Failed to lock doc {doc_id}: {e}")
            return False

        last_error = ""
        for attempt in range(MAX_RETRIES):
            try:
                async with httpx.AsyncClient(
                    follow_redirects=True,
                    timeout=httpx.Timeout(DOWNLOAD_TIMEOUT_SECONDS),
                ) as client:
                    async with client.stream("GET", url) as response:
                        if response.status_code != 200:
                            last_error = f"HTTP {response.status_code}"
                            self.log.warning(
                                f"[document_fetch] {url} returned {response.status_code} (attempt {attempt + 1})"
                            )
                            continue

                        # Determine filename from response headers
                        content_disp = response.headers.get("content-disposition")
                        filename = _extract_filename(url, content_disp)

                        # Determine MIME type
                        content_type = response.headers.get("content-type", "")
                        mime_type = content_type.split(";")[0].strip() if content_type else None
                        if not mime_type:
                            mime_type = mimetypes.guess_type(filename)[0]

                        # Stream to a temp buffer, enforce size limit
                        chunks: list[bytes] = []
                        total_size = 0
                        async for chunk in response.aiter_bytes(chunk_size=65536):
                            total_size += len(chunk)
                            if total_size > MAX_FILE_SIZE_BYTES:
                                last_error = f"File exceeds {MAX_FILE_SIZE_BYTES // (1024*1024)}MB limit"
                                self.log.warning(f"[document_fetch] {url}: {last_error}")
                                break
                            chunks.append(chunk)
                        else:
                            # Only runs if loop didn't break (no size limit hit)
                            content = b"".join(chunks)
                            file_hash = hashlib.sha256(content).hexdigest()

                            # Deduplicate: skip if we already have this exact file for this opp
                            existing_hash = await self.conn.fetchval(
                                """
                                SELECT id FROM documents
                                WHERE opportunity_id = $1
                                  AND file_hash = $2
                                  AND id != $3
                                  AND download_status = 'downloaded'
                                """,
                                opp_id,
                                file_hash,
                                doc_id,
                            )
                            if existing_hash:
                                self.log.info(f"[document_fetch] Duplicate file hash for {url}, marking as downloaded")
                                await self.conn.execute(
                                    """
                                    UPDATE documents
                                    SET download_status = 'downloaded',
                                        file_hash = $1,
                                        file_size_bytes = $2,
                                        download_error = 'duplicate_hash',
                                        downloaded_at = NOW()
                                    WHERE id = $3
                                    """,
                                    file_hash,
                                    total_size,
                                    doc_id,
                                )
                                return True

                            # Ensure unique filename in folder
                            final_filename = filename
                            file_path_abs = os.path.join(abs_folder, final_filename)
                            counter = 1
                            while os.path.exists(file_path_abs):
                                name_base, name_ext = os.path.splitext(filename)
                                final_filename = f"{name_base}_{counter}{name_ext}"
                                file_path_abs = os.path.join(abs_folder, final_filename)
                                counter += 1

                            # Write file
                            storage_path = f"{folder_path}/{final_filename}"
                            Path(file_path_abs).write_bytes(content)

                            # Update documents row
                            try:
                                await self.conn.execute(
                                    """
                                    UPDATE documents
                                    SET download_status = 'downloaded',
                                        filename = $1,
                                        local_path = $2,
                                        storage_path = $3,
                                        storage_backend = 'local',
                                        file_hash = $4,
                                        file_size_bytes = $5,
                                        mime_type = $6,
                                        downloaded_at = NOW(),
                                        download_error = NULL
                                    WHERE id = $7
                                    """,
                                    final_filename,
                                    file_path_abs,
                                    storage_path,
                                    file_hash,
                                    total_size,
                                    mime_type,
                                    doc_id,
                                )
                            except Exception as db_err:
                                self.log.error(f"[document_fetch] DB update failed for doc {doc_id}: {db_err}")
                                # File was written successfully though — mark as error so we don't re-download
                                return False

                            self.log.info(
                                f"[document_fetch] Downloaded {final_filename} "
                                f"({total_size} bytes) → {storage_path}"
                            )
                            return True

                        # If we got here, size limit was exceeded
                        continue

            except httpx.TimeoutException:
                last_error = f"Timeout after {DOWNLOAD_TIMEOUT_SECONDS}s"
                self.log.warning(f"[document_fetch] {url}: {last_error} (attempt {attempt + 1})")
            except httpx.HTTPError as e:
                last_error = f"HTTP error: {e}"
                self.log.warning(f"[document_fetch] {url}: {last_error} (attempt {attempt + 1})")
            except OSError as e:
                last_error = f"Filesystem error: {e}"
                self.log.error(f"[document_fetch] {url}: {last_error}")
                break  # Don't retry filesystem errors

        # All retries exhausted
        try:
            await self.conn.execute(
                """
                UPDATE documents
                SET download_status = 'error',
                    download_error = $1
                WHERE id = $2
                """,
                last_error[:500],
                doc_id,
            )
        except Exception as db_err:
            self.log.error(f"[document_fetch] Failed to update error status for doc {doc_id}: {db_err}")

        return False
