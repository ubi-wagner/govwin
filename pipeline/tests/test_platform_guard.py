"""G1 — platform AI spend guard (pipeline/src/agents/platform_guard.py).

Caps + logs platform (tenant_id IS NULL) Claude spend against the platform
monthly cap. No real DB — the asyncpg connection is mocked.
"""
from __future__ import annotations

import sys
import unittest.mock

# Stub the anthropic SDK before importing pipeline modules (matches other tests).
if "anthropic" not in sys.modules:
    sys.modules["anthropic"] = unittest.mock.MagicMock()

from unittest.mock import AsyncMock

from agents.platform_guard import platform_ai_allowed, log_platform_call


async def test_allowed_when_under_cap():
    conn = AsyncMock()
    conn.fetchrow = AsyncMock(side_effect=[
        {"ai_enabled": True, "platform_monthly_cap": 100.0},
        {"total_cost": 40.0},
    ])
    assert await platform_ai_allowed(conn) is True


async def test_blocked_when_at_or_over_cap():
    conn = AsyncMock()
    conn.fetchrow = AsyncMock(side_effect=[
        {"ai_enabled": True, "platform_monthly_cap": 100.0},
        {"total_cost": 100.0},
    ])
    assert await platform_ai_allowed(conn) is False


async def test_blocked_when_ai_disabled_platformwide():
    conn = AsyncMock()
    conn.fetchrow = AsyncMock(return_value={"ai_enabled": False, "platform_monthly_cap": None})
    assert await platform_ai_allowed(conn) is False


async def test_allowed_when_no_cap_set():
    conn = AsyncMock()
    conn.fetchrow = AsyncMock(return_value={"ai_enabled": True, "platform_monthly_cap": None})
    assert await platform_ai_allowed(conn) is True


async def test_allowed_when_unconfigured():
    conn = AsyncMock()
    conn.fetchrow = AsyncMock(return_value=None)
    assert await platform_ai_allowed(conn) is True


async def test_fails_closed_on_db_error():
    conn = AsyncMock()
    conn.fetchrow = AsyncMock(side_effect=RuntimeError("db down"))
    assert await platform_ai_allowed(conn) is False


async def test_log_platform_call_writes_null_tenant_row():
    conn = AsyncMock()
    conn.execute = AsyncMock()
    await log_platform_call(
        conn, agent_role="shredder", task_type="shred",
        input_tokens=1000, output_tokens=500, cost_usd=0.123, duration_ms=42,
    )
    assert conn.execute.await_count == 1
    args = conn.execute.await_args.args
    sql_text = args[0]
    # tenant_id is a literal NULL in the INSERT (platform/system spend).
    assert "agent_task_log" in sql_text and "NULL" in sql_text
    # Positional params: $1 id, $2 agent_role, $3 task_type, $4 in, $5 out,
    # $6 duration_ms, $7 cost_usd, $8 error.
    assert args[2] == "shredder"
    assert args[3] == "shred"
    assert args[4] == 1000
    assert args[5] == 500
    assert args[6] == 42
    assert args[7] == 0.123
