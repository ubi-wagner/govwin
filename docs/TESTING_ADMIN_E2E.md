# Admin End-to-End Testing Guide -- RFP Curation Pipeline

**Tester role:** Eric (master_admin)
**Environments:**

| Environment | Base URL |
|-------------|----------|
| Production  | `https://govtech-frontend-production.up.railway.app` |
| Staging     | `https://govtech-frontend-staging.up.railway.app` |

Throughout this guide, `{BASE_URL}` is a placeholder for whichever environment you are testing against. Replace it mentally or with find-and-replace in your browser.

---

## 1. Login & Dashboard

**Goal:** Verify admin authentication and the dashboard overview loads correctly.

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to [{BASE_URL}/login]({BASE_URL}/login) | Login page renders with email + password fields |
| 2 | Enter master_admin credentials (Eric's email + password) | Form accepts input |
| 3 | Click "Sign In" | Redirect to admin dashboard |
| 4 | Verify dashboard at [{BASE_URL}/admin/dashboard]({BASE_URL}/admin/dashboard) | Page loads without errors |
| 5 | Check stat cards | 8 stat cards visible (e.g., Active Solicitations, Pending Applications, Topics Published, Proposals in Progress, etc.) |
| 6 | Check recent event stream | Most recent `system_events` displayed with namespace, type, actor, timestamp |
| 7 | Check pending action alerts | Any items requiring admin attention (unclaimed solicitations, pending applications) are surfaced |

**Clickable link:** [{BASE_URL}/admin/dashboard]({BASE_URL}/admin/dashboard)

---

## 2. Set Up Source Monitoring

**Goal:** Configure an intelligence source profile with regions and auto-crawl, then trigger a manual scout.

> :warning: **Prerequisite:** You must be logged in as master_admin (Step 1).

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to Sources Hub: [{BASE_URL}/admin/sources]({BASE_URL}/admin/sources) | Sources page loads |
| 2 | Verify pre-seeded source profiles | 6 profiles visible: DSIP, AFWERX, xTech, NSF, SAM.gov, Defense SBIR |
| 3 | Click into the DSIP source profile | Detail page loads at `{BASE_URL}/admin/sources/{dsip-profile-id}` |
| 4 | Add a region: name=`Active Topics`, type=`listing`, context=`This page lists active BAA topics. Alert me when new topic numbers appear.` | Region appears in the regions list |
| 5 | Enable auto-crawl: set schedule to `daily` at `6:00 AM` | Schedule saved, toggle shows "enabled" |
| 6 | Click "Scout Now" | Job enqueued confirmation (toast or status indicator) |
| 7 | Navigate back to Sources Hub: [{BASE_URL}/admin/sources]({BASE_URL}/admin/sources) | Recent Changes feed shows scout results (new/changed pages detected) |

**Placeholder values:**
- `{dsip-profile-id}` -- the UUID of the DSIP source profile (visible in the URL when you click into it)

**Clickable link:** [{BASE_URL}/admin/sources]({BASE_URL}/admin/sources)

---

## 3. Upload an RFP Manually

**Goal:** Upload a BAA preface PDF and verify it enters the curation pipeline.

> :warning: **Prerequisite:** You must be logged in as master_admin (Step 1). Have a BAA preface PDF ready (e.g., `DoD 25.2 SBIR BAA FULL_04212025.pdf`).

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to RFP Upload: [{BASE_URL}/admin/rfp-curation/upload]({BASE_URL}/admin/rfp-curation/upload) | Upload form renders |
| 2 | Click "Choose File" and select a BAA preface PDF | File name appears in the upload widget |
| 3 | Fill metadata fields: | All fields accept input |
|   | - Title: `DoD SBIR 25.2 BAA Preface` | |
|   | - Agency: `Department of Defense` | |
|   | - Program type: `sbir_phase_1` | |
| 4 | Click "Upload" / "Submit" | Upload progress indicator, then redirect to curation workspace |
| 5 | Verify redirect URL | `{BASE_URL}/admin/rfp-curation/{solId}` where `{solId}` is the newly created solicitation UUID |
| 6 | Verify document listed | Uploaded PDF appears in the Documents tab |
| 7 | Verify text extraction | `extracted_text` field populated (visible in document detail or status badge) |
| 8 | Verify topic auto-extraction | Topics tab shows auto-extracted topics (if the pipeline shredder ran) |

**Events emitted:**
- `finder:rfp.uploaded:start` -- upload begins
- `finder:rfp.uploaded:end` -- upload completes (triggers `OnRfpUploaded` workflow: shred -> compliance -> notify)

**Placeholder values:**
- `{solId}` -- the UUID of the newly created curated_solicitation (visible in the URL after redirect)

**Clickable link:** [{BASE_URL}/admin/rfp-curation/upload]({BASE_URL}/admin/rfp-curation/upload)

---

## 4. Curate the RFP

**Goal:** Fully curate a solicitation: claim it, set compliance variables, add volumes, and push to Spotlight.

> :warning: **Prerequisite:** An RFP must already be uploaded and visible in the curation list (Step 3). You need the `{solId}` from the upload step.

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to the curation workspace: `{BASE_URL}/admin/rfp-curation/{solId}` | Workspace loads with quick-nav tabs: Documents, Topics, Compliance, Customer Interest |
| **Documents Tab** | | |
| 2 | Click "Documents" tab | List of attached documents |
| 3 | Verify uploaded PDF is listed | PDF shows with document type badge and file size |
| 4 | Verify primary document star | The uploaded PDF should have a primary star (is_primary=true) or you can set it |
| **Topics Tab** | | |
| 5 | Click "Topics" tab | List of auto-extracted topics (if shredder ran) |
| 6 | Verify topic fields | Each topic shows: topic_number, title, tech_focus_areas |
| 7 | (Optional) Add a manual topic | Click "Add Topic", fill fields, save. Topic appears in list. |
| 8 | Click into a topic detail | Navigate to `{BASE_URL}/admin/rfp-curation/{solId}/topic/{topicId}` |
| **Claim Ownership** | | |
| 9 | Click "Claim" button | Status changes to `claimed`, claimed_by set to your user ID |
| 10 | Verify claim badge | Your name appears as the curator |
| **Compliance Tab** | | |
| 11 | Click "Compliance" tab | Compliance variables panel |
| 12 | Use the PDF viewer to select text relevant to compliance | Selection highlight appears |
| 13 | Tag selected text as compliance variables: | Variables saved |
|    | - Page limit: `15` | |
|    | - Font: `Times New Roman 10pt` | |
|    | - Margins: `1 inch all sides` | |
| **Volumes** | | |
| 14 | Add Volume 1: Technical Volume | Volume appears in volume list with volume_number=1 |
| 15 | Add Volume 2: Cost Volume | Volume appears with volume_number=2 |
| 16 | In Technical Volume, add required items: | Items appear in required items list |
|    | - Item 1: "Technical Approach" (page_limit=5) | |
|    | - Item 2: "Key Personnel" (page_limit=3) | |
|    | - Item 3: "Past Performance" (page_limit=3) | |
| 17 | In Cost Volume, add required items: | Items saved |
|    | - Item 1: "Cost Breakdown" (page_limit=4) | |
| **Review & Approve** | | |
| 18 | Click "Request Review" | Status changes to `review_requested`. If solo admin, you may "Approve" directly. |
| 19 | Click "Approve" (if available) | Status changes to `approved` |
| **Push to Spotlight** | | |
| 20 | Click "Push to Spotlight" | Status changes to `pushed`. Topics now visible to customers in Spotlight feed. |

**Events emitted (verify in Step 5):**
- `finder:solicitation.claimed:single`
- `finder:annotation.saved:single` (per compliance variable)
- `finder:solicitation.review_requested:single`
- `finder:solicitation.approved:single`
- `finder:solicitation.pushed:single` (triggers `OnSolicitationPushed` workflow)

> **Release 1 of two.** "Push to Spotlight" is **Release 1** -- it makes the opportunity discoverable
> and ranked on every tenant's card feed (`/portal/[slug]/cards`), and the push gate now requires a
> non-empty **`spotlight_summary`** in addition to `submission_format`. The proposal-portal skeleton
> is **Release 2** (see Step 4b).

**Placeholder values:**
- `{solId}` -- UUID from Step 3
- `{topicId}` -- UUID of any topic (visible in URL when clicking into a topic)

**Clickable links:**
- Curation workspace: `{BASE_URL}/admin/rfp-curation/{solId}`
- Topic detail: `{BASE_URL}/admin/rfp-curation/{solId}/topic/{topicId}`

---

## 4b. Purchase Curation & Release (Release 2 -- Shadow Curation)

**Goal:** Resolve a customer's "purchase needs curation" ToDo, build/review the proposal-portal
skeleton, and release the workspace (provisioned unlocked → V0).

> :warning: **Prerequisite:** A customer has pinned an opportunity and purchased a portal with the
> comp code `rfppipelinetest` (see Customer E2E Guide, Step 8). Step 4's push is **Release 1
> (Spotlight)**; this is **Release 2 (Proposal portal)**. Design:
> [`MASTER_MIRROR_OPP_DESIGN.md`](./MASTER_MIRROR_OPP_DESIGN.md); click spine:
> [`HITL_IMMOBILEYES_CLICKPLAN.md`](./HITL_IMMOBILEYES_CLICKPLAN.md); full script:
> [`ALPHA_HITL_RUNBOOK.md`](./ALPHA_HITL_RUNBOOK.md).

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to `{BASE_URL}/admin/rfp-curation` | Triage view loads; the **"Purchase -- needs curation"** ToDo is surfaced (the one tenant-scoped `proposal_setup` task) |
| 2 | Verify the purchase is recorded | `{BASE_URL}/admin/purchases` shows a `$0` completed purchase with the comp code |
| 3 | Click the ToDo | Routes you (shadow admin) into the buyer's RLS-scoped tenant |
| 4 | Build or review the master skeleton | If built in advance (Step 4 volumes/compliance + molds): ~15-min review. Else build now -- the **72h SLA covers skeletoning only** |
| 5 | **Release** the portal (`?action=release`) | Portal `curation_pending → launched`; `provisionProposalForPortal` provisions **UNLOCKED** |
| 6 | Verify provisioning | `proposals` + `proposal_artifacts` per volume + `proposal_sections` per required item + per-tenant `proposal_compliance_matrix` (rows `not_addressed`); molds interpolated |
| 7 | Verify auto-draft | `OnProposalCreated → draft_v0` drafts empty/`ai_drafted` sections via `section_drafter` (needs the pipeline worker + `ANTHROPIC_API_KEY`) |

**Events emitted:**
- `capture:purchase.completed:single` -- at purchase (portal → `curation_pending`)
- `capture:workspace.released:single` -- on release → provisioning

> **⚠ Security gap.** `shadow_admin_grants` (mig 097) was meant to be the enforced gate, but
> `verifyTenantAccess` (`lib/db.ts:52`) still grants any admin a global god-view -- so today the grant
> is auditable/revocable metadata, not the enforcement. Retiring the god-view is a tracked ToDo.

**Clickable links:**
- `{BASE_URL}/admin/rfp-curation`
- `{BASE_URL}/admin/purchases`

---

## 5. Verify Event Stream

**Goal:** Confirm that all admin actions from Steps 2-4 generated properly structured events.

> :warning: **Prerequisite:** Steps 2-4 must be completed so that events exist to verify.

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to Event Stream: [{BASE_URL}/admin/events]({BASE_URL}/admin/events) | Event stream page loads |
| 2 | Filter by namespace: `finder` | Only finder-namespace events shown |
| 3 | Locate `rfp.uploaded` start event | Event visible with phase=`start`, actor=your user ID |
| 4 | Locate `rfp.uploaded` end event | Event visible with phase=`end`, `parent_event_id` pointing to the start event |
| 5 | Locate `solicitation.claimed` event | phase=`single`, payload includes `solicitationId` |
| 6 | Locate `solicitation.approved` event | phase=`single`, payload includes `solicitationId` |
| 7 | Locate `solicitation.pushed` event | phase=`single`, payload includes `solicitationId` and `topicCount` |
| 8 | Verify each event has required fields | `correlationId` in payload, `actor_type`, `actor_id`, `created_at` all present |
| 9 | (Optional) Filter by namespace: `system` | Check for `file.uploaded` events from the PDF upload |

**Clickable link:** [{BASE_URL}/admin/events]({BASE_URL}/admin/events)

---

## 6. Verify Pipeline Jobs

**Goal:** Confirm ingestion schedules are configured and the shred job ran for the uploaded RFP.

> :warning: **Prerequisite:** Step 3 (RFP upload) must be completed.

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to Pipeline: [{BASE_URL}/admin/pipeline]({BASE_URL}/admin/pipeline) | Pipeline jobs page loads |
| 2 | Check ingester schedules | Visible schedules: SAM.gov (daily), SBIR.gov (weekly), DSIP (daily, if configured in Step 2) |
| 3 | Locate the shred job for your uploaded RFP | Job visible with status `completed` (or `running` if still in progress) |
| 4 | Verify job details | Job references the correct `solicitationId`, shows step results (documents shredded, compliance extracted) |
| 5 | Check for `OnRfpUploaded` workflow instance | Process instance created with steps: shred_document, extract_compliance, notify_curator |

**Clickable link:** [{BASE_URL}/admin/pipeline]({BASE_URL}/admin/pipeline)

---

## 7. Verify System Health

**Goal:** Confirm all services and infrastructure are operational.

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to System Health: [{BASE_URL}/admin/system]({BASE_URL}/admin/system) | System health page loads |
| 2 | Check service status | All services show "online" / green status |
| 3 | Check database connections | PostgreSQL connection pool healthy, no stale connections |
| 4 | Check queue depths | Job queues at normal levels (no excessive backlog) |
| 5 | Check error count | Zero or low recent errors. Investigate any non-zero errors. |
| 6 | Check S3 storage | Storage bucket accessible, recent uploads visible |

**Clickable link:** [{BASE_URL}/admin/system]({BASE_URL}/admin/system)

---

## 8. Admin Applications Management

**Goal:** Verify the admin can view and process customer applications (used in the Customer E2E guide).

> :warning: **Prerequisite:** A customer must have submitted an application (see Customer E2E Guide, Step 1).

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to Applications: [{BASE_URL}/admin/applications]({BASE_URL}/admin/applications) | Applications list loads |
| 2 | Locate the submitted application | Application visible with status `pending` |
| 3 | Review application details | Company name, contact email, NAICS codes, website, description visible |
| 4 | Click "Accept" | Application status changes to `accepted` |
| 5 | Verify tenant created | New tenant visible at [{BASE_URL}/admin/tenants]({BASE_URL}/admin/tenants) |
| 6 | Verify user created | New user with `temp_password=true` associated with the tenant |
| 7 | (Optional) Check CRM logs | Welcome email dispatched to applicant |

**Events emitted:**
- `capture:application.accepted:start` -- acceptance begins
- `capture:application.accepted:end` -- acceptance completes (triggers `OnApplicationAccepted` workflow)

**Clickable links:**
- [{BASE_URL}/admin/applications]({BASE_URL}/admin/applications)
- [{BASE_URL}/admin/tenants]({BASE_URL}/admin/tenants)

---

## 9. Tenant Management

**Goal:** Verify tenant detail page and tenant data.

> :warning: **Prerequisite:** A tenant must exist (Step 8 or pre-seeded data).

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to Tenants: [{BASE_URL}/admin/tenants]({BASE_URL}/admin/tenants) | Tenant list loads |
| 2 | Click into a tenant | Detail page at `{BASE_URL}/admin/tenants/{tenantId}` |
| 3 | Verify tenant fields | name, slug, legal_name, website, status, product_tier, billing_email, stripe_customer_id |
| 4 | Verify associated users | List of users belonging to this tenant with roles |
| 5 | Verify subscription status | Current subscription_status and trial_ends_at (if applicable) |

**Placeholder values:**
- `{tenantId}` -- UUID of the tenant (visible in URL)

**Clickable link:** [{BASE_URL}/admin/tenants]({BASE_URL}/admin/tenants)

---

## 10. Content & Storage Management

**Goal:** Verify CMS content and S3 storage pages function.

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to CMS Content: [{BASE_URL}/admin/content]({BASE_URL}/admin/content) | Content management page loads |
| 2 | Navigate to S3 Storage: [{BASE_URL}/admin/storage]({BASE_URL}/admin/storage) | Storage browser loads, showing bucket contents |
| 3 | Verify three head folders visible | `rfp-admin/`, `rfp-pipeline/`, `customers/` |
| 4 | Navigate into `rfp-pipeline/` | Solicitation artifacts visible (if Step 3 completed) |

**Clickable links:**
- [{BASE_URL}/admin/content]({BASE_URL}/admin/content)
- [{BASE_URL}/admin/storage]({BASE_URL}/admin/storage)

---

## 11. CMS Visual Page Editor

**Goal:** Verify the CMS SPA visual page editor, content review workflow, and the redirect from admin content page to the CMS Portal.

> :warning: **Prerequisite:** You must be logged in as master_admin (Step 1).

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to [{BASE_URL}/admin/content]({BASE_URL}/admin/content) | Content management page loads |
| 2 | Verify "Open in CMS Portal" link is visible | Link present, pointing to CMS SPA `/pages` editor |
| 3 | Click "Open in CMS Portal" | CMS SPA visual page editor loads (may open in new tab) |
| 4 | Navigate to [{BASE_URL}/admin/content/editor]({BASE_URL}/admin/content/editor) directly | Redirects to or renders the CMS SPA page editor |
| 5 | Verify page list is displayed | All managed pages visible with block counts and statuses |
| 6 | Click into a page | Block editor opens showing ordered content blocks |
| 7 | Add a blank block | New empty block appears at the correct position |
| 8 | Edit the new block's content | Block body accepts input and renders preview |
| 9 | Move a block up | Block reorders correctly, sort_order updated |
| 10 | Move a block down | Block reorders correctly |
| 11 | Save as draft | Draft saved, status badge shows "draft" |
| 12 | Click "Submit for Review" | Status changes to "submitted_for_review" |
| 13 | Click "Approve" (as reviewer) | Status changes to "approved" |
| 14 | Click "Publish" | Content published, ISR revalidation triggered |
| 15 | Navigate to the corresponding public page | Updated content visible within 60 seconds |
| 16 | Return to editor, click "Reject" on a submitted item | Status returns to "draft", rejection reason visible |
| 17 | Test AI Generate: click AI generate button, enter prompt | AI-generated content appears in block body |
| 18 | Test AI Revise: select existing block, click revise | Revised content returned as suggestion |
| 19 | Test AI from URL: enter an external URL, click generate | Content extracted and generated from URL |

**Content review workflow state machine:**
```
draft -> submitted_for_review -> approved -> published
                              -> rejected -> draft
```

**Events emitted:**
- `system:content.submitted_for_review` -- content submitted
- `system:content.approved` -- content approved
- `system:content.rejected` -- content rejected
- `system:content.published` -- content published (triggers ISR revalidation)

**Clickable links:**
- [{BASE_URL}/admin/content]({BASE_URL}/admin/content)
- [{BASE_URL}/admin/content/editor]({BASE_URL}/admin/content/editor)

---

## 12. System-State Dashboard -- Content Pipeline & Email Automation Tabs

**Goal:** Verify the two new tabs on the system-state dashboard: Content Pipeline and Email Automation.

> :warning: **Prerequisite:** You must be logged in as master_admin (Step 1). CMS content and email automation activity should exist from Steps 11 and earlier testing.

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to [{BASE_URL}/admin/system-state]({BASE_URL}/admin/system-state) | System-state dashboard loads with all tabs visible |
| **Content Pipeline Tab** | | |
| 2 | Click the "Content Pipeline" tab | Tab activates, content pipeline view renders |
| 3 | Verify block status summary | Counts displayed for each status: draft, submitted_for_review, approved, published |
| 4 | Verify recent content events | Table of recent `system:content.*` events with timestamps, actor, and content ID |
| 5 | Verify content types breakdown | Blog posts vs. page blocks counts shown |
| **Email Automation Tab** | | |
| 6 | Click the "Email Automation" tab | Tab activates, email automation view renders |
| 7 | Verify rule execution log | Table of automation rule executions with: rule name, trigger event, execution time, result (success/failure) |
| 8 | Verify email events displayed | Recent `system:email.*` events shown: queued, sent, rejected, failed |
| 9 | Verify rule status indicators | Active rules show green indicator, paused rules show yellow |
| 10 | Check for error counts | Any failed rule executions highlighted with error details |

**Clickable link:** [{BASE_URL}/admin/system-state]({BASE_URL}/admin/system-state)

---

## 13. Admin Sidebar -- Automation & Email Outbox

**Goal:** Verify the reorganized admin sidebar includes direct links to Automation and Email Outbox pages.

> :warning: **Prerequisite:** You must be logged in as master_admin (Step 1).

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Inspect the admin sidebar navigation | Sidebar renders with all sections |
| 2 | Verify "Automation" link is visible in sidebar | Link present under the appropriate nav section |
| 3 | Click "Automation" | Navigates to [{BASE_URL}/admin/automation]({BASE_URL}/admin/automation) |
| 4 | Verify automation page loads | Page renders with automation rules list, rule creation form, and execution log |
| 5 | Navigate back via sidebar | Sidebar still visible and functional |
| 6 | Verify "Email Outbox" link is visible in sidebar | Link present under the appropriate nav section |
| 7 | Click "Email Outbox" | Navigates to [{BASE_URL}/admin/email-outbox]({BASE_URL}/admin/email-outbox) |
| 8 | Verify email outbox page loads | Page renders with pending/claimed/sent email list, approve/reject buttons per email |
| 9 | Verify outbox count badge (if emails are pending) | Badge shows count of pending emails next to nav link |

**Clickable links:**
- [{BASE_URL}/admin/automation]({BASE_URL}/admin/automation)
- [{BASE_URL}/admin/email-outbox]({BASE_URL}/admin/email-outbox)

---

## Quick Reference: All Admin Routes

| Page | URL | Nav Section |
|------|-----|-------------|
| Dashboard | [{BASE_URL}/admin/dashboard]({BASE_URL}/admin/dashboard) | Operations |
| Applications | [{BASE_URL}/admin/applications]({BASE_URL}/admin/applications) | Operations |
| RFP Curation | [{BASE_URL}/admin/rfp-curation]({BASE_URL}/admin/rfp-curation) | Operations |
| RFP Upload | [{BASE_URL}/admin/rfp-curation/upload]({BASE_URL}/admin/rfp-curation/upload) | Operations |
| Tenants | [{BASE_URL}/admin/tenants]({BASE_URL}/admin/tenants) | Operations |
| Purchases | [{BASE_URL}/admin/purchases]({BASE_URL}/admin/purchases) | Operations |
| Automation | [{BASE_URL}/admin/automation]({BASE_URL}/admin/automation) | Operations |
| Email Outbox | [{BASE_URL}/admin/email-outbox]({BASE_URL}/admin/email-outbox) | Operations |
| Event Stream | [{BASE_URL}/admin/events]({BASE_URL}/admin/events) | Monitoring |
| Pipeline Jobs | [{BASE_URL}/admin/pipeline]({BASE_URL}/admin/pipeline) | Monitoring |
| System Health | [{BASE_URL}/admin/system]({BASE_URL}/admin/system) | Monitoring |
| System State | [{BASE_URL}/admin/system-state]({BASE_URL}/admin/system-state) | Monitoring |
| Sources | [{BASE_URL}/admin/sources]({BASE_URL}/admin/sources) | Intelligence |
| CMS Content | [{BASE_URL}/admin/content]({BASE_URL}/admin/content) | Content |
| CMS Editor | [{BASE_URL}/admin/content/editor]({BASE_URL}/admin/content/editor) | Content |
| S3 Storage | [{BASE_URL}/admin/storage]({BASE_URL}/admin/storage) | Content |

---

## Troubleshooting

| Symptom | Likely Cause | Action |
|---------|--------------|--------|
| Login redirects back to /login | Session expired or invalid credentials | Clear cookies, re-enter credentials |
| Dashboard shows 0 for all stats | Database connection issue or empty DB | Check [{BASE_URL}/admin/system]({BASE_URL}/admin/system) for DB health |
| Upload fails silently | S3 credentials missing or bucket misconfigured | Check Railway env vars: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` |
| Shred job never completes | Pipeline service down or ANTHROPIC_API_KEY missing | Check Pipeline service status on Railway |
| Push to Spotlight succeeds but topics not visible to customer | Topics not linked via `solicitation_id` | Verify `opportunities` rows have `solicitation_id = {solId}` |
| Events not appearing in stream | Event emission silently failed | Check server logs for `[events]` tagged errors |
