// === Roles ===
export type UserRole = 'master_admin' | 'rfp_admin' | 'tenant_admin' | 'tenant_user' | 'partner_user';

// === Auth ===
export interface AppUser {
  id: string;
  name: string | null;
  email: string;
  role: UserRole;
  tenantId: string | null;
  isActive: boolean;
  tempPassword: boolean;
  createdAt: string;
}

export interface AppSession {
  user: AppUser;
  expires: string;
}

// === Tenants ===
export type TenantStatus = 'active' | 'suspended' | 'churned' | 'trial';
export type TenantPlan = 'finder' | 'reminder' | 'binder' | 'grinder';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  productTier: TenantPlan;
  createdAt: string;
}

// === Opportunities ===
export type PursuitStatus = 'unreviewed' | 'pursuing' | 'monitoring' | 'passed';
export type PriorityTier = 'high' | 'medium' | 'low';

export interface Opportunity {
  id: string;
  source: string;
  sourceId: string;
  title: string;
  agency: string;
  closeDate: string | null;
  totalScore: number;
  pursuitStatus: PursuitStatus;
  priorityTier: PriorityTier;
}

// === Proposals ===
export type ProposalStage = 'outline' | 'draft' | 'pink_team' | 'red_team' | 'gold_team' | 'final' | 'submitted' | 'archived';
export type CollaboratorPermission = 'view' | 'comment' | 'edit';

export interface Proposal {
  id: string;
  tenantId: string;
  opportunityId: string;
  title: string;
  stage: ProposalStage;
  createdAt: string;
}

// === Agent Fabric ===
export type AgentRole = 'opportunity_analyst' | 'scoring_strategist' | 'capture_strategist' | 'proposal_architect' | 'section_drafter' | 'compliance_reviewer' | 'color_team_reviewer' | 'partner_coordinator' | 'librarian' | 'packaging_specialist';

export interface AgentTaskRequest {
  tenantId: string;
  agentRole: AgentRole;
  taskType: string;
  input: Record<string, unknown>;
  proposalId?: string;
  sectionId?: string;
}

// Additional types will be added as features are implemented
