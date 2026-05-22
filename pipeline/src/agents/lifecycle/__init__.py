"""Lifecycle modules for agent memory management.

These modules handle the ongoing maintenance of the memory store:
decay -> garbage collection -> compaction -> contradiction resolution.
"""

from pipeline.src.agents.lifecycle.compactor import MemoryCompactor
from pipeline.src.agents.lifecycle.contradiction_resolver import ContradictionResolver
from pipeline.src.agents.lifecycle.decay import MemoryDecay
from pipeline.src.agents.lifecycle.gc import MemoryGC

__all__ = [
    "MemoryCompactor",
    "ContradictionResolver",
    "MemoryDecay",
    "MemoryGC",
]
