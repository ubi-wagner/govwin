/**
 * Google Drive integration — service account only
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

// ── Mime type → DriveFileType mapping ──────────────────────────
const MIME_TYPE_MAP: Record<string, string> = {
  'application/vnd.google-apps.folder':       'FOLDER',
  'application/vnd.google-apps.document':     'DOCUMENT',
  'application/vnd.google-apps.spreadsheet':  'SPREADSHEET',
  'application/vnd.google-apps.presentation': 'PRESENTATION',
  'application/pdf':                          'PDF',
}

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

// ── Tenant provisioning ────────────────────────────────────────

const DEFAULT_SUB_FOLDERS = ['Company Profile', 'Proposals', 'Pipeline', 'Resources']

/**
 * Create a tenant folder tree in Google Drive using the service account.
 * Returns the root folder's Google Drive ID (gid).
 */
export async function provisionTenantDrive(
  tenantName: string,
  parentFolderId?: string
): Promise<{ rootFolderId: string; subFolderIds: Record<string, string> }> {
  const delegateAdmin = process.env.GOOGLE_DELEGATED_ADMIN
  const drive = getServiceAccountDrive(delegateAdmin)
  const parent = parentFolderId ?? process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID

  // Create root tenant folder
  const rootFolder = await drive.files.create({
    requestBody: {
      name: tenantName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parent ? [parent] : undefined,
    },
    fields: 'id',
  })
  const rootFolderId = rootFolder.data.id
  if (!rootFolderId) throw new Error('Failed to create root Drive folder')

  // Create sub-folders
  const subFolderIds: Record<string, string> = {}
  for (const name of DEFAULT_SUB_FOLDERS) {
    const sub = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [rootFolderId],
      },
      fields: 'id',
    })
    if (sub.data.id) subFolderIds[name] = sub.data.id
  }

  return { rootFolderId, subFolderIds }
}

/**
 * Share a Drive folder with an email address.
 */
export async function shareDriveFolder(
  folderId: string,
  email: string,
  role: 'reader' | 'writer' | 'commenter' = 'reader'
): Promise<void> {
  const drive = getServiceAccountDrive(process.env.GOOGLE_DELEGATED_ADMIN)
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

/**
 * List files in a Drive folder using the service account.
 */
export async function listDriveFiles(
  folderId: string,
  pageToken?: string
): Promise<{ files: drive_v3.Schema$File[]; nextPageToken: string | null }> {
  const drive = getServiceAccountDrive(process.env.GOOGLE_DELEGATED_ADMIN)
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

/**
 * Trash a file (move to bin, not permanent delete).
 */
export async function trashDriveFile(fileId: string): Promise<void> {
  const drive = getServiceAccountDrive(process.env.GOOGLE_DELEGATED_ADMIN)
  await drive.files.update({
    fileId,
    requestBody: { trashed: true },
  })
}
