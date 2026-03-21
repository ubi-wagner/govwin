/**
 * Google Drive integration — RFPPIPELINE Architecture
 *
 * Folder structure:
 *   /RFPPIPELINE/
 *     /Opportunities/YYYY-WNN/SAM-{solNum}-{title}/  (global, weekly-partitioned)
 *     /Customers/{Tenant}/Finder|Reminders|Binder|Grinder|Uploads/
 *     /System/templates/
 *
 * Service account: automation@rfppipeline.com (domain-wide delegation)
 * Delegated as:    admin@rfppipeline.com (Drive ops + email sending)
 * Workspace admin: eric@rfppipeline.com
 *
 * Tenant users authenticate via email/password — no Google OAuth.
 * The service account creates/manages folders and shares them with tenant users.
 */
import { google, type drive_v3 } from 'googleapis'
import { GoogleAuth } from 'google-auth-library'
import type { ProductTier } from '@/types'

// ── Mime type → DriveFileType mapping ──────────────────────────
const MIME_TYPE_MAP: Record<string, string> = {
  'application/vnd.google-apps.folder':       'FOLDER',
  'application/vnd.google-apps.document':     'DOCUMENT',
  'application/vnd.google-apps.spreadsheet':  'SPREADSHEET',
  'application/vnd.google-apps.presentation': 'PRESENTATION',
  'application/pdf':                          'PDF',
}

const FOLDER_MIME = 'application/vnd.google-apps.folder'
const DOC_MIME    = 'application/vnd.google-apps.document'
const SHEET_MIME  = 'application/vnd.google-apps.spreadsheet'

export function driveFileType(mimeType: string | null | undefined): string {
  return (mimeType && MIME_TYPE_MAP[mimeType]) ?? 'FILE'
}

// ── Service account client (automated operations) ──────────────

export function getServiceAccountDrive(delegateEmail?: string): drive_v3.Drive {
  const keyBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyBase64) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not set')

  const credentials = JSON.parse(Buffer.from(keyBase64, 'base64').toString())
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
    clientOptions: delegateEmail ? { subject: delegateEmail } : undefined,
  })

  return google.drive({ version: 'v3', auth })
}

function getDrive(): drive_v3.Drive {
  return getServiceAccountDrive(process.env.GOOGLE_DELEGATED_ADMIN)
}

// ── Low-level helpers ──────────────────────────────────────────

/** Create a folder in Drive. Returns the new folder's GID. */
export async function createFolder(
  name: string,
  parentId?: string
): Promise<string> {
  const drive = getDrive()
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      parents: parentId ? [parentId] : undefined,
    },
    fields: 'id, webViewLink',
  })
  const gid = res.data.id
  if (!gid) throw new Error(`Failed to create folder: ${name}`)
  return gid
}

/** Create a Google Doc in Drive. Returns GID. */
export async function createDocument(
  name: string,
  parentId: string
): Promise<string> {
  const drive = getDrive()
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: DOC_MIME,
      parents: [parentId],
    },
    fields: 'id',
  })
  const gid = res.data.id
  if (!gid) throw new Error(`Failed to create document: ${name}`)
  return gid
}

/** Create a Google Sheet in Drive. Returns GID. */
export async function createSpreadsheet(
  name: string,
  parentId: string
): Promise<string> {
  const drive = getDrive()
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: SHEET_MIME,
      parents: [parentId],
    },
    fields: 'id',
  })
  const gid = res.data.id
  if (!gid) throw new Error(`Failed to create spreadsheet: ${name}`)
  return gid
}

/** Upload a file (PDF, etc.) to Drive. Returns GID. */
export async function uploadFile(
  name: string,
  parentId: string,
  content: Buffer | NodeJS.ReadableStream,
  mimeType: string
): Promise<string> {
  const drive = getDrive()
  const res = await drive.files.create({
    requestBody: {
      name,
      parents: [parentId],
    },
    media: {
      mimeType,
      body: content,
    },
    fields: 'id',
  })
  const gid = res.data.id
  if (!gid) throw new Error(`Failed to upload file: ${name}`)
  return gid
}

/** Create a Drive shortcut to a target file/folder. Returns shortcut GID. */
export async function createShortcut(
  name: string,
  targetId: string,
  parentId: string
): Promise<string> {
  const drive = getDrive()
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.shortcut',
      parents: [parentId],
      shortcutDetails: { targetId },
    },
    fields: 'id',
  })
  const gid = res.data.id
  if (!gid) throw new Error(`Failed to create shortcut: ${name}`)
  return gid
}

/** Get file metadata by GID. */
export async function getFileMetadata(
  fileId: string
): Promise<drive_v3.Schema$File> {
  const drive = getDrive()
  const res = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, webViewLink, size, createdTime, modifiedTime, md5Checksum',
  })
  return res.data
}

/** List files in a Drive folder. */
export async function listDriveFiles(
  folderId: string,
  pageToken?: string
): Promise<{ files: drive_v3.Schema$File[]; nextPageToken: string | null }> {
  const drive = getDrive()
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'nextPageToken, files(id, name, mimeType, webViewLink, exportLinks, size, createdTime, modifiedTime, permissions)',
    pageSize: 100,
    pageToken: pageToken ?? undefined,
    orderBy: 'folder,name',
  })

  return {
    files: res.data.files ?? [],
    nextPageToken: res.data.nextPageToken ?? null,
  }
}

/** Find a folder by name within a parent. Returns GID or null. */
export async function findFolder(
  name: string,
  parentId: string
): Promise<string | null> {
  const drive = getDrive()
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name = '${name}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: 'files(id)',
    pageSize: 1,
  })
  return res.data.files?.[0]?.id ?? null
}

/** Share a Drive folder/file with an email address. */
export async function shareDriveFolder(
  folderId: string,
  email: string,
  role: 'reader' | 'writer' | 'commenter' = 'reader'
): Promise<void> {
  const drive = getDrive()
  await drive.permissions.create({
    fileId: folderId,
    requestBody: {
      type: 'user',
      role,
      emailAddress: email,
    },
    sendNotificationEmail: false,
  })
}

/** Trash a file (move to bin, not permanent delete). */
export async function trashDriveFile(fileId: string): Promise<void> {
  const drive = getDrive()
  await drive.files.update({
    fileId,
    requestBody: { trashed: true },
  })
}

/** Copy a file (used for templates). Returns new file GID. */
export async function copyFile(
  sourceId: string,
  name: string,
  parentId: string
): Promise<string> {
  const drive = getDrive()
  const res = await drive.files.copy({
    fileId: sourceId,
    requestBody: {
      name,
      parents: [parentId],
    },
    fields: 'id',
  })
  const gid = res.data.id
  if (!gid) throw new Error(`Failed to copy file: ${name}`)
  return gid
}


// =================================================================
// GLOBAL DRIVE PROVISIONING
// One-time setup: creates the /RFPPIPELINE/ root structure
// =================================================================

export interface GlobalDriveStructure {
  rootFolderId: string
  opportunitiesFolderId: string
  customersFolderId: string
  systemFolderId: string
  templatesFolderId: string
}

/**
 * Provision the global RFPPIPELINE Drive structure.
 * Idempotent: checks for existing folders before creating.
 *
 * /RFPPIPELINE/
 *   /Opportunities/
 *   /Customers/
 *   /System/
 *     /templates/
 *     /logs/
 */
export async function provisionGlobalDrive(
  parentFolderId?: string
): Promise<GlobalDriveStructure> {
  const parent = parentFolderId ?? undefined

  // Root
  let rootFolderId = parent ? await findFolder('RFPPIPELINE', parent) : null
  if (!rootFolderId) {
    rootFolderId = await createFolder('RFPPIPELINE', parent)
  }

  // /Opportunities/
  let opportunitiesFolderId = await findFolder('Opportunities', rootFolderId)
  if (!opportunitiesFolderId) {
    opportunitiesFolderId = await createFolder('Opportunities', rootFolderId)
  }

  // /Customers/
  let customersFolderId = await findFolder('Customers', rootFolderId)
  if (!customersFolderId) {
    customersFolderId = await createFolder('Customers', rootFolderId)
  }

  // /System/
  let systemFolderId = await findFolder('System', rootFolderId)
  if (!systemFolderId) {
    systemFolderId = await createFolder('System', rootFolderId)
  }

  // /System/templates/
  let templatesFolderId = await findFolder('templates', systemFolderId)
  if (!templatesFolderId) {
    templatesFolderId = await createFolder('templates', systemFolderId)
  }

  // /System/logs/
  const logsFolderId = await findFolder('logs', systemFolderId)
  if (!logsFolderId) {
    await createFolder('logs', systemFolderId)
  }

  return {
    rootFolderId,
    opportunitiesFolderId,
    customersFolderId,
    systemFolderId,
    templatesFolderId,
  }
}


// =================================================================
// WEEKLY FOLDER MANAGEMENT
// /Opportunities/YYYY-WNN/ — one folder per ISO week
// =================================================================

/**
 * Get the ISO week label for a date: e.g. '2026-W12'
 */
export function getISOWeekLabel(date: Date = new Date()): string {
  // ISO week calculation
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

/**
 * Get or create the weekly folder for a given date.
 * /Opportunities/2026-W12/
 *
 * Returns the folder GID.
 */
export async function getOrCreateWeeklyFolder(
  opportunitiesFolderId: string,
  date: Date = new Date()
): Promise<{ folderId: string; weekLabel: string }> {
  const weekLabel = getISOWeekLabel(date)

  // Check if it already exists
  let folderId = await findFolder(weekLabel, opportunitiesFolderId)
  if (!folderId) {
    folderId = await createFolder(weekLabel, opportunitiesFolderId)
  }

  return { folderId, weekLabel }
}


// =================================================================
// OPPORTUNITY ARCHIVAL
// Downloads opp attachments to Drive, creates per-opp folder
// =================================================================

export interface OppFolderResult {
  oppFolderId: string
  weekLabel: string
  weekFolderId: string
  uploadedFiles: Array<{ name: string; gid: string; mimeType: string }>
}

/**
 * Create an opportunity folder in the weekly partition and
 * optionally upload attachments.
 *
 * /Opportunities/2026-W12/SAM-W15QKN-25-R-0042-CyberOps/
 *   - original_rfp.pdf
 *   - attachment_1.pdf
 */
export async function archiveOpportunityToDrive(opts: {
  opportunitiesFolderId: string
  solicitationNumber: string | null
  title: string
  postedDate: Date | null
  attachments?: Array<{ name: string; content: Buffer; mimeType: string }>
}): Promise<OppFolderResult> {
  const date = opts.postedDate ?? new Date()
  const { folderId: weekFolderId, weekLabel } = await getOrCreateWeeklyFolder(
    opts.opportunitiesFolderId,
    date
  )

  // Build a clean folder name: SAM-{solNum}-{shortTitle}
  const solPart = opts.solicitationNumber
    ? opts.solicitationNumber.replace(/[/\\:*?"<>|]/g, '-')
    : 'NOSOL'
  const titlePart = opts.title
    .substring(0, 60)
    .replace(/[/\\:*?"<>|]/g, '-')
    .trim()
  const folderName = `SAM-${solPart}-${titlePart}`

  // Check if folder already exists (idempotent)
  let oppFolderId = await findFolder(folderName, weekFolderId)
  if (!oppFolderId) {
    oppFolderId = await createFolder(folderName, weekFolderId)
  }

  // Upload attachments
  const uploadedFiles: Array<{ name: string; gid: string; mimeType: string }> = []
  if (opts.attachments) {
    for (const att of opts.attachments) {
      const gid = await uploadFile(att.name, oppFolderId, att.content, att.mimeType)
      uploadedFiles.push({ name: att.name, gid, mimeType: att.mimeType })
    }
  }

  return { oppFolderId, weekLabel, weekFolderId, uploadedFiles }
}


// =================================================================
// TENANT DRIVE PROVISIONING (Tier-Aware)
// =================================================================

/** Folder structure produced by tier-aware provisioning */
export interface TenantDriveStructure {
  rootFolderId: string
  finderFolderId: string
  finderCuratedFolderId: string
  finderSavedFolderId: string
  uploadsFolderId: string
  remindersFolderId: string | null
  binderFolderId: string | null
  binderProjectsFolderId: string | null
  binderProfileFolderId: string | null
  binderTeamingFolderId: string | null
  grinderFolderId: string | null
  grinderProposalsFolderId: string | null
}

/** Tier hierarchy: each tier includes all tiers below it */
const TIER_INCLUDES: Record<ProductTier, ProductTier[]> = {
  finder:   ['finder'],
  reminder: ['finder', 'reminder'],
  binder:   ['finder', 'reminder', 'binder'],
  grinder:  ['finder', 'reminder', 'binder', 'grinder'],
}

/**
 * Provision a tenant's Drive folder tree based on their product tier.
 * Idempotent: checks for existing folders before creating.
 *
 * /Customers/{Tenant Name}/
 *   /Finder/
 *     /Curated/        ← AI-generated per-opp summaries
 *     /Saved/          ← Shortcuts to master opp folders
 *   /Uploads/          ← General tenant uploads
 *   /Reminders/        ← (Reminder+ tier)
 *   /Binder/           ← (Binder+ tier)
 *     /Active Projects/
 *     /Company Profile/
 *     /Teaming/
 *   /Grinder/          ← (Grinder tier)
 *     /Proposals/
 */
export async function provisionTenantDrive(
  tenantName: string,
  tier: ProductTier = 'finder',
  customersFolderId?: string
): Promise<TenantDriveStructure> {
  const parent = customersFolderId ?? process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID
  const tiers = TIER_INCLUDES[tier]

  // Root tenant folder
  let rootFolderId: string | null = null
  if (parent) {
    rootFolderId = await findFolder(tenantName, parent)
  }
  if (!rootFolderId) {
    rootFolderId = await createFolder(tenantName, parent)
  }

  // === FINDER (always created) ===
  let finderFolderId = await findFolder('Finder', rootFolderId)
  if (!finderFolderId) {
    finderFolderId = await createFolder('Finder', rootFolderId)
  }

  let finderCuratedFolderId = await findFolder('Curated', finderFolderId)
  if (!finderCuratedFolderId) {
    finderCuratedFolderId = await createFolder('Curated', finderFolderId)
  }

  let finderSavedFolderId = await findFolder('Saved', finderFolderId)
  if (!finderSavedFolderId) {
    finderSavedFolderId = await createFolder('Saved', finderFolderId)
  }

  // Uploads (always created)
  let uploadsFolderId = await findFolder('Uploads', rootFolderId)
  if (!uploadsFolderId) {
    uploadsFolderId = await createFolder('Uploads', rootFolderId)
  }

  // === REMINDER (tier 2+) ===
  let remindersFolderId: string | null = null
  if (tiers.includes('reminder')) {
    remindersFolderId = await findFolder('Reminders', rootFolderId)
    if (!remindersFolderId) {
      remindersFolderId = await createFolder('Reminders', rootFolderId)
    }
  }

  // === BINDER (tier 3+) ===
  let binderFolderId: string | null = null
  let binderProjectsFolderId: string | null = null
  let binderProfileFolderId: string | null = null
  let binderTeamingFolderId: string | null = null
  if (tiers.includes('binder')) {
    binderFolderId = await findFolder('Binder', rootFolderId)
    if (!binderFolderId) {
      binderFolderId = await createFolder('Binder', rootFolderId)
    }

    binderProjectsFolderId = await findFolder('Active Projects', binderFolderId)
    if (!binderProjectsFolderId) {
      binderProjectsFolderId = await createFolder('Active Projects', binderFolderId)
    }

    binderProfileFolderId = await findFolder('Company Profile', binderFolderId)
    if (!binderProfileFolderId) {
      binderProfileFolderId = await createFolder('Company Profile', binderFolderId)
    }

    binderTeamingFolderId = await findFolder('Teaming', binderFolderId)
    if (!binderTeamingFolderId) {
      binderTeamingFolderId = await createFolder('Teaming', binderFolderId)
    }
  }

  // === GRINDER (tier 4) ===
  let grinderFolderId: string | null = null
  let grinderProposalsFolderId: string | null = null
  if (tiers.includes('grinder')) {
    grinderFolderId = await findFolder('Grinder', rootFolderId)
    if (!grinderFolderId) {
      grinderFolderId = await createFolder('Grinder', rootFolderId)
    }

    grinderProposalsFolderId = await findFolder('Proposals', grinderFolderId)
    if (!grinderProposalsFolderId) {
      grinderProposalsFolderId = await createFolder('Proposals', grinderFolderId)
    }
  }

  return {
    rootFolderId,
    finderFolderId,
    finderCuratedFolderId,
    finderSavedFolderId,
    uploadsFolderId,
    remindersFolderId,
    binderFolderId,
    binderProjectsFolderId,
    binderProfileFolderId,
    binderTeamingFolderId,
    grinderFolderId,
    grinderProposalsFolderId,
  }
}


// =================================================================
// TIER UPGRADE — Add new folders when tenant upgrades
// =================================================================

/**
 * Add tier-specific folders when a tenant upgrades.
 * Only creates folders for the NEW tier (existing ones are untouched).
 */
export async function upgradeTenantTier(
  rootFolderId: string,
  newTier: ProductTier
): Promise<Partial<TenantDriveStructure>> {
  const result: Partial<TenantDriveStructure> = {}

  if (newTier === 'reminder' || newTier === 'binder' || newTier === 'grinder') {
    let remindersFolderId = await findFolder('Reminders', rootFolderId)
    if (!remindersFolderId) {
      remindersFolderId = await createFolder('Reminders', rootFolderId)
    }
    result.remindersFolderId = remindersFolderId
  }

  if (newTier === 'binder' || newTier === 'grinder') {
    let binderFolderId = await findFolder('Binder', rootFolderId)
    if (!binderFolderId) {
      binderFolderId = await createFolder('Binder', rootFolderId)
    }
    result.binderFolderId = binderFolderId

    let projectsFolderId = await findFolder('Active Projects', binderFolderId)
    if (!projectsFolderId) {
      projectsFolderId = await createFolder('Active Projects', binderFolderId)
    }
    result.binderProjectsFolderId = projectsFolderId

    let profileFolderId = await findFolder('Company Profile', binderFolderId)
    if (!profileFolderId) {
      profileFolderId = await createFolder('Company Profile', binderFolderId)
    }
    result.binderProfileFolderId = profileFolderId

    let teamingFolderId = await findFolder('Teaming', binderFolderId)
    if (!teamingFolderId) {
      teamingFolderId = await createFolder('Teaming', binderFolderId)
    }
    result.binderTeamingFolderId = teamingFolderId
  }

  if (newTier === 'grinder') {
    let grinderFolderId = await findFolder('Grinder', rootFolderId)
    if (!grinderFolderId) {
      grinderFolderId = await createFolder('Grinder', rootFolderId)
    }
    result.grinderFolderId = grinderFolderId

    let proposalsFolderId = await findFolder('Proposals', grinderFolderId)
    if (!proposalsFolderId) {
      proposalsFolderId = await createFolder('Proposals', grinderFolderId)
    }
    result.grinderProposalsFolderId = proposalsFolderId
  }

  return result
}


// =================================================================
// TENANT ARTIFACT CREATION
// Functions for creating specific Drive artifacts per tenant
// =================================================================

/**
 * Create a curated AI summary document for a specific opportunity.
 * /Customers/{Tenant}/Finder/Curated/{Sol#}-summary.gdoc
 */
export async function createCuratedSummary(
  curatedFolderId: string,
  solicitationNumber: string | null,
  title: string
): Promise<string> {
  const solPart = solicitationNumber ?? 'NOSOL'
  const shortTitle = title.substring(0, 40).replace(/[/\\:*?"<>|]/g, '-').trim()
  const docName = `${solPart}-${shortTitle}-summary`
  return createDocument(docName, curatedFolderId)
}

/**
 * Create a pipeline snapshot spreadsheet for a tenant.
 * /Customers/{Tenant}/Finder/pipeline_snapshot.gsheet
 */
export async function createPipelineSnapshot(
  finderFolderId: string,
  tenantName: string
): Promise<string> {
  return createSpreadsheet(`${tenantName} - Pipeline Snapshot`, finderFolderId)
}

/**
 * Create a deadline tracker spreadsheet for a Reminder-tier tenant.
 * /Customers/{Tenant}/Reminders/deadline_tracker.gsheet
 */
export async function createDeadlineTracker(
  remindersFolderId: string,
  tenantName: string
): Promise<string> {
  return createSpreadsheet(`${tenantName} - Deadline Tracker`, remindersFolderId)
}

/**
 * Create an amendment log spreadsheet for a Reminder-tier tenant.
 * /Customers/{Tenant}/Reminders/amendment_log.gsheet
 */
export async function createAmendmentLog(
  remindersFolderId: string,
  tenantName: string
): Promise<string> {
  return createSpreadsheet(`${tenantName} - Amendment Log`, remindersFolderId)
}

/**
 * Create a project folder for a pursued opportunity (Binder tier).
 * /Customers/{Tenant}/Binder/Active Projects/{Opp Title}/
 *   - requirements_matrix.gsheet
 *   - compliance_checklist.gsheet
 */
export async function createProjectFolder(
  activeProjectsFolderId: string,
  title: string,
  solicitationNumber: string | null
): Promise<{
  projectFolderId: string
  requirementsGid: string
  complianceGid: string
}> {
  const solPart = solicitationNumber ?? ''
  const folderName = solPart ? `${title.substring(0, 50)} - ${solPart}` : title.substring(0, 60)
  const cleanName = folderName.replace(/[/\\:*?"<>|]/g, '-').trim()

  const projectFolderId = await createFolder(cleanName, activeProjectsFolderId)
  const requirementsGid = await createSpreadsheet('Requirements Matrix', projectFolderId)
  const complianceGid = await createSpreadsheet('Compliance Checklist', projectFolderId)

  return { projectFolderId, requirementsGid, complianceGid }
}

/**
 * Create a proposal folder for a Grinder-tier opportunity.
 * /Customers/{Tenant}/Grinder/Proposals/{Opp Title}/
 */
export async function createProposalFolder(
  proposalsFolderId: string,
  title: string,
  solicitationNumber: string | null
): Promise<{
  proposalFolderId: string
  draftGid: string
  complianceMatrixGid: string
}> {
  const solPart = solicitationNumber ?? ''
  const folderName = solPart ? `${title.substring(0, 50)} - ${solPart}` : title.substring(0, 60)
  const cleanName = folderName.replace(/[/\\:*?"<>|]/g, '-').trim()

  const proposalFolderId = await createFolder(cleanName, proposalsFolderId)
  const draftGid = await createDocument('Proposal Draft v1', proposalFolderId)
  const complianceMatrixGid = await createSpreadsheet('Compliance Matrix', proposalFolderId)

  return { proposalFolderId, draftGid, complianceMatrixGid }
}

/**
 * Create a shortcut in /Finder/Saved/ pointing to a master opp folder.
 */
export async function createSavedOppShortcut(
  savedFolderId: string,
  masterOppFolderId: string,
  oppTitle: string
): Promise<string> {
  const cleanTitle = oppTitle.substring(0, 60).replace(/[/\\:*?"<>|]/g, '-').trim()
  return createShortcut(cleanTitle, masterOppFolderId, savedFolderId)
}


// =================================================================
// MASTER INDEX
// The running index spreadsheet in /Opportunities/
// =================================================================

/**
 * Get or create the master_index.gsheet in /Opportunities/.
 */
export async function getOrCreateMasterIndex(
  opportunitiesFolderId: string
): Promise<string> {
  const drive = getDrive()
  const res = await drive.files.list({
    q: `'${opportunitiesFolderId}' in parents and name = 'master_index' and mimeType = '${SHEET_MIME}' and trashed = false`,
    fields: 'files(id)',
    pageSize: 1,
  })
  const existing = res.data.files?.[0]?.id
  if (existing) return existing

  return createSpreadsheet('master_index', opportunitiesFolderId)
}
