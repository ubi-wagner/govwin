"""Unit tests for Phase 1 §D1 — PDF text extraction.

Tests the budget cap + error path without requiring a real PDF fixture
(golden-fixture tests with real PDFs live in test_shredder_regression.py).

We monkey-patch pymupdf + pymupdf4llm so these tests run without the
upstream libraries installed in the CI image.
"""
import sys
import types
import pytest

from shredder.extractor import (
    extract_text_from_pdf,
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
