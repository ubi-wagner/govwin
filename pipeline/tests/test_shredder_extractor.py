"""Unit tests for Phase 1 §D1 — PDF text extraction.

Tests the budget cap + error path without requiring a real PDF fixture
(golden-fixture tests with real PDFs live in test_shredder_regression.py).

We monkey-patch pymupdf + pymupdf4llm so these tests run without the
upstream libraries installed in the CI image.
"""
import sys
import types
from pathlib import Path

import pytest

from shredder.extractor import (
    extract_text_from_pdf,
    pdf_page_count,
    MAX_CHARS_PER_DOCUMENT,
    ExtractionError,
)


def _install_fake_pymupdf(monkeypatch, markdown_output):
    """Install fake pymupdf + pymupdf4llm modules that return a known value."""
    fake_doc = types.SimpleNamespace(close=lambda: None)
    fake_pymupdf = types.ModuleType("pymupdf")
    fake_pymupdf.open = lambda stream, filetype: fake_doc  # type: ignore[attr-defined]

    fake_pymupdf4llm = types.ModuleType("pymupdf4llm")
    fake_pymupdf4llm.to_markdown = lambda doc: markdown_output  # type: ignore[attr-defined]

    monkeypatch.setitem(sys.modules, "pymupdf", fake_pymupdf)
    monkeypatch.setitem(sys.modules, "pymupdf4llm", fake_pymupdf4llm)


class TestExtractTextFromPdf:
    def test_returns_markdown_passthrough(self, monkeypatch):
        _install_fake_pymupdf(monkeypatch, "# Title\n\nBody paragraph.")
        result = extract_text_from_pdf(b"fake pdf bytes")
        assert result == "# Title\n\nBody paragraph."

    def test_truncates_to_max_chars(self, monkeypatch):
        """Oversized markdown gets capped at MAX_CHARS_PER_DOCUMENT."""
        huge = "A" * (MAX_CHARS_PER_DOCUMENT + 50_000)
        _install_fake_pymupdf(monkeypatch, huge)
        result = extract_text_from_pdf(b"fake pdf bytes")
        assert len(result) == MAX_CHARS_PER_DOCUMENT

    def test_under_cap_untouched(self, monkeypatch):
        """Markdown shorter than the cap is returned verbatim."""
        exactly_at_cap = "Z" * MAX_CHARS_PER_DOCUMENT
        _install_fake_pymupdf(monkeypatch, exactly_at_cap)
        result = extract_text_from_pdf(b"fake pdf bytes")
        assert len(result) == MAX_CHARS_PER_DOCUMENT
        assert result == exactly_at_cap

    def test_non_string_output_raises(self, monkeypatch):
        _install_fake_pymupdf(monkeypatch, b"bytes not str")
        with pytest.raises(ExtractionError, match="unexpected type"):
            extract_text_from_pdf(b"fake pdf bytes")

    def test_open_failure_raises_extraction_error(self, monkeypatch):
        fake_pymupdf = types.ModuleType("pymupdf")

        def _bad_open(stream, filetype):
            raise RuntimeError("corrupt PDF")
        fake_pymupdf.open = _bad_open  # type: ignore[attr-defined]

        fake_pymupdf4llm = types.ModuleType("pymupdf4llm")
        fake_pymupdf4llm.to_markdown = lambda doc: ""  # type: ignore[attr-defined]

        monkeypatch.setitem(sys.modules, "pymupdf", fake_pymupdf)
        monkeypatch.setitem(sys.modules, "pymupdf4llm", fake_pymupdf4llm)

        with pytest.raises(ExtractionError, match="failed to open PDF"):
            extract_text_from_pdf(b"garbage")

    def test_missing_library_raises_extraction_error(self, monkeypatch):
        """If pymupdf isn't installed, we get a helpful ExtractionError."""
        # Remove any previously-imported copies; force the import inside
        # extract_text_from_pdf to see them as missing.
        monkeypatch.setitem(sys.modules, "pymupdf", None)
        monkeypatch.setitem(sys.modules, "pymupdf4llm", None)

        with pytest.raises(ExtractionError, match="not available"):
            extract_text_from_pdf(b"whatever")


class TestPdfPageCount:
    """A page count must be READ, or absent. It must never be estimated.

    runner.py stored `len(pdf_bytes) // 40000 + 1` in solicitation_documents.page_count and handed
    that to the packaging specialist beside genuinely-extracted values. Measured against the real
    solicitations in docs/, the guess was 72-81% low — a 254-page DoD SBIR BAA recorded as 60
    pages. docs/INGEST_PROVENANCE.md: a value the product did not read must never look like one it
    did, and absence is a finding.
    """

    def test_reads_the_real_page_count(self) -> None:
        pdf = (
            Path(__file__).resolve().parents[2] / "docs/DoD 25.2 SBIR BAA FULL_04212025.pdf"
        )
        if not pdf.exists():
            pytest.skip("solicitation fixture not present in this checkout")
        assert pdf_page_count(pdf.read_bytes()) == 254

    @pytest.mark.parametrize("bad", [b"", b"this is not a pdf"])
    def test_unreadable_input_is_none_never_a_guess(self, bad: bytes) -> None:
        """The old expression returned 1 for both of these — a document claiming to have a page."""
        assert pdf_page_count(bad) is None

    def test_missing_library_is_none_not_a_raise(self, monkeypatch) -> None:
        """Unlike extraction, an absent page count is not fatal: the column is nullable and the
        caller stores NULL. Raising here would fail a shred over a nice-to-have."""
        monkeypatch.setitem(sys.modules, "pymupdf", None)
        assert pdf_page_count(b"whatever") is None
