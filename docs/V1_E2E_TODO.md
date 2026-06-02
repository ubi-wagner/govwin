# V1 E2E Functionality Audit — Implementation TODO

**Date:** 2026-05-31  
**Scope:** Complete end-to-end V1 flow — purchase, admin 72hr SLA, proposal setup, collaborator access, document building, stage gates

---

## What's Working (Verified)

| Flow | Status | Notes |
|------|--------|-------|
| Stripe checkout → webhook → purchase record | ✅ | Race-safe, idempotent |
| Proposal creation from spotlight (with lock) | ✅ | Sections auto-generated from volumes/compliance |
| Admin email alert on proposal.created | ✅ | 72hr instructions in email body |
| Compliance matrix in curation workspace | ✅ | `solicitation_compliance` + volumes |
| Template auto-application during creation | ✅ | Resolves by program type + item type |
| Lock/unlock mechanism | ✅ | Lock counts, deadline enforcement |
| Collaborator invite (from portal team page) | ✅ | Creates user, sends creds, stage access |
| Collaborator invite (from proposal page) | ✅ | section-assigned, stage-gated access |
| Section save access control | ✅ | Enforced on PUT via collaborator_stage_access |
| Partner user nav restrictions | ✅ | Only /proposals visible |
| Admin claiming (race-safe) | ✅ | Atomic WHERE status='new' AND claimed_by IS NULL |
| Canvas editor (WYSIWYG) | ✅ | Full node CRUD, undo/redo, format presets |
| AI section drafting (Claude) | ✅ | invoke('proposal.draft_section') → CanvasNode[] |
| Library atom search + insertion | ✅ | library-picker.tsx + library.search_atoms tool |
| AI revision panel | ✅ | Quick actions + custom instructions |
| Stage advancement with gate checks | ✅ | process, completion snapshots, canvas versions |
| Section export (DOCX/PPTX/XLSX) | ✅ | Gated behind lock_count >= 1 |
| Canvas versioning | ✅ | canvas_versions on every save + stage advance |
| Node-level comments | ✅ | On-demand fetch, resolve workflow |

---

## Critical Gaps (V1 Blockers)

### GAP-1: No 72-Hour Admin Task Tracking
**Problem:** When proposal is created and admin emailed, there's no tracked task with deadline. No `process_instances` entry, no deadline enforcement, no escalation.  
**Files:** `frontend/app/api/portal/[tenantSlug]/proposals/create/route.ts` (lines 485-551)  
**Fix:** Create a `process_instances` row at proposal creation with `deadline = NOW() + 72h`, `workflow_name = 'AdminProposalSetup'`, `source = 'pipeline'`. Show this on admin workflows dashboard.

### GAP-2: No Customer Notification on Unlock
**Problem:** Admin unlocks proposal (`is_locked = false`) but customer receives no email or UI notification. They don't know their proposal is ready to edit.  
**Files:** `frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/lock/route.ts` (lines 333-398)  
**Fix:** Send customer email when admin unlocks. Emit `proposal.ready_for_customer` event.

### GAP-3: Partner Users Can View Unassigned Sections
**Problem:** `resolveUserAccess()` returns only `editableSections`/`commentableSections`/`viewableSections` for assigned sections, but the **sections LIST page** and **proposal workspace** show all sections before checking access. Only the save endpoint enforces assignment.  
**Files:** 
- `frontend/app/portal/[tenantSlug]/proposals/[proposalId]/page.tsx`
- `frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/sections/route.ts`  
**Fix:** Filter sections list for partner_user to only return sections in their `assigned_sections` array. Section page should redirect if user not authorized to view.

### GAP-4: No "My Work" View for Collaborators
**Problem:** `proposal_sections.assigned_to` and `proposal_collaborators.assigned_sections` exist but zero UI surfaces "sections assigned to me." Collaborators don't know what they need to do.  
**Files:** `frontend/components/portal/proposal-workspace.tsx`  
**Fix:** Add "My Sections" tab/filter to proposal workspace. For partner_user, default to showing only assigned sections.

### GAP-5: Stage Gate Checklist Has No UI
**Problem:** `stage_gate_requirements` table, API, and advance-check all work. But the proposal workspace has no checklist showing what must be done before advancing. Users hit a generic "requirements not met" error.  
**Files:** `frontend/components/portal/proposal-workspace.tsx`, `frontend/components/portal/stage-control.tsx`  
**Fix:** Add requirements checklist panel (shown before advance button). Load from `GET /gates?stage=current`, show checkbox per requirement with isMet status.

### GAP-6: No Stale Claim Detection / Forced Escalation
**Problem:** Admin claims an RFP, doesn't touch it for 48+ hours — no detection, no escalation, no auto-reassignment option.  
**Files:** `frontend/app/admin/rfp-curation/page.tsx`, `frontend/components/rfp-curation/triage-queue.tsx`  
**Fix:** Add "stale" detection to triage queue — show warning badge if claimed_at > 24h with no status change. Add "Force Release" button for master_admin to unclaim and return to 'new'. Add automation rule for stale claim detection.

---

## Secondary Gaps (V1 Polish)

### GAP-7: No Editing Session Tracking
**Problem:** `editing_by` / `editing_since` columns exist on `proposal_sections` but no API sets/clears them. No "User X is editing this" awareness.  
**Fix:** Add PUT endpoint to set editing session. Clear on save or 5min timeout.

### GAP-8: No Section-Level Deadlines
**Problem:** Only `proposals.unlock_deadline` (global). No per-section due dates. Collaborators don't know when their section is due.  
**Fix:** Needs a DB column `proposal_sections.due_date`. Add to template setup.

### GAP-9: No Revoke Collaborator Access UI
**Problem:** `collaborator_stage_access.access_revoked_at` column exists but no UI to revoke. Only DB-level.  
**Fix:** Add "Remove Access" button in TeamManager component.

### GAP-10: Admin Tenant Page Read-Only
**Problem:** `/admin/tenants/[tenantId]/page.tsx` shows users but has no "Add Team Member" button.  
**Fix:** Add invite form (calls same API as portal team invite).

---

## Implementation Tasks

### Phase 1: 72hr Process Instance + Customer Notification (CRITICAL)

- [x] **F1.1** In `proposals/create/route.ts` after proposal INSERT: create `process_instances` row
  - `workflow_name = 'AdminProposalSetup'`
  - `deadline = NOW() + interval '72 hours'`
  - `status = 'running'`
  - `source = 'pipeline'`
  - `tenant_id = tenantId`
  - `payload = { proposalId, opportunityTitle, tenantName, adminEmailsSent }`
- [x] **F1.2** In `proposals/[proposalId]/lock/route.ts` unlock handler: add customer notification
  - Send email to all `tenant_admin`/`tenant_user` members via `tenant_memberships` JOIN
  - Subject: "Your proposal is ready — [Opportunity Title]"
  - Body: link to proposal, instructions to review and edit
  - Emit `proposal.ready_for_customer` event (namespace='proposal', type='proposal.ready_for_customer')
- [x] **F1.3** Mark process_instance complete when admin unlocks proposal
  - On unlock: `UPDATE process_instances SET status='completed', completed_at=now() WHERE workflow_name='AdminProposalSetup' AND payload->>'proposalId' = proposalId AND status='running'`

### Phase 2: Partner Section View Guard + My Work Tab

- [x] **F2.1** In sections GET route: filter for partner_user to assigned sections only
  - Check `role === 'partner_user'` from session (not access.role which maps to contributor/external)
  - Remove sections with `permission === 'none'` entirely from response
- [ ] **F2.2** In section page: if partner_user navigates directly to unassigned section URL, return 403
  - Deferred — section page server component needs auth + resolveUserAccess check
- [x] **F2.3** In proposal workspace: add "My Sections" filter tab
  - All roles see "All Sections" + "My Sections" + "Timeline" tabs
  - For non-admin: defaults to "My Sections" on mount
  - "My Sections" = sections where `permission === 'edit'` or `'comment'` or `assignedTo === currentUserId`

### Phase 3: Stage Gate Checklist UI

- [x] **F3.1** In `stage-control.tsx`: load gate requirements for current stage on mount
  - `GET /api/portal/[tenantSlug]/proposals/[proposalId]/gates?stage=current`
  - Show toggle button (amber if unmet, green if all met)
  - Expandable checklist with per-requirement status
- [x] **F3.2** Disable "Advance" button if any required gates unmet (for non-admin)
  - Show "Requirements not met" disabled placeholder instead
- [x] **F3.3** For admin users: Advance button shown even with unmet requirements (force advance)
- [x] **F3.4** Allow tenant_admin to mark requirements met from checklist (PATCH /gates with requirementId + isMet)
  - Uses existing PATCH handler on gates route

### Phase 4: Stale Claim Detection + Force Release

- [x] **F4.1** In triage-queue.tsx: add "stale" amber badge if `claimedAt` > 24h AND status still 'claimed'
  - Tooltip shows hours elapsed
- [x] **F4.2** In triage-queue.tsx: Force Release button for master_admin on stale items
  - Only visible when `currentUserRole === 'master_admin'` AND `isStale(item)`
- [x] **F4.3** `force-release/route.ts`: master_admin only, resets status→'new', clears claimed_by/claimed_at, logs to triage_actions, emits finder.solicitation.force_released
- [ ] **F4.4** Add automation rule seed: on `finder.solicitation.claimed` event + cooldown 24h → `notify_admin` if still status='claimed' after delay
  - Deferred — needs automation_rules DB seed

### Phase 5: Collaborator Access Revoke UI

- [x] **F5.1** In TeamManager component: Remove button (✕) per collaborator row, canManage only
  - Calls `DELETE /api/portal/[tenantSlug]/proposals/[proposalId]/collaborators/[collaboratorId]`
- [x] **F5.2** Added DELETE handler `collaborators/[collaboratorId]/route.ts`:
  - Revokes all `collaborator_stage_access` rows (sets `access_revoked_at`)
  - Deletes `proposal_collaborators` row
  - Emits `proposal.collaborator.access_revoked`

### Phase 6: TypeScript verification + commit — DONE ✅

- [x] **F6.1** `npx tsc --noEmit` passes clean (0 errors)
- [x] **F6.2** All new routes follow CLAUDE.md standards (auth check, try/catch, error+code)
- [x] **F6.3** Commit `e9edf0d` pushed to `claude/analyze-project-status-KbAhg`
