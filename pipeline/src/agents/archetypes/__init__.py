"""Agent archetypes — specialized AI roles for the proposal lifecycle."""

from .base import BaseArchetype
from .section_drafter import SectionDrafterArchetype
from .color_team_reviewer import ColorTeamReviewerArchetype
from .opportunity_analyst import OpportunityAnalystArchetype

__all__ = [
    "BaseArchetype",
    "SectionDrafterArchetype",
    "ColorTeamReviewerArchetype",
    "OpportunityAnalystArchetype",
]
