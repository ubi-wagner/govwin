/**
 * TypeScript interfaces — mirrors Postgres schema exactly
 * Flows: DB → API route → React component with no runtime surprises
 * Sync with db/migrations/ when schema changes
 */

// ─── Auth ─────────────────────────────────────────────────────
export type UserRole = 'master_admin' | 'tenant_admin' | 'tenant_user' | 'partner_user'

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
  // 009 local storage paths
  storageRootPath: string | null
  storageFinderPath: string | null
  storageRemindersPath: string | null
  storageBinderPath: string | null
  storageGrinderPath: string | null
  storageUploadsPath: string | null
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
  department: string | null
  subTier: string | null
  office: string | null
  naicsCodes: string[]
  classificationCode: string | null
  setAsideType: string | null
  setAsideCode: string | null
  opportunityType: string
  baseType: string | null
  postedDate: string | null
  closeDate: string | null
  archiveDate: string | null
  estimatedValueMin: number | null
  estimatedValueMax: number | null
  sourceUrl: string
  samUiLink: string | null
  additionalInfoLink: string | null
  resourceLinks: ResourceLink[]
  oppStatus: OpportunityStatus
  isActive: boolean
  // Place of performance
  popCity: string | null
  popState: string | null
  popCountry: string | null
  popZip: string | null
  // Point of contact
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  contactTitle: string | null
  // Award info (populated when opp is awarded)
  awardDate: string | null
  awardNumber: string | null
  awardAmount: number | null
  awardeeName: string | null
  awardeeUei: string | null
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
  // SpotLight provenance
  matchedSpotlightIds?: string[]
  bestSpotlightId?: string | null
  bestSpotlightName?: string | null
  pinnedFromSpotlightId?: string | null
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
  programType: string | null
}

// SAM.gov resource/attachment link
export interface ResourceLink {
  name?: string
  url?: string
  type?: string
  size?: string
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
  programType?: string
  minScore?: number
  agency?: string
  pursuitStatus?: PursuitStatus
  deadlineStatus?: DeadlineStatus
  setAsideType?: string
  isPinned?: boolean
  spotlightId?: string
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

export type LinkedRecordType = 'past_performance' | 'capability' | 'personnel' | 'partner' | 'boilerplate'

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
  uploadCategory?: UploadCategory
  description: string | null
  focusAreaId: string | null
  spotlightId?: string | null
  linkedRecordType: LinkedRecordType | null
  linkedRecordId: string | null
  extractedText: string | null
  processed: boolean
  processedAt: string | null
  isActive: boolean
  libraryStatus?: LibraryProcessingStatus
  atomCount?: number
  libraryProcessedAt?: string | null
  createdAt: string
}

// ─── File Storage (local Railway volume + R2 archive) ────────
export type StorageBackend = 'local' | 'r2' | 'gdrive_legacy'
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

export interface StoredFile {
  id: string
  gid: string | null            // Legacy: Google Drive file ID
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
  // 009 local storage
  storagePath: string | null
  fileSizeBytes: number | null
  storageBackend: StorageBackend
  createdAt: string
  updatedAt: string
}

/** @deprecated Use StoredFile instead */
export type DriveFile = StoredFile

// ─── Event Bus ──────────────────────────────────────────────

// Opportunity event types by worker namespace
export type OpportunityEventType =
  | 'ingest.new' | 'ingest.updated' | 'ingest.closed' | 'ingest.cancelled'
  | 'ingest.document_added' | 'ingest.field_changed'
  | 'scoring.scored' | 'scoring.rescored' | 'scoring.llm_adjusted'
  | 'drive.archived' | 'drive.extracted' | 'drive.analyzed'
  | 'rfp.parsed' | 'rfp.template_extracted'

// Customer event types by worker namespace
export type CustomerEventType =
  | 'finder.opp_presented' | 'finder.opp_attached' | 'finder.opp_dismissed'
  | 'finder.summary_generated' | 'finder.summary_reviewed' | 'finder.cap_reached'
  | 'reminder.nudge_sent' | 'reminder.amendment_alert' | 'reminder.digest_sent'
  | 'reminder.deadline_acknowledged'
  | 'binder.project_created' | 'binder.upload_added' | 'binder.pwin_updated'
  | 'binder.stage_advanced'
  | 'grinder.draft_generated' | 'grinder.draft_reviewed' | 'grinder.draft_approved'
  | 'library.upload_ingested' | 'library.atoms_extracted' | 'library.atom_approved'
  | 'library.atom_updated' | 'library.atom_archived'
  | 'library.embeddings_generated' | 'library.harvest_completed' | 'library.duplicates_found'
  | 'proposal.created' | 'proposal.section_populated' | 'proposal.section_refined'
  | 'proposal.completed' | 'proposal.exported' | 'proposal.archived'
  | 'proposal.atoms_extracted' | 'proposal.section_approved'
  | 'proposal.outcome_recorded'
  | 'proposal.stage_changed' | 'proposal.deadline_warning'
  | 'proposal.collaborator_added' | 'proposal.collaborator_removed'
  | 'proposal.review_requested' | 'proposal.review_completed'
  | 'proposal.comment_added' | 'proposal.comment_resolved'
  | 'proposal.change_suggested' | 'proposal.change_accepted' | 'proposal.change_rejected'
  | 'proposal.file_uploaded' | 'proposal.file_versioned'
  | 'proposal.checklist_completed' | 'proposal.workspace_locked' | 'proposal.workspace_unlocked'
  | 'rfp.parsed' | 'rfp.template_created' | 'rfp.template_accepted' | 'rfp.template_corrected'
  | 'account.tier_upgraded' | 'account.tier_downgraded' | 'account.cap_increased'
  | 'account.user_added' | 'account.profile_updated' | 'account.drive_provisioned'
  | 'account.tenant_created' | 'account.tenant_updated'
  | 'account.login' | 'account.login_failed'
  | 'account.invite_sent' | 'account.invite_accepted' | 'account.invite_expired'
  | 'spotlight.created' | 'spotlight.updated' | 'spotlight.deleted'
  | 'purchase.created' | 'purchase.cancelled' | 'purchase.template_delivered'
  | 'partner.invited' | 'partner.accepted' | 'partner.approved'
  | 'partner.revoked' | 'partner.rejected' | 'partner.access_requested'

export interface OpportunityEvent {
  id: string
  opportunityId: string
  eventType: OpportunityEventType
  source: string
  fieldChanged: string | null
  oldValue: string | null
  newValue: string | null
  snapshotHash: string | null
  correlationId: string | null
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
  correlationId: string | null
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

export interface SourceHealthDetail {
  status: SourceHealthStatus
  consecutiveFailures: number
  lastSuccessAt: string | null
  lastErrorAt: string | null
  lastErrorMessage: string | null
  avgDurationSeconds: number | null
  successRate30d: number | null
}

export interface ApiKeyDetail {
  expiryStatus: ApiKeyExpiry
  hasStoredKey: boolean
  keyHint: string | null
  expiresDate: string | null
  daysUntilExpiry: number | null
  lastValidatedAt: string | null
  lastValidationOk: boolean | null
  lastValidationMsg: string | null
  rotatedAt: string | null
}

export interface SystemStatus {
  pipelineJobs: {
    pending: number
    running: number
    failed24h: number
    failedTotal: number
    completed24h: number
    staleRunning: number
  }
  tenants: { total: number; active: number; trial: number }
  sourceHealth: Record<string, SourceHealthDetail>
  apiKeys: Record<string, ApiKeyDetail>
  rateLimits: Record<string, { used: number; limit: number | null }>
  checkedAt: string
}

// ─── Content Library (Knowledge Base + Teaming) ─────────────────

export type PersonnelAffiliation = 'internal' | 'partner' | 'consultant' | 'advisor'
export type PersonnelAvailability = 'available' | 'committed' | 'partial' | 'unavailable'
export type PartnerType = 'subcontractor' | 'mentor' | 'jv_partner' | 'university' | 'lab' | 'consultant' | 'prime'
export type RelationshipStatus = 'active' | 'prospective' | 'inactive' | 'past'
export type PerformanceRating = 'exceptional' | 'very_good' | 'satisfactory' | 'marginal' | 'unsatisfactory'
export type BoilerplateCategory =
  | 'technical_approach' | 'management_approach' | 'past_performance'
  | 'staffing' | 'quality' | 'security' | 'transition' | 'general'

export interface FocusArea {
  id: string
  tenantId: string
  name: string
  description: string | null
  naicsCodes: string[]
  keywords: string[]
  status: 'active' | 'inactive'
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface PastPerformance {
  id: string
  tenantId: string
  contractNumber: string
  title: string
  agency: string
  agencyCode: string | null
  primeOrSub: 'prime' | 'sub'
  contractType: string | null
  naicsCode: string | null
  periodStart: string | null
  periodEnd: string | null
  valueUsd: number | null
  description: string
  relevanceDomains: string[]
  keyTechnologies: string[]
  outcomes: string[]
  pocName: string | null
  pocEmail: string | null
  pocPhone: string | null
  clearanceRequired: boolean
  partnerId: string | null
  performanceRating: PerformanceRating | null
  cparsRating: string | null
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface Capability {
  id: string
  tenantId: string
  domain: string
  naicsCodes: string[]
  maturityLevel: 'expert' | 'proficient' | 'developing'
  yearsExperience: number | null
  summary: string
  keyTechnologies: string[]
  differentiators: string[]
  certifications: string[]
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface KeyPersonnel {
  id: string
  tenantId: string
  fullName: string
  title: string
  roleType: string | null
  affiliation: PersonnelAffiliation
  partnerId: string | null
  organization: string | null
  email: string | null
  phone: string | null
  yearsExperience: number | null
  bioShort: string | null
  bioLong: string | null
  certifications: string[]
  clearanceLevel: string | null
  domains: string[]
  education: string[]
  publications: number
  laborCategory: string | null
  hourlyRate: number | null
  availability: PersonnelAvailability
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface TeamingPartner {
  id: string
  tenantId: string
  name: string
  legalName: string | null
  partnerType: PartnerType
  relationshipStatus: RelationshipStatus
  ueiNumber: string | null
  cageCode: string | null
  samRegistered: boolean
  isSmallBusiness: boolean
  isSdvosb: boolean
  isWosb: boolean
  isHubzone: boolean
  is8a: boolean
  businessSize: string | null
  naicsCodes: string[]
  capabilitiesSummary: string | null
  keyTechnologies: string[]
  certifications: string[]
  priorContracts: number
  teamingSince: string | null
  pocName: string | null
  pocEmail: string | null
  pocPhone: string | null
  pocTitle: string | null
  website: string | null
  notes: string | null
  ndaOnFile: boolean
  teamingAgreement: boolean
  taExpiration: string | null
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface BoilerplateSection {
  id: string
  tenantId: string
  sectionKey: string
  title: string
  content: string
  category: BoilerplateCategory
  wordCount: number | null
  lastUsedAt: string | null
  usageCount: number
  lastUpdated: string | null
  version: number
  active: boolean
  createdAt: string
  updatedAt: string
}

// Content library summary (from tenant_content_summary view)
export interface TenantContentSummary {
  tenantId: string
  tenantName: string
  focusAreaCount: number
  pastPerformanceCount: number
  capabilityCount: number
  internalPersonnelCount: number
  partnerPersonnelCount: number
  teamingPartnerCount: number
  boilerplateCount: number
  uploadCount: number
}

// Focus area with linked content counts (from focus_area_content view)
export interface FocusAreaContent {
  focusAreaId: string
  tenantId: string
  focusAreaName: string
  naicsCodes: string[]
  keywords: string[]
  pastPerformanceCount: number
  capabilityCount: number
  personnelCount: number
  partnerCount: number
  boilerplateCount: number
  uploadCount: number
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

// ─── Content Management (Digital Twin CMS) ───────────────────

export type ContentPageKey =
  | 'home' | 'about' | 'team' | 'tips'
  | 'customers' | 'announcements' | 'get_started' | 'happenings'
  | 'features' | 'engine'

export type ContentSource = 'manual' | 'generated' | 'hybrid'

export type ContentEventType =
  | 'content.draft_saved'
  | 'content.published'
  | 'content.rolled_back'
  | 'content.auto_generated'
  | 'content.auto_published'
  | 'content.unpublished'
  | 'content.configured'
  | 'content_pipeline.post.created'
  | 'content_pipeline.post.updated'
  | 'content_pipeline.post.submitted_for_review'
  | 'content_pipeline.post.approved'
  | 'content_pipeline.post.rejected'
  | 'content_pipeline.post.published'
  | 'content_pipeline.post.unpublished'
  | 'content_pipeline.post.reverted'
  | 'content_pipeline.post.archived'
  | 'content_pipeline.generation.requested'
  | 'content_pipeline.generation.accepted'
  | 'content_pipeline.generation.rejected'
  | 'content_pipeline.generation.retry_requested'

export interface SiteContent {
  id: string
  pageKey: ContentPageKey
  displayName: string
  draftContent: Record<string, unknown>
  draftMetadata: ContentMetadata
  draftUpdatedAt: string
  draftUpdatedBy: string | null
  publishedContent: Record<string, unknown> | null
  publishedMetadata: ContentMetadata | null
  publishedAt: string | null
  publishedBy: string | null
  previousContent: Record<string, unknown> | null
  previousMetadata: ContentMetadata | null
  previousPublishedAt: string | null
  autoPublish: boolean
  contentSource: ContentSource
  createdAt: string
  updatedAt: string
}

export interface ContentMetadata {
  title?: string
  description?: string
  keywords?: string[]
}

export interface ContentEvent {
  id: string
  pageKey: ContentPageKey
  eventType: ContentEventType
  userId: string | null
  contentSnapshot: Record<string, unknown> | null
  metadataSnapshot: ContentMetadata | null
  diffSummary: string | null
  source: string
  correlationId: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

// Page content section schemas — typed shapes for each page's JSON
export interface HomePageContent {
  hero: { eyebrow: string; title: string; description: string; trustBadge: string }
  features: { icon: string; title: string; description: string }[]
  stats: { value: string; label: string; description: string }[]
  howItWorks: { step: string; title: string; description: string }[]
  partners: string[]
  testimonial: { quote: string; company: string; result: string }
  pricingTeaser: { eyebrow: string; title: string; description: string; ctaText: string; ctaLink: string }
  cta: { title: string; description: string; primaryLabel: string; primaryHref: string; secondaryLabel: string; secondaryHref: string }
}

export interface SbirEnginePageContent {
  hero: { title: string; description: string }
  sections: { id: string; eyebrow: string; title: string; description: string; features: string[] }[]
  cta: { title: string; description: string; primaryLabel: string; primaryHref: string }
}

export interface FeaturesPageContent {
  hero: { title: string; description: string }
  features: { title: string; description: string; icon: string }[]
}

export interface HappeningsPageContent {
  hero: { title: string; description: string }
  categories: { slug: string; label: string }[]
  items: { date: string; category: string; title: string; excerpt: string }[]
  resources: { title: string; description: string; type: string }[]
}

export interface AboutPageContent {
  hero: { eyebrow: string; title: string; description: string }
  mission: { eyebrow: string; title: string; paragraphs: string[] }
  features: { icon: string; title: string; description: string }[]
  howItWorks: { step: string; title: string; description: string }[]
}

export interface TeamPageContent {
  hero: { eyebrow: string; title: string; description: string }
  members: {
    name: string; title: string; linkedIn: string
    bio: string[]; credentials: string[]
  }[]
  stats: { value: string; label: string; description: string }[]
}

export interface TipsPageContent {
  hero: { eyebrow: string; title: string; description: string }
  tips: { date: string; category: string; title: string; excerpt: string }[]
  tools: { name: string; description: string; status: string }[]
}

export interface CustomersPageContent {
  hero: { eyebrow: string; title: string; description: string }
  stories: {
    company: string; description: string; quote: string; result: string
  }[]
  caseStudy: { before: string; after: string; result: string }
}

export interface AnnouncementsPageContent {
  hero: { eyebrow: string; title: string; description: string }
  items: { date: string; category: string; title: string; excerpt: string }[]
}

export interface GetStartedPageContent {
  hero: { eyebrow: string; title: string; description: string }
  tiers: {
    name: string; price: string; period: string
    description: string; features: string[]
    cta: string; popular: boolean
  }[]
  comparison: (string | boolean)[][]
  faqs: { q: string; a: string }[]
  contactCta: { title: string; description: string; email: string }
}

// ─── Content Pipeline ────────────────────────────────────────

export type ContentPostStatus = 'draft' | 'in_review' | 'approved' | 'rejected' | 'published' | 'reverted' | 'archived'
export type ContentCategory = 'tip' | 'announcement' | 'product_update' | 'guide' | 'resource' | 'case_study'
export type ContentReviewAction = 'submit_review' | 'approve' | 'reject' | 'request_changes' | 'publish' | 'unpublish' | 'revert' | 'archive'

export interface ContentPost {
  id: string
  slug: string
  title: string
  excerpt: string | null
  body: string
  category: ContentCategory
  tags: string[]
  status: ContentPostStatus
  authorId: string | null
  authorName: string | null
  generationId: string | null
  generatedByModel: string | null
  generationPrompt: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  reviewNotes: string | null
  publishedAt: string | null
  publishedBy: string | null
  unpublishedAt: string | null
  metaTitle: string | null
  metaDescription: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface ContentGeneration {
  id: string
  prompt: string
  category: ContentCategory
  model: string
  systemPrompt: string | null
  temperature: number
  status: 'pending' | 'generating' | 'completed' | 'failed' | 'accepted' | 'rejected'
  generatedTitle: string | null
  generatedExcerpt: string | null
  generatedBody: string | null
  generatedTags: string[]
  postId: string | null
  requestedBy: string | null
  tokensUsed: number | null
  durationMs: number | null
  errorMessage: string | null
  retryCount: number
  createdAt: string
  completedAt: string | null
}

export interface ContentReview {
  id: string
  postId: string
  action: ContentReviewAction
  reviewerId: string
  notes: string | null
  titleSnapshot: string | null
  bodySnapshot: string | null
  versionAtReview: number
  createdAt: string
}

// ─── SpotLight Buckets ───────────────────────────────────────

export interface SpotlightBucket {
  id: string
  tenantId: string
  name: string
  description: string | null
  naicsCodes: string[]
  keywords: string[]
  setAsideTypes: string[]
  agencyPriorities: Record<string, number>
  keywordDomains: Record<string, string[]>
  isSmallBusiness: boolean
  minContractValue: number | null
  maxContractValue: number | null
  minScoreThreshold: number
  opportunityTypes: string[]
  companySummary: string | null
  technologyFocus: string | null
  status: 'active' | 'inactive'
  sortOrder: number
  createdBy: string | null
  lastScoredAt: string | null
  matchedOppCount: number
  createdAt: string
  updatedAt: string
}

export interface SpotlightScore {
  id: string
  tenantId: string
  spotlightId: string
  opportunityId: string
  totalScore: number
  naicsScore: number
  keywordScore: number
  setAsideScore: number
  agencyScore: number
  typeScore: number
  timelineScore: number
  llmAdjustment: number
  llmRationale: string | null
  matchedKeywords: string[]
  matchedDomains: string[]
  scoredAt: string
}

export interface SpotlightDashboardItem {
  spotlightId: string
  tenantId: string
  spotlightName: string
  description: string | null
  naicsCodes: string[]
  keywords: string[]
  setAsideTypes: string[]
  status: string
  sortOrder: number
  matchedOppCount: number
  lastScoredAt: string | null
  aboveThresholdCount: number
  highPriorityCount: number
  topScore: number | null
  avgScore: number | null
  uploadCount: number
  createdAt: string
  updatedAt: string
}

// ─── Team Invitations ────────────────────────────────────────

export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked'

export interface TeamInvitation {
  id: string
  tenantId: string
  invitedBy: string
  email: string
  name: string
  role: 'tenant_admin' | 'tenant_user'
  company: string | null
  phone: string | null
  notes: string | null
  token: string
  status: InviteStatus
  acceptedUserId: string | null
  acceptedAt: string | null
  expiresAt: string
  reminderSentAt: string | null
  createdAt: string
}

// ─── Tenant Upload (extended fields from 028) ───────────────

export type UploadCategory =
  | 'general' | 'capability_statement' | 'past_performance'
  | 'personnel_resume' | 'facility_description' | 'tech_approach'
  | 'company_overview' | 'certification' | 'financial' | 'other'

export type LibraryProcessingStatus = 'pending' | 'processing' | 'atomized' | 'failed' | 'skipped'

// Plan-based limits
export interface PlanLimits {
  maxSeats: number
  maxSpotlights: number
  maxActiveOpps: number
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  finder:   { maxSeats: 2,  maxSpotlights: 1,  maxActiveOpps: 10 },
  reminder: { maxSeats: 5,  maxSpotlights: 3,  maxActiveOpps: 25 },
  binder:   { maxSeats: 10, maxSpotlights: 5,  maxActiveOpps: 50 },
  grinder:  { maxSeats: 25, maxSpotlights: 10, maxActiveOpps: 999 },
}

// ─── Grinder: Atomic Library ─────────────────────────────────

export type LibraryUnitCategory =
  | 'bio' | 'facility' | 'tech_approach' | 'past_performance'
  | 'management' | 'commercialization' | 'budget_justification'
  | 'equipment' | 'data_management' | 'broader_impact' | 'general'

export type LibraryUnitStatus = 'draft' | 'approved' | 'archived' | 'rejected'
export type LibraryUnitContentType = 'text' | 'table' | 'image_ref' | 'code'

export interface LibraryUnit {
  id: string
  tenantId: string
  content: string
  contentType: LibraryUnitContentType
  category: LibraryUnitCategory
  subcategory: string | null
  title: string | null
  sourceUploadId: string | null
  sourceRecordType: string | null
  sourceRecordId: string | null
  contextTags: Record<string, unknown>
  confidenceScore: number | null
  status: LibraryUnitStatus
  wordCount: number | null
  charCount: number | null
  version: number
  parentUnitId: string | null
  approvedBy: string | null
  approvedAt: string | null
  lastUsedAt: string | null
  usageCount: number
  createdAt: string
  updatedAt: string
}

export interface LibraryUnitImage {
  id: string
  unitId: string
  tenantId: string
  imagePath: string
  storageBackend: string
  mimeType: string | null
  widthPx: number | null
  heightPx: number | null
  fileSizeBytes: number | null
  altText: string | null
  caption: string | null
  sortOrder: number
  createdAt: string
}

// ─── Grinder: RFP Templates ─────────────────────────────────

export type RfpTemplateSource = 'library' | 'ai_extracted' | 'manual' | 'hybrid'
export type RfpTemplateStatus = 'draft' | 'accepted' | 'locked' | 'superseded'

export interface RfpTemplateSection {
  key: string
  title: string
  pageLimit: number | null
  required: boolean
  instructions: string | null
  subsections?: RfpTemplateSection[]
  evaluationWeight: number | null
}

export interface RfpTemplateConstraints {
  font?: string
  fontSize?: string
  margins?: string
  totalPages?: number
  lineSpacing?: string
  headerFooter?: string
}

export interface RfpTemplateLibraryEntry {
  id: string
  agency: string
  programType: string
  subAgency: string | null
  templateName: string
  description: string | null
  sections: RfpTemplateSection[]
  constraints: RfpTemplateConstraints
  submissionFormat: Record<string, unknown>
  evaluationCriteria: Record<string, unknown>
  commonErrors: string[]
  version: number
  usageCount: number
  accuracyScore: number | null
  createdBy: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface RfpTemplate {
  id: string
  tenantId: string
  opportunityId: string
  baseTemplateId: string | null
  templateName: string
  sections: RfpTemplateSection[]
  constraints: RfpTemplateConstraints
  submissionFormat: Record<string, unknown>
  evaluationCriteria: Record<string, unknown>
  source: RfpTemplateSource
  status: RfpTemplateStatus
  userCorrections: Array<{
    sectionKey: string
    field: string
    oldValue: string
    newValue: string
    reason?: string
  }>
  acceptedBy: string | null
  acceptedAt: string | null
  createdAt: string
  updatedAt: string
}

// ─── Grinder: Proposals ──────────────────────────────────────

export type ProposalStatus =
  | 'draft' | 'assembly' | 'review' | 'final_review'
  | 'complete' | 'exported' | 'archived'

export type ProposalOutcome = 'won' | 'lost' | 'no_bid' | 'pending' | 'withdrawn'

export type ProposalSectionStatus =
  | 'empty' | 'ai_populated' | 'user_edited'
  | 'approved' | 'locked' | 'needs_revision'

export type ProposalSectionPageStatus = 'under' | 'within' | 'over' | 'unknown'

export type ProposalSectionChangeType =
  | 'ai_populated' | 'user_edit' | 'ai_refined'
  | 'swap_unit' | 'manual_paste' | 'revert'

export type ProposalPersonnelRole =
  | 'PI' | 'Co-PI' | 'Key Personnel' | 'Consultant' | 'Subcontractor Lead'

export interface Proposal {
  id: string
  tenantId: string
  opportunityId: string
  rfpTemplateId: string | null
  title: string
  status: ProposalStatus
  stage: ProposalStage
  stageColor: ProposalStageColor
  stageEnteredAt: string
  stageDeadline: string | null
  submissionDeadline: string | null
  workspaceLocked: boolean
  workspaceLockedBy: string | null
  workspaceLockedAt: string | null
  pageLimit: number | null
  currentPageEst: number
  sectionCount: number
  sectionsPopulated: number
  sectionsApproved: number
  completionPct: number
  createdBy: string
  lockedBy: string | null
  lockedAt: string | null
  submittedAt: string | null
  outcome: ProposalOutcome | null
  outcomeNotes: string | null
  scoreReceived: number | null
  debriefNotes: string | null
  createdAt: string
  updatedAt: string
}

export interface ProposalSection {
  id: string
  proposalId: string
  sectionKey: string
  title: string
  sortOrder: number
  pageLimit: number | null
  required: boolean
  instructions: string | null
  contentDraft: string | null
  contentFinal: string | null
  status: ProposalSectionStatus
  aiConfidence: number | null
  aiMatchSummary: string | null
  wordCount: number
  charCount: number
  estPageCount: number
  pageStatus: ProposalSectionPageStatus
  refinementCount: number
  reviewedBy: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ProposalSectionHistory {
  id: string
  sectionId: string
  proposalId: string
  content: string
  changeType: ProposalSectionChangeType
  changedBy: string | null
  changeSummary: string | null
  wordCount: number | null
  estPageCount: number | null
  metadata: Record<string, unknown>
  createdAt: string
}

export interface ProposalSectionUnit {
  id: string
  sectionId: string
  unitId: string
  proposalId: string
  sortOrder: number
  usageType: 'primary' | 'supporting' | 'reference'
  aiSelected: boolean
  confidenceScore: number | null
  createdAt: string
}

export interface ProposalPersonnel {
  id: string
  proposalId: string
  personnelId: string
  sectionId: string | null
  roleInProposal: string
  effortPercentage: number | null
  sortOrder: number
  createdAt: string
}

export interface ProposalExport {
  id: string
  proposalId: string
  tenantId: string
  format: 'pdf' | 'docx' | 'pptx' | 'markdown'
  filePath: string | null
  fileSizeBytes: number | null
  storageBackend: string
  exportedBy: string
  versionLabel: string | null
  createdAt: string
}

// Proposal dashboard (from proposal_dashboard view)
export interface ProposalDashboardItem {
  proposalId: string
  tenantId: string
  proposalTitle: string
  proposalStatus: ProposalStatus
  pageLimit: number | null
  currentPageEst: number
  completionPct: number
  outcome: ProposalOutcome | null
  proposalCreatedAt: string
  proposalUpdatedAt: string
  opportunityId: string
  opportunityTitle: string
  agency: string | null
  solicitationNumber: string | null
  closeDate: string | null
  opportunityType: string | null
  daysToClose: number | null
  templateName: string | null
  templateSource: RfpTemplateSource | null
  totalSections: number
  completedSections: number
  personnelCount: number
  exportCount: number
  createdByName: string | null
  createdByEmail: string | null
}

// Library unit summary (from library_unit_summary view)
export interface LibraryUnitSummary {
  tenantId: string
  tenantName: string
  totalUnits: number
  approvedUnits: number
  draftUnits: number
  vectorizedUnits: number
  categoryCount: number
  unitsByCategory: Record<LibraryUnitCategory, number>
  lastUnitCreated: string | null
  totalUsage: number
}

// ─── Grinder: Library Feedback Loop ──────────────────────────

export type HarvestTrigger =
  | 'section_approved' | 'section_locked' | 'proposal_submitted'
  | 'proposal_won' | 'manual' | 'scheduled'

export type HarvestStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped'

export type AtomOriginType =
  | 'upload' | 'proposal_harvest' | 'manual_entry'
  | 'import' | 'ai_generated' | 'merged'

export type AtomMergeStatus =
  | 'pending' | 'auto_merged' | 'manually_merged'
  | 'kept_separate' | 'dismissed'

export interface LibraryHarvestLog {
  id: string
  tenantId: string
  proposalId: string
  sectionId: string
  harvestTrigger: HarvestTrigger
  status: HarvestStatus
  atomsExtracted: number
  atomsNew: number
  atomsMerged: number
  atomsSkipped: number
  sourceWordCount: number | null
  sourceContentHash: string | null
  processingModel: string | null
  processingTimeMs: number | null
  errorMessage: string | null
  metadata: Record<string, unknown>
  createdAt: string
  completedAt: string | null
}

export interface LibraryAtomSimilarity {
  id: string
  tenantId: string
  unitAId: string
  unitBId: string
  cosineSimilarity: number
  mergeStatus: AtomMergeStatus
  mergedIntoId: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  createdAt: string
}

export interface LibraryAtomOutcome {
  id: string
  unitId: string
  proposalId: string
  sectionId: string | null
  usageType: 'used' | 'harvested' | 'both'
  outcome: ProposalOutcome | null
  confidenceDelta: number
  appliedAt: string | null
  createdAt: string
}

// Learning metrics view
export interface LibraryLearningMetrics {
  tenantId: string
  totalAtoms: number
  approvedAtoms: number
  atomsFromUploads: number
  atomsFromProposals: number
  atomsFromMerges: number
  atomsManual: number
  atomsWithWins: number
  atomsWithLosses: number
  atomsUndefeated: number
  totalReuses: number
  avgConfidence: number | null
  avgConfidenceWinners: number | null
  avgConfidenceLosers: number | null
  lastAtomCreated: string | null
  atomsLast30d: number
  vectorizedAtoms: number
}

// Harvest pipeline status view
export interface LibraryHarvestStatus {
  tenantId: string
  totalHarvests: number
  completed: number
  failed: number
  pending: number
  totalAtomsExtracted: number
  totalAtomsNew: number
  totalAtomsMerged: number
  totalAtomsSkipped: number
  avgProcessingMs: number | null
  lastHarvestAt: string | null
}

// Atom effectiveness view
export interface LibraryAtomEffectiveness {
  unitId: string
  tenantId: string
  title: string | null
  category: LibraryUnitCategory
  contentType: LibraryUnitContentType
  confidenceScore: number | null
  usageCount: number
  winCount: number
  lossCount: number
  winRate: number | null
  originType: AtomOriginType
  status: LibraryUnitStatus
  wordCount: number | null
  reuseEffectiveness: number | null
  createdAt: string
  updatedAt: string
}

// ─── Grinder: Proposal Workspace & Collaboration ─────────────

// Color Team pipeline stages
export type ProposalStage =
  | 'outline' | 'draft' | 'pink_team' | 'red_team'
  | 'gold_team' | 'final' | 'submitted' | 'archived'

export type ProposalStageColor =
  | 'gray' | 'blue' | 'pink' | 'red' | 'gold' | 'green' | 'purple' | 'slate'

// Stage-to-color mapping
export const STAGE_COLORS: Record<ProposalStage, ProposalStageColor> = {
  outline: 'gray',
  draft: 'blue',
  pink_team: 'pink',
  red_team: 'red',
  gold_team: 'gold',
  final: 'green',
  submitted: 'purple',
  archived: 'slate',
}

export const STAGE_LABELS: Record<ProposalStage, string> = {
  outline: 'Outline',
  draft: 'Draft',
  pink_team: 'Pink Team',
  red_team: 'Red Team',
  gold_team: 'Gold Team',
  final: 'Final',
  submitted: 'Submitted',
  archived: 'Archived',
}

// Workspace files
export type WorkspaceFileType = 'document' | 'spreadsheet' | 'presentation' | 'pdf' | 'image' | 'other'

export interface ProposalWorkspaceFile {
  id: string
  proposalId: string
  sectionId: string | null
  fileName: string
  fileType: WorkspaceFileType
  mimeType: string | null
  storagePath: string
  fileSizeBytes: number | null
  version: number
  parentFileId: string | null
  uploadedBy: string
  description: string | null
  isSubmissionArtifact: boolean
  isTemplate: boolean
  tags: string[]
  sortOrder: number
  createdAt: string
  updatedAt: string
}

// Collaborators
export type CollaboratorRole =
  | 'owner' | 'capture_manager' | 'volume_lead' | 'writer'
  | 'reviewer' | 'approver' | 'subject_expert' | 'viewer'

export interface CollaboratorPermissions {
  can_edit: boolean
  can_comment: boolean
  can_review: boolean
  can_approve: boolean
  can_upload: boolean
  can_manage_team: boolean
  can_lock: boolean
  can_export: boolean
}

export interface CollaboratorNotificationPrefs {
  on_mention: boolean
  on_stage_change: boolean
  on_review_requested: boolean
  on_comment: boolean
  on_deadline: boolean
  digest_frequency: 'immediate' | 'hourly' | 'daily' | 'none'
}

export interface ProposalCollaborator {
  id: string
  proposalId: string
  userId: string
  role: CollaboratorRole
  assignedSections: string[]
  permissions: CollaboratorPermissions
  invitedBy: string | null
  invitedAt: string
  acceptedAt: string | null
  isActive: boolean
  notificationPrefs: CollaboratorNotificationPrefs
  createdAt: string
  updatedAt: string
}

// Stage history
export interface ProposalStageHistoryEntry {
  id: string
  proposalId: string
  fromStage: ProposalStage | null
  toStage: ProposalStage
  fromColor: ProposalStageColor | null
  toColor: ProposalStageColor
  changedBy: string
  reason: string | null
  gateCriteria: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
}

// Change tracking
export type ChangeType =
  | 'edit' | 'suggestion' | 'accept' | 'reject' | 'revert'
  | 'ai_edit' | 'ai_suggestion' | 'bulk_accept' | 'bulk_reject'

export type ChangeStatus = 'pending' | 'accepted' | 'rejected' | 'superseded'

export interface ProposalChange {
  id: string
  proposalId: string
  sectionId: string | null
  fileId: string | null
  userId: string
  changeType: ChangeType
  fieldChanged: string | null
  oldValue: string | null
  newValue: string | null
  diffHtml: string | null
  diffSummary: string | null
  status: ChangeStatus
  reviewedBy: string | null
  reviewedAt: string | null
  reviewComment: string | null
  batchId: string | null
  createdAt: string
}

// Reviews (Color Team)
export type ReviewType =
  | 'compliance' | 'technical' | 'editorial' | 'executive'
  | 'pink_team' | 'red_team' | 'gold_team' | 'peer' | 'final_qa'

export type ReviewStage = 'pink_team' | 'red_team' | 'gold_team' | 'final' | 'ad_hoc'

export type ReviewStatus =
  | 'pending' | 'in_progress' | 'approved' | 'rejected'
  | 'changes_requested' | 'deferred'

export type ReviewVerdict = 'pass' | 'fail' | 'conditional_pass' | 'not_reviewed'

export interface ReviewFinding {
  severity: 'critical' | 'major' | 'minor' | 'suggestion'
  section: string | null
  description: string
  recommendation: string | null
}

export interface ProposalReview {
  id: string
  proposalId: string
  sectionId: string | null
  reviewerId: string
  reviewType: ReviewType
  reviewStage: ReviewStage
  status: ReviewStatus
  verdict: ReviewVerdict | null
  score: number | null
  maxScore: number | null
  comments: string | null
  findings: ReviewFinding[]
  dueDate: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

// Comments
export type CommentType =
  | 'general' | 'suggestion' | 'question' | 'issue'
  | 'resolution' | 'action_item' | 'praise'

export interface CommentAnchor {
  startOffset?: number
  endOffset?: number
  anchorText?: string
  elementId?: string
}

export interface ProposalComment {
  id: string
  proposalId: string
  sectionId: string | null
  fileId: string | null
  parentCommentId: string | null
  userId: string
  content: string
  commentType: CommentType
  anchorContext: CommentAnchor | null
  mentions: string[]
  isResolved: boolean
  resolvedBy: string | null
  resolvedAt: string | null
  isPinned: boolean
  createdAt: string
  updatedAt: string
}

// Checklists
export type ChecklistStage =
  | 'outline' | 'draft' | 'pink_team' | 'red_team'
  | 'gold_team' | 'final' | 'submission'

export type ChecklistCategory =
  | 'compliance' | 'content' | 'formatting' | 'technical'
  | 'administrative' | 'submission' | 'general'

export interface ProposalChecklist {
  id: string
  proposalId: string
  stage: ChecklistStage
  category: ChecklistCategory
  title: string
  description: string | null
  isRequired: boolean
  isChecked: boolean
  checkedBy: string | null
  checkedAt: string | null
  sortOrder: number
  autoCheckRule: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

// Activity feed
export type ProposalActivityType =
  | 'stage_changed' | 'section_edited' | 'section_populated'
  | 'section_approved' | 'section_locked'
  | 'file_uploaded' | 'file_versioned' | 'file_deleted'
  | 'collaborator_added' | 'collaborator_removed'
  | 'review_requested' | 'review_completed'
  | 'comment_added' | 'comment_resolved'
  | 'change_suggested' | 'change_accepted' | 'change_rejected'
  | 'checklist_checked' | 'checklist_unchecked'
  | 'ai_populated' | 'ai_refined'
  | 'workspace_locked' | 'workspace_unlocked'
  | 'exported' | 'submitted'

export interface ProposalActivity {
  id: string
  proposalId: string
  userId: string | null
  activityType: ProposalActivityType
  sectionId: string | null
  targetUserId: string | null
  summary: string
  detail: Record<string, unknown>
  isSystem: boolean
  createdAt: string
}

// Notifications
export type ProposalNotificationType =
  | 'mention' | 'review_request' | 'review_complete'
  | 'stage_change' | 'deadline_warning' | 'comment_reply'
  | 'change_accepted' | 'change_rejected' | 'assignment'
  | 'lock_warning' | 'submission_reminder'

export interface ProposalNotification {
  id: string
  proposalId: string
  userId: string
  notificationType: ProposalNotificationType
  title: string
  body: string | null
  link: string | null
  isRead: boolean
  readAt: string | null
  createdAt: string
}

// Workspace summary view
export interface ProposalWorkspaceSummary {
  tenantId: string
  proposalId: string
  title: string
  stage: ProposalStage
  stageColor: ProposalStageColor
  stageEnteredAt: string
  stageDeadline: string | null
  submissionDeadline: string | null
  status: ProposalStatus
  workspaceLocked: boolean
  opportunityTitle: string | null
  closeDate: string | null
  collaboratorCount: number
  totalSections: number
  completedSections: number
  fileCount: number
  submissionFileCount: number
  pendingReviews: number
  openComments: number
  pendingChanges: number
  uncheckedGateItems: number
  createdAt: string
  updatedAt: string
}

// Section assignment view
export interface ProposalSectionAssignment {
  sectionId: string
  proposalId: string
  sectionKey: string
  title: string
  sectionStatus: ProposalSectionStatus
  pageLimit: number | null
  currentPageCount: number
  pageStatus: ProposalSectionPageStatus
  proposalStage: ProposalStage
  stageColor: ProposalStageColor
  assigneeId: string | null
  assigneeName: string | null
  assigneeEmail: string | null
  assigneeRole: CollaboratorRole | null
  openComments: number
  pendingChanges: number
  pendingReviews: number
  sectionUpdatedAt: string
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

// ─── Proposal Purchases ─────────────────────────────────────

export interface ProposalPurchase {
  id: string
  tenantId: string
  proposalId: string | null
  opportunityId: string | null
  purchaseType: 'phase_1' | 'phase_2'
  priceCents: number
  status: 'pending' | 'active' | 'template_delivered' | 'completed' | 'cancelled' | 'refunded'
  purchasedAt: string
  cancellationDeadline: string
  templateDeliveredAt: string | null
  cancelledAt: string | null
  refundReason: string | null
  proposalTitle?: string
  templateName?: string
}

// ─── Partner Access ─────────────────────────────────────────

export interface PartnerAccessGrant {
  id: string
  userId: string
  tenantId: string
  proposalId: string
  status: 'pending_acceptance' | 'pending_approval' | 'active' | 'revoked' | 'expired' | 'rejected'
  permissions: PartnerPermissions
  accessScope: 'proposal_only' | 'proposal_and_files'
  expiresAt: string | null
  acceptedAt: string | null
  approvedAt: string | null
  revokedAt: string | null
  createdAt: string
  userName?: string
  userEmail?: string
}

export interface PartnerPermissions {
  default: 'none' | 'view' | 'review' | 'edit'
  sections: Record<string, 'none' | 'view' | 'review' | 'edit'>
  uploads: { can_upload: boolean; can_delete_own: boolean; can_view_all: boolean; can_view_shared: boolean }
  library: { can_access: boolean }
  proposal: { can_view_metadata: boolean; can_advance_stage: boolean; can_export: boolean }
}
