"""Agent archetypes — specialized AI roles for the proposal lifecycle."""

from .base import BaseArchetype
from .amendment_monitor import AmendmentMonitorArchetype
from .capture_strategist import CaptureStrategistArchetype
from .color_team_reviewer import ColorTeamReviewerArchetype
from .compliance_reviewer import ComplianceReviewerArchetype
from .cost_estimator import CostEstimatorArchetype
from .ingest_analyst import IngestAnalystArchetype
from .librarian import LibrarianArchetype
from .matrix_stager import MatrixStagerArchetype
from .onboarding_agent import OnboardingAgentArchetype
from .opportunity_analyst import OpportunityAnalystArchetype
from .opportunity_scout import OpportunityScoutArchetype
from .outcome_analyst import OutcomeAnalystArchetype
from .packaging_specialist import PackagingSpecialistArchetype
from .partner_coordinator import PartnerCoordinatorArchetype
from .pp_matcher import PpMatcherArchetype
from .proposal_architect import ProposalArchitectArchetype
from .scoring_strategist import ScoringStrategistArchetype
from .section_drafter import SectionDrafterArchetype
from .skeleton_architect import SkeletonArchitectArchetype

__all__ = [
    "BaseArchetype",
    "AmendmentMonitorArchetype",
    "CaptureStrategistArchetype",
    "ColorTeamReviewerArchetype",
    "ComplianceReviewerArchetype",
    "CostEstimatorArchetype",
    "IngestAnalystArchetype",
    "LibrarianArchetype",
    "MatrixStagerArchetype",
    "OnboardingAgentArchetype",
    "OpportunityAnalystArchetype",
    "OpportunityScoutArchetype",
    "OutcomeAnalystArchetype",
    "PackagingSpecialistArchetype",
    "PartnerCoordinatorArchetype",
    "PpMatcherArchetype",
    "ProposalArchitectArchetype",
    "ScoringStrategistArchetype",
    "SectionDrafterArchetype",
    "SkeletonArchitectArchetype",
]
