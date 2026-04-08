"""Idempotent seed for the initial master_admin user.

Seeds exactly one row:

    email = eric@rfppipeline.com
    role  = master_admin

Password resolution order on first boot (when no master_admin exists):

  1. INITIAL_MASTER_ADMIN_PASSWORD env var (backward compat — set this
     on Railway if you want a known temp password)
  2. A freshly generated 16-character urlsafe random temp password
     (~96 bits of entropy, not brute-forceable)

In both cases the password is bcrypt-hashed at cost 12 and inserted
with `temp_password = true`, which forces the middleware to redirect
the user to /change-password on first sign-in.

When the seed creates a new row it prints the email + temp password
to stdout in a loud banner so it's findable in the Railway pipeline
boot logs. This banner is printed exactly ONCE — every subsequent
boot detects the existing row and is a complete no-op.

This is the same temp_password mechanism that customer-admin invite
flows will reuse in Phase 2: a system-generated temp password,
delivered out of band, rotated immediately on first sign-in.

See docs/DECISIONS.md D004 and plan section 18.

Usage from pipeline/src/main.py::main after run_migrations():

    from src.seeds.master_admin import seed_master_admin
    await seed_master_admin(DATABASE_URL)

The seed is a no-op if ANY master_admin already exists. Safe to run
on every boot.
"""
from __future__ import annotations

import logging
import os
import secrets
from typing import Optional

import asyncpg

logger = logging.getLogger(__name__)

MASTER_ADMIN_EMAIL = "eric@rfppipeline.com"


async def seed_master_admin(database_url: str) -> None:
    """Seed the initial master_admin if none exists yet.

    Returns silently on success. Logs and continues on failure — a
    failed seed must never crash the worker boot loop.
    """
    conn: Optional[asyncpg.Connection] = None
    try:
        conn = await asyncpg.connect(database_url)

        # Idempotent guard — never overwrite an existing master_admin
        existing = await conn.fetchval(
            "SELECT 1 FROM users WHERE role = 'master_admin' LIMIT 1"
        )
        if existing:
            logger.info("[seed] master_admin already exists, skipping")
            return

        # Use the env var if set (backward compat); otherwise generate
        # a fresh crypto-random temp password. token_urlsafe(12) yields
        # 16 ASCII characters with no shell-special chars.
        initial_password = (
            os.getenv("INITIAL_MASTER_ADMIN_PASSWORD")
            or secrets.token_urlsafe(12)
        )

        # Lazy import so test collection works without bcrypt installed.
        import bcrypt  # type: ignore[import-not-found]

        password_hash = bcrypt.hashpw(
            initial_password.encode("utf-8"),
            bcrypt.gensalt(rounds=12),
        ).decode("utf-8")

        # ON CONFLICT DO NOTHING is the safety net for the (impossible
        # given the early-out above) race where two pipeline workers
        # boot simultaneously and both try to insert. The early-out
        # is the primary guard.
        await conn.execute(
            """
            INSERT INTO users (email, name, role, password_hash, is_active, temp_password)
            VALUES ($1, $2, 'master_admin', $3, true, true)
            ON CONFLICT (email) DO NOTHING
            """,
            MASTER_ADMIN_EMAIL,
            "Eric (Master Admin)",
            password_hash,
        )

        # LOUD banner — must be findable in Railway pipeline logs.
        # Use print() not logger.info() because Python's logging
        # defaults route to stderr at WARNING level; we want stdout
        # at guaranteed visibility regardless of LOG_LEVEL config.
        # flush=True so it lands immediately, not buffered until exit.
        banner = "=" * 64
        print(banner, flush=True)
        print("[seed] BOOTSTRAP: master_admin user created", flush=True)
        print(f"[seed] email:    {MASTER_ADMIN_EMAIL}", flush=True)
        print(f"[seed] password: {initial_password}", flush=True)
        print("[seed]", flush=True)
        print("[seed] Use these credentials ONCE at /login.", flush=True)
        print("[seed] You will be forced to set a permanent password", flush=True)
        print("[seed] on first sign-in. This is the only time this", flush=True)
        print("[seed] temp password will ever be printed.", flush=True)
        print(banner, flush=True)

    except Exception as e:
        # Non-fatal — pipeline must keep booting even if seed fails.
        logger.error("[seed] master_admin seed failed: %s", e)
    finally:
        if conn is not None:
            await conn.close()
