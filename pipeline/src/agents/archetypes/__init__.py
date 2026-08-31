"""Agent archetypes — specialized AI roles for the proposal lifecycle."""

from .base import BaseArchetype
from .advisory_manager import AdvisoryManagerArchetype
from .amendment_monitor import AmendmentMonitorArchetype
from .capture_strategist import CaptureStrategistArchetype
from .color_team_reviewer import ColorTeamReviewerArchetype
from .compliance_reviewer import ComplianceReviewerArchetype
from .content_curator import ContentCuratorArchetype
from .content_generator import ContentGeneratorArchetype
from .continuity_manager import ContinuityManagerArchetype
from .cost_estimator import CostEstimatorArchetype
from .curation_qa import CurationQaArchetype
from .formatter import FormatterArchetype
from .ingest_analyst import IngestAnalystArchetype
from .librarian import LibrarianArchetype
from .library_seed_mapper import LibrarySeedMapperArchetype
from .library_seed_suggester import LibrarySeedSuggesterArchetype
from .market_analyst import MarketAnalystArchetype
from .matrix_stager import MatrixStagerArchetype
from .onboarding_agent import OnboardingAgentArchetype
from .opportunity_analyst import OpportunityAnalystArchetype
from .opportunity_scout import OpportunityScoutArchetype
from .ops_digest import OpsDigestArchetype
from .outcome_analyst import OutcomeAnalystArchetype
from .packaging_specialist import PackagingSpecialistArchetype
from .partner_coordinator import PartnerCoordinatorArchetype
from .pp_matcher import PpMatcherArchetype
from .proposal_architect import ProposalArchitectArchetype
from .project_manager import ProjectManagerArchetype
from .proposal_manager import ProposalManagerArchetype
from .status_narrator import StatusNarratorArchetype
from .redaction_guard import RedactionGuardArchetype
from .research_scout import ResearchScoutArchetype
from .rfp_ingest_manager import RfpIngestManagerArchetype
from .scoring_strategist import ScoringStrategistArchetype
from .section_drafter import SectionDrafterArchetype
from .skeleton_architect import SkeletonArchitectArchetype
from .social_scheduler import SocialSchedulerArchetype
from .stylist import StylistArchetype
from .traceability_auditor import TraceabilityAuditorArchetype

__all__ = [
    "BaseArchetype",
    "AdvisoryManagerArchetype",
    "AmendmentMonitorArchetype",
    "CaptureStrategistArchetype",
    "ColorTeamReviewerArchetype",
    "ComplianceReviewerArchetype",
    "ContentCuratorArchetype",
    "ContentGeneratorArchetype",
    "ContinuityManagerArchetype",
    "CostEstimatorArchetype",
    "CurationQaArchetype",
    "FormatterArchetype",
    "IngestAnalystArchetype",
    "LibrarianArchetype",
    "LibrarySeedMapperArchetype",
    "LibrarySeedSuggesterArchetype",
    "MarketAnalystArchetype",
    "MatrixStagerArchetype",
    "OnboardingAgentArchetype",
    "OpportunityAnalystArchetype",
    "OpportunityScoutArchetype",
    "OpsDigestArchetype",
    "OutcomeAnalystArchetype",
    "PackagingSpecialistArchetype",
    "PartnerCoordinatorArchetype",
    "PpMatcherArchetype",
    "ProposalArchitectArchetype",
    "ProjectManagerArchetype",
    "ProposalManagerArchetype",
    "StatusNarratorArchetype",
    "RedactionGuardArchetype",
    "ResearchScoutArchetype",
    "RfpIngestManagerArchetype",
    "ScoringStrategistArchetype",
    "SectionDrafterArchetype",
    "SkeletonArchitectArchetype",
    "SocialSchedulerArchetype",
    "StylistArchetype",
    "TraceabilityAuditorArchetype",
]
