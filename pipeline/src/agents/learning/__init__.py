"""Learning modules for the agent memory lifecycle.

These modules implement the continuous learning flywheel:
edit analysis -> preference extraction -> pattern promotion -> outcome attribution -> calibration.
"""

from pipeline.src.agents.learning.calibrator import Calibrator
from pipeline.src.agents.learning.diff_analyzer import DiffAnalyzer
from pipeline.src.agents.learning.outcome_attributor import OutcomeAttributor
from pipeline.src.agents.learning.pattern_promoter import PatternPromoter
from pipeline.src.agents.learning.preference_extractor import PreferenceExtractor

__all__ = [
    "Calibrator",
    "DiffAnalyzer",
    "OutcomeAttributor",
    "PatternPromoter",
    "PreferenceExtractor",
]
