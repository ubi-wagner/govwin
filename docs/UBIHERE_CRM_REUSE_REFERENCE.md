# UbiHere CRM → GovWin: Reusable Code Reference

**Source repo:** `ubi-wagner/ubihere-crm` (public)
**Date analyzed:** 2026-03-21
**Purpose:** Map production-tested patterns from UbiHere CRM into GovWin's Next.js architecture

---

## 1. What UbiHere CRM Has (That GovWin Needs)

| Capability | UbiHere Status | GovWin Status | Priority |
|---|---|---|---|
| Google Drive folder provisioning | Production code | Architecture doc only | HIGH |
| Google Drive file/doc/sheet CRUD | 14 step functions | Not started | HIGH |
| Gmail send/search/archive | 5 step functions + sweeper | Not started | HIGH |
| Google Calendar scheduling | 13 step functions | Not started | MEDIUM |
| Service account domain-wide delegation | Implemented | Not started | HIGH |
| Activity event stream | Full tracker + worker | Not started | MEDIUM |
| Workflow template engine | 48 step functions | Not started | LOW |
| Prisma ORM models | Full schema | Using raw SQL | LOW |

---

## 2. Key Files to Port (by priority)

### 2.1 Google Workspace Auth Foundation

**Source:** `packages/api/src/workflows/stepFunctions/interface.ts`

Core patterns:
- `GoogleWorkspaceService` base class with `authenticateWithDelegation(userEmail)`
- `ServiceFactory.createGmailService()`, `.createGoogleDriveService()`, `.createGoogleCalendarService()`
- `executeWithTracking()` — wraps every API call with activity logging + error handling
- Base64 service account key from env: `process.env.SERVICE_ACCOUNT_BASE64`

**GovWin adaptation:** Create `frontend/lib/google.ts` with:
```typescript
// Service account auth with domain-wide delegation
import { google } from 'googleapis';

export function getGoogleAuth(scopes: string[], delegateEmail?: string) {
  const credentialsBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!credentialsBase64) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not set');

  const credentials = JSON.parse(Buffer.from(credentialsBase64, 'base64').toString());
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes,
    clientOptions: delegateEmail ? { subject: delegateEmail } : undefined,
  });
  return auth;
}

export function getDriveClient(delegateEmail?: string) {
  const auth = getGoogleAuth(['https://www.googleapis.com/auth/drive'], delegateEmail);
  return google.drive({ version: 'v3', auth });
}

export function getGmailClient(delegateEmail: string) {
  const auth = getGoogleAuth([
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send',
  ], delegateEmail);
  return google.gmail({ version: 'v1', auth });
}
```

### 2.2 Google Drive — Tenant Folder Provisioning

**Source:** `packages/api/src/workflows/stepFunctions/gdrive.ts`

Functions to port:
- `createFolder(context)` — Create per-tenant folder tree
- `shareWithUsers(context)` — Share folder with tenant users
- `createGoogleDoc(context)` — Clone template documents
- `createGoogleSheet(context)` — Create tracking spreadsheets
- `uploadFile(context)` / `uploadContent(context)` — File uploads

**GovWin adaptation:** Create `frontend/lib/google-drive.ts`:
```typescript
export async function provisionTenantDrive(tenantSlug: string, tenantName: string) {
  const drive = getDriveClient(process.env.GOOGLE_DELEGATED_ADMIN);

  // Create root folder: /GovWin Tenants/{tenant-slug}/
  const rootFolder = await drive.files.create({
    requestBody: {
      name: tenantName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [process.env.GOOGLE_DRIVE_TEMPLATE_FOLDER_ID!],
    },
  });

  // Create sub-folders: Company Profile, Proposals, Pipeline, Resources
  const subFolders = ['Company Profile', 'Proposals', 'Pipeline', 'Resources'];
  for (const name of subFolders) {
    await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [rootFolder.data.id!],
      },
    });
  }

  return rootFolder.data.id;
}
```

**API route:** `frontend/app/api/onboarding/provision/route.ts`

### 2.3 Gmail — Digest & Notification Sender

**Source:** `packages/api/src/workflows/stepFunctions/googleGmail.ts` + `packages/api/src/lib/gmailClient.ts`

Key patterns:
- `GmailService` class extending `GoogleWorkspaceService`
- Rate limiting: 250ms between requests, 250/minute max
- Retry with exponential backoff on 429/quota errors
- Email metadata extraction from Gmail API response
- Query builder for complex search filters

**GovWin adaptation:** For sending daily digest emails via `noreply@govwin.io`:
```typescript
export async function sendDigestEmail(
  recipientEmail: string,
  subject: string,
  htmlBody: string
) {
  const gmail = getGmailClient(process.env.GOOGLE_DELEGATED_SENDER!);

  const message = [
    `To: ${recipientEmail}`,
    `Subject: ${subject}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    htmlBody,
  ].join('\n');

  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodedMessage },
  });
}
```

### 2.4 Gmail Sweeper Pattern (Background Worker)

**Source:** `packages/api/src/workers/gmailSweeper.ts`

Reusable patterns:
- `GmailSweeper` class with initialize/start/stop lifecycle
- Batch processing with configurable lookback window
- Dedup via `message_id` unique constraint
- Organization resolution from email participants
- System health tracking per worker
- Rate limiting between employees (5s) and messages (250ms)

**GovWin relevance:** Could adapt for inbound reply parsing (future feature per architecture doc).

### 2.5 Activity Tracker

**Source:** `packages/api/src/lib/activityTracker.ts`

Pattern: `startOperation()` → do work → `endOperation()` with:
- Duration tracking
- Namespaced types: `project.create_started`, `stepfunction.failed`
- Stall detection for long-running operations
- In-memory active operations map with cleanup

**GovWin adaptation:** Add to pipeline audit logging. Could replace/supplement `console.error` logging with structured activity records.

---

## 3. Database Schema Patterns to Adopt

### From UbiHere's Prisma Schema

**GDriveArtifact model** — Index of all Drive files per tenant:
```sql
CREATE TABLE drive_files (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  gid TEXT UNIQUE NOT NULL,           -- Google Drive file ID
  name TEXT NOT NULL,
  type TEXT NOT NULL,                  -- FOLDER, DOCUMENT, SPREADSHEET, etc.
  mime_type TEXT,
  tenant_id UUID REFERENCES tenants(id),
  parent_gid TEXT,                     -- parent folder's Google Drive ID
  web_view_link TEXT,
  download_link TEXT,
  permissions JSONB DEFAULT '[]',
  is_processed BOOLEAN DEFAULT false,
  auto_created BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_drive_files_tenant ON drive_files(tenant_id);
CREATE INDEX idx_drive_files_parent ON drive_files(parent_gid);
```

**EmailArchive model** — Track all sent emails:
```sql
CREATE TABLE email_log (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id UUID REFERENCES tenants(id),
  message_id TEXT UNIQUE,             -- Gmail message ID
  thread_id TEXT,
  recipient TEXT NOT NULL,
  subject TEXT,
  body_preview TEXT,
  email_type TEXT NOT NULL,           -- 'digest', 'alert', 'onboarding', 'custom'
  sent_at TIMESTAMPTZ DEFAULT now(),
  delivery_status TEXT DEFAULT 'sent'
);
```

**StepFunctionExecution model** — Audit trail for automated operations:
```sql
CREATE TABLE integration_executions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  function_name TEXT NOT NULL,        -- 'drive.createFolder', 'gmail.sendDigest'
  tenant_id UUID REFERENCES tenants(id),
  status TEXT DEFAULT 'STARTED',      -- STARTED, COMPLETED, FAILED
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  success BOOLEAN,
  duration_ms INTEGER,
  error_message TEXT,
  parameters JSONB,
  result JSONB
);
```

### Columns to Add to `tenants` Table

Per GovWin architecture doc (section 7.2), these match UbiHere's `Organization.gdrive_folder_id` pattern:
```sql
ALTER TABLE tenants ADD COLUMN drive_folder_id TEXT;
ALTER TABLE tenants ADD COLUMN gmail_thread_label_id TEXT;
ALTER TABLE tenants ADD COLUMN onboarding_step TEXT DEFAULT 'pending';
```

---

## 4. npm Packages to Add

From UbiHere's `packages/api/package.json`:
```bash
cd frontend && npm install googleapis google-auth-library zod
```

- `googleapis@128` — Google Drive, Gmail, Calendar, Sheets APIs
- `google-auth-library@9` — Service account + domain-wide delegation
- `zod` — Runtime request validation (already a good practice for API routes)

---

## 5. Environment Variables to Add

From UbiHere's Google Workspace setup doc:
```env
# Google Workspace Integration
GOOGLE_SERVICE_ACCOUNT_KEY=<base64 encoded JSON key>
GOOGLE_DELEGATED_ADMIN=admin@govwin.io
GOOGLE_DELEGATED_SENDER=noreply@govwin.io
GOOGLE_DRIVE_TEMPLATE_FOLDER_ID=<folder ID of master template folder>
GOOGLE_WORKSPACE_DOMAIN=govwin.io
```

---

## 6. OAuth Scopes Required

Configure in Google Workspace Admin → Security → API Controls → Domain-wide Delegation:

```
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/drive.file
https://www.googleapis.com/auth/calendar
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/calendar.readonly
```

---

## 7. Implementation Order

Based on GovWin's architecture doc and UbiHere's proven patterns:

### Phase 1: Foundation (Week 1)
1. Install `googleapis`, `google-auth-library`, `zod`
2. Create `frontend/lib/google.ts` (auth foundation)
3. Create `frontend/lib/google-drive.ts` (Drive operations)
4. Add `drive_folder_id` column to tenants
5. Create migration for `drive_files` table
6. Implement `/api/onboarding/provision` route

### Phase 2: Drive Portal (Week 2)
1. Create migration for `email_log` and `integration_executions` tables
2. Create `frontend/lib/google-gmail.ts` (send only, initially)
3. Implement Drive file browser in portal UI (embed Google Docs/Sheets)
4. Add GDriveArtifact sync worker pattern from UbiHere

### Phase 3: Notifications (Week 3)
1. Implement daily digest email sender in Python pipeline
2. Add Gmail label management per tenant
3. Create `/api/portal/[slug]/documents` route for Drive file listing

### Phase 4: Stripe + Full Onboarding (Week 4)
1. Implement `/api/stripe/webhooks` → trigger provisioning
2. Wire checkout → subscription → Drive folder creation → welcome email
3. Add Stripe columns to tenants table

---

## 8. Key Architectural Differences

| Aspect | UbiHere CRM | GovWin |
|---|---|---|
| Framework | Express + Prisma | Next.js 15 + raw SQL (postgres.js) |
| Auth | Session-based + JWT | NextAuth.js |
| Multi-tenancy | `organization_id` FK | `tenant_id` FK + slug routing |
| Error handling | Basic try-catch | Mandatory per CLAUDE.md SOP |
| API style | Express routes | Next.js API routes (app router) |
| Frontend | React + Vite + TanStack Query | React + Next.js SSR/client split |
| Workers | Node.js setInterval | Python pipeline (+ potential Next.js cron) |

### Adaptation Notes
- UbiHere's Express routes → convert to Next.js `route.ts` handlers
- UbiHere's Prisma queries → convert to postgres.js tagged templates (`sql\`...\``)
- UbiHere's `req.user` → GovWin's `authorize()` from `lib/auth.ts`
- UbiHere's `ServiceFactory` → GovWin's simpler function exports from `lib/google.ts`
- UbiHere's `console.log` → GovWin's `console.error` with tagged prefixes per CLAUDE.md

---

## 9. Source File Index

All files from `ubi-wagner/ubihere-crm` (master branch):

### Core Integration Code
| File | Purpose | Lines |
|---|---|---|
| `packages/api/src/workflows/stepFunctions/interface.ts` | Service factory + base classes | ~400 |
| `packages/api/src/workflows/stepFunctions/gdrive.ts` | Drive step functions (14 ops) | ~500 |
| `packages/api/src/workflows/stepFunctions/googleGmail.ts` | Gmail service class | ~250 |
| `packages/api/src/workflows/stepFunctions/gmail.ts` | Gmail step function wrappers | ~150 |
| `packages/api/src/lib/gmailClient.ts` | Rate-limited Gmail client | ~350 |
| `packages/api/src/workers/gmailSweeper.ts` | Background email sweeper | ~400 |
| `packages/api/src/routes/integrations/gmail.ts` | Gmail composer API routes | ~350 |
| `packages/api/src/lib/activityTracker.ts` | Operation tracking | ~200 |
| `packages/api/src/workflows/stepFunctions/executor.ts` | Step function executor | ~80 |

### Schema & Types
| File | Purpose |
|---|---|
| `packages/api/prisma/schema.prisma` | Full Prisma schema (all models + enums) |
| `packages/api/src/workflows/types.ts` | TypeScript interfaces for workflows |
| `packages/api/package.json` | Dependencies list |

### Documentation
| File | Purpose |
|---|---|
| `SYSTEMS_ARCHITECTURE.md` | Full system architecture |
| `GOOGLE_WORKSPACE_STEPFUNCTIONS.md` | All 32 Google Workspace functions documented |
| `GDRIVE_CUSTOMER_PORTAL_ARCHITECTURE.md` | Drive portal design with permissions |
| `packages/api/GOOGLE-WORKSPACE-SETUP.md` | Domain delegation setup guide |

### React Components (for UI reference)
| File | Purpose |
|---|---|
| `packages/web/src/components/GDriveFolderAutomation.tsx` | Folder management UI |
| `packages/web/src/components/GDriveTemplateSystem.tsx` | Template cloning UI |
| `packages/web/src/components/GmailAssistant.tsx` | Gmail sidebar component |
| `packages/web/src/components/DocumentEmbedInterface.tsx` | Google Docs embed |
| `packages/web/src/components/FormsAndSheetsBuilder.tsx` | Sheets integration |
