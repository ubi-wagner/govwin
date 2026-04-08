"""Idempotent seed for the initial master_admin user.

Seeds exactly one row:

    email = eric@rfppipeline.com
    role  = master_admin

Password is read from the INITIAL_MASTER_ADMIN_PASSWORD env var at
seed time, bcrypt-hashed with cost 12, and NEVER logged. After the
first successful boot the env var should be unset on Railway; the
seed logs a warning if it is still present after a master_admin
already exists in the DB.

See docs/DECISIONS.md D004.

Usage from pipeline/src/main.py::main after run_migrations():

    from src.seeds.master_admin import seed_master_admin
    await seed_master_admin(DATABASE_URL)

The seed is a no-op if ANY master_admin already exists. Safe to run
on every boot.
"""
from __future__ import annotations

import logging
import os
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
        existing = await conn.fetchval(
            "SELECT 1 FROM users WHERE role = 'master_admin' LIMIT 1"
        )
        if existing:
            if os.getenv("INITIAL_MASTER_ADMIN_PASSWORD"):
                logger.warning(
                    "[seed] master_admin already exists but "
                    "INITIAL_MASTER_ADMIN_PASSWORD is still set on Railway. "
                    "Unset this env var to complete the bootstrap."
                )
            else:
                logger.info("[seed] master_admin already exists, skipping")
            return

        initial_password = os.getenv("INITIAL_MASTER_ADMIN_PASSWORD")
        if not initial_password:
            logger.error(
                "[seed] no master_admin exists and "
                "INITIAL_MASTER_ADMIN_PASSWORD is not set. "
                "Cannot bootstrap the initial admin user."
            )
            return

        # Lazy import so test collection works without bcrypt installed.
        import bcrypt  # type: ignore[import-not-found]

        password_hash = bcrypt.hashpw(
            initial_password.encode("utf-8"),
            bcrypt.gensalt(rounds=12),
        ).decode("utf-8")

        await conn.execute(
            """
            INSERT INTO users (email, name, role, password_hash, is_active, temp_password)
            VALUES ($1, $2, 'master_admin', $3, true, true)
            ON CONFLICT (email) DO UPDATE
              SET role = 'master_admin',
                  password_hash = EXCLUDED.password_hash,
                  is_active = true,
                  temp_password = true,
                  updated_at = now()
            """,
            MASTER_ADMIN_EMAIL,
            "Eric (Master Admin)",
            password_hash,
        )
        logger.info(
            "[seed] master_admin bootstrapped for %s (temp_password=true)",
            MASTER_ADMIN_EMAIL,
        )
    except Exception as e:
        # Non-fatal — pipeline must keep booting even if seed fails.
        logger.error("[seed] master_admin seed failed: %s", e)
    finally:
        if conn is not None:
            await conn.close()
