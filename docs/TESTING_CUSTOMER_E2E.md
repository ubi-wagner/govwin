# Customer End-to-End Testing Guide -- Proposal Portal

**Tester role:** New customer applicant (becomes tenant_admin after acceptance)
**Admin tester:** Eric (master_admin) -- needed for application acceptance steps
**Environments:**

| Environment | Base URL |
|-------------|----------|
| Production  | `https://govtech-frontend-production.up.railway.app` |
| Staging     | `https://govtech-frontend-staging.up.railway.app` |

Throughout this guide, `{BASE_URL}` is a placeholder for whichever environment you are testing against.

**Placeholder values used in this guide:**
- `{slug}` -- tenant slug assigned during acceptance (e.g., `acme-defense`)
- `{tenantId}` -- tenant UUID (visible in admin tenant detail page)
- `{proposalId}` -- proposal UUID (visible in URL after proposal creation)
- `{sectionId}` -- section UUID (visible in URL when editing a section)
- `{spotlightId}` -- spotlight/opportunity UUID (visible in URL on spotlight detail page)

---

## 1. Apply for Access

**Goal:** Submit a customer application through the public form.

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to [{BASE_URL}/apply]({BASE_URL}/apply) | Application form renders |
| 2 | Fill in company name | e.g., `Acme Defense Solutions` |
| 3 | Fill in contact email | e.g., `jane@acmedefense.com` |
| 4 | Fill in NAICS codes | e.g., `541512, 541519` |
| 5 | Fill in company website | e.g., `https://acmedefense.com` |
| 6 | Fill in company description | Brief description of capabilities and SBIR experience |
| 7 | Fill in SBIR experience | e.g., `5 Phase I awards, 2 Phase II awards` |
| 8 | Scroll through Terms & Conditions | Must scroll to bottom (scroll-to-accept pattern) |
| 9 | Accept Terms & Conditions | Checkbox or button becomes enabled after scrolling |
| 10 | Click "Submit Application" | Confirmation page displayed |
| 11 | Verify confirmation message | "Your application has been submitted" or similar |

**Event emitted:** `capture:application.submitted:single` -- payload includes `email` and `companyName`

**Clickable link:** [{BASE_URL}/apply]({BASE_URL}/apply)

---

## 2. Admin Accepts Application

> :warning: **Prerequisite:** Step 1 must be completed. This step is performed by Eric (master_admin), not the customer.

**Goal:** Admin reviews and accepts the application, creating the tenant and user.

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Log in as master_admin at [{BASE_URL}/login]({BASE_URL}/login) | Redirect to admin dashboard |
| 2 | Navigate to Applications: [{BASE_URL}/admin/applications]({BASE_URL}/admin/applications) | Applications list loads |
| 3 | Locate the application from Step 1 | Application visible with status `pending`, company name and email match |
| 4 | Click into the application | Application detail page loads |
| 5 | Review all submitted fields | Company name, email, NAICS codes, website, description, SBIR experience all visible |
| 6 | Click "Accept" | Acceptance flow begins |
| 7 | Verify tenant created | New tenant appears at [{BASE_URL}/admin/tenants]({BASE_URL}/admin/tenants) with slug like `acme-defense-solutions` |
| 8 | Verify user created | New user with `temp_password=true` and `role=tenant_admin` |
| 9 | Note the temporary password | Record the temp password from the admin interface or pipeline logs (needed for Step 3) |
| 10 | Note the tenant slug | Record `{slug}` (e.g., `acme-defense-solutions`) for all subsequent portal URLs |
| 11 | (Optional) Verify welcome email | Check CRM logs or the applicant's email inbox for the welcome message |

**Events emitted:**
- `capture:application.accepted:start` -- acceptance begins
- `capture:application.accepted:end` -- triggers `OnApplicationAccepted` workflow (welcome email, library setup, onboarding reminder)

**Clickable links:**
- [{BASE_URL}/admin/applications]({BASE_URL}/admin/applications)
- [{BASE_URL}/admin/tenants]({BASE_URL}/admin/tenants)

---

## 3. Customer First Login

> :warning: **Prerequisite:** Step 2 must be completed. You need the customer email and temporary password from the acceptance step.

**Goal:** Customer logs in with temporary credentials and sets a permanent password.

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to [{BASE_URL}/login]({BASE_URL}/login) | Login page renders |
| 2 | Enter the customer email (e.g., `jane@acmedefense.com`) | Field accepts input |
| 3 | Enter the temporary password (from Step 2) | Field accepts input |
| 4 | Click "Sign In" | Forced redirect to change-password page |
| 5 | Verify redirect URL | [{BASE_URL}/change-password]({BASE_URL}/change-password) |
| 6 | Enter new password (minimum 12 characters) | Password strength indicator (if present) shows acceptable |
| 7 | Confirm new password | Fields match |
| 8 | Click "Change Password" / "Submit" | Password changed successfully |
| 9 | Verify redirect | Redirect to `{BASE_URL}/portal/{slug}/dashboard` |
| 10 | Verify dashboard loads | Customer dashboard renders with company name in sidebar |

**Events emitted:**
- `identity:user.logged_in:single`
- `identity:user.password_changed:start` and `identity:user.password_changed:end`

**Clickable links:**
- [{BASE_URL}/login]({BASE_URL}/login)
- [{BASE_URL}/change-password]({BASE_URL}/change-password)
- `{BASE_URL}/portal/{slug}/dashboard`

---

## 4. Upload Company Documents to Library

> :warning: **Prerequisite:** Step 3 must be completed. You must be logged in as the customer (tenant_admin).

**Goal:** Upload company documents and atomize them for use in proposal drafting.

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to Library: `{BASE_URL}/portal/{slug}/library` | Library page loads (may be empty for new tenant) |
| 2 | Click "Upload" or navigate to `{BASE_URL}/portal/{slug}/library/upload` | Upload page renders |
| 3 | Upload a capability statement (.docx) | File accepted, upload progress shown |
| 4 | Upload a PI resume (.docx) | File accepted |
| 5 | Upload a past performance document (.docx) | File accepted |
| 6 | Navigate back to Library list | All 3 documents visible |
| 7 | Verify each document shows: | |
|   | - File name | Original filename displayed |
|   | - Category | Correct category assigned (or editable) |
|   | - Atom count | Initially 0 (before atomization) |
| 8 | Click "Atomize" on the capability statement | Atomization job starts (progress indicator or toast) |
| 9 | Wait for atomization to complete | Atom count updates to non-zero |
| 10 | Verify atoms created | Atoms visible with categories: `key_personnel`, `past_performance`, `technical_approach`, `corporate_overview`, etc. |
| 11 | (Optional) Navigate to Library Review: `{BASE_URL}/portal/{slug}/library/review` | Review page shows atoms for quality verification |

**Events emitted:**
- `library:file.uploaded:single` -- per file
- `library:document.atomized:start` and `library:document.atomized:end` -- payload includes `atomsCreated` count

**Clickable links:**
- `{BASE_URL}/portal/{slug}/library`
- `{BASE_URL}/portal/{slug}/library/upload`
- `{BASE_URL}/portal/{slug}/library/review`

---

## 4b. Library Upload, Atomize, and Review Flow

> :warning: **Prerequisite:** Step 4 must be completed. At least one document must be uploaded to the library.

**Goal:** Verify the complete library lifecycle: upload a document, atomize it into reusable content atoms, and review the atoms for quality.

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to Library: `{BASE_URL}/portal/{slug}/library` | Library page loads showing uploaded documents from Step 4 |
| 2 | Select an uploaded document (e.g., capability statement) | Document detail visible with metadata |
| 3 | Click "Atomize" on the document | Atomization job starts, progress indicator or toast shown |
| 4 | Wait for atomization to complete (30-120 seconds) | Atom count updates to a non-zero value |
| 5 | Verify atoms created with categories | Atoms visible with assigned categories: `key_personnel`, `past_performance`, `technical_approach`, `corporate_overview`, etc. |
| 6 | Navigate to Library Review: `{BASE_URL}/portal/{slug}/library/review` | Review page loads showing atoms awaiting quality review |
| 7 | Verify review page displays atom previews | Each atom shows: content preview, category, confidence score, source document reference |
| 8 | Approve a high-quality atom | Atom status changes to "approved" |
| 9 | Reject a low-quality atom with reason | Atom status changes to "rejected", reason stored |
| 10 | Return to Library list | Approved atoms show correct status; rejected atoms filtered or marked |
| 11 | Search library for content from the atomized document | Search returns matching atoms |
| 12 | Filter by category (e.g., "past_performance") | Only atoms in that category shown |

**Events emitted:**
- `library:document.atomized:start` and `library:document.atomized:end` -- payload includes `atomsCreated` count
- `library:atom.reviewed:single` -- per atom review action, payload includes `atomId`, `status`, `reviewerId`

**Clickable links:**
- `{BASE_URL}/portal/{slug}/library`
- `{BASE_URL}/portal/{slug}/library/review`

---

## 5. Browse Spotlight Feed

> :warning: **Prerequisite:** Step 3 must be completed (logged in as customer). Admin must have pushed at least one solicitation to Spotlight (see Admin E2E Guide, Step 4).

**Goal:** View curated opportunities in the Spotlight feed with unified scoring (pipeline pre-computed scores with estimation fallback).

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to Spotlights: `{BASE_URL}/portal/{slug}/spotlights` | Spotlight feed loads |
| 2 | Verify opportunity cards visible | At least one curated opportunity from admin curation |
| 3 | Each card shows: | |
|   | - Title | Solicitation/topic title |
|   | - Agency | e.g., "Department of Defense" |
|   | - Close date | Submission deadline |
|   | - Program type | e.g., "SBIR Phase I" |
|   | - Score badge | Pipeline-scored: solid badge with numeric score. Unscored/estimated: dashed border badge with "Est." label |
| 4 | Verify scoring display for pipeline-scored opportunities | Score badge is solid (filled background), showing the numeric score from pipeline pre-computation |
| 5 | Verify scoring display for unscored/estimated opportunities | Score badge has dashed border with "Est." label, indicating estimation fallback |
| 6 | Verify sort order | Pipeline-scored opportunities appear first, then estimated. Within each group, higher scores sort first |
| 7 | Click into a pipeline-scored opportunity | Detail page loads at `{BASE_URL}/portal/{slug}/spotlights/{spotlightId}` |
| 8 | Verify detail view shows: | |
|   | - Full topic description | Complete text from the solicitation |
|   | - Compliance summary | Page limits, font requirements, margin requirements |
|   | - Evaluation criteria | If extracted during curation |
|   | - Score breakdown with source | Factor breakdown visible, source labeled as "pipeline" or "estimated" |
|   | - "Pin" button | Visible and clickable |
|   | - "Build Proposal" button | Visible and clickable |

**Clickable links:**
- `{BASE_URL}/portal/{slug}/spotlights`
- `{BASE_URL}/portal/{slug}/spotlights/{spotlightId}`

---

## 6. Pin a Topic

> :warning: **Prerequisite:** Step 5 must be completed. You must be viewing a Spotlight detail page.

**Goal:** Pin an opportunity to track it and signal interest to the admin.

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | On the Spotlight detail page, click "Pin" button | Button state changes to "Pinned" (or equivalent visual feedback) |
| 2 | Navigate back to Spotlights list: `{BASE_URL}/portal/{slug}/spotlights` | Pinned topic shows a pin indicator |
| 3 | Check customer dashboard: `{BASE_URL}/portal/{slug}/dashboard` | Pinned topic appears in a "Pinned Topics" or "My Topics" section |
| 4 | (Admin verification) Log in as admin | |
| 5 | Navigate to the curation workspace for this solicitation | Customer Interest tab shows this tenant as interested |
| 6 | Navigate to admin Event Stream: [{BASE_URL}/admin/events]({BASE_URL}/admin/events) | |
| 7 | Filter by namespace: `capture` | `capture:topic.pinned:single` event visible with `tenantId` and `opportunityId` |

**Event emitted:** `capture:topic.pinned:single` -- payload includes `tenantId` and `opportunityId`

---

## 7. Monitor Pinned Topics (Deadline Reminders)

> :warning: **Prerequisite:** Step 6 must be completed. Notification system depends on CRM email integration being active.

**Goal:** Verify that deadline-approaching notifications surface for pinned topics.

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to customer dashboard: `{BASE_URL}/portal/{slug}/dashboard` | Dashboard loads |
| 2 | Check for deadline reminders | Pinned topics with approaching deadlines should display warnings |
| 3 | Q&A period ending notification | If the pinned topic's Q&A period is ending within 7 days, a notification appears |
| 4 | Submission deadline notification | If the close_date is within 14 days, a deadline warning appears |
| 5 | (Optional) Check email | If CRM email integration is active, reminder emails should arrive at the customer's email |

**Note:** If the CRM email service is not active in the test environment, deadline notifications may only appear in the dashboard UI. Verify with the admin whether email automation rules are configured.

---

## 8. Purchase Proposal Portal

> :warning: **Prerequisite:** Step 6 must be completed (topic pinned). Stripe must be configured in the environment (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` env vars).

**Goal:** Purchase a proposal workspace for a pinned topic.

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to the pinned topic's Spotlight detail page | Detail page loads |
| 2 | Click "Build Proposal" button | Redirect to Stripe checkout (or direct creation for founding cohort) |
| **Stripe Checkout Path** | | |
| 3 | Stripe checkout page loads | Product: Proposal Portal, price visible ($999 or $1999) |
| 4 | Enter test card number: `4242 4242 4242 4242` | Card accepted |
| 5 | Enter any future expiry (e.g., `12/28`), any CVC (e.g., `123`), any ZIP | Fields accepted |
| 6 | Click "Pay" / "Subscribe" | Payment processes |
| 7 | Verify redirect back to platform | Redirect to proposal workspace or confirmation page |
| **Direct Creation Path (Founding Cohort)** | | |
| 3a | If founding cohort: proposal created without Stripe | Redirect directly to proposal workspace |
| **Verification** | | |
| 8 | Verify proposal created | Proposal visible at `{BASE_URL}/portal/{slug}/proposals/{proposalId}` |
| 9 | Verify sections pre-populated | Sections created from `volume_required_items` (from admin curation Step 4) |
| 10 | Verify section titles match volumes | e.g., "Technical Approach", "Key Personnel", "Past Performance", "Cost Breakdown" |
| 11 | Verify all sections start with status `empty` | Status badges show "empty" for each section |

**Events emitted:**
- `proposal:proposal.created:start` and `proposal:proposal.created:end` -- payload includes `proposalId`, `sectionCount`
- `capture:purchase.completed:single` -- if Stripe is wired, payload includes `tenantId`, `proposalId`, `productType`

**Placeholder values:**
- `{proposalId}` -- UUID of the created proposal (visible in URL after creation)

**Clickable link:** `{BASE_URL}/portal/{slug}/proposals/{proposalId}`

---

## 9. Proposal Workspace

> :warning: **Prerequisite:** Step 8 must be completed. You need the `{proposalId}` from the purchase step.

**Goal:** Verify the proposal workspace renders correctly with sections, stages, and AI drafting.

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to proposal workspace: `{BASE_URL}/portal/{slug}/proposals/{proposalId}` | Workspace loads |
| 2 | Verify section list | All sections from volume_required_items visible with: |
|   | | - Section number |
|   | | - Title |
|   | | - Page allocation |
|   | | - Status badge (`empty`, `ai_drafted`, `in_progress`, `complete`) |
| 3 | Verify stage progress bar | Stages visible: outline -> draft -> pink_team -> red_team -> gold_team -> final -> submitted |
| 4 | Verify current stage | Should be `outline` (initial stage) |
| 5 | Click "Draft All Sections" | AI drafting job starts |
| 6 | Wait for AI drafting to complete | Each section fills with AI-generated content |
| 7 | Verify section statuses update | Sections change from `empty` to `ai_drafted` |
| 8 | Verify AI content uses library atoms | Generated text should reference capability statement, past performance, and key personnel from library uploads (Step 4) |

> :warning: **Note:** AI drafting requires `ANTHROPIC_API_KEY` to be set in the environment. If the key is missing, drafting will fail silently or show an error.

**Events emitted:**
- `proposal:section.saved:single` -- per section, with `proposalId`, `sectionId`, `version`

**Clickable link:** `{BASE_URL}/portal/{slug}/proposals/{proposalId}`

---

## 10. Edit a Section in Canvas Editor

> :warning: **Prerequisite:** Step 9 must be completed. At least one section should have AI-drafted content.

**Goal:** Edit proposal content in the WYSIWYG canvas editor with compliance-aware formatting.

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Click on a section title (e.g., "Technical Approach") | Canvas editor loads at `{BASE_URL}/portal/{slug}/proposals/{proposalId}/sections/{sectionId}` |
| 2 | Verify canvas renders with compliance-correct formatting: | |
|   | - Page dimensions | Letter size (8.5" x 11") |
|   | - Font | Times New Roman 10pt (or as specified in compliance matrix) |
|   | - Margins | 1 inch all sides (or as specified) |
|   | - Headers/footers | Company name, topic number, page numbering |
| 3 | Verify AI-drafted content visible | Text nodes populated with generated content |
| 4 | Click on a text node to edit | Cursor appears, text is editable |
| 5 | Make an edit (add or change text) | Changes appear in real-time |
| 6 | Use AI Revision Panel: | |
|   | - Select a paragraph | Selection highlight appears |
|   | - Click "Make shorter" | AI rewrites the paragraph more concisely |
|   | - (Or) Click "Add metrics" | AI adds quantitative data to the paragraph |
| 7 | Click "Save" | Save confirmation (toast or status indicator) |
| 8 | Verify version incremented | Version number increases (visible in version history dropdown) |
| 9 | (Optional) Open version history | Previous versions listed with timestamps and authors |
| 10 | (Optional) Revert to a previous version | Content reverts to the selected version's state |

**Event emitted:** `proposal:section.saved:single` -- payload includes `proposalId`, `sectionId`, `version`

**Clickable link:** `{BASE_URL}/portal/{slug}/proposals/{proposalId}/sections/{sectionId}`

---

## 11. Collaboration & Comments

> :warning: **Prerequisite:** Step 10 must be completed. You should be in the canvas editor.

**Goal:** Add and resolve comments on proposal content.

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | In the canvas editor, right-click (or use comment button) on a text node | Comment input appears |
| 2 | Type a comment (e.g., "Need to add specific contract numbers here") | Comment text entered |
| 3 | Submit the comment | Comment appears in the sidebar comment panel |
| 4 | Verify comment shows: | |
|   | - Author name | Your user name |
|   | - Timestamp | Current time |
|   | - Associated text/node | Linked to the correct location in the document |
| 5 | Click "Resolve" on the comment | Comment marked as resolved (visual change: strikethrough, grayed out, or hidden) |
| 6 | Verify resolved state | Comment no longer appears in active comments (or shows resolved indicator) |

**Events emitted:**
- `proposal:comment.created:single` -- payload includes `proposalId`, `nodeId`
- `proposal:comment.resolved:single` -- payload includes `commentId`

---

## 12. Stage Advancement

> :warning: **Prerequisite:** Steps 9-11 should be completed. User must have `tenant_admin` role.

**Goal:** Advance the proposal through all stages from outline to submitted.

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to proposal workspace: `{BASE_URL}/portal/{slug}/proposals/{proposalId}` | Workspace loads at current stage |
| 2 | Click "Advance Stage" (or equivalent button) | |
| **Stage: outline -> draft** | | |
| 3 | Advance from `outline` to `draft` | Stage badge updates to `draft`, progress bar advances |
| 4 | Verify event | `proposal:proposal.advanced:single` with `fromStage=outline`, `toStage=draft` |
| **Stage: draft -> pink_team** | | |
| 5 | Advance from `draft` to `pink_team` | Stage badge updates |
| 6 | Pink team review: verify all sections are reviewable | Sections should be readable and commentable |
| **Stage: pink_team -> red_team** | | |
| 7 | Advance from `pink_team` to `red_team` | Stage badge updates |
| **Stage: red_team -> gold_team** | | |
| 8 | Advance from `red_team` to `gold_team` | Stage badge updates |
| **Stage: gold_team -> final** | | |
| 9 | Advance from `gold_team` to `final` | Stage badge updates to `final` |
| 10 | Verify workspace auto-locks | `is_locked=true` -- edit buttons disabled, canvas is read-only |
| 11 | Attempt to edit a section | Edit should be blocked (read-only mode) |
| **Stage: final -> submitted** | | |
| 12 | Advance from `final` to `submitted` | Stage badge updates to `submitted` |
| 13 | Verify permanent lock | Workspace permanently locked, no further edits possible |

**Events emitted (one per advancement):**
- `proposal:proposal.advanced:single` -- 6 events total, each with `fromStage` and `toStage`
- `proposal:proposal.locked:single` -- when workspace locks at `final` stage

**Note:** Each stage advancement may trigger the `OnProposalAdvanced` workflow (review notifications, HITL wait steps for team reviews). Check with admin whether review gates are enforced or can be bypassed for testing.

---

## 13. Export & Submission

> :warning: **Prerequisite:** Proposal must be at `final` or `submitted` stage (Step 12).

**Goal:** Export the completed proposal as a .docx file and verify compliance formatting.

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | At the `final` stage, navigate to a section's canvas editor | Canvas loads in read-only mode |
| 2 | Click "Export .docx" in the canvas toolbar | File download begins |
| 3 | Save the .docx file locally | File saves successfully |
| 4 | Open the .docx file in Microsoft Word | Document opens without errors |
| 5 | Verify compliance formatting: | |
|   | - Font | Times New Roman 10pt (or as specified in RFP) |
|   | - Margins | 1 inch all sides (or as specified) |
|   | - Headers | Company name, topic number present |
|   | - Footers | Page numbering (e.g., "Page 1 of 15") |
|   | - Page count | Within the page limit specified in compliance matrix |
| 6 | Verify content quality | AI-drafted and manually edited content present, no placeholder text remaining |
| 7 | Navigate back to proposal workspace | Workspace shows `submitted` status |
| 8 | Verify audit trail | Full history of all saves, comments, and stage changes visible |

**Clickable link:** `{BASE_URL}/portal/{slug}/proposals/{proposalId}`

---

## 14. Verify End-to-End Event Chain

> :warning: **Prerequisite:** All previous steps (1-13) must be completed. This step is performed by Eric (master_admin).

**Goal:** Verify the complete event chain from application through submission.

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Log in as master_admin at [{BASE_URL}/login]({BASE_URL}/login) | Admin dashboard loads |
| 2 | Navigate to Event Stream: [{BASE_URL}/admin/events]({BASE_URL}/admin/events) | Event stream page loads |
| 3 | (If available) Filter by tenant: `{tenantId}` | Only events for this tenant shown |
| 4 | Verify the complete event chain in chronological order: | |

**Expected event chain:**

| Order | Namespace | Event Type | Phase | Key Payload |
|-------|-----------|-----------|-------|-------------|
| 1 | `capture` | `application.submitted` | `single` | email, companyName |
| 2 | `capture` | `application.accepted` | `start` | applicationId |
| 3 | `capture` | `application.accepted` | `end` | tenantId, userId |
| 4 | `identity` | `user.logged_in` | `single` | userId |
| 5 | `identity` | `user.password_changed` | `start` | userId |
| 6 | `identity` | `user.password_changed` | `end` | userId |
| 7 | `library` | `file.uploaded` | `single` | tenantId, fileCount |
| 8 | `library` | `document.atomized` | `start`/`end` | tenantId, atomsCreated |
| 9 | `capture` | `topic.pinned` | `single` | tenantId, opportunityId |
| 10 | `proposal` | `proposal.created` | `start` | tenantId, opportunityId |
| 11 | `proposal` | `proposal.created` | `end` | proposalId, sectionCount |
| 12 | `capture` | `purchase.completed` | `single` | tenantId, proposalId (if Stripe) |
| 13 | `proposal` | `section.saved` | `single` | proposalId, sectionId, version (multiple) |
| 14 | `proposal` | `comment.created` | `single` | proposalId, nodeId |
| 15 | `proposal` | `comment.resolved` | `single` | commentId |
| 16 | `proposal` | `proposal.advanced` | `single` | fromStage=outline, toStage=draft |
| 17 | `proposal` | `proposal.advanced` | `single` | fromStage=draft, toStage=pink_team |
| 18 | `proposal` | `proposal.advanced` | `single` | fromStage=pink_team, toStage=red_team |
| 19 | `proposal` | `proposal.advanced` | `single` | fromStage=red_team, toStage=gold_team |
| 20 | `proposal` | `proposal.advanced` | `single` | fromStage=gold_team, toStage=final |
| 21 | `proposal` | `proposal.locked` | `single` | proposalId |
| 22 | `proposal` | `proposal.advanced` | `single` | fromStage=final, toStage=submitted |

| 5 | Verify every event has required fields | `namespace`, `type`, `phase`, `actor_type`, `actor_id`, `created_at`, `correlationId` (in payload) |
| 6 | Verify `parent_event_id` links | Every `end` event references its corresponding `start` event |
| 7 | Verify tenant_id consistency | All `capture`, `proposal`, and `library` events for this customer have the correct `tenantId` |
| 8 | Verify no orphaned start events | Every `start` event has a corresponding `end` event (no stuck operations) |

**Clickable link:** [{BASE_URL}/admin/events]({BASE_URL}/admin/events)

---

## Quick Reference: All Customer Portal Routes

| Page | URL | Nav Item |
|------|-----|----------|
| Dashboard | `{BASE_URL}/portal/{slug}/dashboard` | Dashboard |
| Spotlights | `{BASE_URL}/portal/{slug}/spotlights` | Spotlight |
| Spotlight Detail | `{BASE_URL}/portal/{slug}/spotlights/{spotlightId}` | (from Spotlight) |
| Library | `{BASE_URL}/portal/{slug}/library` | Library |
| Library Upload | `{BASE_URL}/portal/{slug}/library/upload` | (from Library) |
| Library Review | `{BASE_URL}/portal/{slug}/library/review` | (from Library) |
| Proposals | `{BASE_URL}/portal/{slug}/proposals` | Proposals |
| Proposal Workspace | `{BASE_URL}/portal/{slug}/proposals/{proposalId}` | (from Proposals) |
| Section Editor | `{BASE_URL}/portal/{slug}/proposals/{proposalId}/sections/{sectionId}` | (from Workspace) |
| Proposal Review | `{BASE_URL}/portal/{slug}/proposals/{proposalId}/review` | (from Workspace) |
| Team | `{BASE_URL}/portal/{slug}/team` | Team |
| Settings / Profile | `{BASE_URL}/portal/{slug}/profile` | Settings |
| Billing | `{BASE_URL}/portal/{slug}/billing` | (from Settings) |
| Documents | `{BASE_URL}/portal/{slug}/documents` | (from Settings) |

---

## Cross-Reference: Admin + Customer Test Dependency Chain

The admin and customer E2E tests are interdependent. Here is the recommended execution order:

```
Admin Guide Step 1  (Login)
Admin Guide Step 2  (Source Monitoring)
Admin Guide Step 3  (Upload RFP)
Admin Guide Step 4  (Curate & Push to Spotlight)
    |
    v
Customer Guide Step 1  (Apply)
    |
    v
Admin Guide Step 8  (Accept Application)  <-- cross-reference
    |
    v
Customer Guide Step 3  (First Login)
Customer Guide Step 4  (Upload Library Docs)
Customer Guide Step 5  (Browse Spotlights)  <-- depends on Admin Step 4
Customer Guide Step 6  (Pin Topic)
Customer Guide Step 7  (Monitor Deadlines)
Customer Guide Step 8  (Purchase Proposal)
Customer Guide Step 9  (Proposal Workspace)
Customer Guide Step 10 (Canvas Editor)
Customer Guide Step 11 (Comments)
Customer Guide Step 12 (Stage Advancement)
Customer Guide Step 13 (Export)
Customer Guide Step 14 (Verify Event Chain)  <-- admin verifies
    |
    v
Admin Guide Step 5  (Verify Events)   <-- covers both admin + customer events
Admin Guide Step 6  (Verify Pipeline)
Admin Guide Step 7  (System Health)
```

---

## Troubleshooting

| Symptom | Likely Cause | Action |
|---------|--------------|--------|
| Application form not at /apply | Marketing routes may use different path | Check `{BASE_URL}/` for a link to the application form |
| Temp password not visible after acceptance | Password may be emailed, not shown in UI | Check CRM email logs or ask admin for the temp password |
| Change-password redirect not happening | `temp_password` flag not set on user | Admin should verify the user record has `temp_password=true` |
| Spotlights page empty | No solicitations pushed to Spotlight | Complete Admin E2E Guide Steps 3-4 first |
| "Build Proposal" fails | Stripe not configured or `STRIPE_SECRET_KEY` missing | Check Railway env vars; for founding cohort, direct creation may be used instead |
| AI drafting fails or returns empty content | `ANTHROPIC_API_KEY` missing or invalid | Verify env var on Railway; check pipeline service logs |
| Canvas editor blank | `proposal_sections.content` is NULL | Verify proposal provisioning created sections correctly |
| Export .docx fails | docx generation library error | Check browser console for JS errors; verify canvas content is valid JSON |
| Stage advancement blocked | Gate requirements not met (e.g., all sections must be `complete`) | Check section statuses; advance any remaining `empty` or `in_progress` sections |
| Events missing from stream | Event emission failed silently | Check server error logs for `[events]` prefix; verify DB connectivity |

---

## Stripe Test Cards Quick Reference

| Scenario | Card Number | Expiry | CVC |
|----------|-------------|--------|-----|
| Successful payment | `4242 4242 4242 4242` | Any future date | Any 3 digits |
| Declined (generic) | `4000 0000 0000 0002` | Any future date | Any 3 digits |
| Requires authentication | `4000 0025 0000 3155` | Any future date | Any 3 digits |
| Insufficient funds | `4000 0000 0000 9995` | Any future date | Any 3 digits |

Use the successful payment card for the happy-path test. Use the others to verify error handling.
