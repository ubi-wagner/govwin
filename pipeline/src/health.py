"""Health check helpers and lightweight HTTP server for the pipeline worker.

Provides:
  - check_db(), check_s3(), full_health() — composable check functions
  - run_health_server() — minimal asyncio HTTP server for Railway's
    healthcheck probe (no external dependency required)

The health server responds to:
  GET /health   → {"status": "ok"}  (shallow liveness check)
  GET /healthz  → full composite check (DB + S3 + uptime)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any

import asyncpg

logger = logging.getLogger(__name__)

from config import DATABASE_URL

HEALTH_PORT = int(os.getenv("HEALTH_PORT", "8080"))

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
        # Bare `storage.s3_client` (not `src.storage.s3_client`) because
        # sys.path[0] under `python src/main.py` is /app/src, so the
        # `src` prefix would resolve to /app/src/src which doesn't exist.
        from storage.s3_client import ping_s3

        return ping_s3()
    except Exception as e:
        return {"ok": False, "detail": _truncate(str(e))}


async def full_health() -> dict[str, Any]:
    """Composite check used by the /healthz endpoint."""
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


# ── Minimal HTTP health server ────────────────────────────────────────


async def _handle_request(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    """Handle a single HTTP request on the health server."""
    try:
        request_line = await asyncio.wait_for(reader.readline(), timeout=5.0)
        request_str = request_line.decode("utf-8", errors="replace").strip()

        # Consume remaining headers (required by HTTP/1.1)
        while True:
            line = await asyncio.wait_for(reader.readline(), timeout=5.0)
            if line in (b"\r\n", b"\n", b""):
                break

        # Parse method and path
        parts = request_str.split(" ")
        method = parts[0] if parts else ""
        path = parts[1] if len(parts) > 1 else ""

        if method == "GET" and path == "/health":
            body = json.dumps({"status": "ok"})
            status_line = "HTTP/1.1 200 OK"
        elif method == "GET" and path == "/healthz":
            result = await full_health()
            body = json.dumps(result)
            status_code = 200 if result.get("ok") else 503
            status_line = f"HTTP/1.1 {status_code} {'OK' if status_code == 200 else 'Service Unavailable'}"
        else:
            body = json.dumps({"error": "not found"})
            status_line = "HTTP/1.1 404 Not Found"

        response = (
            f"{status_line}\r\n"
            f"Content-Type: application/json\r\n"
            f"Content-Length: {len(body)}\r\n"
            f"Connection: close\r\n"
            f"\r\n"
            f"{body}"
        )
        writer.write(response.encode("utf-8"))
        await writer.drain()
    except Exception as e:
        logger.debug("health server request error: %s", e)
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass


async def run_health_server(
    *,
    shutdown_event: asyncio.Event,
    port: int = HEALTH_PORT,
) -> None:
    """Run a minimal health check HTTP server until shutdown_event is set.

    Uses asyncio.start_server (stdlib) — no external HTTP framework needed.
    Binds to 0.0.0.0 so Railway's internal healthcheck can reach it.
    """
    server = await asyncio.start_server(_handle_request, "0.0.0.0", port)
    logger.info("health server listening on 0.0.0.0:%d", port)

    try:
        # Wait until shutdown is signaled
        await shutdown_event.wait()
    finally:
        server.close()
        await server.wait_closed()
        logger.info("health server stopped")
