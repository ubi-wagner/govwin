"""Text extraction — Phase 1 §D1.

Converts a PDF (from bytes or S3 key) to markdown via `pymupdf4llm`.
Deliberately pure: no DB, no events, no Claude. The shredder runner
(§D4) wires this to the rest of the pipeline.

Token/character budget enforcement lives here rather than in the
runner because the cap is about "don't burn resources on oversized
documents" and the cheapest place to enforce that is before we even
ship bytes to the LLM.
"""
from __future__ import annotations

import io
import logging
from typing import Optional

log = logging.getLogger("pipeline.shredder.extractor")

# Hard cap per document. A typical SBIR Phase I solicitation is
# 20K-50K chars of markdown. A typical BAA can reach 150K. 200K is
# a comfortable ceiling that covers all known RFP formats without
# drifting into "this is probably a multi-volume PDF pack".
#
# When a document exceeds the cap, the extractor returns the first
# 200K chars and logs a warning. The runner should emit a
# `system.shredder.budget_exceeded` system event (§D4 wires this).
MAX_CHARS_PER_DOCUMENT = 200_000


class ExtractionError(Exception):
    """Raised when a PDF cannot be converted to markdown.

    Distinct from `ShredderBudgetError` (which is about token budgets
    during a Claude call) — an ExtractionError means the PDF itself
    is unreadable (corrupt, encrypted, password-protected, etc.).
    """


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Convert a PDF byte buffer to markdown.

    Uses `pymupdf4llm.to_markdown()` which preserves heading structure,
    tables, and bullet lists — the shape the section-extraction prompt
    relies on for accurate boundary detection.

    Args:
        pdf_bytes: Raw PDF file contents.

    Returns:
        Markdown string. Truncated at MAX_CHARS_PER_DOCUMENT if the
        full conversion exceeds the cap.

    Raises:
        ExtractionError: If pymupdf4llm cannot open or parse the PDF.
    """
    # Import lazily so the module imports cleanly even when pymupdf4llm
    # isn't installed (CI unit path for tests that don't touch extraction).
    try:
        import pymupdf  # type: ignore[import-untyped]
        import pymupdf4llm  # type: ignore[import-untyped]
    except ImportError as e:
        raise ExtractionError(
            f"pymupdf4llm / pymupdf not available: {e}. "
            "Add to requirements.txt or install in the pipeline image."
        ) from e

    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    except Exception as e:
        raise ExtractionError(f"pymupdf failed to open PDF: {e}") from e

    try:
        markdown = pymupdf4llm.to_markdown(doc)
    except Exception as e:
        raise ExtractionError(f"pymupdf4llm.to_markdown failed: {e}") from e
    finally:
        doc.close()

    if not isinstance(markdown, str):
        raise ExtractionError(
            f"pymupdf4llm returned unexpected type {type(markdown).__name__}; expected str"
        )

    if len(markdown) > MAX_CHARS_PER_DOCUMENT:
        log.warning(
            "PDF extraction exceeded cap: got %d chars, truncating to %d",
            len(markdown), MAX_CHARS_PER_DOCUMENT,
        )
        return markdown[:MAX_CHARS_PER_DOCUMENT]

    return markdown


async def extract_text_from_s3_key(
    s3_key: str,
    s3_client: Optional[object] = None,
    bucket: Optional[str] = None,
) -> str:
    """Fetch a PDF from S3 and convert to markdown.

    Thin wrapper around `extract_text_from_pdf` that handles the S3
    fetch. Accepts an injectable `s3_client` + `bucket` so tests can
    pass mocks without needing AWS credentials. In production the
    runner passes the shared boto3 client from `pipeline/src/storage/s3_client.py`.

    Args:
        s3_key: Object key within the configured bucket.
        s3_client: boto3 client; if None, the default from
                   `pipeline/src/storage/s3_client.py` is used.
        bucket: Bucket name; if None, taken from env/storage module.

    Returns:
        Markdown string (possibly truncated — see MAX_CHARS_PER_DOCUMENT).

    Raises:
        ExtractionError: If the fetch or extraction fails.
    """
    if s3_client is None or bucket is None:
        # Resolve lazily to keep tests insulated from storage config
        try:
            from storage.s3_client import s3 as default_client, BUCKET as default_bucket
        except ImportError as e:
            raise ExtractionError(
                "No s3_client provided and default storage module unavailable: "
                f"{e}"
            ) from e
        s3_client = s3_client or default_client
        bucket = bucket or default_bucket

    try:
        # boto3's get_object is synchronous; we run it directly because
        # the rest of the shredder pipeline is async but IO-bound and
        # the per-document fetch is a single round-trip. If we ever
        # batch this, swap to aioboto3.
        response = s3_client.get_object(Bucket=bucket, Key=s3_key)  # type: ignore[attr-defined]
        pdf_bytes = response["Body"].read()
    except Exception as e:
        raise ExtractionError(
            f"S3 fetch failed for key={s3_key!r} bucket={bucket!r}: {e}"
        ) from e

    return extract_text_from_pdf(pdf_bytes)
