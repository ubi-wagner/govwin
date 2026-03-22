/**
 * Local filesystem storage layer — replaces Google Drive
 *
 * Folder structure on the Railway volume:
 *   /data/
 *     /opportunities/YYYY-WNN/SAM-{solNum}-{title}/   (global, weekly-partitioned)
 *     /customers/{tenant-slug}/finder|reminders|binder|grinder|uploads/
 *     /system/templates/
 *
 * All file metadata is indexed in the stored_files table (formerly drive_files).
 * The DB is the source of truth; the filesystem is just blob storage.
 *
 * Environment:
 *   STORAGE_ROOT — base path for all stored files (default: /data)
 */
import { mkdir, writeFile, readFile, readdir, stat, unlink, copyFile as fsCopyFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname, extname } from 'path'
import { createHash, randomUUID } from 'crypto'
import type { ProductTier } from '@/types'

// ── Config ────────────────────────────────────────────────────

const STORAGE_ROOT = process.env.STORAGE_ROOT ?? '/data'

export function getStorageRoot(): string {
  return STORAGE_ROOT
}

// ── Low-level helpers ─────────────────────────────────────────

/** Ensure a directory exists (recursive). Returns the absolute path. */
export async function ensureDir(dirPath: string): Promise<string> {
  const abs = dirPath.startsWith('/') ? dirPath : join(STORAGE_ROOT, dirPath)
  await mkdir(abs, { recursive: true })
  return abs
}

/** Write content to a file, creating parent dirs as needed. Returns the absolute path. */
export async function storeFile(
  relativePath: string,
  content: Buffer | string
): Promise<{ path: string; size: number; hash: string }> {
  const abs = join(STORAGE_ROOT, relativePath)
  await mkdir(dirname(abs), { recursive: true })
  const buf = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content
  await writeFile(abs, buf)
  const hash = createHash('sha256').update(buf).digest('hex')
  return { path: relativePath, size: buf.length, hash }
}

/** Read a file from storage. Returns null if not found. */
export async function readStoredFile(relativePath: string): Promise<Buffer | null> {
  const abs = join(STORAGE_ROOT, relativePath)
  try {
    return await readFile(abs)
  } catch {
    return null
  }
}

/** List entries in a directory. Returns file/folder info. */
export async function listDirectory(relativePath: string): Promise<Array<{
  name: string
  path: string
  isDirectory: boolean
  size: number
  modifiedAt: string
}>> {
  const abs = join(STORAGE_ROOT, relativePath)
  if (!existsSync(abs)) return []

  const entries = await readdir(abs, { withFileTypes: true })
  const results = []

  for (const entry of entries) {
    const entryPath = join(relativePath, entry.name)
    const entryAbs = join(abs, entry.name)
    try {
      const stats = await stat(entryAbs)
      results.push({
        name: entry.name,
        path: entryPath,
        isDirectory: entry.isDirectory(),
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      })
    } catch {
      // Skip entries we can't stat
    }
  }

  return results.sort((a, b) => {
    // Folders first, then by name
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/** Delete a file. Returns true if deleted, false if not found. */
export async function deleteFile(relativePath: string): Promise<boolean> {
  const abs = join(STORAGE_ROOT, relativePath)
  try {
    await unlink(abs)
    return true
  } catch {
    return false
  }
}

/** Copy a file within storage. */
export async function copyStoredFile(
  srcRelative: string,
  destRelative: string
): Promise<{ path: string; size: number }> {
  const srcAbs = join(STORAGE_ROOT, srcRelative)
  const destAbs = join(STORAGE_ROOT, destRelative)
  await mkdir(dirname(destAbs), { recursive: true })
  await fsCopyFile(srcAbs, destAbs)
  const stats = await stat(destAbs)
  return { path: destRelative, size: stats.size }
}

/** Get file stats. Returns null if not found. */
export async function getFileStats(relativePath: string): Promise<{
  size: number
  createdAt: string
  modifiedAt: string
} | null> {
  const abs = join(STORAGE_ROOT, relativePath)
  try {
    const stats = await stat(abs)
    return {
      size: stats.size,
      createdAt: stats.birthtime.toISOString(),
      modifiedAt: stats.mtime.toISOString(),
    }
  } catch {
    return null
  }
}

/** Derive file type from extension/mime. */
export function fileType(nameOrMime: string): string {
  const lower = nameOrMime.toLowerCase()
  if (lower.includes('folder') || lower === '') return 'FOLDER'
  if (lower.endsWith('.pdf') || lower.includes('pdf')) return 'PDF'
  if (lower.endsWith('.doc') || lower.endsWith('.docx') || lower.includes('document')) return 'DOCUMENT'
  if (lower.endsWith('.xls') || lower.endsWith('.xlsx') || lower.includes('spreadsheet')) return 'SPREADSHEET'
  if (lower.endsWith('.ppt') || lower.endsWith('.pptx') || lower.includes('presentation')) return 'PRESENTATION'
  return 'FILE'
}

/** Generate a unique file ID. */
export function generateFileId(): string {
  return randomUUID()
}

/** Sanitize a string for use as a filename/folder name. */
function sanitize(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '-').trim()
}


// =================================================================
// GLOBAL STRUCTURE PROVISIONING
// =================================================================

export interface GlobalStorageStructure {
  rootPath: string
  opportunitiesPath: string
  customersPath: string
  systemPath: string
  templatesPath: string
}

/**
 * Provision the global storage structure.
 * Idempotent — just creates dirs if they don't exist.
 *
 * /data/
 *   /opportunities/
 *   /customers/
 *   /system/
 *     /templates/
 *     /logs/
 */
export async function provisionGlobalStorage(): Promise<GlobalStorageStructure> {
  const rootPath = ''
  const opportunitiesPath = 'opportunities'
  const customersPath = 'customers'
  const systemPath = 'system'
  const templatesPath = 'system/templates'
  const logsPath = 'system/logs'

  await Promise.all([
    ensureDir(opportunitiesPath),
    ensureDir(customersPath),
    ensureDir(templatesPath),
    ensureDir(logsPath),
  ])

  return { rootPath, opportunitiesPath, customersPath, systemPath, templatesPath }
}


// =================================================================
// WEEKLY FOLDER MANAGEMENT
// =================================================================

/**
 * Get the ISO week label for a date: e.g. '2026-W12'
 */
export function getISOWeekLabel(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

/**
 * Get or create the weekly folder.
 * /opportunities/2026-W12/
 */
export async function getOrCreateWeeklyFolder(
  date: Date = new Date()
): Promise<{ path: string; weekLabel: string }> {
  const weekLabel = getISOWeekLabel(date)
  const path = `opportunities/${weekLabel}`
  await ensureDir(path)
  return { path, weekLabel }
}


// =================================================================
// OPPORTUNITY ARCHIVAL
// =================================================================

export interface OppFolderResult {
  oppFolderPath: string
  weekLabel: string
  weekFolderPath: string
  storedFiles: Array<{ name: string; path: string; size: number; hash: string }>
}

/**
 * Create an opportunity folder and store attachments.
 *
 * /opportunities/2026-W12/SAM-W15QKN-25-R-0042-CyberOps/
 *   - original_rfp.pdf
 *   - attachment_1.pdf
 */
export async function archiveOpportunity(opts: {
  solicitationNumber: string | null
  title: string
  postedDate: Date | null
  attachments?: Array<{ name: string; content: Buffer; mimeType: string }>
}): Promise<OppFolderResult> {
  const date = opts.postedDate ?? new Date()
  const { path: weekFolderPath, weekLabel } = await getOrCreateWeeklyFolder(date)

  const solPart = opts.solicitationNumber
    ? sanitize(opts.solicitationNumber)
    : 'NOSOL'
  const titlePart = sanitize(opts.title.substring(0, 60))
  const folderName = `SAM-${solPart}-${titlePart}`
  const oppFolderPath = `${weekFolderPath}/${folderName}`

  await ensureDir(oppFolderPath)

  const storedFiles: Array<{ name: string; path: string; size: number; hash: string }> = []
  if (opts.attachments) {
    for (const att of opts.attachments) {
      const filePath = `${oppFolderPath}/${sanitize(att.name)}`
      const result = await storeFile(filePath, att.content)
      storedFiles.push({ name: att.name, ...result })
    }
  }

  return { oppFolderPath, weekLabel, weekFolderPath, storedFiles }
}


// =================================================================
// TENANT STORAGE PROVISIONING (Tier-Aware)
// =================================================================

export interface TenantStorageStructure {
  rootPath: string
  finderPath: string
  finderCuratedPath: string
  finderSavedPath: string
  uploadsPath: string
  remindersPath: string | null
  binderPath: string | null
  binderProjectsPath: string | null
  binderProfilePath: string | null
  binderTeamingPath: string | null
  grinderPath: string | null
  grinderProposalsPath: string | null
}

/** Tier hierarchy: each tier includes all tiers below it */
const TIER_INCLUDES: Record<ProductTier, ProductTier[]> = {
  finder:   ['finder'],
  reminder: ['finder', 'reminder'],
  binder:   ['finder', 'reminder', 'binder'],
  grinder:  ['finder', 'reminder', 'binder', 'grinder'],
}

/**
 * Provision a tenant's folder tree based on their product tier.
 * Idempotent — just creates dirs.
 *
 * /customers/{tenant-slug}/
 *   /finder/
 *     /curated/
 *     /saved/
 *   /uploads/
 *   /reminders/        (tier 2+)
 *   /binder/           (tier 3+)
 *     /active-projects/
 *     /company-profile/
 *     /teaming/
 *   /grinder/          (tier 4)
 *     /proposals/
 */
export async function provisionTenantStorage(
  tenantSlug: string,
  tier: ProductTier = 'finder'
): Promise<TenantStorageStructure> {
  const tiers = TIER_INCLUDES[tier]
  const rootPath = `customers/${tenantSlug}`

  // Always created
  const finderPath = `${rootPath}/finder`
  const finderCuratedPath = `${finderPath}/curated`
  const finderSavedPath = `${finderPath}/saved`
  const uploadsPath = `${rootPath}/uploads`

  await Promise.all([
    ensureDir(finderCuratedPath),
    ensureDir(finderSavedPath),
    ensureDir(uploadsPath),
  ])

  let remindersPath: string | null = null
  if (tiers.includes('reminder')) {
    remindersPath = `${rootPath}/reminders`
    await ensureDir(remindersPath)
  }

  let binderPath: string | null = null
  let binderProjectsPath: string | null = null
  let binderProfilePath: string | null = null
  let binderTeamingPath: string | null = null
  if (tiers.includes('binder')) {
    binderPath = `${rootPath}/binder`
    binderProjectsPath = `${binderPath}/active-projects`
    binderProfilePath = `${binderPath}/company-profile`
    binderTeamingPath = `${binderPath}/teaming`
    await Promise.all([
      ensureDir(binderProjectsPath),
      ensureDir(binderProfilePath),
      ensureDir(binderTeamingPath),
    ])
  }

  let grinderPath: string | null = null
  let grinderProposalsPath: string | null = null
  if (tiers.includes('grinder')) {
    grinderPath = `${rootPath}/grinder`
    grinderProposalsPath = `${grinderPath}/proposals`
    await ensureDir(grinderProposalsPath)
  }

  return {
    rootPath,
    finderPath,
    finderCuratedPath,
    finderSavedPath,
    uploadsPath,
    remindersPath,
    binderPath,
    binderProjectsPath,
    binderProfilePath,
    binderTeamingPath,
    grinderPath,
    grinderProposalsPath,
  }
}


// =================================================================
// TIER UPGRADE — Add new folders when tenant upgrades
// =================================================================

export async function upgradeTenantTier(
  tenantSlug: string,
  newTier: ProductTier
): Promise<Partial<TenantStorageStructure>> {
  const rootPath = `customers/${tenantSlug}`
  const result: Partial<TenantStorageStructure> = {}

  if (newTier === 'reminder' || newTier === 'binder' || newTier === 'grinder') {
    result.remindersPath = `${rootPath}/reminders`
    await ensureDir(result.remindersPath)
  }

  if (newTier === 'binder' || newTier === 'grinder') {
    result.binderPath = `${rootPath}/binder`
    result.binderProjectsPath = `${rootPath}/binder/active-projects`
    result.binderProfilePath = `${rootPath}/binder/company-profile`
    result.binderTeamingPath = `${rootPath}/binder/teaming`
    await Promise.all([
      ensureDir(result.binderProjectsPath),
      ensureDir(result.binderProfilePath),
      ensureDir(result.binderTeamingPath),
    ])
  }

  if (newTier === 'grinder') {
    result.grinderPath = `${rootPath}/grinder`
    result.grinderProposalsPath = `${rootPath}/grinder/proposals`
    await ensureDir(result.grinderProposalsPath)
  }

  return result
}


// =================================================================
// TENANT ARTIFACT HELPERS
// =================================================================

/**
 * Store a curated AI summary for a specific opportunity.
 * /customers/{slug}/finder/curated/{Sol#}-summary.md
 */
export async function storeCuratedSummary(
  tenantSlug: string,
  solicitationNumber: string | null,
  title: string,
  content: string
): Promise<{ path: string; size: number; hash: string }> {
  const solPart = solicitationNumber ?? 'NOSOL'
  const shortTitle = sanitize(title.substring(0, 40))
  const fileName = `${solPart}-${shortTitle}-summary.md`
  return storeFile(`customers/${tenantSlug}/finder/curated/${fileName}`, content)
}

/**
 * Create a project folder for a pursued opportunity (Binder tier).
 * /customers/{slug}/binder/active-projects/{opp-title}/
 */
export async function createProjectFolder(
  tenantSlug: string,
  title: string,
  solicitationNumber: string | null
): Promise<{ projectPath: string }> {
  const solPart = solicitationNumber ?? ''
  const folderName = solPart
    ? sanitize(`${title.substring(0, 50)} - ${solPart}`)
    : sanitize(title.substring(0, 60))
  const projectPath = `customers/${tenantSlug}/binder/active-projects/${folderName}`
  await ensureDir(projectPath)
  return { projectPath }
}

/**
 * Create a proposal folder for a Grinder-tier opportunity.
 * /customers/{slug}/grinder/proposals/{opp-title}/
 */
export async function createProposalFolder(
  tenantSlug: string,
  title: string,
  solicitationNumber: string | null
): Promise<{ proposalPath: string }> {
  const solPart = solicitationNumber ?? ''
  const folderName = solPart
    ? sanitize(`${title.substring(0, 50)} - ${solPart}`)
    : sanitize(title.substring(0, 60))
  const proposalPath = `customers/${tenantSlug}/grinder/proposals/${folderName}`
  await ensureDir(proposalPath)
  return { proposalPath }
}

/**
 * Copy an opportunity file to a tenant's saved folder (pinning).
 * /customers/{slug}/finder/saved/{filename}
 */
export async function pinFileToTenant(
  tenantSlug: string,
  sourceRelativePath: string,
  fileName: string
): Promise<{ path: string; size: number }> {
  const destPath = `customers/${tenantSlug}/finder/saved/${sanitize(fileName)}`
  return copyStoredFile(sourceRelativePath, destPath)
}
