"""
LibreOffice headless wrapper for format conversion and PDF rendering.

Requires `soffice` (LibreOffice) on PATH. On Railway, add to Dockerfile:
  RUN apt-get update && apt-get install -y libreoffice-core libreoffice-writer \
      libreoffice-calc libreoffice-impress --no-install-recommends && rm -rf /var/lib/apt/lists/*

Falls back gracefully when soffice is not available (dev environments).
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
import uuid
from pathlib import Path

logger = logging.getLogger(__name__)

SOFFICE_BIN = os.getenv("SOFFICE_PATH", "soffice")
CONVERT_TIMEOUT = int(os.getenv("SOFFICE_TIMEOUT", "60"))

_FORMAT_TO_FILTER: dict[str, str] = {
    "docx": "writer_pdf_Export",
    "doc": "writer_pdf_Export",
    "pptx": "impress_pdf_Export",
    "ppt": "impress_pdf_Export",
    "xlsx": "calc_pdf_Export",
    "xls": "calc_pdf_Export",
    "odt": "writer_pdf_Export",
    "odp": "impress_pdf_Export",
    "ods": "calc_pdf_Export",
}


def is_soffice_available() -> bool:
    """Check if LibreOffice is installed and on PATH."""
    return shutil.which(SOFFICE_BIN) is not None


async def convert_to_pdf(file_bytes: bytes, source_format: str) -> bytes:
    """
    Convert a document to PDF via LibreOffice headless.
    Raises RuntimeError if soffice is not available.
    """
    if not file_bytes:
        raise ValueError("convert_to_pdf: empty file_bytes")

    if not is_soffice_available():
        raise RuntimeError(
            "LibreOffice (soffice) not found on PATH. "
            "Install it or set SOFFICE_PATH env var."
        )

    work_dir = Path(tempfile.mkdtemp(prefix="docagent_"))
    try:
        input_file = work_dir / f"input.{source_format}"
        input_file.write_bytes(file_bytes)

        cmd = [
            SOFFICE_BIN,
            "--headless",
            "--norestore",
            "--convert-to", "pdf",
            "--outdir", str(work_dir),
            str(input_file),
        ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "HOME": str(work_dir)},
        )

        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=CONVERT_TIMEOUT
            )
        except asyncio.TimeoutError:
            proc.kill()
            raise RuntimeError(
                f"LibreOffice timed out after {CONVERT_TIMEOUT}s converting {source_format}"
            )

        if proc.returncode != 0:
            logger.error(
                "soffice conversion failed (rc=%d): %s",
                proc.returncode,
                stderr.decode("utf-8", errors="replace"),
            )
            raise RuntimeError(
                f"LibreOffice conversion failed with return code {proc.returncode}"
            )

        pdf_file = work_dir / "input.pdf"
        if not pdf_file.exists():
            # soffice sometimes uses the original filename
            candidates = list(work_dir.glob("*.pdf"))
            if candidates:
                pdf_file = candidates[0]
            else:
                raise RuntimeError("LibreOffice produced no PDF output")

        return pdf_file.read_bytes()

    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


async def convert_format(
    file_bytes: bytes,
    source_format: str,
    target_format: str,
) -> bytes:
    """
    Convert between office formats via LibreOffice headless.
    E.g., docx → odt, pptx → pdf, xlsx → csv.
    """
    if not is_soffice_available():
        raise RuntimeError("LibreOffice (soffice) not found on PATH.")

    work_dir = Path(tempfile.mkdtemp(prefix="docagent_"))
    try:
        input_file = work_dir / f"input.{source_format}"
        input_file.write_bytes(file_bytes)

        cmd = [
            SOFFICE_BIN,
            "--headless",
            "--norestore",
            "--convert-to", target_format,
            "--outdir", str(work_dir),
            str(input_file),
        ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "HOME": str(work_dir)},
        )

        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=CONVERT_TIMEOUT
        )

        if proc.returncode != 0:
            raise RuntimeError(
                f"LibreOffice format conversion failed (rc={proc.returncode})"
            )

        output_file = work_dir / f"input.{target_format}"
        if not output_file.exists():
            candidates = list(work_dir.glob(f"*.{target_format}"))
            if candidates:
                output_file = candidates[0]
            else:
                raise RuntimeError(
                    f"LibreOffice produced no .{target_format} output"
                )

        return output_file.read_bytes()

    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
