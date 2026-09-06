"""
Database connection for the CRM service.

Two connections, and they are not interchangeable:

  CRM_DATABASE     the service's OWN Postgres. Internal to the Railway private network — no public
                   proxy — so nothing outside the deployment can reach it. See `crm_database_url()`.
  SHARED_DATABASE_URL  the bridge to the MAIN database (`system_events`, `email_send_ledger`).

Uses asyncpg for async access.
"""
import os
import logging

import asyncpg

logger = logging.getLogger('cms.db')

_pool: asyncpg.Pool | None = None

#: The variable names for the CRM database, newest FIRST.
#:
#: ── WHY THIS IS A CHAIN AND NOT A CONSTANT ───────────────────────────────────────────────────
#: The variable was renamed from `CMS_DATABASE_URL` to `CRM_DATABASE`, and a rename crosses a
#: deploy boundary: the platform variable and the code that reads it do not change in the same
#: instant. Whichever moves first, a single-name reader is a service that will not boot in the gap
#: — and this one raises RuntimeError at startup, so the gap is an outage rather than a degradation.
#:
#: The chain closes the gap in both directions. It is TEMPORARY: once Railway, the GitHub secrets
#: and staging all carry the new name, the legacy entry can go, and the deprecation warning below
#: is what will tell you when that is true.
_CRM_URL_VARS = ('CRM_DATABASE', 'CRM_DATABASE_URL', 'CMS_DATABASE_URL')

#: Names kept only for the transition, warned about on every resolve.
_LEGACY_CRM_URL_VARS = ('CMS_DATABASE_URL',)


def crm_database_url() -> str | None:
    """The CRM database URL, from whichever variable currently carries it.

    ONE resolver, imported everywhere. The name used to be read directly by
    `os.getenv('CMS_DATABASE_URL')` in three Python files, a bash migration runner, two CI
    workflows and a compose file — which is how a rename becomes eight independent chances to
    strand something. `tests/test_crm_database_var.py` asserts nothing reads the raw variable again.
    """
    for var in _CRM_URL_VARS:
        value = os.getenv(var)
        if value:
            if var in _LEGACY_CRM_URL_VARS:
                logger.warning(
                    "%s is DEPRECATED — the CRM database variable is now CRM_DATABASE. Still "
                    "honoured so a rename cannot strand this service mid-deploy; set the new name "
                    "and this line goes away.", var,
                )
            return value
    return None


async def init_db() -> None:
    """Initialize the connection pool. Called at startup."""
    global _pool
    db_url = crm_database_url()
    if not db_url:
        raise RuntimeError(
            'CRM_DATABASE is not set. The CRM service requires its own database — a separate '
            'Postgres in Railway, reachable only on the private network. '
            f'Looked for: {", ".join(_CRM_URL_VARS)}.'
        )
    _pool = await asyncpg.create_pool(
        db_url,
        min_size=2,
        max_size=10,
        command_timeout=30,
    )
    logger.info('CMS database pool initialized (min=2, max=10)')


async def close_db() -> None:
    """Close the connection pool. Called at shutdown."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
        logger.info('CMS database pool closed')


def get_pool() -> asyncpg.Pool:
    """Get the active connection pool. Raises if not initialized."""
    if _pool is None:
        raise RuntimeError('Database pool not initialized. Call init_db() first.')
    return _pool


async def get_conn():
    """Async context manager for a single connection from the pool."""
    pool = get_pool()
    return pool.acquire()


# ── Optional: event bridge to shared database ────────────────────

_event_pool: asyncpg.Pool | None = None


async def init_event_bridge() -> asyncpg.Pool | None:
    """
    Connect to the shared/main database for event emission only.
    This is the bridge that ties CMS events into the automation system.
    Optional — if SHARED_DATABASE_URL is not set, events are logged locally only.
    """
    global _event_pool
    shared_url = os.getenv('SHARED_DATABASE_URL')
    if not shared_url:
        logger.warning('SHARED_DATABASE_URL not set — event bridge disabled, events will be local-only')
        return None
    _event_pool = await asyncpg.create_pool(shared_url, min_size=1, max_size=3, command_timeout=10)

    # WHICH ROLE DOES THIS POOL CARRY? — a question the repo could not answer until now.
    #
    # `mailer/ledger.py` says it outright: "established which role SHARED_DATABASE_URL actually
    # carries" was never done. It matters because migration 215 gives `email_send_ledger` a SELECT
    # policy and NO write policy, so a NOBYPASSRLS role is refused there BY DESIGN. If this pool is
    # not privileged, every CRM send runs DEGRADED — the mail goes out, the ledger row is never
    # reserved, and a crash mid-send becomes invisible again, which is the exact failure the ledger
    # exists to make visible. The symptom is one 42501 per process and otherwise normal behaviour.
    #
    # So state it at boot, once, where an operator reading the startup log can see it — rather than
    # leaving it to be discovered from a suppressed exception months later. Reporting only: a wrong
    # role here degrades one capability and must not stop the service from starting.
    try:
        row = await _event_pool.fetchrow(
            'SELECT current_user AS role, rolsuper, rolbypassrls '
            'FROM pg_roles WHERE rolname = current_user'
        )
        if row is None:
            logger.warning('Event bridge: could not read the connected role')
        elif row['rolsuper'] or row['rolbypassrls']:
            logger.info(
                'Event bridge to shared database initialized (role=%s, privileged — '
                'email_send_ledger writes will land)', row['role'])
        else:
            logger.error(
                'Event bridge role=%s is NOBYPASSRLS — email_send_ledger has no write policy, so '
                'every CRM send will run DEGRADED (mail sent, no ledger reservation). Point '
                'SHARED_DATABASE_URL at the owner role.', row['role'])
    except Exception as exc:  # noqa: BLE001 - reporting only, never fatal
        logger.warning('Event bridge: role check failed (%s)', exc)

    return _event_pool


def get_event_pool() -> asyncpg.Pool | None:
    """Get the event bridge pool (may be None if not configured)."""
    return _event_pool


async def close_event_bridge() -> None:
    """Close the event bridge pool."""
    global _event_pool
    if _event_pool:
        await _event_pool.close()
        _event_pool = None
