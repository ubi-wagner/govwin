"""Agent archetypes — specialized AI roles for the proposal lifecycle."""

from .base import BaseArchetype
from .capture_strategist import CaptureStrategistArchetype
from .color_team_reviewer import ColorTeamReviewerArchetype
from .compliance_reviewer import ComplianceReviewerArchetype
from .librarian import LibrarianArchetype
from .onboarding_agent import OnboardingAgentArchetype
from .opportunity_analyst import OpportunityAnalystArchetype
from .packaging_specialist import PackagingSpecialistArchetype
from .partner_coordinator import PartnerCoordinatorArchetype
from .proposal_architect import ProposalArchitectArchetype
from .scoring_strategist import ScoringStrategistArchetype
from .section_drafter import SectionDrafterArchetype

__all__ = [
    "BaseArchetype",
    "CaptureStrategistArchetype",
    "ColorTeamReviewerArchetype",
    "ComplianceReviewerArchetype",
    "LibrarianArchetype",
    "OnboardingAgentArchetype",
    "OpportunityAnalystArchetype",
    "PackagingSpecialistArchetype",
    "PartnerCoordinatorArchetype",
    "ProposalArchitectArchetype",
    "ScoringStrategistArchetype",
    "SectionDrafterArchetype",
]
