"""Shared pytest fixtures + async config."""
import os
import socket
import pytest
from urllib.parse import urlparse

# Ensure config.py (which requires a non-empty DATABASE_URL) doesn't crash during
# test collection. This is a PLACEHOLDER — a real DB is only needed by the
# DB-integration tests, which guard on `skipif(not DATABASE_URL)`.
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test_db")


def _db_reachable(url: str, timeout: float = 1.0) -> bool:
    """True iff a TCP connection to the DATABASE_URL host:port succeeds.

    The placeholder URL above defeats the DB tests' `skipif(not DATABASE_URL)`
    guard in CI (the var is set, so they run and then error on connect). Probing
    reachability lets those tests SKIP cleanly when no Postgres is up (CI without a
    DB service), while still RUNNING in the sandbox where Postgres is live.
    """
    try:
        p = urlparse(url)
        with socket.create_connection((p.hostname or "localhost", p.port or 5432), timeout=timeout):
            return True
    except OSError:
        return False


DB_REACHABLE = _db_reachable(os.environ.get("DATABASE_URL", ""))

_asyncpg_module_cache: dict = {}


def _module_uses_asyncpg(mod) -> bool:
    """True if the test module's source references asyncpg (module- OR function-level
    import) — i.e. it connects to Postgres and must skip when no DB is reachable."""
    path = getattr(mod, "__file__", None)
    if not path:
        return False
    if path not in _asyncpg_module_cache:
        try:
            with open(path, encoding="utf-8") as fh:
                _asyncpg_module_cache[path] = "asyncpg" in fh.read()
        except OSError:
            _asyncpg_module_cache[path] = False
    return _asyncpg_module_cache[path]


def pytest_collection_modifyitems(config, items):
    """Auto-apply the asyncio mark to coroutine tests, and skip DB-integration tests
    (any module that uses asyncpg) when no reachable Postgres is configured."""
    db_skip = pytest.mark.skip(reason="no reachable Postgres (DATABASE_URL host is down)")
    for item in items:
        if "asyncio" not in item.keywords and item.get_closest_marker("asyncio") is None:
            # Check if the function is a coroutine
            if hasattr(item, "function") and hasattr(item.function, "__code__"):
                if item.function.__code__.co_flags & 0x100:  # CO_COROUTINE
                    item.add_marker(pytest.mark.asyncio)
        if not DB_REACHABLE and _module_uses_asyncpg(item.module):
            item.add_marker(db_skip)
