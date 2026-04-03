"""
Database connection module for CMS service.

Uses asyncpg for async PostgreSQL access.
Connects to CMS_DATABASE_URL (separate from the main app DATABASE_URL).
"""
import os
import logging

import asyncpg

logger = logging.getLogger('cms.db')

_pool: asyncpg.Pool | None = None


async def init_db() -> None:
    """Initialize the connection pool. Called at startup."""
    global _pool
    db_url = os.getenv('CMS_DATABASE_URL')
    if not db_url:
        raise RuntimeError(
            'CMS_DATABASE_URL is not set. The CMS service requires its own database. '
            'Create a separate PostgreSQL plugin in Railway and set CMS_DATABASE_URL.'
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
    logger.info('Event bridge to shared database initialized')
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
