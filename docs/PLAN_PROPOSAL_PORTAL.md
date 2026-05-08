# Plan: Proposal Portal — Unified Workspace

**Date:** 2026-05-07
**Goal:** One page, three user perspectives, 2-4 configurable gates,
frictionless contribution workflow.

---

## 1. The Mental Model

The proposal portal is a single page that adapts based on who's looking:

```
/portal/{slug}/proposals/{proposalId}

┌──────────────────────────────────────────────────────────┐
│  ADMIN VIEW (tenant_admin)                               │
│  ┌─────────┬──────────────┬──────────────┬────────────┐ │
│  │ Artifacts│ Team & Access │ Stage Control│ AI & Library│ │
│  └─────────┴──────────────┴──────────────┴────────────┘ │
│                                                          │
│  [ Volume 1: Technical ]                                 │
│    ├── Technical Proposal (15 pages) — assigned: John    │
│    │   Status: Draft | 12/15 pages | Last edit: 2h ago  │
│    ├── Cover Page — assigned: Admin                      │
│    └── Key Personnel Bios — assigned: Sarah, Mike        │
│                                                          │
│  [ Volume 2: Cost ]                                      │
│    ├── Cost Spreadsheet — assigned: Admin                │
│    └── Budget Justification — assigned: Admin            │
│                                                          │
│  [ Volume 3: Supporting ]                                │
│    ├── Past Performance — assigned: Sarah                │
│    ├── SBIR Certifications — form (auto-filled)          │
│    └── Company Commercialization Report — PDF upload     │
│                                                          │
│  [ Dropboxes ]                                           │
│    ├── John's uploads (3 files)                          │
│    ├── Sarah's uploads (1 file)                          │
│    └── External: Dr. Smith's uploads (2 files)           │
│                                                          │
│  [ Stage: Draft → Review → Final ]                       │
│    Current: Draft | Advance → | Deadline: May 15        │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  CONTRIBUTOR VIEW (tenant_user "John")                   │
│                                                          │
│  My Assignments:                                         │
│    ├── Technical Proposal (15 pages) — EDIT              │
│    └── Key Personnel Bios — EDIT (my section only)       │
│                                                          │
│  My Dropbox:                                             │
│    ├── john_resume_v3.docx                               │
│    ├── past_project_overview.pdf                         │
│    └── [+ Upload files]                                  │
│                                                          │
│  Other Sections (view-only):                             │
│    ├── Cover Page — view only                            │
│    ├── Cost Spreadsheet — hidden (no access)             │
│    └── Past Performance — can comment                    │
│                                                          │
│  Stage: Draft | Deadline: May 15                         │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  EXTERNAL COLLABORATOR VIEW (partner_user "Dr. Smith")   │
│                                                          │
│  Shared With Me:                                         │
│    ├── Technical Proposal — view + comment               │
│    └── Key Personnel Bios — edit (my bio only)           │
│                                                          │
│  My Dropbox:                                             │
│    ├── smith_cv.docx                                     │
│    └── [+ Upload files]                                  │
│                                                          │
│  Stage: Draft | Deadline: May 15                         │
└──────────────────────────────────────────────────────────┘
```

---

## 2. Stage Model Change

### Current (7 fixed stages — too rigid):
```
outline → draft → pink_team → red_team → gold_team → final → submitted
```

### New (2-4 configurable gates):
```
Admin picks at proposal creation:
  2 gates: draft → final
  3 gates: draft → review → final
  4 gates: draft → internal_review → external_review → final

All proposals end with: → submitted (auto after final export)
```

### Migration 029: Simplify stage model
```sql
ALTER TABLE proposals
  DROP CONSTRAINT IF EXISTS proposals_stage_check;

ALTER TABLE proposals
  ADD CONSTRAINT proposals_stage_check
  CHECK (stage IN ('draft','review','final','submitted','archived'));

-- Default existing proposals to 'draft'
UPDATE proposals SET stage = 'draft'
  WHERE stage IN ('outline','pink_team','red_team','gold_team');

-- Store the gate configuration per proposal
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS gate_config JSONB DEFAULT '["draft","final"]'::jsonb;
```

---

## 3. File-Level Build Plan

### Layer 1: Data Model (migration + resolver)

**`db/migrations/029_proposal_portal.sql`**
- Simplify stage CHECK constraint (draft/review/final/submitted/archived)
- Add `gate_config JSONB` to proposals
- Add `dropbox_folder TEXT` to proposal_collaborators
- Add `assigned_sections UUID[]` to proposal_collaborators
- Extend `collaborator_stage_access.permission` to include 'upload'

**`frontend/lib/proposal-access.ts`** — NEW
- `resolveUserAccess(userId, proposalId)` → returns:
  ```typescript
  {
    role: 'admin' | 'contributor' | 'external';
    canEdit: string[];        // section IDs
    canComment: string[];     // section IDs
    canView: string[];        // section IDs
    canUpload: boolean;
    canAdvance: boolean;
    canManageTeam: boolean;
    currentStage: string;
    gates: string[];
  }
  ```
- Reads from `proposal_collaborators` + `collaborator_stage_access`
- Admin (tenant_admin) gets full access implicitly

### Layer 2: API Routes (8 routes to wire)

**`/api/portal/[slug]/proposals/[id]/collaborators/route.ts`** — replace 501
- GET: list all collaborators with their access levels + assigned sections
- POST: invite a new collaborator (email, name, role, assigned_sections, permission)
  - If email matches an existing user → link directly
  - If new email → create user with temp_password=true, send invite email
  - Creates proposal_collaborators row + collaborator_stage_access rows
  - Emits `proposal.collaborator.invited` event

**`/api/portal/[slug]/proposals/[id]/collaborators/[collabId]/route.ts`** — NEW
- PATCH: update role, assigned_sections, permission
- DELETE: revoke access (sets access_revoked_at, doesn't delete row)
- Emits `proposal.collaborator.updated` / `proposal.collaborator.removed`

**`/api/portal/[slug]/proposals/[id]/dropbox/route.ts`** — NEW
- GET: list files in the user's dropbox folder (S3 prefix)
- POST: upload a file to the user's dropbox
  - S3 key: `customers/{slug}/proposals/{id}/dropbox/{userId}/{filename}`
  - Creates a record in proposal_workspace_files (if table exists) or just uses S3
- DELETE: remove a file from dropbox

**`/api/portal/[slug]/proposals/[id]/compliance/route.ts`** — replace 501
- GET: returns the frozen compliance.json from the proposal's S3 folder
- Already copied during provisioning — this just reads it back

**`/api/portal/[slug]/proposals/[id]/stage/route.ts`** — replace 501
- GET: returns current stage, gate_config, stage_history
- PATCH: advance to next gate (admin only)
  - Validates transition against gate_config
  - Records in proposal_stage_history
  - Auto-locks on 'final'

**`/api/portal/[slug]/proposals/[id]/sections/route.ts`** — replace 501
- GET: list all sections with access-filtered visibility
  - Admin sees all
  - Contributors see only assigned + viewable
  - External sees only shared
- Returns section list with per-section permission for the current user

**`/api/portal/[slug]/team/route.ts`** — replace 501
- GET: list team members for this tenant (all proposals)
- POST: invite a new team member to the tenant (not proposal-specific)

**`/api/invite/[token]/route.ts`** — NEW
- GET: verify invite token, show accept page
- POST: accept invite, set password, mark accepted_at

### Layer 3: Components (6 new + 2 modified)

**`frontend/components/portal/proposal-admin-panel.tsx`** — NEW
Admin-only panel with 4 tabs:
- **Artifacts:** volume-grouped sections with assignment dropdowns, status badges, page counts
- **Team:** collaborator list, invite form, access matrix (section × permission grid)
- **Stages:** gate selector (2/3/4 gates), current stage indicator, advance button, timeline
- **AI & Library:** "Draft All" trigger, library atom search, template selection

**`frontend/components/portal/proposal-contributor-view.tsx`** — NEW
Contributor's view:
- "My Assignments" — sections they can edit, with click-to-open canvas editor
- "My Dropbox" — personal file upload zone + file list
- "Other Sections" — view/comment-only sections they have access to
- Stage indicator + deadline

**`frontend/components/portal/proposal-dropbox.tsx`** — NEW
Per-user file upload component:
- Drag-drop zone
- File list with type icons, sizes, upload dates
- Delete button (own files only, admin can delete any)
- S3 presigned URL upload for large files

**`frontend/components/portal/team-manager.tsx`** — NEW
Team management component:
- Member list with role badges (admin/contributor/external)
- Invite form (email, name, role)
- Per-proposal assignment matrix: section × permission (view/comment/edit)
- "Send invite" with temp password flow

**`frontend/components/portal/stage-control.tsx`** — NEW
Stage advancement component:
- Gate selector at proposal creation (2/3/4 gates dropdown)
- Current stage with progress bar
- "Advance to Next Stage" button (admin only)
- Stage history timeline
- Deadline setting

**`frontend/components/portal/compliance-checklist.tsx`** — NEW
Shows the compliance matrix as a checklist:
- Required artifacts with completion status
- Page limit progress per section
- Missing items highlighted
- All data from the frozen compliance.json

**`frontend/components/portal/proposal-workspace.tsx`** — MODIFY
Replace current flat section list with the role-aware unified view:
- Detects user role via `resolveUserAccess()`
- Renders admin panel OR contributor view based on role
- Passes access permissions to child components

**`frontend/app/portal/[tenantSlug]/proposals/[proposalId]/page.tsx`** — MODIFY
Update server component to:
- Load proposal + sections + collaborators + compliance + stage history
- Resolve current user's access level
- Pass everything to the unified workspace

### Layer 4: Invite Flow

**`frontend/app/(auth)/invite/[token]/page.tsx`** — NEW
- Shows invite details (who invited, which proposal, what role)
- Password setup form (same as change-password)
- On submit: accepts invite, sets password, redirects to proposal

---

## 4. Execution Order

```
Phase A (data model + access resolver):      ~4 hours
  029_proposal_portal.sql
  proposal-access.ts

Phase B (API routes):                        ~6 hours
  collaborators CRUD (invite, update, remove)
  dropbox (upload, list, delete)
  compliance (read frozen snapshot)
  stage (read, advance with configurable gates)
  sections (access-filtered list)
  team (tenant-wide)
  invite accept

Phase C (components):                        ~8 hours
  proposal-admin-panel (the big one)
  proposal-contributor-view
  proposal-dropbox
  team-manager
  stage-control
  compliance-checklist
  Modify proposal-workspace.tsx (role switching)
  Modify page.tsx (data loading)

Phase D (invite flow):                       ~2 hours
  invite/[token] page + API
  temp password email template
```

Total: ~20 hours of focused work. Phases A+B can run in parallel
with Phase C design since the API contracts are defined above.

---

## 5. What Doesn't Change

- Canvas editor — stays exactly as-is
- Canvas renderer — stays exactly as-is
- AI revision panel — stays exactly as-is
- Comments system — stays exactly as-is
- Export (DOCX/PPTX/XLSX) — stays exactly as-is
- Template provisioning — stays exactly as-is
- Compliance resolver — stays exactly as-is
- Event system — stays exactly as-is (just new event types added)
- S3 storage paths — stay exactly as-is

---

## 6. What Gets Removed

- The 7 fixed color team stages (replaced by 2-4 configurable gates)
- The hardcoded stage list in the advance route (replaced by gate_config)
- The `pink_team`, `red_team`, `gold_team` stage values in the DB
