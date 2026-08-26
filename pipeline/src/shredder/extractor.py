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

import asyncio
import io
import logging
from typing import Optional

log = logging.getLogger("pipeline.shredder.extractor")

# Hard cap per document.
#
# This read 200_000 with the note that "a typical BAA can reach 150K" and that the ceiling
# "covers all known RFP formats". Measurement says otherwise — the real documents in docs/:
#
#     DoD 25.1 SBIR BAA      1,341,245 chars
#     DoW 2026 SBIR BAA      1,013,966 chars
#     DoD 25.A STTR BAA        449,600 chars
#
# So the annual BAAs — the documents this product exists to read — were being cut to 15-20% of
# their length, silently. Anything a solicitation states past the cut is invisible to the pattern
# extractor, which then reports "not stated in the source"; the field falls back to a
# "Default — unverified" that reads like a considered finding rather than a blind spot we created.
# docs/INGEST_PROVENANCE.md: a value the product did not read from the solicitation must never look
# like one it did, and "we did not find it" must not stand in for "we never looked".
#
# 2_000_000 carries ~50% headroom over the largest observed document. It remains a guard against a
# pathological file exhausting memory, NOT a content decision — which is why crossing it is now
# RECORDED rather than merely logged (cap_source_text below). Any fixed limit is eventually too
# small; what must never happen again is that being quiet.
MAX_CHARS_PER_DOCUMENT = 2_000_000


def cap_source_text(raw: str | None, cap: int = MAX_CHARS_PER_DOCUMENT) -> tuple[str, dict]:
    """Apply the ceiling and report it.

    Returns (text, extraction) where `extraction` is the record a caller MUST persist alongside the
    text: {chars, truncated, original_chars, cap_chars}. Mirrors the frontend's
    lib/ingest/source-text-cap.ts so both services describe coverage the same way.
    """
    s = raw or ""
    original = len(s)
    truncated = original > cap
    text = s[:cap] if truncated else s
    return text, {
        "chars": len(text),
        "truncated": truncated,
        "original_chars": original,
        "cap_chars": cap,
    }


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


def pdf_page_count(pdf_bytes: bytes) -> Optional[int]:
    """How many pages the PDF actually has, or None when that cannot be determined.

    None is the point. The caller previously stored `len(pdf_bytes) // 40000 + 1` in a column named
    page_count — a byte-size guess wearing the name of a measurement, handed on to the packaging
    specialist beside genuinely-read values with nothing marking it as estimated. That is the
    failure docs/INGEST_PROVENANCE.md exists to prevent: a value the product did not read must
    never look like one it did. An unknown page count has to stay unknown.

    pymupdf is already opened one function above to extract the text; the count is free.
    """
    try:
        import pymupdf  # type: ignore[import-untyped]
    except ImportError:
        return None
    try:
        with pymupdf.open(stream=pdf_bytes, filetype="pdf") as doc:
            return int(doc.page_count)
    except Exception as e:
        log.warning("pdf_page_count: could not read page count: %s", e)
        return None


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
            from storage.s3_client import get_s3_client, BUCKET as default_bucket
            default_client = get_s3_client()
        except ImportError as e:
            raise ExtractionError(
                "No s3_client provided and default storage module unavailable: "
                f"{e}"
            ) from e
        s3_client = s3_client or default_client
        bucket = bucket or default_bucket

    try:
        # boto3's get_object is synchronous — run it in a thread pool
        # executor so the async event loop is not blocked during the S3
        # round-trip (fixes PIPE-04).
        def _s3_fetch():
            resp = s3_client.get_object(Bucket=bucket, Key=s3_key)  # type: ignore[attr-defined]
            return resp["Body"].read()

        pdf_bytes = await asyncio.to_thread(_s3_fetch)
    except Exception as e:
        raise ExtractionError(
            f"S3 fetch failed for key={s3_key!r} bucket={bucket!r}: {e}"
        ) from e

    return extract_text_from_pdf(pdf_bytes)
