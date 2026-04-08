"""Health check helpers for the pipeline worker.

Phase 0.5 only provides the check functions as importable helpers.
A future phase will wrap these in an HTTP server (aiohttp or
starlette) for Railway's healthcheck probe.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any

import asyncpg

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://govtech:changeme@localhost:5432/govtech_intel",
)

_booted_at = time.monotonic()


async def check_db() -> dict[str, Any]:
    """Ping Postgres with SELECT 1."""
    try:
        conn = await asyncpg.connect(DATABASE_URL, timeout=5)
        try:
            one = await conn.fetchval("SELECT 1")
            if one == 1:
                return {"ok": True}
            return {"ok": False, "detail": "unexpected result"}
        finally:
            await conn.close()
    except Exception as e:
        return {"ok": False, "detail": _truncate(str(e))}


def check_s3() -> dict[str, Any]:
    """HeadBucket against the configured bucket."""
    try:
        from src.storage.s3_client import ping_s3

        return ping_s3()
    except Exception as e:
        return {"ok": False, "detail": _truncate(str(e))}


async def full_health() -> dict[str, Any]:
    """Composite check used by the future /healthz endpoint."""
    db = await check_db()
    s3 = check_s3()
    return {
        "ok": bool(db.get("ok")) and bool(s3.get("ok")),
        "uptime_ms": int((time.monotonic() - _booted_at) * 1000),
        "db": db,
        "s3": s3,
    }


def _truncate(s: str) -> str:
    return s if len(s) <= 200 else s[:200] + "…"
