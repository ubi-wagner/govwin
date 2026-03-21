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
  // 007 additions
  productTier: ProductTier
  maxActiveOpps: number
  driveFinderFolderId: string | null
  driveRemindersFolderId: string | null
  driveBinderFolderId: string | null
  driveGrinderFolderId: string | null
  driveUploadsFolderId: string | null
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
  agencyAtAction: string | null
  typeAtAction: string | null
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

// ─── Downloads (V1: external links only) ─────────────────────
export type LinkType    = 'resource' | 'template' | 'guidance' | 'opportunity_doc'

// Phase 2: file upload support — types kept for DB schema parity
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
  updatedAt: string
}

// Phase 2: file upload support — interface kept for DB schema parity
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

// ─── Google Drive ────────────────────────────────────────────
export type DriveFileType = 'FOLDER' | 'DOCUMENT' | 'SPREADSHEET' | 'PRESENTATION' | 'PDF' | 'FILE'

export type ArtifactType =
  // Global (/Opportunities/)
  | 'weekly_folder' | 'opp_folder' | 'opp_attachment' | 'opp_extract'
  | 'opp_analysis' | 'weekly_digest' | 'master_index'
  // Tenant Finder
  | 'pipeline_snapshot' | 'curated_summary' | 'saved_shortcut'
  // Tenant Reminder
  | 'deadline_tracker' | 'amendment_log'
  // Tenant Binder
  | 'project_folder' | 'requirements_matrix' | 'compliance_checklist'
  | 'pwin_assessment' | 'tenant_upload'
  // Tenant Grinder
  | 'proposal_draft' | 'proposal_section' | 'compliance_matrix'
  | 'executive_summary'
  // System
  | 'template'

export type ArtifactScope = 'global' | 'tenant' | 'system'
export type ProductTier   = 'finder' | 'reminder' | 'binder' | 'grinder'

export interface DriveFile {
  id: string
  gid: string
  name: string
  type: DriveFileType
  mimeType: string | null
  tenantId: string | null
  parentGid: string | null
  webViewLink: string | null
  downloadLink: string | null
  permissions: Record<string, unknown>[]
  isProcessed: boolean
  autoCreated: boolean
  // 007 additions
  opportunityId: string | null
  artifactType: ArtifactType | null
  artifactScope: ArtifactScope | null
  productTier: ProductTier | null
  version: number
  contentHash: string | null
  lastSyncedAt: string | null
  weekLabel: string | null
  createdAt: string
  updatedAt: string
}

// ─── Event Bus ──────────────────────────────────────────────

// Opportunity event types by worker namespace
export type OpportunityEventType =
  | 'ingest.new' | 'ingest.updated' | 'ingest.closed' | 'ingest.cancelled'
  | 'ingest.document_added' | 'ingest.field_changed'
  | 'scoring.scored' | 'scoring.rescored'
  | 'drive.archived' | 'drive.extracted' | 'drive.analyzed'

// Customer event types by worker namespace
export type CustomerEventType =
  | 'finder.opp_presented' | 'finder.opp_attached' | 'finder.opp_dismissed'
  | 'finder.summary_generated' | 'finder.summary_reviewed' | 'finder.cap_reached'
  | 'reminder.nudge_sent' | 'reminder.amendment_alert' | 'reminder.digest_sent'
  | 'reminder.deadline_acknowledged'
  | 'binder.project_created' | 'binder.upload_added' | 'binder.pwin_updated'
  | 'binder.stage_advanced'
  | 'grinder.draft_generated' | 'grinder.draft_reviewed' | 'grinder.draft_approved'
  | 'account.tier_upgraded' | 'account.tier_downgraded' | 'account.cap_increased'
  | 'account.user_added' | 'account.profile_updated' | 'account.drive_provisioned'

export interface OpportunityEvent {
  id: string
  opportunityId: string
  eventType: OpportunityEventType
  source: string
  fieldChanged: string | null
  oldValue: string | null
  newValue: string | null
  snapshotHash: string | null
  metadata: Record<string, unknown>
  processed: boolean
  processedBy: string | null
  processedAt: string | null
  createdAt: string
}

export interface CustomerEvent {
  id: string
  tenantId: string
  userId: string | null
  eventType: CustomerEventType
  opportunityId: string | null
  entityType: string | null
  entityId: string | null
  description: string | null
  metadata: Record<string, unknown>
  processed: boolean
  processedBy: string | null
  processedAt: string | null
  createdAt: string
}

// ─── Tenant Active Opp Cap ──────────────────────────────────

export interface TenantOppCap {
  tenantId: string
  tenantName: string
  productTier: ProductTier
  maxActiveOpps: number
  pursuingCount: number
  monitoringCount: number
  activeCount: number
  slotsRemaining: number
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
  workerId: string | null
  priority: number
  attempt: number
  maxAttempts: number
  parameters: Record<string, unknown>
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
  timezone: string
  enabled: boolean
  priority: number
  timeoutMinutes: number
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

// ─── Knowledge Base (Phase 2 — tables exist but no API/UI yet) ─
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
  oldValue: unknown | null
  newValue: unknown | null
  ipAddress: string | null
  userAgent: string | null
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
