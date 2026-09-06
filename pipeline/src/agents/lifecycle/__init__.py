"""Lifecycle modules for agent memory management.

These modules handle the ongoing maintenance of the memory store:
decay -> garbage collection -> compaction -> contradiction resolution.
"""

from .compactor import MemoryCompactor
from .contradiction_resolver import ContradictionResolver
from .decay import MemoryDecay
from .gc import MemoryGC

__all__ = [
    "MemoryCompactor",
    "ContradictionResolver",
    "MemoryDecay",
    "MemoryGC",
]
