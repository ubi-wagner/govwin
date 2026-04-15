"""Shared pytest fixtures + async config."""
import pytest


def pytest_collection_modifyitems(config, items):
    """Auto-apply asyncio mark to any test function named async."""
    for item in items:
        if "asyncio" not in item.keywords and item.get_closest_marker("asyncio") is None:
            # Check if the function is a coroutine
            if hasattr(item, "function") and hasattr(item.function, "__code__"):
                if item.function.__code__.co_flags & 0x100:  # CO_COROUTINE
                    item.add_marker(pytest.mark.asyncio)
