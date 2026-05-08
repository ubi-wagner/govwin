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

**Placeholder values:**
- `{solId}` -- UUID from Step 3
- `{topicId}` -- UUID of any topic (visible in URL when clicking into a topic)

**Clickable links:**
- Curation workspace: `{BASE_URL}/admin/rfp-curation/{solId}`
- Topic detail: `{BASE_URL}/admin/rfp-curation/{solId}/topic/{topicId}`

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

## Quick Reference: All Admin Routes

| Page | URL | Nav Section |
|------|-----|-------------|
| Dashboard | [{BASE_URL}/admin/dashboard]({BASE_URL}/admin/dashboard) | Operations |
| Applications | [{BASE_URL}/admin/applications]({BASE_URL}/admin/applications) | Operations |
| RFP Curation | [{BASE_URL}/admin/rfp-curation]({BASE_URL}/admin/rfp-curation) | Operations |
| RFP Upload | [{BASE_URL}/admin/rfp-curation/upload]({BASE_URL}/admin/rfp-curation/upload) | Operations |
| Tenants | [{BASE_URL}/admin/tenants]({BASE_URL}/admin/tenants) | Operations |
| Purchases | [{BASE_URL}/admin/purchases]({BASE_URL}/admin/purchases) | Operations |
| Event Stream | [{BASE_URL}/admin/events]({BASE_URL}/admin/events) | Monitoring |
| Pipeline Jobs | [{BASE_URL}/admin/pipeline]({BASE_URL}/admin/pipeline) | Monitoring |
| System Health | [{BASE_URL}/admin/system]({BASE_URL}/admin/system) | Monitoring |
| Sources | [{BASE_URL}/admin/sources]({BASE_URL}/admin/sources) | Intelligence |
| CMS Content | [{BASE_URL}/admin/content]({BASE_URL}/admin/content) | Content |
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
