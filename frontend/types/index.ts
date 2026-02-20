/**
 * TypeScript interfaces — mirrors Postgres schema exactly
 * Flows: DB → API route → React component with no runtime surprises
 * Sync with db/migrations/ when schema changes
 */

// ─── Auth ─────────────────────────────────────────────────────
export type UserRole = 'master_admin' | 'tenant_admin' | 'tenant_user'

export interface AppUser {
  id: string
  name: string | null
  email: string
  role: UserRole
  tenantId: string | null
  isActive: boolean
  lastLoginAt: string | null
  tempPassword: boolean
  createdAt: string
}

// Attached to NextAuth session (extends default session)
export interface AppSession {
  user: {
    id: string
    name: string | null
    email: string
    role: UserRole
    tenantId: string | null
    tempPassword: boolean
  }
  expires: string
}

// ─── Tenants ──────────────────────────────────────────────────
export type TenantStatus = 'active' | 'suspended' | 'churned' | 'trial'
export type TenantPlan   = 'starter' | 'professional' | 'enterprise'

export interface Tenant {
  id: string
  slug: string
  name: string
  legalName: string | null
  plan: TenantPlan
  status: TenantStatus
  primaryEmail: string | null
  primaryPhone: string | null
  website: string | null
  ueiNumber: string | null
  cageCode: string | null
  samRegistered: boolean
  internalNotes: string | null
  onboardedAt: string | null
  trialEndsAt: string | null
  features: Record<string, boolean>
  billingEmail: string | null
  createdAt: string
  updatedAt: string
}

export interface TenantProfile {
  id: string
  tenantId: string
  primaryNaics: string[]
  secondaryNaics: string[]
  keywordDomains: Record<string, string[]>
  isSmallBusiness: boolean
  isSdvosb: boolean
  isWosb: boolean
  isHubzone: boolean
  is8a: boolean
  agencyPriorities: Record<string, 1 | 2 | 3>
  minContractValue: number | null
  maxContractValue: number | null
  minSurfaceScore: number
  highPriorityScore: number
  selfService: boolean
  updatedBy: string
  updatedAt: string
}

// Admin view with extra stats
export interface TenantWithStats extends Tenant {
  userCount: number
  opportunityCount: number
  pursuingCount: number
  avgScore: number | null
  lastActivityAt: string | null
}

// ─── Opportunities ────────────────────────────────────────────
export type OpportunityStatus  = 'active' | 'closed' | 'awarded' | 'cancelled'
export type PursuitStatus      = 'unreviewed' | 'pursuing' | 'monitoring' | 'passed'
export type DeadlineStatus     = 'urgent' | 'soon' | 'ok' | 'closed'
export type PriorityTier       = 'high' | 'medium' | 'low'
export type ActionType         = 'thumbs_up' | 'thumbs_down' | 'comment' | 'note' | 'status_change' | 'pin'

// From tenant_pipeline VIEW — main portal query result
export interface TenantPipelineItem {
  tenantOppId: string
  tenantId: string
  opportunityId: string
  source: string
  sourceId: string
  solicitationNumber: string | null
  title: string
  description: string | null
  agency: string | null
  agencyCode: string | null
  naicsCodes: string[]
  setAsideType: string | null
  opportunityType: string
  postedDate: string | null
  closeDate: string | null
  estimatedValueMin: number | null
  estimatedValueMax: number | null
  sourceUrl: string
  oppStatus: OpportunityStatus
  // Tenant scores
  totalScore: number | null
  llmAdjustment: number | null
  llmRationale: string | null
  matchedKeywords: string[]
  matchedDomains: string[]
  pursuitStatus: PursuitStatus
  pursuitRecommendation: 'pursue' | 'monitor' | 'pass' | null
  keyRequirements: string[]
  competitiveRisks: string[]
  questionsForRfi: string[]
  priorityTier: PriorityTier
  scoredAt: string | null
  // Computed
  daysToClose: number | null
  deadlineStatus: DeadlineStatus
  // Reactions
  thumbsUp: number
  thumbsDown: number
  commentCount: number
  isPinned: boolean
  lastActionAt: string | null
  docCount: number
  amendmentCount: number
}

export interface TenantAction {
  id: string
  tenantId: string
  opportunityId: string
  userId: string
  actionType: ActionType
  value: string | null
  metadata: Record<string, unknown> | null
  scoreAtAction: number | null
  createdAt: string
}

export interface OpportunityFilters {
  search?: string
  source?: string
  opportunityType?: string
  minScore?: number
  agency?: string
  pursuitStatus?: PursuitStatus
  deadlineStatus?: DeadlineStatus
  setAsideType?: string
  isPinned?: boolean
  sortBy?: 'score' | 'close_date' | 'posted_date' | 'value' | 'last_action'
  sortDir?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

// ─── Downloads & Uploads ──────────────────────────────────────
export type LinkType    = 'resource' | 'template' | 'guidance' | 'opportunity_doc'
export type UploadType  = 'general' | 'capability_doc' | 'cut_sheet' | 'past_performance' | 'personnel_resume'

export interface DownloadLink {
  id: string
  tenantId: string
  title: string
  description: string | null
  url: string
  linkType: LinkType
  opportunityId: string | null
  isActive: boolean
  expiresAt: string | null
  accessCount: number
  lastAccessedAt: string | null
  createdBy: string
  createdAt: string
}

export interface TenantUpload {
  id: string
  tenantId: string
  uploadedBy: string
  filename: string
  originalFilename: string
  filePath: string
  fileSizeBytes: number | null
  mimeType: string | null
  uploadType: UploadType
  description: string | null
  isActive: boolean
  createdAt: string
}

// ─── Pipeline / Control Plane ─────────────────────────────────
export type JobStatus          = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type ApiKeyExpiry       = 'ok' | 'expiring_soon' | 'expired' | 'no_expiry'
export type SourceHealthStatus = 'healthy' | 'degraded' | 'error' | 'unknown'

export interface PipelineJob {
  id: string
  source: string
  runType: string
  status: JobStatus
  triggeredBy: string
  triggeredAt: string
  startedAt: string | null
  completedAt: string | null
  priority: number
  attempt: number
  result: PipelineRunResult | null
  errorMessage: string | null
}

export interface PipelineRunResult {
  opportunitiesFetched: number
  opportunitiesNew: number
  opportunitiesUpdated: number
  tenantsScored: number
  documentsDownloaded: number
  llmCallsMade: number
  llmCostUsd: number | null
  amendmentsDetected: number
  errors: string[]
}

export interface PipelineSchedule {
  id: string
  source: string
  displayName: string
  runType: string
  cronExpression: string
  enabled: boolean
  priority: number
  lastRunAt: string | null
  nextRunAt: string | null
}

export interface SystemStatus {
  pipelineJobs: { pending: number; running: number; failed24h: number }
  tenants: { total: number; active: number; trial: number }
  sourceHealth: Record<string, SourceHealthStatus>
  apiKeys: Record<string, ApiKeyExpiry>
  rateLimits: Record<string, { used: number; limit: number | null }>
  checkedAt: string
}

// ─── Knowledge Base ───────────────────────────────────────────
export interface PastPerformance {
  id: string
  tenantId: string
  contractNumber: string
  title: string
  agency: string
  contractType: string | null
  naicsCode: string | null
  periodStart: string | null
  periodEnd: string | null
  valueUsd: number | null
  description: string
  relevanceDomains: string[]
  keyTechnologies: string[]
  outcomes: string[]
  active: boolean
}

export interface Capability {
  id: string
  tenantId: string
  domain: string
  maturityLevel: 'expert' | 'proficient' | 'developing'
  summary: string
  keyTechnologies: string[]
  active: boolean
}

// ─── Admin ────────────────────────────────────────────────────
export interface AuditEntry {
  id: string
  userId: string | null
  tenantId: string | null
  action: string
  entityType: string | null
  entityId: string | null
  createdAt: string
}

// ─── API responses ────────────────────────────────────────────
export interface PaginatedResponse<T> {
  data: T[]
  total: number
  limit: number
  offset: number
}

export interface ApiError {
  error: string
  code?: string
}
