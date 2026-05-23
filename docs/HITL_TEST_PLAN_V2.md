# V1 HITL Test Plan -- Pre-Launch Validation

**Version:** 2.0
**Date:** 2026-05-23
**Launch Target:** June 1, 2026
**Scope:** All 15 user journeys across 6 structured test sessions
**Estimated Total Time:** 5-6 hours (one tester) or 3 hours (two testers in parallel)

---

## Test Environment Setup

### Prerequisites

| Component | Version | Verification |
|-----------|---------|-------------|
| Node.js | 20+ | `node --version` |
| Python | 3.12+ | `python3 --version` |
| PostgreSQL | 15+ | `psql --version` or Railway dashboard |
| AWS CLI | 2.x | `aws --version` (for S3 bucket access) |
| Browser | Chrome 120+ or Firefox 120+ | DevTools available |

### Environment Variables

The following must be set in `frontend/.env.local` (or Railway environment):

```
DATABASE_URL=postgresql://...
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000  (or production URL)
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
S3_BUCKET=rfp-pipeline-prod-r8t7tr6
ANTHROPIC_API_KEY=...              (for AI features in Session 4)
FOUNDING_COHORT_BYPASS=true        (skips Stripe for proposal creation)
RESEND_API_KEY=...                 (or Gmail OAuth2 credentials for email)
```

### Seed Data

Before starting tests, verify:

1. **master_admin account exists** in `users` table with `role='master_admin'`, known password, `temp_password=false`
2. **Database migrations applied** through 047: `SELECT MAX(version) FROM schema_migrations` or count migration files
3. **S3 bucket accessible**: `aws s3 ls s3://rfp-pipeline-prod-r8t7tr6/ --max-items 1`
4. **At least one test PDF** available locally (real SBIR solicitation preferred, or any multi-page PDF)

### Browser Setup

- **Window A:** Admin session (logged in as master_admin)
- **Window B:** Incognito/private (for public forms and customer login)
- DevTools Console tab open in both windows to monitor for JS errors
- Network tab available for verifying API responses

### Starting the Application

```bash
cd frontend && npm run dev     # Development mode on localhost:3000
# OR
cd frontend && npm run build && npm start   # Production mode
```

For pipeline services (needed for Sessions 2 and 5):
```bash
cd pipeline && python -m src.main   # Starts cron, workflow processor, agent fabric
```

---

## Test Sessions

Sessions are ordered by dependency. Each session builds on state created by the previous one. Do not skip sessions or change the order.

---

### SESSION 1: Admin Foundation (45 min)

**Covers:** Journey 1 (Waitlist + Applications), admin dashboard, tenant management
**Roles tested:** master_admin, rfp_admin
**Routes:** `/login`, `/admin/dashboard`, `/admin/waitlist`, `/admin/applications`, `/admin/tenants`, `/apply`

---

#### Test 1.1: Admin Login + Dashboard

**Route:** `/login` then `/admin/dashboard`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/login` in Window A | Login form renders with email and password fields |
| 2 | Enter master_admin email + password | -- |
| 3 | Click "Sign In" | Redirect to `/admin/dashboard` |
| 4 | Inspect dashboard stat cards | 8 cards visible: Pending Applications, Active Tenants, Library Atoms, Active Proposals, RFPs in Curation, Events Today, SBIR Companies, SBIR Awards. Values are numbers (may be 0), not "unavailable" |
| 5 | Inspect Recent Events table | Table renders with columns: Time, Event, Phase, Actor. May be empty if fresh DB |
| 6 | Inspect Pending Actions sidebar | Shows: Pending applications count, Unclaimed RFPs count, Draft atoms awaiting review count |
| 7 | Click "Pending Applications" link | Navigates to `/admin/applications` |
| 8 | Use browser Back, click "View all" next to Recent Events | Navigates to `/admin/events` |
| 9 | Open DevTools Console | No errors logged |

**Pass criteria:** Dashboard renders all 8 stat cards with numeric values, Recent Events table renders, Pending Actions panel renders, no JS console errors.

---

#### Test 1.2: Waitlist Submission (Public)

**Route:** `/api/waitlist` (API-only, no public waitlist page)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | In Window A, navigate to `/admin/waitlist` | Page loads showing pending entries (may be empty): "No pending applications" message or list |
| 2 | Using curl or Postman, POST to `/api/waitlist`: `{"email":"test-waitlist@example.com", "company_name":"Test Corp"}` | 201 response with `{ data: { id: "..." } }` |
| 3 | In Window A, refresh `/admin/waitlist` | NOTE: Admin waitlist page queries `applications` table, not `waitlist` table. Waitlist entries appear in the DB `waitlist` table but the admin page shows applications. Confirm the POST succeeded via DB or API response |
| 4 | POST the same email again | 409 response with duplicate error (UNIQUE constraint on email) |
| 5 | POST with invalid email format | 400 response with `VALIDATION_ERROR` code |

**Pass criteria:** Waitlist API accepts valid submissions, rejects duplicates, validates input.

---

#### Test 1.3: Application Submission (Public)

**Route:** `/apply` (public) then `/admin/applications`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | In Window B (incognito), navigate to `/apply` | Application form renders with sections: Contact Info, Company Info, SAM Registration, Experience, Technology, Motivation, Terms |
| 2 | Fill required fields: contactName, contactEmail (`testapplicant1@example.com`), companyName ("Acme Defense Tech"), techSummary (min 20 chars), motivation (min 10 chars), referralSource, termsAccepted=true | -- |
| 3 | Fill optional fields: companyWebsite, companySize, companyState, techAreas (add 2-3), targetPrograms (select SBIR), targetAgencies (add "DoD"), desiredOutcomes | -- |
| 4 | Submit the form | Success confirmation message. API returns 201 |
| 5 | In Window A, navigate to `/admin/applications` | Page shows "Founding Cohort Applications" with count. New application visible with status "pending" |
| 6 | Verify application card shows: companyName, contactName, contactEmail, techSummary snippet, "Pending" badge, submission date | All fields rendered correctly |

**Pass criteria:** Public application form submits successfully, application appears in admin queue with status "pending".

---

#### Test 1.4: Accept Application

**Route:** `/admin/applications` -> `/api/admin/applications/[id]/accept`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | On `/admin/applications`, click the pending application from Test 1.3 | Application detail panel expands showing all submitted fields |
| 2 | Review all fields: contact info, company info, SAM details, experience, tech areas, target agencies, motivation | All data matches what was submitted |
| 3 | Click "Accept" button | Confirmation dialog or immediate action |
| 4 | Verify the acceptance transaction completed: | |
| 4a | -- Application status changes to "accepted" | Status badge updates |
| 4b | -- Check DB: new row in `tenants` table with `status='active'` | `SELECT * FROM tenants ORDER BY created_at DESC LIMIT 1` |
| 4c | -- Check DB: new row in `users` table with `role='tenant_admin'`, `temp_password=true` | `SELECT email, role, temp_password FROM users ORDER BY created_at DESC LIMIT 1` |
| 4d | -- Welcome email sent (check email inbox or Resend dashboard) | Email with temp password |
| 5 | Note the tenant slug from the `tenants` table | Record: `__________` |
| 6 | Note the temp password from the welcome email or admin notification | Record: `__________` |
| 7 | Check `/admin/events` | `capture:application.accepted` event logged |
| 8 | Check `/admin/workflows` | OnApplicationAccepted workflow instance visible (may show completed) |

**Pass criteria:** Accept creates tenant + user in a transaction, sets temp_password, emits event, triggers workflow.

---

#### Test 1.5: Reject Application

**Route:** `/admin/applications` -> `/api/admin/applications/[id]/reject`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | In Window B (incognito), submit another application via `/apply` with email `testapplicant2@example.com` | 201 success |
| 2 | In Window A, refresh `/admin/applications` | New application appears with "pending" status |
| 3 | Click the new application, then click "Reject" | Rejection reason field appears |
| 4 | Enter reason (min 10 characters): "Company focus does not align with our current program areas" | -- |
| 5 | Confirm rejection | Status changes to "rejected" |
| 6 | Verify: no tenant or user created for this application | DB check: no tenant with this company name |
| 7 | Verify rejection email sent (if email configured) | Email with rejection reason |
| 8 | Check `/admin/events` | `capture:application.rejected` event logged |

**Pass criteria:** Rejection updates status, does NOT create tenant/user, sends rejection email with reason.

---

#### Test 1.6: Tenant Management

**Route:** `/admin/tenants`, `/admin/tenants/[tenantId]`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/admin/tenants` | Tenant list renders. The accepted tenant from Test 1.4 appears |
| 2 | Verify tenant card shows: company name, slug, status ("active"), creation date | All fields populated |
| 3 | Click the tenant to navigate to detail page `/admin/tenants/[tenantId]` | Detail page loads |
| 4 | Verify detail page shows: tenant info, user count (should be 1), proposal count (should be 0), subscription status | All data correct |
| 5 | Return to tenant list via breadcrumb or browser Back | List renders correctly |

**Pass criteria:** Tenant appears in list, detail page shows correct user and proposal counts.

---

### SESSION 2: Source Scout + RFP Ingestion (60 min)

**Covers:** Journeys 2 (Source Scout), 3 (Ingestion), 4 (Manual Upload), 5 (Triage Queue), 6 (Curation Workspace), 7 (Topic Management)
**Roles tested:** master_admin, rfp_admin
**Routes:** `/admin/sources`, `/admin/sources/[profileId]`, `/admin/rfp-curation`, `/admin/rfp-curation/upload`, `/admin/rfp-curation/[solId]`, `/admin/rfp-curation/[solId]/topic/[topicId]`

---

#### Test 2.1: Source Profiles List

**Route:** `/admin/sources`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/admin/sources` | Page renders: "Opportunity Sources" heading, "+ New Solicitation" link to `/admin/rfp-curation/upload` |
| 2 | Verify the three-tab layout: source profile cards, recent activity feed, recent meaningful diffs | All panels render (may be empty) |
| 3 | If source profiles exist, verify each card shows: name, site type, base URL, agency, program type, visit count, last activity date | All fields populated for existing profiles |

**Pass criteria:** Sources page renders with all panels, no errors.

---

#### Test 2.2: Source Profile Detail + Regions

**Route:** `/admin/sources/[profileId]`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | If no source profiles exist, create one via the UI or API: POST to `/api/admin/sources` with `{"name":"AFWERX Test","baseUrl":"https://afwerx.af.mil","siteType":"agency_portal","agency":"Air Force","programType":"SBIR"}` | 201 response with profile ID |
| 2 | Navigate to `/admin/sources/[profileId]` | Detail page loads showing profile info, regions list, visit history, diffs |
| 3 | Add a region: POST to `/api/admin/sources/[profileId]/regions` with `{"cssSelector":".topic-list","label":"Topics","guidance":"Look for new topic announcements","name":"Topic List Region"}` | Region created, appears in regions list |
| 4 | Verify region shows: CSS selector, label, guidance text | All fields displayed |

**Pass criteria:** Source profile detail page renders, regions can be added and display correctly.

---

#### Test 2.3: Trigger Scout (if Source Scout infrastructure is running)

**Route:** `/api/admin/sources/[profileId]/scout`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Run Scout" or POST to `/api/admin/sources/[profileId]/scout` | Scout job starts. Response: `{ data: { jobId, status } }` |
| 2 | Wait for completion (30-60 seconds) | Job completes |
| 3 | Refresh source detail page | New snapshot visible in history, diff analysis shown if changes detected |
| 4 | If meaningful changes found, verify diff summary appears with severity rating | Diff card shows summary, severity badge, region name |
| 5 | Check `/admin/workflows` | If changes detected: OnSourceChangeDetected workflow instance visible |

**Pass criteria:** Scout completes without error, results recorded. Skip if network access restricted.

---

#### Test 2.4: Manual RFP Upload

**Route:** `/admin/rfp-curation/upload`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/admin/rfp-curation/upload` | Upload form renders: back link to triage queue, file upload area, metadata fields |
| 2 | Upload a test PDF (SBIR solicitation or any multi-page PDF, max 30MB) | File accepted, upload progress shown |
| 3 | Fill metadata fields: title (e.g., "DoD SBIR 26.1 Test"), agency ("DoD"), program type ("SBIR") | -- |
| 4 | Submit the form | Success response |
| 5 | Verify the transaction created: | |
| 5a | -- New `opportunities` row | `SELECT id, title, agency FROM opportunities ORDER BY created_at DESC LIMIT 1` |
| 5b | -- New `curated_solicitations` row with `status='new'` | `SELECT id, status FROM curated_solicitations ORDER BY created_at DESC LIMIT 1` |
| 5c | -- New `solicitation_documents` row with `storage_key` pointing to S3 | Verify storage_key is not null |
| 5d | -- S3 object at the storage_key path | `aws s3 ls s3://rfp-pipeline-prod-r8t7tr6/rfp-admin/...` |
| 6 | Check `/admin/events` | `finder:rfp.uploaded` event (start + end phases) |
| 7 | Check `/admin/workflows` | OnRfpUploaded workflow instance visible |

**Pass criteria:** Upload creates opportunity + solicitation + document in a single transaction, stores file in S3, emits event, triggers workflow.

---

#### Test 2.5: Triage Queue

**Route:** `/admin/rfp-curation`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/admin/rfp-curation` | "RFP Triage Queue" page loads. Shows solicitation count. "+ Upload RFP" button visible |
| 2 | Verify the uploaded RFP from Test 2.4 appears | Card shows: title, source, agency, status "new", close date (if set), posted date |
| 3 | Click "Claim" on the solicitation | Status changes from "new" to "claimed". `claimed_by` set to current user ID |
| 4 | Verify claim is atomic: open a second browser tab, try to claim the same solicitation | Second claim fails or shows already claimed |
| 5 | If shredder is available: click "Release for AI Analysis" | Status changes to "released_for_analysis". Shredder job enqueued |
| 6 | Wait for shredder to complete (2-10 minutes depending on PDF size) | Status changes to "ai_analyzed". `ai_extracted` field populated with sections and compliance data |
| 7 | If shredder is NOT available: use triage action to move to "curation_in_progress" directly | Status changes to "curation_in_progress" |

**Solicitation status state machine:**

```
new -> claimed -> released_for_analysis -> ai_analyzed -> curation_in_progress
                                                       -> review_requested -> approved -> pushed_to_pipeline
                                          (or dismissed at any point after claimed)
```

**Pass criteria:** Triage queue renders, claim is atomic, status transitions work correctly.

---

#### Test 2.6: Curation Workspace

**Route:** `/admin/rfp-curation/[solId]`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click into the solicitation detail (or navigate directly to `/admin/rfp-curation/[solId]`) | Curation workspace loads with panels: solicitation info, documents, compliance, volumes, topics, annotations, triage history |
| 2 | **Documents panel:** verify uploaded PDF appears with filename, file type, size. If `is_primary` is set, it shows a primary badge | Document listed with metadata |
| 3 | **Compliance panel:** If AI analysis ran, verify extracted compliance variables appear (page limits, font requirements, margins, etc.) | Compliance variables rendered. If no AI analysis, panel shows empty state |
| 4 | **Edit compliance:** modify a compliance variable (e.g., set page_limit_technical to 25) | Change accepted |
| 5 | Save compliance changes | POST to `/api/admin/rfp-curation/[solId]/compliance` succeeds. Values persist on refresh |
| 6 | **Volumes panel:** Click "Add Volume" | Volume creation form appears |
| 7 | Create a volume: name="Technical Volume", volume_number=1, format="letter" | Volume created and appears in list |
| 8 | Add a required item to the volume: item_name="Technical Approach", item_type="narrative", required=true, page_limit=15 | Item appears under the volume |
| 9 | **Annotations panel:** If PDF viewer supports it, add an annotation (highlight text, add text box, tag with compliance reference) | Annotation saved |
| 10 | Save all changes and refresh the page | All edits persist: compliance, volumes, required items, annotations |

**Pass criteria:** All curation workspace panels render, compliance editing works, volume + required item CRUD works, changes persist.

---

#### Test 2.7: Topic Management

**Route:** `/admin/rfp-curation/[solId]` (topics section) and `/admin/rfp-curation/[solId]/topic/[topicId]`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | In the curation workspace, locate the Topics section | Topics panel renders (may be empty) |
| 2 | Add a topic manually: title="Autonomous Drone Navigation", topic_number="AF261-001", description="Research on GPS-denied navigation" | Topic created. Verify it is an `opportunities` row with `solicitation_id` = current solicitation ID |
| 3 | Click into the topic detail page `/admin/rfp-curation/[solId]/topic/[topicId]` | Topic detail renders with: title, topic number, compliance editor |
| 4 | Set topic-level compliance overrides (e.g., topic-specific page limit different from solicitation default) | Override saved |
| 5 | Verify merge behavior: topic compliance overrides take precedence over solicitation compliance | Check resolved compliance values |
| 6 | Return to curation workspace, verify topic appears in the topics list | Topic listed with number and title |

**Pass criteria:** Topics are created as `opportunities` with `solicitation_id`, topic-level compliance overrides work, merge logic (topic > solicitation > system defaults) applies.

---

#### Test 2.8: Review, Approve, and Push to Pipeline

**Route:** `/admin/rfp-curation/[solId]`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | In the curation workspace, click "Request Review" | Status changes to "review_requested". `review_requested_for` may be set |
| 2 | **Approval constraint:** The approver must be a different user than the curator. If only one admin exists, note this limitation. Otherwise, log in as a different rfp_admin | `curated_by != approved_by` enforced |
| 3 | As a different admin (or master_admin), navigate to the solicitation | Solicitation shows "review_requested" status |
| 4 | Click "Approve" | Status changes to "approved". `approved_by` set to current user |
| 5 | Click "Push to Pipeline" | Validation runs (checks compliance is set, at least one volume exists) |
| 6 | If validation passes: status changes to "pushed_to_pipeline", `pushed_at` timestamp set | -- |
| 7 | Verify: `opportunities.is_active = true` for the parent opportunity | `SELECT is_active FROM opportunities WHERE id = [opp_id]` |
| 8 | Check `/admin/events` | `finder:solicitation.pushed` event logged |
| 9 | Check `/admin/workflows` | OnSolicitationPushed workflow instance visible (running match_tenants scoring) |
| 10 | Record the solicitation ID for use in Session 3 | Record: `__________` |

**Pass criteria:** Review/approve/push lifecycle works, approval requires different user than curator, push sets `is_active=true`, emits event, triggers OnSolicitationPushed workflow.

---

### SESSION 3: Customer Onboarding + Spotlight (45 min)

**Covers:** Journeys 9 (Spotlight/Finder), 15 (Billing + Profile)
**Roles tested:** tenant_admin, tenant_user
**Routes:** `/login`, `/change-password`, `/portal/[slug]/dashboard`, `/portal/[slug]/profile`, `/portal/[slug]/team`, `/portal/[slug]/spotlights`, `/portal/[slug]/pipeline`

**Prerequisite:** Session 1 completed (tenant + user created via application acceptance).

---

#### Test 3.1: Customer First Login + Password Change

**Route:** `/login` then `/change-password` then `/portal/[slug]/dashboard`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | In Window B (incognito/private), navigate to `/login` | Login form renders |
| 2 | Enter the accepted applicant's email + temp password (from Test 1.4) | -- |
| 3 | Click "Sign In" | Redirect to `/change-password` (middleware forces password change when `temp_password=true`) |
| 4 | Try navigating to `/portal/[slug]/dashboard` directly | Redirect back to `/change-password` (middleware enforces) |
| 5 | Enter new password (min 8 characters, mixed case recommended) and confirm | -- |
| 6 | Submit password change | API call to `/api/auth/change-password` succeeds. `temp_password` set to false in DB. Redirect to `/portal/[slug]/dashboard` |
| 7 | Verify dashboard shows company name in welcome message | Company name from tenant record displayed |
| 8 | Verify quick stats: Library Units count, Active Proposals count, Pinned Pipeline Items count | All show numbers (likely 0 for new tenant) |

**Pass criteria:** Temp password login forces password change, new password works, redirect to portal dashboard, company name displayed.

---

#### Test 3.2: Profile Setup

**Route:** `/portal/[slug]/profile`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/portal/[slug]/profile` | ProfileEditor component renders with editable fields |
| 2 | Fill company info: NAICS codes (e.g., 541715, 541330), keywords, agency priorities (DoD, Air Force), tech focus areas (AI, ML, autonomous systems), company summary | -- |
| 3 | Save profile | POST to `/api/portal/[slug]/profile` succeeds |
| 4 | Refresh the page | All saved values persist. Fields pre-populated with saved data |
| 5 | Edit a field (add another NAICS code), save again | Update succeeds, new value persists |
| 6 | Check DB: `tenant_profiles` table has a row for this tenant | Verify data matches what was entered |

**Pass criteria:** Profile saves and loads correctly. All fields persist across page refreshes.

---

#### Test 3.3: Team Management

**Route:** `/portal/[slug]/team`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/portal/[slug]/team` | Team page renders showing current user as tenant_admin |
| 2 | Click "Invite Team Member" (or equivalent) | Invite form appears |
| 3 | Fill: name="Jane Tester", email="janetester@example.com", role=tenant_user | -- |
| 4 | Submit invite | POST to `/api/portal/[slug]/team` succeeds |
| 5 | Verify: new user created with `role='tenant_user'`, `temp_password=true`, `tenant_id` set | Check DB or verify invite appears in team list |
| 6 | Verify invite email sent (if email configured) with temp password | Email received |
| 7 | Verify the new team member appears in the team list on the page | Name, email, role displayed |

**Pass criteria:** Team invitation creates user with correct role and tenant association, sends invite email.

---

#### Test 3.4: Spotlight Feed (Requires Session 2 Push)

**Route:** `/portal/[slug]/spotlights`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/portal/[slug]/spotlights` | Spotlight feed page renders: "Spotlight" heading |
| 2 | If OnSolicitationPushed workflow completed and scored this tenant above threshold: verify the pushed solicitation from Test 2.8 appears | Opportunity card shows: title, agency, score, close date |
| 3 | If tenant profile was not set up before the push: score may be 0 or low. Verify the scoring factors are displayed (NAICS overlap, keyword match, agency match, set-aside, timeline) | Factor breakdown visible on the card |
| 4 | If no opportunities appear: verify by checking `tenant_pipeline_items` table for this tenant_id | If no rows, the scoring may not have run yet or the tenant was below threshold |

**Note:** If the push happened before profile setup (Test 3.2), re-triggering scoring may be needed. The scoring workflow runs automatically on push.

**Pass criteria:** Spotlight page renders. If scoring ran against a populated profile, opportunities appear with score breakdowns.

---

#### Test 3.5: Create Saved Spotlight Bucket

**Route:** `/portal/[slug]/spotlights`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Create Spotlight" (or "Save as Spotlight") | Spotlight bucket creation form appears |
| 2 | Fill: name="DoD SBIR Watch", NAICS filter (541715), keyword filter ("autonomous"), min score (30) | -- |
| 3 | Save | POST to `/api/portal/[slug]/spotlights` succeeds |
| 4 | Verify saved spotlight appears in sidebar/list | Spotlight bucket listed by name |
| 5 | Click into the saved spotlight `/portal/[slug]/spotlights/[spotlightId]` | Filtered results shown (only opportunities matching the bucket criteria) |
| 6 | Verify limit: create up to 5 saved spotlights | All 5 create successfully |
| 7 | Try creating a 6th spotlight | Rejected with limit error |

**Pass criteria:** Saved spotlight buckets create, filter, persist. Max 5 enforced.

---

#### Test 3.6: Pin + Pipeline

**Route:** `/portal/[slug]/spotlights` then `/portal/[slug]/pipeline`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | On the spotlight feed, find an opportunity and click "Pin" | Pin action fires: POST to `/api/portal/[slug]/spotlight/pin` with `{ opportunityId, action: "pin" }` |
| 2 | Navigate to `/portal/[slug]/pipeline` | Pipeline page renders. Pinned opportunity appears |
| 3 | Verify pipeline card shows: title, agency, close date with countdown badge (color-coded: red < 7 days, yellow < 30 days, green > 30 days), score, pursuit status | All elements rendered |
| 4 | Verify "Create Proposal" button is visible on the pinned item | Button present |
| 5 | Return to spotlight feed, unpin the opportunity | Unpin action fires: POST with `action: "unpin"` |
| 6 | Navigate to `/portal/[slug]/pipeline` | Opportunity no longer visible in pipeline |
| 7 | Check DB: `tenant_pipeline_items` row still exists but `is_pinned=false` | Score data preserved, pin status toggled |
| 8 | Re-pin the opportunity from spotlight feed | Pipeline shows it again with scores intact |

**Pass criteria:** Pin/unpin toggle works. Pipeline shows pinned items with countdown badges. Scores preserved on unpin (UPDATE not DELETE).

---

### SESSION 4: Proposal Purchase + Workspace (90 min)

**Covers:** Journeys 10 (Proposal Purchase + Build), 11 (Proposal Workspace), 12 (Collaboration), 13 (Library + Uploads), 14 (Supporting Documents)
**Roles tested:** tenant_admin, tenant_user, partner_user
**Routes:** `/portal/[slug]/proposals/*`, `/portal/[slug]/library/*`, `/portal/[slug]/documents`

**Prerequisites:** Sessions 1-3 completed (tenant exists, profile set, opportunity pinned).

---

#### Test 4.1: Proposal Creation (Founding Cohort Bypass)

**Route:** `/portal/[slug]/pipeline` -> proposal creation

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | On `/portal/[slug]/pipeline`, click "Create Proposal" on a pinned opportunity | Proposal creation flow starts. With `FOUNDING_COHORT_BYPASS=true`, Stripe checkout is skipped |
| 2 | Select gate configuration (e.g., draft, review, final -- the 2-4 gates from the 5 valid stages) | Gate config UI renders |
| 3 | Submit | POST to `/api/portal/[slug]/proposals/create` |
| 4 | Verify the creation transaction: | |
| 4a | -- `proposals` row created with `stage='draft'`, `gate_config` JSONB set, `tenant_id` correct | `SELECT id, stage, gate_config FROM proposals ORDER BY created_at DESC LIMIT 1` |
| 4b | -- `proposal_sections` rows created from `volume_required_items` (compliance matrix) | `SELECT COUNT(*) FROM proposal_sections WHERE proposal_id = [id]` -- should match required items count |
| 4c | -- Each section has template content interpolated with company data | Sections have non-empty `content` field |
| 4d | -- `proposal_supporting_docs` rows seeded from `solicitation_compliance.required_documents` | `SELECT * FROM proposal_supporting_docs WHERE proposal_id = [id]` -- status should be "missing" |
| 5 | Navigate to `/portal/[slug]/proposals` | Proposal list page shows the new proposal with "Drafting" stage badge |
| 6 | Click into the proposal `/portal/[slug]/proposals/[proposalId]` | Proposal detail page loads with section list, stage indicator, compliance status |
| 7 | Check `/admin/events` (Window A) | `proposal:proposal.created` event logged |
| 8 | Check `/admin/workflows` (Window A) | OnProposalCreated workflow instance visible |
| 9 | Record the proposal ID | Record: `__________` |

**Pass criteria:** Proposal created with sections provisioned from compliance matrix, supporting docs seeded, events and workflows triggered.

---

#### Test 4.2: Documents Overview

**Route:** `/portal/[slug]/documents`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/portal/[slug]/documents` | Documents page loads with 4 sections |
| 2 | **Proposal Sections:** verify sections from the proposal appear with status badges (Empty, AI Drafted, In Progress, etc.) | Sections listed with title, section number, status |
| 3 | **Supporting Documents:** verify required supporting docs appear with "Missing" status | Documents listed with requirement label, category, status |
| 4 | **Library Uploads:** verify library section (may be empty initially) | Section renders |
| 5 | **Source Documents:** verify source RFP documents section | Section renders (link to original solicitation docs) |

**Pass criteria:** All 4 document sections render with correct data.

---

#### Test 4.3: Canvas Editor -- Basic Editing

**Route:** `/portal/[slug]/proposals/[proposalId]/sections/[sectionId]`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | From the proposal detail page, click a section (e.g., "Technical Approach") | Canvas editor loads at `/portal/[slug]/proposals/[proposalId]/sections/[sectionId]` |
| 2 | Verify canvas loads with template content (or empty if no template) | Canvas nodes render: headings, text blocks, etc. |
| 3 | **Edit a text node:** click on a text_block node, modify the text | Node enters edit mode, text editable |
| 4 | **Add a new node:** use the toolbar/button to add a heading or bulleted_list node | New node appears in the canvas |
| 5 | **Delete a node:** select a node and delete it | Node removed from canvas |
| 6 | **Reorder nodes:** drag a node to a different position (if drag-and-drop is implemented) | Node moves to new position |
| 7 | Click "Save" | POST to `/api/portal/[slug]/proposals/[proposalId]/sections/[sectionId]/save`. Response includes `version` number |
| 8 | Verify "Saved" confirmation appears | Visual confirmation (toast, badge, or text) |
| 9 | Refresh the page | All changes persist. Canvas loads with the saved state |
| 10 | Check DB: `proposal_sections.version` incremented | Version number increased by 1 |
| 11 | Check DB: `canvas_versions` row created with source tracking | `SELECT source, version FROM canvas_versions WHERE section_id = [id] ORDER BY version DESC LIMIT 1` -- source should be `human_edit` |

**Pass criteria:** All CRUD operations on canvas nodes work, save persists, version increments, canvas_versions tracked.

---

#### Test 4.4: Canvas Editor -- OCC (Optimistic Concurrency Control)

**Route:** `/portal/[slug]/proposals/[proposalId]/sections/[sectionId]`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open the same section in two browser tabs (Tab A and Tab B) | Both tabs load the same content at the same version |
| 2 | In Tab A: edit text and save | Save succeeds, version increments |
| 3 | In Tab B: edit different text and save | Save returns **409 Conflict** with guidance to reload. Response includes `code: 'CONFLICT'` and `currentVersion` |
| 4 | Tab B: reload the page | Loads Tab A's changes at the new version |
| 5 | Tab B: make edits and save again | Save succeeds (version now matches) |

**Pass criteria:** OCC prevents silent data loss. Second save to a stale version returns 409 with the current version.

---

#### Test 4.5: Canvas Editor -- AI Features

**Route:** `/portal/[slug]/proposals/[proposalId]/sections/[sectionId]`

**Note:** Requires `ANTHROPIC_API_KEY` to be set. If not set, AI features will fail gracefully.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Select a text node with substantial content | Node selected |
| 2 | Open the AI revision panel (sidebar or toolbar button) | Panel shows quick-revision options: "Make shorter", "Make more specific", "Add detail", "Improve clarity", etc. (8 options + custom prompt) |
| 3 | Click "Make shorter" | POST to `/api/portal/[slug]/proposals/[proposalId]/ai/review`. AI revision appears as a suggestion |
| 4 | Review the AI suggestion | Suggested text shown, with accept/reject controls |
| 5 | Accept the revision | Canvas updates with AI text. Save to persist |
| 6 | Check `canvas_versions`: verify `source='ai_revision'` | Version logged with correct source |
| 7 | Click "Draft with AI" (if available for empty sections) | POST to `/api/portal/[slug]/proposals/[proposalId]/ai/draft`. AI generates section content |
| 8 | Verify AI-drafted content appears | Content populated with AI text. `[PLACEHOLDER]` markers may appear for claims needing verification |

**Pass criteria:** AI revision and drafting work (if API key set). Source tracking differentiates `ai_revision` from `human_edit`.

---

#### Test 4.6: Library Upload + Atomization

**Route:** `/portal/[slug]/library/upload` then `/portal/[slug]/library`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/portal/[slug]/library/upload` | Upload form renders with file input, metadata fields |
| 2 | Upload a document (PDF, DOCX, PPTX, TXT, or MD; max 50MB) | File accepted, upload to S3 succeeds |
| 3 | Fill metadata: category ("technical_approach"), tags | -- |
| 4 | Submit | POST to `/api/portal/[slug]/library/upload` succeeds. `library_units` row created |
| 5 | If atomization is enabled: trigger atomization | POST to `/api/portal/[slug]/library/atomize`. Reader extracts content, creates child units with `canvas_nodes`, `heading_text`, `char_offset` |
| 6 | Navigate to `/portal/[slug]/library` | Library dashboard loads with LibraryDashboard component |
| 7 | Verify uploaded document appears in the list | Card shows: content preview, category, tags, status, source_type, confidence score |
| 8 | Test filters: filter by category, status, tags | Filtered results update correctly |
| 9 | Test search: search by keyword from the uploaded content | Matching units appear |
| 10 | Test pagination: if > 20 units, verify pagination works | Page controls functional |

**Pass criteria:** Library upload works, atomization creates child units, library dashboard shows units with filtering and search.

---

#### Test 4.7: Library Integration in Canvas Editor

**Route:** `/portal/[slug]/proposals/[proposalId]/sections/[sectionId]`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open a proposal section in the canvas editor | Editor loads |
| 2 | Open the library picker (sidebar or toolbar) | Library search interface appears |
| 3 | Search for content from the library (keyword from uploaded document) | Matching library units appear |
| 4 | Select a library unit and insert it into the canvas | Content appears as a new node in the canvas |
| 5 | Save the section | Save succeeds |
| 6 | Check `canvas_versions`: verify `source='library_import'` | Source tracked correctly |

**Pass criteria:** Library picker finds content, insertion works, source tracking logs `library_import`.

---

#### Test 4.8: Version History

**Route:** `/api/portal/[slug]/proposals/[proposalId]/sections/[sectionId]/versions`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | After making several edits and saves to a section (Tests 4.3-4.7), query the versions API | GET to `/api/portal/[slug]/proposals/[proposalId]/sections/[sectionId]/versions` |
| 2 | Verify: each save created a `canvas_versions` entry | Multiple version rows returned |
| 3 | Verify: version numbers increment sequentially (1, 2, 3, ...) | No gaps in sequence |
| 4 | Verify: source tracking varies (`human_edit`, `ai_revision`, `library_import`) | Different sources reflected for each version |
| 5 | Verify: each version has a timestamp and content snapshot | Data complete |

**Pass criteria:** Complete version trail with sequential numbers, source tracking, and timestamps.

---

#### Test 4.9: Collaboration -- Invite + Access Control

**Route:** `/portal/[slug]/proposals/[proposalId]`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | On the proposal detail page, click "Invite Collaborator" (or equivalent) | Collaborator form appears |
| 2 | Invite a team member (from Test 3.3) with section assignments and stage access | POST to `/api/portal/[slug]/proposals/[proposalId]/collaborators` |
| 3 | Set stage access: draft=edit, review=comment | `collaborator_stage_access` rows created |
| 4 | Set assigned sections: select 2-3 specific sections | `proposal_collaborators.assigned_sections` UUID array populated |
| 5 | Invite an external collaborator as partner_user with limited section access | Partner user created or linked |
| 6 | Log in as the tenant_user collaborator in a new window | Login succeeds |
| 7 | Navigate to the proposal | Collaborator sees assigned sections only (if partner_user) or all sections (if tenant_user with `all` access) |
| 8 | Open an assigned section in the editor | Edit mode available (current stage is "draft", collaborator has "edit" for draft) |
| 9 | Try accessing a non-assigned section (as partner_user) | Access denied -- section not visible or read-only |

**Pass criteria:** Collaboration invites work, stage-scoped access (view/comment/edit) enforced, section assignment restricts partner_user visibility.

---

#### Test 4.10: Comments

**Route:** `/api/portal/[slug]/proposals/[proposalId]/comments`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | As collaborator, navigate to a section | Section loads |
| 2 | Add a comment: POST to `/api/portal/[slug]/proposals/[proposalId]/comments` with `{ sectionId, content: "Please add more detail on the drone nav algorithm" }` | Comment created. 201 response |
| 3 | As tenant_admin, view the proposal. Verify comment appears | Comment visible with author name, content, timestamp |
| 4 | Resolve the comment: POST to `/api/portal/[slug]/proposals/[proposalId]/comments/[commentId]/resolve` | Comment marked as resolved |
| 5 | Verify resolved status displayed | Visual indicator (strikethrough, badge, or dimmed) |

**Pass criteria:** Comments create, display, and resolve correctly. Full lifecycle works.

---

#### Test 4.11: Supporting Documents

**Route:** `/api/portal/[slug]/proposals/[proposalId]/supporting-docs`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to the documents page or supporting docs section | Supporting documents listed with "Missing" status for required docs |
| 2 | Upload a supporting document (e.g., letter of support PDF): POST to `/api/portal/[slug]/proposals/[proposalId]/supporting-docs/[docId]` with file | Upload succeeds. Status changes from "missing" to "uploaded" |
| 3 | Verify: `storage_key` populated, `original_filename` set, `file_size` recorded | DB fields populated |
| 4 | As admin, review the document: update status to "reviewed" | PATCH succeeds |
| 5 | As admin, approve the document: update status to "approved" | Status changes to "approved" |
| 6 | Test waiver: for an optional doc, set status to "waived" | Status changes to "waived" |

**Status workflow:** `missing -> uploaded -> reviewed -> approved` (or `waived` at any point)

**Pass criteria:** Full supporting document status lifecycle works. Upload stores to S3, status transitions validated.

---

#### Test 4.12: Stage Gates + Requirements

**Route:** `/api/portal/[slug]/proposals/[proposalId]/gates`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Query gate requirements: GET `/api/portal/[slug]/proposals/[proposalId]/gates` | Current gate requirements for the "draft" stage returned |
| 2 | If gate requirements exist, verify they are displayed in the proposal workspace | Requirements listed with completion status |
| 3 | Mark requirements as met (if applicable) | Requirements update |

**Pass criteria:** Gate requirements render and can be tracked.

---

#### Test 4.13: Stage Advancement (Draft -> Review)

**Route:** `/api/portal/[slug]/proposals/[proposalId]/advance`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Ensure all sections have content (edit and save any empty sections first) | All sections have content |
| 2 | Click "Advance to Review" (or POST to `/api/portal/[slug]/proposals/[proposalId]/advance`) | Advance succeeds |
| 3 | Verify: `proposals.stage` changes from "draft" to "review" | Stage updated |
| 4 | Verify: `stage_completion_snapshots` row created with `stage='draft'`, section census (total_sections, sections_complete, sections_approved) | Snapshot data matches section counts |
| 5 | Verify: `canvas_versions` snapshot created for each section with reason "stage_completed:draft" | Version rows exist with `stage_completed` reason |
| 6 | Verify: draft-stage sections become read-only | -- |
| 7 | Try editing a section that was draft-stage: POST save to a completed-stage section | Response: **423** with `code: 'STAGE_LOCKED'` |
| 8 | Verify review-stage sections are editable | Edit and save succeeds |
| 9 | Check `/admin/events` | `proposal:proposal.advanced` event logged with `fromStage: 'draft'`, `toStage: 'review'` |

**Pass criteria:** Stage advancement creates snapshots, locks previous-stage sections (423 STAGE_LOCKED), allows current-stage editing.

---

#### Test 4.14: Concurrent Stage Advancement Race Condition

**Route:** `/api/portal/[slug]/proposals/[proposalId]/advance`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open proposal in two browser tabs | Both at "review" stage |
| 2 | Click "Advance" in both tabs simultaneously | One succeeds, one returns **409 Conflict** |
| 3 | Verify: proposal is at "final" stage (not double-advanced) | Stage is "final", not beyond |

**Pass criteria:** Race condition handled. Only one advance succeeds.

---

#### Test 4.15: Lock + Unlock + Export

**Route:** `/api/portal/[slug]/proposals/[proposalId]/lock`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Advance to "final" stage (if not already there from Test 4.13/4.14) | Stage is "final" |
| 2 | Verify: proposal auto-locks at "final". `is_locked=true`, `lock_count` incremented | DB values updated |
| 3 | Verify: auto-advance to "submitted" stage | Stage changes to "submitted" |
| 4 | Try saving a section | Response: **423** with `code: 'STAGE_LOCKED'` (or similar lock error) |
| 5 | **Export a section:** POST to `/api/portal/[slug]/proposals/[proposalId]/sections/[sectionId]/export` | DOCX file downloads. Full formatting: headers, footers, inline styles |
| 6 | **Package export:** POST to `/api/portal/[slug]/proposals/[proposalId]/package` | JSON manifest with all sections + supporting doc references + download links |
| 7 | **Unlock (first time -- free):** POST to `/api/portal/[slug]/proposals/[proposalId]/lock` with `action: "unlock"` | Unlock succeeds. Proposal reverts to "final" stage. `is_locked=false` |
| 8 | Edit a section in "final" stage | Edit allowed |
| 9 | Re-lock | Auto-advance back to "submitted". `lock_count` now 2 |
| 10 | **Unlock again (second time -- requires rfp_admin):** | As tenant_admin: unlock fails (or requires elevation). As rfp_admin/master_admin: unlock succeeds |

**Pass criteria:** Lock at "final" auto-advances to "submitted". Export works when locked. First unlock is free, second requires rfp_admin/master_admin.

---

#### Test 4.16: Outcome Recording

**Route:** `/api/portal/[slug]/proposals/[proposalId]/outcome`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | POST outcome: `{ outcome: "awarded", notes: "Contract awarded Q3 2026" }` | Outcome recorded |
| 2 | Verify: `proposals.stage` changes to "archived" | Stage is "archived" |
| 3 | Verify: proposal is locked permanently | `is_locked=true` |
| 4 | Verify: library_units outcome_score updated (if proposal harvest ran) | `library_units.outcome` and `outcome_score` updated for atoms from this proposal |
| 5 | Check `/admin/events` | `proposal:proposal.outcome_recorded` event logged |

**Pass criteria:** Outcome recording archives proposal, updates library learning loop, emits event.

---

### SESSION 5: Pipeline + Workflow Monitoring (30 min)

**Covers:** Journey 8 (Pipeline + Workflow + Agent Monitor)
**Roles tested:** master_admin, rfp_admin
**Routes:** `/admin/pipeline`, `/admin/workflows`, `/admin/agents`, `/admin/process`, `/admin/events`

**Prerequisites:** Sessions 1-4 completed (workflow instances, events, and agent tasks generated).

---

#### Test 5.1: Pipeline Monitor

**Route:** `/admin/pipeline`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/admin/pipeline` | Pipeline page loads |
| 2 | Verify: job counts displayed (pending, running, completed, failed) | Stat counters render (may be 0) |
| 3 | Verify: recent jobs listed with status, schedule, timestamps | Job list renders |
| 4 | If pipeline service is running: verify schedule status (next run times for SAM.gov, SBIR.gov, DSIP ingesters) | Schedule info displayed |

**Pass criteria:** Pipeline page renders with job data from the pipeline service.

---

#### Test 5.2: Workflow Monitor

**Route:** `/admin/workflows`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/admin/workflows` | Workflow dashboard loads |
| 2 | Verify stats bar: Running, Paused, Completed 24h, Failed 24h | 4 counters render with numbers |
| 3 | **Active Workflows panel:** verify workflow instances from Sessions 1-4 | Instances listed: OnApplicationAccepted, OnRfpUploaded, OnSolicitationPushed, OnProposalCreated, etc. |
| 4 | Verify each instance card shows: workflow name (formatted), status with color indicator (Blue=running, Yellow=paused, Gray=pending, Orange=retrying, Green=completed, Red=failed), current step, elapsed time | All elements rendered |
| 5 | **Recent History panel:** verify completed/failed instances from last 24h | Instances with duration, final status, error details (if failed) |
| 6 | Wait 10 seconds | Page auto-refreshes (client component refreshes via Next.js router) |
| 7 | If any failed instances exist: verify retry/cancel buttons available | Admin action buttons functional |

**Pass criteria:** Workflow monitor renders active and recent instances with correct status colors, auto-refreshes every 10 seconds.

---

#### Test 5.3: Agent Monitor

**Route:** `/admin/agents`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/admin/agents` | Agent page loads |
| 2 | Verify: agent task metrics displayed (if AI features were used in Session 4) | Metrics: task count, token usage, cost |
| 3 | Verify: usage dashboard shows per-archetype breakdown | Archetypes listed with call counts and costs |
| 4 | If no AI tasks ran: verify empty state renders cleanly | "No agent activity" or similar message |

**Pass criteria:** Agent monitor renders usage data or clean empty state.

---

#### Test 5.4: Process Monitor (Event Stream)

**Route:** `/admin/process`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/admin/process` | Process monitor loads with event stream |
| 2 | Verify: real-time event stream shows events from all prior test sessions | Events listed with: namespace, type, phase, actor, timestamp |
| 3 | Verify: namespace stats visible (counts per namespace: finder, capture, identity, proposal, library, system, tool) | Namespace breakdown renders |
| 4 | Verify: tenant activity visible (events grouped or filterable by tenant) | Tenant filter works |

**Pass criteria:** Process monitor shows complete event trail from all test sessions.

---

#### Test 5.5: Event Monitor

**Route:** `/admin/events`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/admin/events` | Event list page loads |
| 2 | Verify: events searchable/filterable by namespace | Filter by "capture" shows application events only |
| 3 | Filter by type | Filter by "application.accepted" narrows to acceptance events |
| 4 | Filter by tenant | Shows only events for the selected tenant_id |
| 5 | Verify event detail: click an event to see full payload | Payload JSON displayed |

**Pass criteria:** Event monitor supports namespace, type, and tenant filtering. Full payload accessible.

---

#### Test 5.6: Admin Proposals View

**Route:** `/admin/proposals`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/admin/proposals` | Admin proposals list page loads |
| 2 | Verify: proposals from all tenants visible | Proposals listed with tenant name, title, stage, section count |
| 3 | Click into a proposal | Admin can view proposal sections, comments, activity |

**Pass criteria:** Admin has cross-tenant visibility of all proposals.

---

#### Test 5.7: Admin Section Editor

**Route:** `/admin/proposals/[proposalId]/section/[sectionId]`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to a proposal section via the admin route | Canvas editor loads in admin context |
| 2 | Verify: admin can view and edit section content | Edit mode available |
| 3 | Verify: API calls use `/api/admin/proposals/...` path, NOT `/api/portal/...` | Network tab shows correct API path |

**Pass criteria:** Admin section editor uses admin API routes, not portal routes.

---

### SESSION 6: Edge Cases + Error Handling (30 min)

**Covers:** Security, rate limiting, input validation, error responses
**Roles tested:** All roles, unauthenticated
**Tools needed:** curl or Postman for direct API testing

---

#### Test 6.1: Rate Limiting

**Route:** `/api/applications`

Rate limit configuration from middleware: 5 requests per 15-minute window per IP.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Using curl, send 5 rapid POST requests to `/api/applications` with valid bodies (different emails each time) | All 5 return 201 (or 4xx for validation) |
| 2 | Send a 6th request immediately | Response: **429 Too Many Requests** |
| 3 | Verify response headers: `Retry-After`, `X-RateLimit-Limit: 5`, `X-RateLimit-Remaining: 0`, `X-RateLimit-Reset` | All rate limit headers present |
| 4 | Verify response body: `{ error: "Too many requests...", code: "RATE_LIMITED" }` | Error response matches format |
| 5 | Test `/api/waitlist` rate limiting: same 5-per-15-min limit | 429 after 5 requests |

```bash
# Quick test script
for i in $(seq 1 6); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/applications \
    -H "Content-Type: application/json" \
    -d "{\"contactEmail\":\"ratelimit${i}@example.com\",\"contactName\":\"Test ${i}\",\"companyName\":\"Rate Limit Corp ${i}\",\"techSummary\":\"Testing rate limiting behavior of the application endpoint\",\"motivation\":\"Testing rate limits\",\"referralSource\":\"testing\",\"termsAccepted\":true}"
done
# Expected output: 201 201 201 201 201 429
```

**Pass criteria:** 6th request within window returns 429 with proper headers.

---

#### Test 6.2: Input Validation -- Size Limits

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Try uploading a 60MB file to the library upload endpoint (max 50MB) | **413** or **422** rejection with size limit message |
| 2 | Try uploading a 35MB file to the RFP upload endpoint (max 30MB) | **413** or **422** rejection |
| 3 | Try POSTing a comment with content > 15,000 characters | **422** with `VALIDATION_ERROR` code |
| 4 | Try saving a section with > 3MB content payload | **413** rejection |

**Pass criteria:** Size limits enforced on upload, comment, and section save endpoints.

---

#### Test 6.3: Auth Bypass Attempts

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | **Unauthenticated API access:** curl `/api/admin/applications/[id]/accept` without auth cookie | **401** `{ error: "unauthenticated" }` |
| 2 | **Unauthenticated page access:** navigate to `/admin/dashboard` in incognito without login | Redirect to `/login?from=/admin/dashboard` |
| 3 | **Wrong role -- tenant accessing admin:** log in as tenant_admin, navigate to `/admin/dashboard` | Redirect to `/` (role insufficient -- rfp_admin required) |
| 4 | **Wrong role -- tenant API:** as tenant_admin, curl `/api/admin/tenants` with session cookie | **403** `{ error: "forbidden" }` |
| 5 | **Cross-tenant access:** as tenant_admin for Tenant A, navigate to `/portal/tenant-b-slug/dashboard` | Redirect to `/login` (tenant access verification fails) |
| 6 | **Cross-tenant API:** as tenant_admin for Tenant A, curl `/api/portal/tenant-b-slug/proposals` | **403** or redirect |
| 7 | **Direct proposal access across tenants:** as tenant_admin for Tenant A, try accessing Tenant B's proposal by ID via `/api/portal/tenant-a-slug/proposals/[tenant-b-proposal-id]` | **404** (query filters by tenant_id) |
| 8 | **System page -- master_admin only:** as rfp_admin, navigate to `/admin/system` | Redirect (master_admin required per rbac PATH_MIN_ROLE) |

**Pass criteria:** All auth bypass attempts blocked. Unauthenticated returns 401 (API) or redirects (page). Wrong role returns 403. Cross-tenant returns 403/404.

---

#### Test 6.4: Locked Proposal Operations

**Prerequisites:** A proposal in "submitted" (locked) state from Test 4.15.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Try saving a section on the locked proposal | **423** `{ code: 'STAGE_LOCKED' }` |
| 2 | Try uploading to supporting docs dropbox when locked | **423** or locked error |
| 3 | Try advancing stage when already at "submitted" | Appropriate error (no next stage, or already at terminal stage) |
| 4 | Try exporting a section when locked | **Export succeeds** -- exports are allowed when locked |
| 5 | Try package export when locked | **Export succeeds** |

**Pass criteria:** Lock blocks edits (423) but allows downloads/exports.

---

#### Test 6.5: API Error Response Format

Verify all error responses include both `error` and `code` fields per the project standard.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | POST invalid JSON to any API route | `{ error: "Invalid JSON body", code: "INVALID_BODY" }` with status 400 |
| 2 | POST with missing required fields to `/api/applications` | `{ error: "...", code: "VALIDATION_ERROR" }` with status 422 |
| 3 | Access non-existent resource (e.g., `/api/admin/rfp-curation/00000000-0000-0000-0000-000000000000`) | `{ error: "...", code: "NOT_FOUND" }` with status 404 |
| 4 | Attempt duplicate application email | `{ error: "...", code: "..." }` with status 409 (or appropriate) |

**Pass criteria:** Every error response from every tested endpoint includes both `error` (string) and `code` (string) fields.

---

#### Test 6.6: Middleware -- Temp Password Enforcement

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create a new user with `temp_password=true` (via team invite or DB insert) | User exists with temp password |
| 2 | Log in as that user | Login succeeds |
| 3 | Try navigating to any authenticated page (e.g., `/portal/[slug]/dashboard`) | Redirect to `/change-password` |
| 4 | Try calling any API endpoint (e.g., GET `/api/portal/[slug]/dashboard`) | **403** `{ error: "password change required" }` |
| 5 | Complete password change via `/change-password` | Succeeds. `temp_password` set to false |
| 6 | Navigate to dashboard | Access granted |

**Pass criteria:** Temp password blocks all authenticated access except `/change-password` and `/api/auth/change-password`.

---

## Test Results Template

Copy this template for each test:

```
Test {session}.{number}: {name}
Route: {route tested}
Status: PASS / FAIL / BLOCKED / SKIPPED
Tester: {name}
Time: {duration in minutes}
Notes: {observations, unexpected behavior, or deviation from expected}
Screenshot: {filename or "N/A"}
Defect: {defect ID if FAIL, or "N/A"}
```

### Results Summary Table

| Session | Test | Name | Status | Notes |
|---------|------|------|--------|-------|
| 1 | 1.1 | Admin Login + Dashboard | | |
| 1 | 1.2 | Waitlist Submission | | |
| 1 | 1.3 | Application Submission | | |
| 1 | 1.4 | Accept Application | | |
| 1 | 1.5 | Reject Application | | |
| 1 | 1.6 | Tenant Management | | |
| 2 | 2.1 | Source Profiles List | | |
| 2 | 2.2 | Source Profile Detail + Regions | | |
| 2 | 2.3 | Trigger Scout | | |
| 2 | 2.4 | Manual RFP Upload | | |
| 2 | 2.5 | Triage Queue | | |
| 2 | 2.6 | Curation Workspace | | |
| 2 | 2.7 | Topic Management | | |
| 2 | 2.8 | Review, Approve, Push | | |
| 3 | 3.1 | Customer First Login | | |
| 3 | 3.2 | Profile Setup | | |
| 3 | 3.3 | Team Management | | |
| 3 | 3.4 | Spotlight Feed | | |
| 3 | 3.5 | Saved Spotlight Buckets | | |
| 3 | 3.6 | Pin + Pipeline | | |
| 4 | 4.1 | Proposal Creation | | |
| 4 | 4.2 | Documents Overview | | |
| 4 | 4.3 | Canvas Editor -- Basic | | |
| 4 | 4.4 | Canvas Editor -- OCC | | |
| 4 | 4.5 | Canvas Editor -- AI | | |
| 4 | 4.6 | Library Upload | | |
| 4 | 4.7 | Library in Canvas | | |
| 4 | 4.8 | Version History | | |
| 4 | 4.9 | Collaboration | | |
| 4 | 4.10 | Comments | | |
| 4 | 4.11 | Supporting Documents | | |
| 4 | 4.12 | Stage Gates | | |
| 4 | 4.13 | Stage Advancement | | |
| 4 | 4.14 | Concurrent Advance | | |
| 4 | 4.15 | Lock + Unlock + Export | | |
| 4 | 4.16 | Outcome Recording | | |
| 5 | 5.1 | Pipeline Monitor | | |
| 5 | 5.2 | Workflow Monitor | | |
| 5 | 5.3 | Agent Monitor | | |
| 5 | 5.4 | Process Monitor | | |
| 5 | 5.5 | Event Monitor | | |
| 5 | 5.6 | Admin Proposals | | |
| 5 | 5.7 | Admin Section Editor | | |
| 6 | 6.1 | Rate Limiting | | |
| 6 | 6.2 | Size Limits | | |
| 6 | 6.3 | Auth Bypass | | |
| 6 | 6.4 | Locked Proposal Ops | | |
| 6 | 6.5 | Error Response Format | | |
| 6 | 6.6 | Temp Password Enforcement | | |

---

## Post-Test Checklist

After completing all 6 sessions:

### Journey Coverage

- [ ] Journey 1: Waitlist + Applications (Tests 1.2-1.5)
- [ ] Journey 2: Source Scout + RFP Discovery (Tests 2.1-2.3)
- [ ] Journey 3: RFP Ingestion (Test 2.4, verified via pipeline page)
- [ ] Journey 4: RFP Upload -- Manual (Test 2.4)
- [ ] Journey 5: Triage Queue (Test 2.5)
- [ ] Journey 6: Curation Workspace (Tests 2.6-2.7)
- [ ] Journey 7: Topic Management (Test 2.7)
- [ ] Journey 8: Pipeline + Workflow + Agent Monitor (Tests 5.1-5.5)
- [ ] Journey 9: Spotlight/Finder (Tests 3.4-3.6)
- [ ] Journey 10: Proposal Purchase + Build (Test 4.1)
- [ ] Journey 11: Proposal Workspace (Tests 4.3-4.8, 4.13-4.16)
- [ ] Journey 12: Collaboration (Tests 4.9-4.10)
- [ ] Journey 13: Library + Uploads (Tests 4.6-4.7)
- [ ] Journey 14: Supporting Documents (Test 4.11)
- [ ] Journey 15: Billing + Profile (Tests 3.1-3.2)

### State Transitions Verified

- [ ] Application: pending -> accepted (creates tenant + user)
- [ ] Application: pending -> rejected (no tenant created)
- [ ] Solicitation: new -> claimed -> released -> ai_analyzed -> curation_in_progress -> review_requested -> approved -> pushed_to_pipeline
- [ ] Solicitation: (any state after claimed) -> dismissed
- [ ] Proposal: draft -> review -> final -> submitted -> archived
- [ ] Supporting docs: missing -> uploaded -> reviewed -> approved (or waived)
- [ ] Pipeline items: unpinned -> pinned -> unpinned (scores preserved)

### Role-Based Access Verified

- [ ] master_admin: full system access including `/admin/system`
- [ ] rfp_admin: all admin pages except `/admin/system`
- [ ] tenant_admin: portal access, team management, proposal creation
- [ ] tenant_user: portal access per admin grant
- [ ] partner_user: section-scoped access per proposal, stage-gated permissions
- [ ] Unauthenticated: only public paths accessible

### Error States Verified

- [ ] 401: Unauthenticated API access
- [ ] 403: Wrong role, wrong tenant, temp password
- [ ] 404: Non-existent resource
- [ ] 409: OCC conflict (stale version save), concurrent stage advance, duplicate application
- [ ] 413: Oversized upload/payload
- [ ] 422: Validation errors (missing fields, invalid format)
- [ ] 423: Stage-locked content edit
- [ ] 429: Rate limit exceeded (with Retry-After header)

### Export Formats Verified

- [ ] DOCX: Section export with formatting
- [ ] Package: JSON manifest with all sections + supporting doc references

### Email Notifications Verified (if email configured)

- [ ] Welcome email on application acceptance (with temp password)
- [ ] Rejection email on application rejection (with reason)
- [ ] Team invite email (with temp password)
- [ ] RFP ready for curation notification
- [ ] Proposal created notification

### Workflow Instances Verified (on `/admin/workflows`)

- [ ] OnApplicationAccepted: visible with completed status
- [ ] OnRfpUploaded: visible with completed status (if shredder ran)
- [ ] OnSolicitationPushed: visible with completed status
- [ ] OnProposalCreated: visible with completed/skipped status

### System Integrity

- [ ] No JavaScript console errors in browser DevTools
- [ ] No unhandled server errors in application logs
- [ ] All API responses include both `error` and `code` fields on failure
- [ ] All DB-touching routes wrapped in try/catch
- [ ] No data leaks across tenants

---

## Appendix A: Key API Routes Reference

### Public (No Auth)

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/waitlist` | Join waitlist |
| POST | `/api/applications` | Submit founding cohort application |
| POST | `/api/auth/[...nextauth]` | NextAuth login/callback |

### Admin (rfp_admin+)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/admin/dashboard` | Dashboard stats |
| GET | `/api/admin/waitlist` | Waitlist entries |
| POST | `/api/admin/applications/[id]/accept` | Accept application |
| POST | `/api/admin/applications/[id]/reject` | Reject application |
| GET | `/api/admin/tenants` | Tenant list |
| GET | `/api/admin/tenants/[tenantId]` | Tenant detail |
| GET/POST | `/api/admin/sources` | Source profiles CRUD |
| POST | `/api/admin/sources/[profileId]/scout` | Trigger scout |
| POST | `/api/admin/sources/[profileId]/regions` | Add region |
| POST | `/api/admin/rfp-upload` | Upload RFP document |
| GET | `/api/admin/rfp-curation` | Triage queue |
| POST | `/api/admin/rfp-curation/[solId]/claim` | Claim solicitation |
| POST | `/api/admin/rfp-curation/[solId]/triage` | Triage actions |
| GET/POST | `/api/admin/rfp-curation/[solId]/compliance` | Compliance CRUD |
| POST | `/api/admin/rfp-curation/[solId]/push` | Push to pipeline |
| GET | `/api/admin/workflows` | Workflow instances |
| POST | `/api/admin/workflows/[instanceId]/retry` | Retry failed workflow |
| POST | `/api/admin/workflows/[instanceId]/cancel` | Cancel workflow |

### Portal (tenant_user+)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/portal/[tenantSlug]/dashboard` | Customer dashboard stats |
| GET/POST | `/api/portal/[tenantSlug]/profile` | Tenant profile CRUD |
| GET/POST | `/api/portal/[tenantSlug]/team` | Team management |
| GET | `/api/portal/[tenantSlug]/opportunities` | Opportunity feed |
| POST | `/api/portal/[tenantSlug]/spotlight/pin` | Pin/unpin opportunity |
| GET/POST | `/api/portal/[tenantSlug]/spotlights` | Saved spotlight buckets |
| POST | `/api/portal/[tenantSlug]/proposals/create` | Create proposal |
| GET | `/api/portal/[tenantSlug]/proposals` | Proposal list |
| POST | `/api/portal/[tenantSlug]/proposals/[id]/sections/[sid]/save` | Save section |
| GET | `/api/portal/[tenantSlug]/proposals/[id]/sections/[sid]/versions` | Version history |
| POST | `/api/portal/[tenantSlug]/proposals/[id]/sections/[sid]/export` | Export section |
| POST | `/api/portal/[tenantSlug]/proposals/[id]/advance` | Advance stage |
| POST | `/api/portal/[tenantSlug]/proposals/[id]/lock` | Lock/unlock |
| POST | `/api/portal/[tenantSlug]/proposals/[id]/outcome` | Record outcome |
| POST | `/api/portal/[tenantSlug]/proposals/[id]/collaborators` | Manage collaborators |
| GET/POST | `/api/portal/[tenantSlug]/proposals/[id]/comments` | Comments |
| POST | `/api/portal/[tenantSlug]/proposals/[id]/comments/[cid]/resolve` | Resolve comment |
| GET/POST | `/api/portal/[tenantSlug]/proposals/[id]/supporting-docs` | Supporting docs |
| POST | `/api/portal/[tenantSlug]/proposals/[id]/ai/draft` | AI draft section |
| POST | `/api/portal/[tenantSlug]/proposals/[id]/ai/review` | AI revise section |
| POST | `/api/portal/[tenantSlug]/proposals/[id]/package` | Package export |
| POST | `/api/portal/[tenantSlug]/library/upload` | Upload to library |
| POST | `/api/portal/[tenantSlug]/library/atomize` | Atomize document |
| GET | `/api/portal/[tenantSlug]/library` | Library units list |

---

## Appendix B: Admin Page Map

| Route | Purpose | Key Elements |
|-------|---------|-------------|
| `/admin/dashboard` | System overview | 8 stat cards, Recent Events table, Pending Actions sidebar |
| `/admin/applications` | Application review | ApplicationReview component, accept/reject actions |
| `/admin/waitlist` | Pending applications (waitlist view) | Pending application cards |
| `/admin/tenants` | Tenant list | Tenant cards with status, user count |
| `/admin/tenants/[id]` | Tenant detail | User list, proposal count, subscription status |
| `/admin/sources` | Source scout profiles | Source cards, activity feed, meaningful diffs |
| `/admin/sources/[id]` | Source detail | Regions, visit history, diff history |
| `/admin/rfp-curation` | Triage queue | TriageQueue component, claim/release/dismiss |
| `/admin/rfp-curation/upload` | Upload RFP | UploadForm component, file + metadata |
| `/admin/rfp-curation/[solId]` | Curation workspace | CurationWorkspace: docs, compliance, volumes, topics, annotations |
| `/admin/rfp-curation/[solId]/topic/[id]` | Topic detail | Topic compliance editor |
| `/admin/pipeline` | Pipeline jobs | Job counts, schedules, recent jobs |
| `/admin/workflows` | Workflow instances | Stats bar, active/recent instances, auto-refresh |
| `/admin/agents` | Agent metrics | Task queue, usage dashboard, per-archetype costs |
| `/admin/process` | Event stream | Real-time events, namespace stats |
| `/admin/events` | Event search | Filterable event log |
| `/admin/proposals` | All proposals | Cross-tenant proposal list |
| `/admin/proposals/[id]/section/[sid]` | Admin section editor | Canvas editor in admin context |
| `/admin/documents` | Document management | Document list and detail |
| `/admin/purchases` | Purchase history | Cross-tenant purchase records |
| `/admin/analytics` | Analytics dashboard | Usage analytics |
| `/admin/billing` | Billing overview | Subscription and payment data |
| `/admin/content` | CMS content | Blog posts, resources, guides |
| `/admin/storage` | Storage overview | S3 bucket usage |
| `/admin/templates` | Section templates | Template management |
| `/admin/system` | System admin (master_admin only) | System configuration |

---

## Appendix C: Portal Page Map

| Route | Purpose | Key Elements |
|-------|---------|-------------|
| `/portal/[slug]/dashboard` | Customer dashboard | Welcome message, quick stats, onboarding checklist |
| `/portal/[slug]/profile` | Company profile | ProfileEditor: NAICS, keywords, agency priorities, tech focus |
| `/portal/[slug]/team` | Team management | Member list, invite form, role assignment |
| `/portal/[slug]/spotlights` | Spotlight feed | Scored opportunity cards, filter/search, pin action |
| `/portal/[slug]/spotlights/[id]` | Saved spotlight bucket | Filtered opportunity list by bucket criteria |
| `/portal/[slug]/pipeline` | Pinned pipeline | Pinned opportunities with countdown badges, create proposal |
| `/portal/[slug]/proposals` | Proposal list | Active proposals with stage badges, section counts |
| `/portal/[slug]/proposals/[id]` | Proposal detail | Section list, stage indicator, compliance, collaborators |
| `/portal/[slug]/proposals/[id]/sections/[sid]` | Canvas editor | Full canvas editor with 12 node types, AI, library |
| `/portal/[slug]/proposals/[id]/review` | Proposal review | Review dashboard |
| `/portal/[slug]/documents` | Documents overview | 4 sections: proposal sections, supporting docs, library, source docs |
| `/portal/[slug]/library` | Content library | LibraryDashboard: cards, filters, search, bulk ops |
| `/portal/[slug]/library/upload` | Library upload | File upload with metadata |
| `/portal/[slug]/library/review` | Library review | Review pending library units |
| `/portal/[slug]/billing` | Billing | Subscription status, purchase history, Stripe portal |
| `/portal/[slug]/activity` | Activity feed | Tenant-scoped system events |

---

## Appendix D: Database Quick Reference for Verification Queries

```sql
-- Check application status
SELECT id, contact_email, company_name, status, created_at
FROM applications ORDER BY created_at DESC LIMIT 5;

-- Check tenant created from accepted application
SELECT id, slug, name, status, created_at
FROM tenants ORDER BY created_at DESC LIMIT 5;

-- Check user created from accepted application
SELECT id, email, role, tenant_id, temp_password, created_at
FROM users ORDER BY created_at DESC LIMIT 5;

-- Check solicitation status
SELECT id, status, claimed_by, curated_by, approved_by, pushed_at
FROM curated_solicitations ORDER BY created_at DESC LIMIT 5;

-- Check proposal and stage
SELECT id, tenant_id, stage, is_locked, lock_count, gate_config
FROM proposals ORDER BY created_at DESC LIMIT 5;

-- Check proposal sections
SELECT id, proposal_id, section_number, title, version, status
FROM proposal_sections WHERE proposal_id = '[proposal_id]'
ORDER BY section_number;

-- Check canvas versions
SELECT id, section_id, version, source, created_at
FROM canvas_versions WHERE section_id = '[section_id]'
ORDER BY version DESC LIMIT 10;

-- Check stage completion snapshots
SELECT id, proposal_id, stage, total_sections, sections_complete, completed_at
FROM stage_completion_snapshots WHERE proposal_id = '[proposal_id]'
ORDER BY completed_at DESC;

-- Check supporting docs status
SELECT id, requirement_label, category, status, original_filename
FROM proposal_supporting_docs WHERE proposal_id = '[proposal_id]';

-- Check pipeline items (pinned status)
SELECT id, tenant_id, opportunity_id, is_pinned, total_score, pursuit_status
FROM tenant_pipeline_items WHERE tenant_id = '[tenant_id]';

-- Check recent events
SELECT id, namespace, type, phase, actor_email, tenant_id, created_at
FROM system_events ORDER BY created_at DESC LIMIT 20;

-- Check workflow instances
SELECT id, workflow_name, status, current_step, started_at, completed_at, last_error
FROM process_instances ORDER BY created_at DESC LIMIT 10;

-- Check library units
SELECT id, tenant_id, category, status, source_type, content_length, created_at
FROM library_units WHERE tenant_id = '[tenant_id]'
ORDER BY created_at DESC LIMIT 10;
```

---

## Appendix E: Solicitation Status State Machine

```
                                                    +-> dismissed
                                                    |   (with reason)
                                                    |
new --> claimed --> released_for_analysis --> ai_analyzed --> curation_in_progress
                                                          |
                                                          v
                                                    review_requested
                                                          |
                                                          v
                                                       approved
                                                     (curated_by != approved_by)
                                                          |
                                                          v
                                                  pushed_to_pipeline
                                                  (is_active = true)
```

## Appendix F: Proposal Stage State Machine

```
draft --> review --> final --> submitted --> archived
                       |          ^              ^
                       |          |              |
                       +-- lock --+              |
                       |                         |
                       +-- unlock (reverts to    |
                       |   final, max 1 free,    |
                       |   2+ needs rfp_admin)   |
                       |                         |
                       +--- outcome recorded ----+
```

**Stage locking rules:**
- `final`: auto-lock + auto-advance to `submitted`
- `submitted`: locked, all edits blocked, exports allowed
- First unlock: free (any tenant_admin)
- Second+ unlock: requires rfp_admin or master_admin
- Past RFP due date: non-admin unlocks blocked
- Outcome recording: sets stage to `archived` (permanent)
