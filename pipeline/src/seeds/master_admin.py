"""
Seed: master_admin bootstrap
─────────────────────────────
Creates the very first master_admin user so the platform has a working
login immediately after deploy.  Designed to be called once on every
pipeline boot — it's fully idempotent and will no-op if a master_admin
row already exists.

Password handling:
  1. If INITIAL_MASTER_ADMIN_PASSWORD is set, use it.
  2. Otherwise generate a random 16-char token and print a LOUD banner
     so the operator can grab it from Railway deploy logs.

The user is created with temp_password=true, so NextAuth middleware
will force-redirect to /change-password on first sign-in.
"""

import logging
import os
import secrets

import asyncpg
import bcrypt

log = logging.getLogger("pipeline.seed.master_admin")


async def seed_master_admin(database_url: str) -> None:
    """Insert the bootstrap master_admin user if none exists."""
    try:
        conn: asyncpg.Connection = await asyncpg.connect(database_url)
    except Exception as exc:
        log.error("seed_master_admin: cannot connect to DB — %s", exc)
        return

    try:
        # ── Already seeded? ─────────────────────────────────────────
        row = await conn.fetchval(
            "SELECT 1 FROM users WHERE role = 'master_admin' LIMIT 1"
        )
        if row is not None:
            log.info("master_admin already exists, skipping seed.")
            return

        # ── Resolve credentials ─────────────────────────────────────
        email = os.getenv("MASTER_ADMIN_EMAIL", "eric@rfppipeline.com")
        password = os.getenv("INITIAL_MASTER_ADMIN_PASSWORD") or ""

        generated = False
        if not password:
            password = secrets.token_urlsafe(12)  # 16 chars, ~96 bits
            generated = True

        # ── Hash (bcrypt cost 12 — matches frontend bcryptjs config) ─
        password_hash = bcrypt.hashpw(
            password.encode("utf-8"),
            bcrypt.gensalt(rounds=12),
        ).decode("utf-8")

        # ── Insert ──────────────────────────────────────────────────
        await conn.execute(
            """
            INSERT INTO users (email, name, role, password_hash, is_active, temp_password)
            VALUES ($1, $2, 'master_admin', $3, true, true)
            ON CONFLICT (email) DO NOTHING
            """,
            email,
            "Eric (Master Admin)",
            password_hash,
        )

        # ── Banner (impossible to miss in Railway logs) ─────────────
        banner = "\n".join([
            "",
            "=" * 72,
            "=" * 72,
            "   MASTER ADMIN ACCOUNT CREATED",
            "=" * 72,
            f"   Email:    {email}",
            f"   Password: {password}",
            "",
            "   *** temp_password = true ***",
            "   You MUST change this on first login at /change-password",
            "",
        ])
        if generated:
            banner += (
                "   This password was auto-generated because\n"
                "   INITIAL_MASTER_ADMIN_PASSWORD was not set.\n"
                "   COPY IT NOW — it will never be shown again.\n"
            )
        banner += "\n".join([
            "=" * 72,
            "=" * 72,
            "",
        ])

        print(banner, flush=True)
        log.info("master_admin user seeded successfully (%s).", email)

    except Exception as exc:
        log.error("seed_master_admin failed: %s", exc)
    finally:
        await conn.close()
