# HITL Role-Based Test Plan — RFP Pipeline Portal
## Also serves as a pre-launch walkthrough manual

**Date:** 2026-06-23
**Source inputs:** ARCHITECTURE_V9.md · docs/baseline/inventory/FRONTEND_API.md · FRONTEND_PAGES.md · GAP_ANALYSIS.md · LAUNCH_TODO.md
**Status legend:** ✅ Live · 🟦 Built-but-dormant · 🔴 Broken stub

---

## 1. Purpose and How to Use This Document

This plan is a **human-driven walkthrough** — not a script for automated tests.
Walk through every numbered step as the named role. For each step:

- **Preconditions** — what must be true before you start
- **Action** — exactly what to do in the browser or terminal
- **Expected result** — what a passing outcome looks like
- **(route · event · table)** — the API route hit, event emitted, and table written
- **Pass / Fail** — check the box when confirmed

Every "Verify in-house" callout in Section 6 is explicitly **not covered** by the automated suite. Those items must be manually signed off here before launch.

---

## 2. Test Environment Setup

### 2.1 Required Accounts (create in this order)

| Role | Username | How to create |
|------|----------|--------------|
| master_admin | `master@test.local` | Pipeline seeds on first boot via `seed_master_admin()` in `pipeline/src/main.py`; credentials come from `MASTER_ADMIN_EMAIL` / `MASTER_ADMIN_PASSWORD` env vars |
| rfp_admin | `rfpadmin@test.local` | Log in as master_admin → `/admin/tenants` → create user with role `rfp_admin` (or direct INSERT into `users` with bcrypt hash) |
| tenant_admin | `tadmin@acme.test` | Log in as rfp_admin → `/admin/applications` → accept a pending application; the accept flow creates the tenant + tenant_admin user with a temp password |
| tenant_user | `tuser@acme.test` | Log in as tenant_admin → `/portal/[slug]/team` → invite with role `tenant_user` |
| partner_user | `partner@ext.test` | Log in as tenant_admin → proposal workspace → Collaborators → invite; partner receives email with `/invite/[token]` link |

### 2.2 Required Seed Data

- At least one submitted application in `applications` table (status `pending`) for the tenant onboarding flow.
- At least one real or synthetic RFP PDF (any multi-page PDF will do; SBIR BAA format preferred).
- A SAM.gov API key inserted and AES-256-GCM encrypted in `api_key_registry` (or use synthetic ingest mode).
- A Stripe test-mode product with price IDs matching `STRIPE_PRICE_ID_*` env vars.

### 2.3 Environment Variables Required

```
DATABASE_URL                      → PostgreSQL govtech_intel
CMS_DATABASE_URL                  → PostgreSQL govtech_cms
SHARED_DATABASE_URL               → PostgreSQL govtech_intel (CMS event bridge)
ANTHROPIC_API_KEY                 → Claude API (Sonnet + Haiku calls)
AWS_ACCESS_KEY_ID / SECRET        → Cloudflare R2 (or local MinIO for dev)
AWS_ENDPOINT_URL / S3_BUCKET_NAME → R2 endpoint + bucket
NEXTAUTH_SECRET                   → NextAuth JWT signing
STRIPE_SECRET_KEY                 → Stripe test key (sk_test_…)
STRIPE_WEBHOOK_SECRET             → Stripe webhook signing secret (whsec_…)
GOOGLE_SERVICE_ACCOUNT_JSON       → Gmail API for email send (CMS)
CMS_JWT_SECRET                    → CMS SPA auth
REVALIDATE_SECRET                 → Next.js ISR token
API_KEY_ENCRYPTION_SECRET         → Pipeline AES key for api_key_registry
```

### 2.4 Verifying the Stack is Running

- [ ] `GET /api/health` returns `{ ok: true }`
- [ ] Pipeline health: `GET http://pipeline:8080/health` returns 200
- [ ] CMS health: `GET http://cms/health` returns 200
- [ ] `process_instances` table exists in govtech_intel (migration 043+)

---

## 3. master_admin Walkthrough

**Role rank:** 5 — full system access including `/admin/system` and migrations.

### 3.1 Login and System Dashboard

- [ ] **MA-01** — Navigate to `/login`; enter master_admin credentials.
  - Expected: redirect to `/admin/dashboard`.
  - Event: `identity:user.logged_in:single` written to `system_events`.

- [ ] **MA-02** — Visit `/admin/system` (master_admin only path).
  - Expected: page loads with queue depth, event rates, tool stats. Partner_user or rfp_admin session should be redirected away.
  - Route: `GET /api/admin/system`; table: `agent_task_queue`, `system_events`.

- [ ] **MA-03** — Visit `/admin/analytics`.
  - Expected: 24h / 7d visitor and pageview counts render; device breakdown shown.
  - Route: `GET /api/admin/analytics`; tables: `visitor_sessions`, `page_views`.

### 3.2 Tenant and User Management

- [ ] **MA-04** — Visit `/admin/tenants`; search for a tenant by name.
  - Expected: tenant list with user/proposal/library counts; ILIKE search returns matching rows.
  - Route: `GET /api/admin/tenants`; table: `tenants`.

- [ ] **MA-05** — Click a tenant → `/admin/tenants/[tenantId]`.
  - Expected: subscription status, user list, proposal list, purchase history all render.
  - Route: `GET /api/admin/tenants/[tenantId]`; tables: `tenants`, `users`, `proposals`, `purchases`.

- [ ] **MA-06** — Patch a tenant (e.g. toggle status).
  - Expected: `200` response; `finder:tenant.updated:single` event written; table: `tenants`.

### 3.3 Migration and Storage Inspection

- [ ] **MA-07** — Visit `/admin/storage`.
  - Expected: S3 file browser lists files under `rfp-admin/` prefix; upload a small test file.
  - Route: `GET /api/admin/storage`; `POST /api/admin/storage`; storage: R2/S3.

- [ ] **MA-08** — Verify the migration runner: confirm `_migration_history` table has entries for the highest-numbered migration file. Do NOT use `scripts/migrate.sh` (no tracking table — marked "NEVER USE").
  - Check: `SELECT filename FROM _migration_history ORDER BY applied_at DESC LIMIT 5;`

### 3.4 Agent and Workflow Monitoring

- [ ] **MA-09** — Visit `/admin/agents`.
  - Expected: tool catalog grouped by namespace; 32 tools displayed; agent usage stats panel loads.
  - Route: `GET /api/admin/agents`, `GET /api/admin/agents/usage`; tables: `agent_task_queue`, `agent_task_log`.

- [ ] **MA-10** — Visit `/admin/workflows`.
  - Expected: active/recent `process_instances` listed with tenant name and open task count.
  - Route: `GET /api/admin/workflows`, `GET /api/admin/processes`; tables: `process_instances`, `tasks`.

- [ ] **MA-11** — Force-advance a paused process instance (if one exists).
  - Expected: `200`; `process_instance_transitions` row written; instance moves to next step.
  - Route: `POST /api/admin/workflows/[instanceId]/advance`.

**master_admin total: 11 steps**

---

## 4. rfp_admin Walkthrough

**Role rank:** 4 — RFP triage/curation, customer onboarding, CMS site editor.

### 4.1 Application Review and Tenant Onboarding

- [ ] **RA-01** — Visit `/admin/applications`; find a pending application.
  - Expected: list shows status badges; click application for detail.

- [ ] **RA-02** — Accept the application (`POST /api/admin/applications/[id]/accept`).
  - Expected: tenant + tenant_admin user created in `sql.begin` transaction; welcome email sent (verify in CMS email outbox); temp password displayed or emailed.
  - Event: `capture:application.accepted:end`; tables: `applications`, `tenants`, `users`.
  - **Verify in-house:** confirm email arrives via Gmail (CMS email_queue worker). This is NOT auto-tested.

- [ ] **RA-03** — Visit `/admin/tenants` and confirm the new tenant appears with status `active`.

### 4.2 RFP Upload and Ingest

- [ ] **RA-04** — Visit `/admin/rfp-curation/upload`; upload a test PDF.
  - Expected: `201` response; solicitation document and curated_solicitation rows created; file stored in S3 `rfp-admin/inbox/` prefix.
  - Route: `POST /api/admin/rfp-upload`; event: `finder:rfp.uploaded:end`; tables: `curated_solicitations`, `solicitation_documents`, `opportunities`.
  - **Verify in-house:** PDF import must succeed (P0-01 fix for `{PDFParse}` named import must be applied). If upload returns a JS TypeError, the fix is not deployed.

- [ ] **RA-05** — Confirm `OnRfpUploaded` workflow fires: visit `/admin/workflows` and find a `running` or `completed` process instance for the event.
  - Expected: workflow has steps `shred_document` (ACTION) → `extract_compliance` (ACTION) → `notify_curator` (NOTIFY).
  - Tables: `process_instances`, `process_instance_transitions`.

- [ ] **RA-06** — Once shredding completes, visit `/admin/rfp-curation`; find the new solicitation with status `ai_analyzed`.
  - Route: `GET /api/admin/rfp-curation`; table: `curated_solicitations`.

### 4.3 Triage

- [ ] **RA-07** — Claim the solicitation: click Claim.
  - Expected: status transitions to `claimed`; `claimed_by` set to current user.
  - Route: `POST /api/admin/rfp-curation/[solId]/claim` (via `solicitation.claim` tool); event: `finder:solicitation.claimed:single`.

- [ ] **RA-08** — Triage the solicitation: click Accept/Defer/Reject.
  - Expected: status transitions correctly per the state machine; `triage_actions` row written.
  - Route: `POST /api/admin/rfp-curation/[solId]/triage`; event: `finder:solicitation.triaged:single`; table: `triage_actions`.

### 4.4 Curation Workspace

- [ ] **RA-09** — Visit `/admin/rfp-curation/[solId]`.
  - Expected: full curation workspace renders — metadata panel, PDF viewer (signed S3 URL), topics list, volumes, compliance variables.
  - Routes: `GET /api/admin/rfp-curation/[solId]`; `GET /api/admin/rfp-document/[id]/signed-url`; tables: `curated_solicitations`, `solicitation_documents`, `solicitation_volumes`, `solicitation_compliance`.

- [ ] **RA-10** — Save a compliance variable value.
  - Expected: value saved; `episodic_memories` row written (HITL flywheel write).
  - Route: `POST /api/admin/rfp-curation/[solId]/compliance` (via `compliance.save_variable_value` tool); event: `finder:compliance_value.saved:single`.

- [ ] **RA-11** — Apply a compliance preset to one or more topics.
  - Expected: `solicitation_compliance` + `solicitation_volumes` + `volume_required_items` upserted.
  - Route: `POST /api/admin/rfp-curation/[solId]/apply-preset`.

- [ ] **RA-12** — Run the shredder manually (skip-shredder or shred-sync tool).
  - Expected: `solicitation_compliance` and `solicitation_documents` rows updated; extracted text written to S3 `rfp-pipeline/[opp_id]/text.md`.
  - Route: `POST /api/tools/solicitation.shred_sync`.

### 4.5 Request Review and Push

- [ ] **RA-13** — Request review: click "Request Review".
  - Expected: status transitions to `review_requested`.
  - Route via tool: `solicitation.request_review`; event: `finder:solicitation.review_requested:single`.

- [ ] **RA-14** — Approve the solicitation.
  - Expected: status → `approved`.
  - Route via tool: `solicitation.approve`.

- [ ] **RA-15** — Push to pipeline: click "Push to Portal".
  - Expected: status → `pushed_to_pipeline`; `finder:solicitation.pushed:single` event fires; `OnSolicitationPushed` workflow runs `match_tenants` scoring action; `tenant_pipeline_items` rows upserted for matched tenants.
  - Route: `POST /api/admin/rfp-curation/[solId]/push` (via `solicitation.push` tool); tables: `curated_solicitations`, `tenant_pipeline_items`.
  - **Verify in-house:** confirm scoring ran — query `SELECT * FROM tenant_pipeline_items WHERE solicitation_id = '[solId]'` and verify score values are non-zero. This path (match_tenants) has zero automated test coverage.

### 4.6 Sources and Scout

- [ ] **RA-16** — Visit `/admin/sources`; view all source profiles.
  - Route: `GET /api/admin/sources`; tables: `source_profiles`, `source_visits`, `source_diffs`.

- [ ] **RA-17** — Trigger a manual scout on a source profile.
  - Expected: `pipeline_jobs` row inserted with `kind=scout_source`; after pipeline processes, `source_snapshots` written; diffs visible in source profile.
  - Route: `POST /api/admin/sources/[profileId]/scout`; event: `finder:source.scout_triggered:single`.

- [ ] **RA-18** — Review a source diff: visit source diffs, mark one as reviewed.
  - Route: `PATCH /api/admin/sources/[profileId]/diffs`; event: `finder:source_diff.reviewed:single`.

### 4.7 CMS Site Editor (System A — Next.js Native)

- [ ] **RA-19** — Visit `/admin/site`; find the "homepage" page key.
  - Expected: list of all editable pages with view counts and draft/published status.
  - Route: `GET /api/admin/site/pages`; table: `content_pages`.

- [ ] **RA-20** — Open the homepage editor (`/admin/site/homepage`); edit a text block; save draft.
  - Expected: draft saved; `content_pages` row updated with `status=draft`.
  - Route: `POST /api/admin/site/pages/[pageKey]/save`; event: `system:content.page_saved:single`.

- [ ] **RA-21** — Publish the page.
  - Expected: `content_pages` row set to `status=active`; `Next.js revalidatePath` triggered; marketing homepage refreshes within 60s.
  - Route: `POST /api/admin/site/pages/[pageKey]/publish`; event: `system:content.page_published:single`.

- [ ] **RA-22** — Open a resource doc (`/admin/site/docs/resource/[slug]`); edit and publish.
  - Route: `GET /api/admin/site/docs/[type]/[slug]`; `POST /api/admin/site/docs/[type]/[slug]/save`; `POST /api/admin/site/docs/[type]/[slug]/publish`.

### 4.8 HITL Task Inbox

- [ ] **RA-23** — Visit `/admin/dashboard`; check the TaskQueue panel for open tasks assigned to rfp_admin.
  - Expected: tasks from `OnOpportunitiesDetected` (72h window) or `OnCmsContentRequested` visible.
  - Route: `GET /api/admin/tasks`; table: `tasks`.

- [ ] **RA-24** — Complete one open task.
  - Expected: task status → `completed`; workflow instance advances past the `HITL_WAIT` step.
  - Route: `POST /api/admin/tasks` (with `taskId`); table: `tasks`.

**rfp_admin total: 24 steps**

---

## 5. tenant_admin Walkthrough

**Role rank:** 3 — manages their tenant, invites team, purchases proposals, sees Spotlight.

### 5.1 First Login (Temp Password)

- [ ] **TA-01** — Use the welcome email link to log in with the temp password.
  - Expected: middleware detects `tempPassword=true` → forced redirect to `/change-password`.
  - Route: `POST /api/auth/change-password`; table: `users` (`temp_password=false`).

- [ ] **TA-02** — After password change, confirm redirect to `/portal/[slug]/dashboard`.
  - Expected: dashboard renders with empty stats (no proposals yet).

### 5.2 Profile Setup

- [ ] **TA-03** — Visit `/portal/[slug]/profile`; set NAICS codes, keywords, agency priorities.
  - Expected: `tenant_profiles` upserted; event: `capture:profile.updated:single`.
  - Route: `PATCH /api/portal/[tenantSlug]/profile`; tables: `tenants`, `tenant_profiles`.

### 5.3 Spotlight — Scored Opportunities

- [ ] **TA-04** — Visit `/portal/[slug]/spotlights`.
  - Expected: scored opportunities appear (score ≥ tenant's `min_surface_score` threshold from `tenant_profiles`).
  - Page: `/portal/[tenantSlug]/spotlights`; tables: `tenant_pipeline_items`, `opportunities`, `tenant_profiles`.

- [ ] **TA-05** — Click an opportunity to see full detail; pin it.
  - Expected: `tenant_pipeline_items.is_pinned=true`; event: `capture:opportunity.pinned:single`.
  - Route: `POST /api/portal/[tenantSlug]/opportunities/[opportunityId]/actions` (action: `pin`).

### 5.4 Purchase a Proposal

- [ ] **TA-06** — From the opportunity detail, click "Purchase Proposal".
  - Expected: Stripe Checkout session created; redirect to Stripe-hosted checkout page.
  - Route: Stripe checkout session creation.
  - **Verify in-house:** must use a Stripe test key (`sk_test_…`) and a real test card (`4242 4242 4242 4242`). Stripe webhook must be configured with `STRIPE_WEBHOOK_SECRET`. This path has zero automated coverage — see Section 6.

- [ ] **TA-07** — Complete Stripe checkout (test mode); confirm redirect back to portal.
  - Expected: `stripe/webhook` receives `checkout.session.completed`; 6-table `sql.begin` transaction runs: `purchases` row created, `proposals` row created, `proposal_sections` rows created, S3 `customers/[slug]/proposals/[id]/` prefix provisioned.
  - Event: `capture:purchase.completed:end`; tables: `purchases`, `proposals`, `proposal_sections`.
  - **Verify in-house:** query `SELECT * FROM proposals WHERE tenant_id = '[tenantId]' ORDER BY created_at DESC LIMIT 1;` — confirm proposal exists with all sections. Also confirm S3 `customers/` prefix has the `rfp-snapshot/` and `manifest.json` objects.

### 5.5 Invite Team and Partners

- [ ] **TA-08** — Visit `/portal/[slug]/team`; invite a team member (role: `tenant_user`).
  - Expected: invitation created; email sent with invite link; table: `invitations`.
  - Route: `POST /api/portal/[tenantSlug]/team/invite` (or via team page form).

- [ ] **TA-09** — From a proposal workspace, invite a partner_user collaborator.
  - Expected: collaborator row created; `proposal_collaborators` + `collaborator_stage_access` rows written; invite email sent.
  - Route: `POST /api/portal/[tenantSlug]/proposals/[proposalId]/collaborators`.
  - **Verify in-house:** confirm invite email arrives via Gmail. See Section 6.

- [ ] **TA-10** — Advance a proposal to `review` stage.
  - Expected: all stage gate requirements checked; if met, `proposals.stage=review`; `proposal_stage_history` row written; `proposal:proposal.advanced:end` event fires; `OnProposalAdvancedToReview` workflow spawns a TODO for tenant_admin.
  - Route: `POST /api/portal/[tenantSlug]/proposals/[proposalId]/advance` (targetStage: `review`); tables: `proposals`, `stage_completion_snapshots`, `canvas_versions`, `proposal_stage_history`, `proposal_activity_log`.

- [ ] **TA-11** — Visit `/portal/[slug]/billing`; confirm purchase history.
  - Expected: purchase table shows product type, amount, status; `purchases` rows visible.
  - Route: `GET /api/portal/[tenantSlug]/billing` (requires tenant_admin role; partner_user must be blocked).

**tenant_admin total: 11 steps**

---

## 6. tenant_user Walkthrough

**Role rank:** 2 — accesses proposals per admin grant; drafts sections, runs compliance checks.

### 6.1 Access and Dashboard

- [ ] **TU-01** — Accept the team invite link (`/invite/[token]`); set a password.
  - Expected: `users` row updated; `proposal_collaborators` join created (if applicable); event: `identity:invite.accepted:single` (NOT `identity.identity.invite_accepted` — that would be the double-prefix bug from P0-03).
  - Route: `POST /api/invite`; tables: `users`, `invitations`.

- [ ] **TU-02** — Log in; land on `/portal/[slug]/dashboard`.
  - Expected: stats render (proposals count, library units, pinned items).

### 6.2 Proposal Workspace

- [ ] **TU-03** — Visit `/portal/[slug]/proposals`; confirm proposals assigned to this user are listed.
  - Expected: partner_user sees only proposals where they are in `proposal_collaborators`; tenant_user sees all tenant proposals.

- [ ] **TU-04** — Click a proposal to open the workspace (`/portal/[slug]/proposals/[proposalId]`).
  - Expected: section list with status badges, compliance variables, collaborator roster, export controls.
  - Tables: `proposals`, `proposal_sections`, `solicitation_compliance`, `proposal_collaborators`.

- [ ] **TU-05** — Click into a section editor (`/portal/[slug]/proposals/[proposalId]/sections/[sectionId]`).
  - Expected: Tiptap canvas editor loads with existing content (empty if new); readOnly mode if `proposals.is_locked=true`.

- [ ] **TU-06** — Type content in the canvas and trigger auto-save.
  - Expected: `PUT /api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/save` called; `proposal_sections.content` updated; `canvas_versions` snapshot written; OCC version incremented.
  - Event: `proposal:section.saved:single`.

### 6.3 AI Draft

- [ ] **TU-07** — Click "AI Draft" for a section.
  - Expected: `POST /api/portal/[tenantSlug]/proposals/[proposalId]/ai/draft` queues draft intent; client then calls `POST /api/tools/proposal.draft_section` which calls Claude Sonnet directly; draft content returned and inserted into canvas.
  - Event: `proposal:proposal.draft_requested:single`; tool event: `tool:tool.invoked:end`.
  - **Verify in-house:** confirm ANTHROPIC_API_KEY is set and a real Claude response is returned (not a mock). This is a live Anthropic call — the pipeline agent workforce does NOT handle drafting; it comes from the frontend directly.

### 6.4 Compliance Check

- [ ] **TU-08** — Click "Compliance Check" on a section.
  - Expected: `POST /api/portal/[tenantSlug]/proposals/[proposalId]/ai/compliance` calls Claude Haiku; compliance score and issues returned and displayed inline.
  - Event: `proposal:compliance.checked:single`; tables read: `solicitation_compliance`, `compliance_variables`.
  - Model used: `claude-haiku-4-5-20251001` (hardcoded in route).

### 6.5 Proposal Stage Advancement and Gate Check

- [ ] **TU-09** — Attempt to advance a proposal stage without meeting gate requirements.
  - Expected: `400` response with `code: GATE_REQUIREMENTS_NOT_MET` and `details.unmet` listing missing items.
  - Route: `POST /api/portal/[tenantSlug]/proposals/[proposalId]/advance`.

- [ ] **TU-10** — Satisfy gate requirements; attempt advance again.
  - Expected: stage advances; `proposals.stage` updated; `proposal_stage_history` + `proposal_activity_log` rows written.

### 6.6 Comments

- [ ] **TU-11** — Leave a comment on a proposal.
  - Expected: `proposal_comments` row created; comment appears in activity feed.
  - Route: `POST /api/portal/[tenantSlug]/proposals/[proposalId]/comments` (if routed separately) or via proposal workspace.

### 6.7 Library

- [ ] **TU-12** — Upload a file to the content library.
  - Expected: `library_units` row created with `status=draft`; S3 `customers/[slug]/library/` object created.
  - Route: `POST /api/portal/[tenantSlug]/library/upload`; event: `library:file.uploaded:single`.

- [ ] **TU-13** — Atomize the uploaded document (trigger chunk extraction).
  - Expected: `library_units` rows updated with extracted atoms; event: `library:document.atomized:single`.
  - Route: `POST /api/portal/[tenantSlug]/library/atomize`.

**tenant_user total: 13 steps**

---

## 7. partner_user Walkthrough

**Role rank:** 1 — stage-scoped external collaborator; most restricted role.

### 7.1 Invite Acceptance

- [ ] **PU-01** — Open the invite link (`/invite/[token]`) from email; set a password.
  - Expected: page renders invite details (inviter name, proposal title, company); password form visible; no login required to view.
  - Tables on accept: `users`, `invitations`.

- [ ] **PU-02** — After accepting, redirect to `/portal/[slug]/proposals`.
  - Expected: ONLY proposals where this partner is listed in `proposal_collaborators` appear. No Dashboard, Spotlight, Pipeline, Library, Billing, or Team nav items visible (portal layout hides them for `partner_user`).

### 7.2 Stage-Scoped Access

- [ ] **PU-03** — Click into an assigned proposal.
  - Expected: only sections for stages granted in `collaborator_stage_access` are editable; sections outside granted stages show as read-only or hidden.
  - Table: `collaborator_stage_access`.

- [ ] **PU-04** — View a section the partner is authorized to view.
  - Expected: Tiptap canvas opens in correct mode (view/comment/edit per grant).

- [ ] **PU-05** — Leave a comment on a section.
  - Expected: comment created; `proposal_comments` row written.

### 7.3 Access Restriction Checks (Security)

- [ ] **PU-06** — Attempt to navigate to `/portal/[slug]/billing`.
  - Expected: redirect or 403. partner_user must NOT see billing data.

- [ ] **PU-07** — Attempt to navigate to `/portal/[slug]/spotlights`.
  - Expected: redirect or 403. partner_user is blocked from Spotlight by portal layout guard.

- [ ] **PU-08** — Attempt to call `GET /api/portal/[tenantSlug]/profile` as partner_user.
  - Expected: 403 response after FE-04 fix. If the fix is not applied this will return 200 with `billing_email` — a known security gap (P0-05). Confirm the fix is live.

- [ ] **PU-09** — Attempt to access a proposal section NOT in partner's `collaborator_stage_access`.
  - Expected: `lib/proposal-access.ts::resolveUserAccess()` returns `canView=false`; section content hidden or 403.

**partner_user total: 9 steps**

---

## 8. Cross-Cutting Workflow Flows

For each workflow: trigger the entry event manually or via the relevant UI action, then observe the `process_instances` row progress through steps. Use `/admin/workflows` to monitor.

| # | Template | Trigger event | Steps to observe | Expected HITL outcome |
|---|----------|--------------|------------------|-----------------------|
| CW-01 | `OnApplicationAccepted` | `capture:application.accepted:end` (via rfp_admin accept) | ACTION `create_library_defaults` → `HITL_WAIT` (TODO) | TODO appears in rfp_admin task inbox; advance via `POST /api/admin/workflows/[id]/advance` |
| CW-02 | `OnCmsContentRequested` | `library:content.requested:single` | ACTION `draft` → TODO (rfp_admin, 72h) → ACTION `publish` → NOTIFY | rfp_admin receives TODO; after completion content publishes |
| CW-03 | `OnOpportunitiesDetected` | `finder:opportunities.detected:single` (auto or manual trigger) | NOTIFY → TODO (rfp_admin, 72h) | Notification + open task in rfp_admin inbox |
| CW-04 | `OnProposalAdvancedToReview` | `proposal:proposal.advanced:end` (targetStage=review) | AI_INVOKE (will be **skipped** — dormant; see Appendix A) → NOTIFY → TODO (tenant_admin, 72h) | TODO in tenant_admin task queue; AI step logs `{skipped: true}` |
| CW-05 | `OnProposalAdvancedToFinal` | `proposal:proposal.advanced:end` (targetStage=final) | ACTION `generate_preview` → NOTIFY | Preview ZIP generated in S3; notification sent |
| CW-06 | `OnProposalCreated` | `proposal:proposal.created:end` | NOTIFY only | Notification written (note: docstring claims AI_INVOKE but code is NOTIFY-only) |
| CW-07 | `OnRfpUploaded` | `finder:rfp.uploaded:end` (via rfp_admin upload) | ACTION `shred_document` (3 retries) → ACTION `extract_compliance` → NOTIFY | After shredding, `solicitation_compliance` populated; curator notified |
| CW-08 | `OnSolicitationPushed` | `finder:solicitation.pushed:single` (via rfp_admin push) | ACTION `match_tenants` scoring → NOTIFY | `tenant_pipeline_items` upserted; tenants above score threshold see opportunity in Spotlight |
| CW-09 | `OnSourceChangeDetected` | `finder:source.change_detected:single` (via scout job) | ACTION `create_draft_solicitations` → NOTIFY → TODO (rfp_admin, 24h wait_for source_diff.reviewed) | Draft solicitations created; rfp_admin receives 24h TODO |

### Checkbox: Resume a HITL Wait

- [ ] **CW-10** — Confirm HITL resume: find a `process_instances` row with `status=paused` (at a `HITL_WAIT` step); call `POST /api/admin/workflows/[instanceId]/advance`. Verify `process_instance_transitions` shows the `paused → running → completed` path. Tables: `process_instances`, `process_instance_transitions`, `tasks`.

---

## 9. Verify In-House — Items NOT Covered by Automated Suite

The following must be **manually signed off** before launch. None of these are validated by vitest, pytest, or playwright CI jobs.

### 9.1 Stripe Webhook (CRITICAL — zero test coverage; P0-08)

- [ ] **VH-01** — Use the Stripe CLI (`stripe listen --forward-to localhost:3000/api/stripe/webhook`) in test mode.
- [ ] **VH-02** — Complete a Stripe test checkout; confirm the webhook fires and `checkout.session.completed` is processed.
- [ ] **VH-03** — Confirm the `sql.begin` 6-table transaction commits: `purchases` row created, `proposals` row created, `proposal_sections` rows created, S3 prefix provisioned.
- [ ] **VH-04** — Simulate a bad HMAC signature (tamper the payload); confirm the route returns `400` and writes no DB rows.

### 9.2 `proposals/create` Transaction Integrity (CRITICAL — zero test coverage; P0-14)

- [ ] **VH-05** — Purchase a proposal as tenant_admin; confirm ALL of the following exist in a single atomic write: `proposals`, `proposal_sections` (all sections from the solicitation outline), `proposal_collaborators` (tenant_admin as owner), S3 `customers/[slug]/proposals/[id]/` prefix with `rfp-snapshot/`, `compliance.json`, `manifest.json`.
- [ ] **VH-06** — Query `SELECT * FROM proposals WHERE id = '[new_id]'` and confirm `source_solicitation_id` is correctly linked.

### 9.3 Auth — Real Login Verification (unit test covers logic mirror only; P0-13)

- [ ] **VH-07** — Log in as each of the 5 roles; confirm JWT payload contains correct `{ id, role, tenantId, tenantSlug, tempPassword }`.
- [ ] **VH-08** — Log in with wrong password; confirm `identity:user.login_failed:single` event is written to `system_events`.
- [ ] **VH-09** — Confirm session expires after 8 hours (or test by manipulating `maxAge`).
- [ ] **VH-10** — Confirm temp password enforcement: user with `tempPassword=true` is redirected to `/change-password` on every protected page, and API routes return `403` until password is changed.

### 9.4 Email Send via Gmail (CMS email_queue worker)

- [ ] **VH-11** — Accept a test application (step RA-02); confirm the welcome email arrives at the invitee's inbox. Requires `GOOGLE_SERVICE_ACCOUNT_JSON` to be set and authorized.
- [ ] **VH-12** — Invite a partner_user (step TA-09); confirm the invite email arrives with a valid `/invite/[token]` link.
- [ ] **VH-13** — Trigger a password reset; confirm the reset email arrives with a valid token.

### 9.5 pgvector Memory (functional but zero coverage; P3 V2 embeddings)

- [ ] **VH-14** — After saving a compliance variable (step RA-10), query `SELECT * FROM episodic_memories WHERE tenant_id IS NULL ORDER BY created_at DESC LIMIT 5;` and confirm a row was written.
- [ ] **VH-15** — Call the `memory.search` tool via `POST /api/tools/memory.search`; confirm it returns results using ILIKE text search (vector similarity is V2 — embeddings are zero-vector placeholders in V1).

### 9.6 Pipeline Agent Workforce — Confirm Dormant (NOT wired)

- [ ] **VH-16** — Confirm AI features come from the frontend, not the pipeline agents. Query `SELECT * FROM agent_task_log ORDER BY created_at DESC LIMIT 10;` — the table should be empty or have no recent entries corresponding to proposal drafting. All AI draft and compliance calls come from the frontend's direct Anthropic calls, not from the dormant agent workforce. See Appendix A.

### 9.7 Social Posting — Confirm Graceful Failure (CMS social_poster stub)

- [ ] **VH-17** — If a `distribute_social` automation rule fires, confirm the CMS `social_poster` worker marks the post as `failed` with `reason=oauth_not_configured` rather than crashing the worker loop. Query `SELECT status, error FROM cms.social_posts ORDER BY created_at DESC LIMIT 5;`. See Appendix A.

### 9.8 S3/R2 Object Integrity

- [ ] **VH-18** — After RFP upload and shredding, confirm the S3 key scheme: `rfp-pipeline/[opp_id]/source.pdf`, `text.md`, `metadata.json`, and `shredded/*.md` files all exist in R2.
- [ ] **VH-19** — Confirm `assertKeyBelongsToTenant()` blocks a portal route from accessing another tenant's S3 prefix. Attempt a signed URL request for a key outside the requesting tenant's `customers/[other-slug]/` prefix; confirm 403.

---

## 10. Appendix A — Known-Dormant / V2 Items

Do not expect these features to work. The tester should confirm they are dormant, not debug them.

| Item | Status | Why dormant |
|------|--------|------------|
| Pipeline agent workforce (10 archetypes) | 🟦 Built-but-dormant | `AgentFabric` is instantiated in `main.py:72` as a local variable but never passed to the workflow processor; `invoke_agent()` is never called at runtime. Wiring is P3. |
| `AI_INVOKE` workflow steps | 🟦 Always skipped | `_execute_ai_invoke()` in `processor.py` always returns `{skipped: True}`. `OnProposalAdvancedToReview` AI compliance check never runs. |
| `agent_task_queue` consumer | 🟦 Never scheduled | `AgentFabric.process_task_queue()` is implemented but not added to the asyncio gather loop. |
| `DiffAnalyzer` / `OutcomeAttributor` | 💀 No caller | No `OnProposalSectionEdited` or `OnProposalOutcomeRecorded` workflow exists yet. Learning flywheel is wired but not triggered. |
| Social posting — LinkedIn/Twitter | 🔴 Stub | `social_poster.py` adapters raise `NotImplementedError`. Posts are queued in the DB but never sent. CMS-01 fix wraps this gracefully; the tester should confirm `failed` status rather than a crashed worker. |
| Recurring CMS campaigns | 🟡 Partial | `campaign_executor.py:342` defers recurring campaigns to V2. One-time campaigns work; recurring does not. |
| PPTX/XLSX export | 🟦 Unwired | `pptx-exporter.ts` and `xlsx-exporter.ts` exist but are not connected to any export route. Only DOCX export is live. |
| `/api/portal/[tenantSlug]/agents/config` | 🟦 501 stub | Returns 501. Agent configuration UI renders but the API is unimplemented (P2-18). |
| `pgvector` semantic search | 🟦 Zero-vector V1 | Memory tables have HNSW indexes but all stored embeddings are zero-vector placeholders. Similarity search is ILIKE text-only. Real embeddings are Phase 4. |
| `ScoringEngine` class in `scoring/engine.py` | 💀 Dead code | Zero callers confirmed by grep. Live scoring is `match_tenants()` in `workflows/actions/score_tenants.py`. |
