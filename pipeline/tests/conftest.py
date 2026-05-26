"""Shared pytest fixtures + async config."""
import os
import pytest

# Ensure config.py doesn't crash during test collection
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test_db")


def pytest_collection_modifyitems(config, items):
    """Auto-apply asyncio mark to any test function named async."""
    for item in items:
        if "asyncio" not in item.keywords and item.get_closest_marker("asyncio") is None:
            # Check if the function is a coroutine
            if hasattr(item, "function") and hasattr(item.function, "__code__"):
                if item.function.__code__.co_flags & 0x100:  # CO_COROUTINE
                    item.add_marker(pytest.mark.asyncio)
