# Human-in-the-Loop Test Plan -- V1 Baseline

**Date:** 2026-05-21
**Deployment:** www.rfppipeline.com (Frontend), rfp-crm-production.up.railway.app (CMS)
**Migration:** `db/migrations/041_seed_test_accounts.sql`
**Estimated Time:** 90-120 minutes (full run)

---

## Section 0: Test Accounts

| Role | Email | Password | Tenant | Purpose |
|------|-------|----------|--------|---------|
| Platform Admin | eric.c.wagner@gmail.com | TestAdmin2026! | None (admin) | Full admin access, RFP curation, tenant management |
| Customer Admin | admin@apexdefense.test | TestCustomer2026! | Apex Defense Solutions | Tenant admin: manage team, proposals, billing |
| Customer Employee | james@apexdefense.test | TestEmployee2026! | Apex Defense Solutions | Limited tenant access, view-only for restricted pages |
| External Partner | partner@techalliance.test | TestPartner2026! | Apex Defense Solutions | Proposal collaborator, stage-scoped access only |

**Tenant UUID:** `a0a0a0a0-b1b1-c2c2-d3d3-e4e4e4e4e4e4`
**Tenant slug:** `apex-defense`

---

## Section 1: Public Marketing Site (Unauthenticated)

> **Prerequisite:** Sign out of all sessions or use an incognito window.

### 1.1 Landing Page

- [ ] **Step 1:** Open [https://www.rfppipeline.com](https://www.rfppipeline.com)
- [ ] **Expected:** Landing page loads with hero section, top bar ("Now Accepting Applications"), stats, six stages, pricing, and CTA buttons
- [ ] **Step 2:** Verify the top bar shows "Now Accepting Applications -- Founding Cohort -- Platform launches July 2026" with an "Apply" link
- [ ] **Expected:** Top bar renders in dark navy background with citrus-colored accents
- [ ] **Step 3:** Scroll through the entire page from top to bottom
- [ ] **Expected:** All sections render fully, no broken images, no layout shifts, no JS errors in console

### 1.2 Header Navigation -- Platform Dropdown

- [ ] **Step 4:** Hover over "Platform" in the header navigation
- [ ] **Expected:** Dropdown menu appears with five links: Features, Engine, How It Works, The Expert, Pricing
- [ ] **Step 5:** Click "Features" in the dropdown
- [ ] **Expected:** [https://www.rfppipeline.com/features](https://www.rfppipeline.com/features) loads with feature descriptions
- [ ] **Step 6:** Click browser back, then hover "Platform" and click "Engine"
- [ ] **Expected:** [https://www.rfppipeline.com/engine](https://www.rfppipeline.com/engine) loads with engine/technology content
- [ ] **Step 7:** Navigate to [https://www.rfppipeline.com/how-it-works](https://www.rfppipeline.com/how-it-works)
- [ ] **Expected:** How It Works page loads with step-by-step process description
- [ ] **Step 8:** Navigate to [https://www.rfppipeline.com/the-expert](https://www.rfppipeline.com/the-expert)
- [ ] **Expected:** The Expert page loads with AI assistant description
- [ ] **Step 9:** Navigate to [https://www.rfppipeline.com/pricing](https://www.rfppipeline.com/pricing)
- [ ] **Expected:** Pricing page loads with tier comparison (Finder, Reminder, Binder, Grinder)

### 1.3 Header Navigation -- Top-Level Links

- [ ] **Step 10:** Click "About" in the header
- [ ] **Expected:** [https://www.rfppipeline.com/about](https://www.rfppipeline.com/about) loads with company information
- [ ] **Step 11:** Click "Resources" in the header
- [ ] **Expected:** [https://www.rfppipeline.com/resources](https://www.rfppipeline.com/resources) loads with resource listings
- [ ] **Step 12:** Click "Blog" in the header
- [ ] **Expected:** [https://www.rfppipeline.com/blog](https://www.rfppipeline.com/blog) loads with blog post listings (may be empty if no published posts)
- [ ] **Step 13:** Click "Security" in the header
- [ ] **Expected:** [https://www.rfppipeline.com/infosec](https://www.rfppipeline.com/infosec) loads with security and data handling information

### 1.4 Footer Navigation

- [ ] **Step 14:** Scroll to the footer on any marketing page
- [ ] **Expected:** Four-column footer with Platform, Company, Resources, Legal sections
- [ ] **Step 15:** Click "Team" in the Company column
- [ ] **Expected:** [https://www.rfppipeline.com/team](https://www.rfppipeline.com/team) loads with team information
- [ ] **Step 16:** Click "Customers" in the Company column
- [ ] **Expected:** [https://www.rfppipeline.com/customers](https://www.rfppipeline.com/customers) loads
- [ ] **Step 17:** Click "Value" in the Company column
- [ ] **Expected:** [https://www.rfppipeline.com/value](https://www.rfppipeline.com/value) loads

### 1.5 Legal Pages

- [ ] **Step 18:** Navigate to [https://www.rfppipeline.com/legal/terms](https://www.rfppipeline.com/legal/terms)
- [ ] **Expected:** Terms of Service page renders with full legal text
- [ ] **Step 19:** Navigate to [https://www.rfppipeline.com/legal/privacy](https://www.rfppipeline.com/legal/privacy)
- [ ] **Expected:** Privacy Policy page renders
- [ ] **Step 20:** Navigate to [https://www.rfppipeline.com/legal/acceptable-use](https://www.rfppipeline.com/legal/acceptable-use)
- [ ] **Expected:** Acceptable Use Policy page renders
- [ ] **Step 21:** Navigate to [https://www.rfppipeline.com/legal/ai-disclosure](https://www.rfppipeline.com/legal/ai-disclosure)
- [ ] **Expected:** AI Disclosure page renders

### 1.6 Mobile Navigation

- [ ] **Step 22:** Resize browser to mobile width (< 768px) or use DevTools device toolbar
- [ ] **Expected:** Desktop nav links hide, hamburger menu icon appears
- [ ] **Step 23:** Click the hamburger menu icon
- [ ] **Expected:** Mobile menu slides open with all navigation links: Platform (with children: Features, Engine, How It Works, The Expert, Pricing), About, Resources, Blog, Security
- [ ] **Step 24:** Click "Features" in the mobile menu
- [ ] **Expected:** Navigates to /features, menu closes
- [ ] **Step 25:** Resize browser back to desktop width (> 768px)
- [ ] **Expected:** Desktop navigation reappears, hamburger icon disappears

### 1.7 Application Flow

- [ ] **Step 26:** Click "Apply Now" in the header (or navigate to [https://www.rfppipeline.com/apply](https://www.rfppipeline.com/apply))
- [ ] **Expected:** Application form loads with all required fields
- [ ] **Step 27:** Fill in the application form with test data:
  - Company Name: `Test Company LLC`
  - Contact Name: `Test User`
  - Email: `test@example.com`
  - Phone: `555-0100`
  - Website: `https://test.com`
  - NAICS: `541511`
  - Description: `We build AI systems for defense applications`
- [ ] **Expected:** All fields accept input, chip buttons work for multi-select fields
- [ ] **Step 28:** Scroll through the Terms & Conditions section to the bottom
- [ ] **Expected:** Scroll-to-accept pattern: submit button becomes enabled only after scrolling to the bottom of T&C
- [ ] **Step 29:** Accept the Terms & Conditions and click "Submit Application"
- [ ] **Expected:** Success confirmation message displays. Application is submitted.
- [ ] **Step 30:** Note: This application will be reviewed in Section 2.4

### 1.8 Authentication Pages

- [ ] **Step 31:** Navigate to [https://www.rfppipeline.com/login](https://www.rfppipeline.com/login)
- [ ] **Expected:** Login form renders with email field, password field, "Sign In" button, and "Forgot password?" link
- [ ] **Step 32:** Enter invalid credentials: email `nobody@example.com`, password `wrong`
- [ ] **Expected:** Error message displays (e.g., "Invalid email or password")
- [ ] **Step 33:** Leave email blank and click "Sign In"
- [ ] **Expected:** Client-side validation prevents submission or shows validation error
- [ ] **Step 34:** Click "Forgot password?" link
- [ ] **Expected:** [https://www.rfppipeline.com/forgot-password](https://www.rfppipeline.com/forgot-password) loads with email input form

### 1.9 Get Started / Waitlist

- [ ] **Step 35:** Navigate to [https://www.rfppipeline.com/get-started](https://www.rfppipeline.com/get-started)
- [ ] **Expected:** Get started page loads (may redirect to /apply or show waitlist form)

---

## Section 2: Admin Panel (as eric.c.wagner@gmail.com)

> **Prerequisite:** Signed out of any previous session.

### 2.1 Admin Login

- [ ] **Step 1:** Navigate to [https://www.rfppipeline.com/login](https://www.rfppipeline.com/login)
- [ ] **Step 2:** Enter email: `eric.c.wagner@gmail.com`
- [ ] **Step 3:** Enter password: `TestAdmin2026!`
- [ ] **Step 4:** Click "Sign In"
- [ ] **Expected:** Redirect to [https://www.rfppipeline.com/admin/dashboard](https://www.rfppipeline.com/admin/dashboard)

### 2.2 Admin Dashboard

- [ ] **Step 5:** Verify dashboard page loads at [https://www.rfppipeline.com/admin/dashboard](https://www.rfppipeline.com/admin/dashboard)
- [ ] **Expected:** Page renders without errors, stat cards visible
- [ ] **Step 6:** Verify stat cards are present (some may show 0 on fresh deploy):
  - Pending Applications
  - Active Tenants
  - Library Atoms
  - Active Proposals
  - RFPs in Curation
  - Events Today
- [ ] **Expected:** Each card shows a numeric value and label
- [ ] **Step 7:** Verify recent events table at the bottom
- [ ] **Expected:** Table shows recent system events with namespace, type, actor, and timestamp (at minimum a login event from Step 4)
- [ ] **Step 8:** Verify pending actions or alerts section
- [ ] **Expected:** Alerts section displays (may list the test application from Section 1.7 if submitted)

### 2.3 Admin Sidebar Navigation -- Opportunities Group

- [ ] **Step 9:** Click "RFP Curation" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/admin/rfp-curation](https://www.rfppipeline.com/admin/rfp-curation) loads. Triage queue displays (may be empty if no solicitations ingested)
- [ ] **Step 10:** Click "Sources" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/admin/sources](https://www.rfppipeline.com/admin/sources) loads. Source profiles listed (pre-seeded profiles: DSIP, AFWERX, xTech, NSF, SAM.gov, Defense SBIR)
- [ ] **Step 11:** Click "Pipeline Jobs" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/admin/pipeline](https://www.rfppipeline.com/admin/pipeline) loads. Job queue and cron schedule display
- [ ] **Step 12:** Click "Templates" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/admin/templates](https://www.rfppipeline.com/admin/templates) loads. Template list or empty state displays

### 2.4 Admin Sidebar Navigation -- Customers Group

- [ ] **Step 13:** Click "Applications" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/admin/applications](https://www.rfppipeline.com/admin/applications) loads. Application list displays
- [ ] **Step 14:** Verify the test application from Section 1.7 appears (if submitted)
- [ ] **Expected:** Application from `test@example.com` / `Test Company LLC` is visible in the list
- [ ] **Step 15:** Click on the test application to open the review panel
- [ ] **Expected:** Application detail panel opens with company info, contact details, NAICS codes, and admin action buttons
- [ ] **Step 16:** Test the Accept flow: click "Accept" (add admin notes if required)
- [ ] **Expected:** Application status changes to "accepted". Tenant and user are created. Confirmation email would be sent.
- [ ] **Step 17:** Click "Tenants" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/admin/tenants](https://www.rfppipeline.com/admin/tenants) loads. Tenant list displays
- [ ] **Step 18:** Verify "Apex Defense Solutions" appears in the tenant list
- [ ] **Expected:** Row shows Apex Defense Solutions with slug `apex-defense`, status `active`, and user count (3 users: Sarah, James, Maria)
- [ ] **Step 19:** Click on "Apex Defense Solutions" to view tenant detail
- [ ] **Expected:** [https://www.rfppipeline.com/admin/tenants/{tenantId}](https://www.rfppipeline.com/admin/tenants/a0a0a0a0-b1b1-c2c2-d3d3-e4e4e4e4e4e4) loads with company info, users list, proposals, and pipeline items
- [ ] **Step 20:** Click "Billing" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/admin/billing](https://www.rfppipeline.com/admin/billing) loads. Billing overview or Stripe integration status displays
- [ ] **Step 21:** Click "Waitlist" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/admin/waitlist](https://www.rfppipeline.com/admin/waitlist) loads. Waitlist entries display (may be empty)
- [ ] **Step 22:** Click "Purchases" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/admin/purchases](https://www.rfppipeline.com/admin/purchases) loads. Purchase records display (may be empty)
- [ ] **Step 23:** Click "Proposals" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/admin/proposals](https://www.rfppipeline.com/admin/proposals) loads. All proposals across all tenants display (may be empty)

### 2.5 Admin Sidebar Navigation -- Content Group

- [ ] **Step 24:** Click "CMS Content" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/admin/content](https://www.rfppipeline.com/admin/content) loads. CMS content blocks listed (may show seeded marketing pages)
- [ ] **Step 25:** Click "New" or "Create" to start a new content block
- [ ] **Expected:** Content editor form loads with title, slug, content type, and body fields
- [ ] **Step 26:** Click "Document Builder" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/admin/documents](https://www.rfppipeline.com/admin/documents) loads. Document list or empty state displays
- [ ] **Step 27:** Click "S3 Storage" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/admin/storage](https://www.rfppipeline.com/admin/storage) loads. S3 file browser with bucket contents displays

### 2.6 Admin Sidebar Navigation -- System Group

- [ ] **Step 28:** Click "Event Stream" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/admin/events](https://www.rfppipeline.com/admin/events) loads. Filterable event stream with namespace, type, actor, and timestamp columns
- [ ] **Step 29:** Verify events from your login and any actions taken appear in the stream
- [ ] **Expected:** At least `identity.user.logged_in` event visible
- [ ] **Step 30:** Test event stream filter: type a namespace (e.g., `identity`) in the filter input
- [ ] **Expected:** Events are filtered to only show matching namespace
- [ ] **Step 31:** Click "Agents" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/admin/agents](https://www.rfppipeline.com/admin/agents) loads. Agent registry or provisioning page displays
- [ ] **Step 32:** Click "Process Monitor" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/admin/process](https://www.rfppipeline.com/admin/process) loads. Process/worker status displays
- [ ] **Step 33:** Click "System Health" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/admin/system](https://www.rfppipeline.com/admin/system) loads. System health metrics (DB status, service connectivity, memory/CPU) display
- [ ] **Step 34:** Click "Analytics" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/admin/analytics](https://www.rfppipeline.com/admin/analytics) loads. Visitor analytics, page view data display

### 2.7 Admin Sidebar Navigation -- CRM Group

- [ ] **Step 35:** Click "CRM Console" in the sidebar
- [ ] **Expected:** New browser tab opens to [https://rfp-crm-production.up.railway.app/cms/](https://rfp-crm-production.up.railway.app/cms/)
- [ ] **Expected:** CMS SPA loads with dark sidebar and Dashboard page (tested in detail in Section 3)

### 2.8 RFP Curation Workflow (if solicitations exist)

- [ ] **Step 36:** Navigate to [https://www.rfppipeline.com/admin/rfp-curation](https://www.rfppipeline.com/admin/rfp-curation)
- [ ] **Step 37:** If triage queue has items: click on a solicitation to view detail
- [ ] **Expected:** Detail page loads at `/admin/rfp-curation/{solId}` with PDF viewer, compliance matrix, topic panel, and activity feed
- [ ] **Step 38:** Click "Claim" to claim the solicitation for review
- [ ] **Expected:** Status changes to "claimed", your name shows as reviewer
- [ ] **Step 39:** Add annotations or compliance variables (if applicable)
- [ ] **Expected:** Annotations persist on refresh
- [ ] **Step 40:** Click "Push" to push solicitation to customer spotlight feeds
- [ ] **Expected:** Status changes to "published", opportunities created for matching tenants

### 2.9 RFP Upload

- [ ] **Step 41:** Navigate to [https://www.rfppipeline.com/admin/rfp-curation/upload](https://www.rfppipeline.com/admin/rfp-curation/upload)
- [ ] **Expected:** Upload form loads with file picker and metadata fields
- [ ] **Step 42:** Upload a test PDF document
- [ ] **Expected:** File uploads, shredder processes the document, solicitation appears in curation queue

### 2.10 Source Detail and Scout

- [ ] **Step 43:** Navigate to [https://www.rfppipeline.com/admin/sources](https://www.rfppipeline.com/admin/sources)
- [ ] **Step 44:** Click on a source profile (e.g., SAM.gov) to view detail
- [ ] **Expected:** Source detail page loads at `/admin/sources/{profileId}` with regions, crawl settings, and recent changes
- [ ] **Step 45:** If available, click "Scout Now" to trigger a manual source check
- [ ] **Expected:** Job enqueued confirmation, results appear in recent changes

### 2.11 Admin Portal Link

- [ ] **Step 46:** Click "Portal" link at the bottom of the admin sidebar
- [ ] **Expected:** Navigates to [https://www.rfppipeline.com/portal](https://www.rfppipeline.com/portal) which redirects to appropriate portal or shows portal selection

---

## Section 3: CMS Admin Console

> **Prerequisite:** Access via admin sidebar "CRM Console" link or directly at [https://rfp-crm-production.up.railway.app/cms/](https://rfp-crm-production.up.railway.app/cms/)

### 3.1 CMS Dashboard

- [ ] **Step 1:** Open [https://rfp-crm-production.up.railway.app/cms/](https://rfp-crm-production.up.railway.app/cms/)
- [ ] **Expected:** CMS SPA loads with dark slate sidebar and Dashboard page
- [ ] **Step 2:** Verify sidebar navigation groups are visible: Overview, Email, Content, Social, Drip, Tasks
- [ ] **Expected:** All nav groups render with their child links
- [ ] **Step 3:** Verify dashboard stat cards load
- [ ] **Expected:** Cards visible (may show 0 counts on fresh deploy): Email Accounts, Campaigns, Outbox, Content, Social, TODOs

### 3.2 Content Pipeline

- [ ] **Step 4:** Click "Pipeline" under the Content section in the sidebar
- [ ] **Expected:** Content pipeline page loads at `/content` showing list of content posts (may be empty)
- [ ] **Step 5:** Click "New Post" in the sidebar (or nav to `/content/new`)
- [ ] **Expected:** Content editor loads with title, excerpt, category, tags, and rich text editor (TipTap)
- [ ] **Step 6:** Create a test post:
  - Title: `How AI is Transforming SBIR Proposals`
  - Excerpt: `Discover how AI tools help small businesses win more government contracts`
  - Category: `blog_post`
  - Tags: `ai, sbir, proposals`
  - Body: Add a heading ("The Future of Proposals"), a paragraph of text, bold a word, add a bullet list
- [ ] **Step 7:** Click "Create Post" (or "Save")
- [ ] **Expected:** Post is saved. Redirects to pipeline list or post detail. Post appears with status "draft"

### 3.3 Content Stage Pipeline

- [ ] **Step 8:** On the content pipeline page, find the test post
- [ ] **Expected:** Post shows with title "How AI is Transforming SBIR Proposals" and status "draft"
- [ ] **Step 9:** Click "Edit" on the test post
- [ ] **Expected:** Content editor loads with the saved content
- [ ] **Step 10:** Test AI Revision: Click "Stronger opening" button (or similar AI revision button)
- [ ] **Expected:** AI processes the request (may take a few seconds), opening paragraph is revised. Diff or updated content visible
- [ ] **Step 11:** Click "Submit for Review" (or advance the stage)
- [ ] **Expected:** Post status changes to "in_review"
- [ ] **Step 12:** Click "Approve"
- [ ] **Expected:** Post status changes to "approved"
- [ ] **Step 13:** Click "Publish"
- [ ] **Expected:** Post status changes to "published"

### 3.4 Content Preview

- [ ] **Step 14:** On the content pipeline page, click "Preview" on the published post
- [ ] **Expected:** Blog-style preview renders with title, author, date, and formatted body content

### 3.5 Email -- Accounts

- [ ] **Step 15:** Click "Accounts" under the Email section in the sidebar
- [ ] **Expected:** Email accounts page loads at `/email/accounts`. Shows configured email accounts or empty state
- [ ] **Step 16:** If accounts are configured: verify Google Workspace / platform@rfppipeline.com appears
- [ ] **Expected:** Account shows connection status (connected/disconnected)

### 3.6 Email -- Campaigns

- [ ] **Step 17:** Click "Campaigns" under the Email section in the sidebar
- [ ] **Expected:** Email campaigns page loads at `/email/campaigns`. Campaign list or empty state displays

### 3.7 Email -- Outbox (HITL Approval)

- [ ] **Step 18:** Click "Outbox (HITL)" under the Email section in the sidebar
- [ ] **Expected:** Email outbox page loads at `/email/outbox`. Pending emails listed or empty state
- [ ] **Step 19:** If pending emails exist: verify each shows recipient, subject, and body preview
- [ ] **Expected:** Each email has "Approve" and "Reject" action buttons
- [ ] **Step 20:** Test "Approve" on a pending email (if any exist)
- [ ] **Expected:** Email status changes to approved/sent. Email is delivered via Gmail API
- [ ] **Step 21:** Test "Reject" on a pending email (if any exist)
- [ ] **Expected:** Email status changes to rejected. Email is NOT sent

### 3.8 Social -- Accounts

- [ ] **Step 22:** Click "Accounts" under the Social section in the sidebar
- [ ] **Expected:** Social accounts page loads at `/social/accounts`. Connected social accounts or empty state

### 3.9 Social -- Posts

- [ ] **Step 23:** Click "Posts" under the Social section in the sidebar
- [ ] **Expected:** Social posts page loads at `/social/posts`. Scheduled/published posts or empty state

### 3.10 Drip Campaigns

- [ ] **Step 24:** Click "Campaigns" under the Drip section in the sidebar
- [ ] **Expected:** Drip campaigns page loads at `/drip`. Campaign list or empty state

### 3.11 TODOs

- [ ] **Step 25:** Click "TODOs" under the Tasks section in the sidebar
- [ ] **Expected:** TODOs page loads at `/todos`. Task list or empty state
- [ ] **Step 26:** If TODOs exist: verify each shows title, status, priority
- [ ] **Expected:** Status options visible (open, in_progress, done)
- [ ] **Step 27:** If TODOs exist: click to toggle status from "open" to "in_progress"
- [ ] **Expected:** Status updates immediately. Change persists on refresh
- [ ] **Step 28:** If TODOs exist: click to toggle status from "in_progress" to "done"
- [ ] **Expected:** Status updates. Task visually marked as complete

---

## Section 4: Customer Portal (as admin@apexdefense.test)

> **Prerequisite:** Sign out of the admin session. Open a fresh browser or incognito window.

### 4.1 Customer Login

- [ ] **Step 1:** Navigate to [https://www.rfppipeline.com/login](https://www.rfppipeline.com/login)
- [ ] **Step 2:** Enter email: `admin@apexdefense.test`
- [ ] **Step 3:** Enter password: `TestCustomer2026!`
- [ ] **Step 4:** Click "Sign In"
- [ ] **Expected:** Redirect to [https://www.rfppipeline.com/portal/apex-defense/dashboard](https://www.rfppipeline.com/portal/apex-defense/dashboard)

### 4.2 Portal Dashboard

- [ ] **Step 5:** Verify the portal layout loads with dark sidebar showing "Apex Defense Solutions" as the company name
- [ ] **Expected:** Sidebar shows company name at top, user name below it, and navigation links
- [ ] **Step 6:** Verify the sidebar shows ALL non-partner links:
  - Dashboard
  - Spotlight
  - Pipeline
  - Library
  - Proposals
  - Activity
  - Team
  - Documents
  - Billing
  - Settings
- [ ] **Expected:** All 10 navigation links are visible (partner_user would only see Proposals and Settings)
- [ ] **Step 7:** Verify "Sign out" link at the bottom of the sidebar
- [ ] **Expected:** Sign out button is visible and functional
- [ ] **Step 8:** Verify the dashboard content area loads
- [ ] **Expected:** Welcome message, quick stats (Library Units, Active Proposals, Pinned Topics), and onboarding checklist if applicable

### 4.3 Spotlight (Opportunity Feed)

- [ ] **Step 9:** Click "Spotlight" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/portal/apex-defense/spotlights](https://www.rfppipeline.com/portal/apex-defense/spotlights) loads
- [ ] **Step 10:** Verify the spotlight feed renders (may be empty if no opportunities have been pushed to this tenant)
- [ ] **Expected:** Either opportunity cards display or a clean empty state message
- [ ] **Step 11:** If opportunities exist: test the search/filter functionality
- [ ] **Expected:** Filter narrows results as you type
- [ ] **Step 12:** If opportunities exist: click on an opportunity to view details
- [ ] **Expected:** Opportunity detail page loads with solicitation info, compliance requirements, and action buttons (Pin, Pursue, Dismiss)
- [ ] **Step 13:** If opportunities exist: test the "Pin" action
- [ ] **Expected:** Opportunity is pinned, visual indicator changes

### 4.4 Pipeline

- [ ] **Step 14:** Click "Pipeline" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/portal/apex-defense/pipeline](https://www.rfppipeline.com/portal/apex-defense/pipeline) loads
- [ ] **Step 15:** Verify pipeline view renders
- [ ] **Expected:** Pipeline stages display (may be empty). Shows opportunities the tenant is tracking

### 4.5 Library

- [ ] **Step 16:** Click "Library" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/portal/apex-defense/library](https://www.rfppipeline.com/portal/apex-defense/library) loads
- [ ] **Step 17:** Verify library page renders with upload capability
- [ ] **Expected:** Library atom list (may be empty) with an "Upload" button or drag-and-drop zone
- [ ] **Step 18:** Click "Upload" to test document upload
- [ ] **Step 19:** Select a test document (PDF, DOCX, PPTX, or TXT file)
- [ ] **Expected:** File uploads, import readers process the document, atoms are extracted
- [ ] **Step 20:** If atoms were extracted: verify they appear in the library with categories and tags
- [ ] **Expected:** Atoms listed with title, category, and source document reference
- [ ] **Step 21:** If atoms exist: click on an atom to view detail
- [ ] **Expected:** Atom detail modal or page shows full text, metadata, and action buttons (accept, reject, recategorize)

### 4.6 Proposals

- [ ] **Step 22:** Click "Proposals" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/portal/apex-defense/proposals](https://www.rfppipeline.com/portal/apex-defense/proposals) loads
- [ ] **Step 23:** Verify proposal list renders (may be empty)
- [ ] **Expected:** Proposal cards or empty state with guidance on how to create proposals
- [ ] **Step 24:** If an opportunity was pursued in Section 4.3: verify a proposal was created
- [ ] **Expected:** Proposal card shows with title, status, and associated solicitation

### 4.7 Activity

- [ ] **Step 25:** Click "Activity" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/portal/apex-defense/activity](https://www.rfppipeline.com/portal/apex-defense/activity) loads
- [ ] **Step 26:** Verify the event stream displays tenant-scoped events
- [ ] **Expected:** At minimum, login events should appear. Events are filtered to only this tenant

### 4.8 Team Management

- [ ] **Step 27:** Click "Team" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/portal/apex-defense/team](https://www.rfppipeline.com/portal/apex-defense/team) loads
- [ ] **Step 28:** Verify team members are listed:
  - Sarah Mitchell (tenant_admin) -- current user
  - James Chen (tenant_user)
  - Maria Santos (partner_user)
- [ ] **Expected:** Each member shows name, email, role, and status
- [ ] **Step 29:** If invite functionality exists: test sending a team invite
- [ ] **Expected:** Invite form or modal appears, invite can be sent to an email address

### 4.9 Documents

- [ ] **Step 30:** Click "Documents" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/portal/apex-defense/documents](https://www.rfppipeline.com/portal/apex-defense/documents) loads
- [ ] **Step 31:** Verify document list or canvas editor loads
- [ ] **Expected:** Document list (may be empty) or document builder interface

### 4.10 Billing

- [ ] **Step 32:** Click "Billing" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/portal/apex-defense/billing](https://www.rfppipeline.com/portal/apex-defense/billing) loads
- [ ] **Step 33:** Verify billing page shows subscription info or Stripe integration
- [ ] **Expected:** Current plan (Grinder tier), subscription status (active), and billing portal link

### 4.11 Company Profile (Settings)

- [ ] **Step 34:** Click "Settings" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/portal/apex-defense/profile](https://www.rfppipeline.com/portal/apex-defense/profile) loads
- [ ] **Step 35:** Verify company info displays:
  - Company name: Apex Defense Solutions
  - NAICS codes: 541330, 541511, 541512, 541519, 334111
  - Technology focus: Artificial intelligence, machine learning, cybersecurity, cloud computing, data analytics, autonomous systems
  - Agency priorities: DoD, Air Force, Navy, DARPA, NSA
  - Research areas: Computer vision, NLP, Edge computing, Zero trust architecture
  - Keywords: AI, ML, cyber, cloud, autonomy, ISR, C4ISR
- [ ] **Expected:** All profile data from the seed migration displays correctly
- [ ] **Step 36:** Test editing a field (e.g., add a keyword)
- [ ] **Expected:** Edit mode activates, field is editable, save persists the change
- [ ] **Step 37:** Refresh the page and verify the edit persisted
- [ ] **Expected:** Updated value displays after page reload

---

## Section 5: Employee Access (as james@apexdefense.test)

> **Prerequisite:** Sign out of the customer admin session.

### 5.1 Employee Login

- [ ] **Step 1:** Navigate to [https://www.rfppipeline.com/login](https://www.rfppipeline.com/login)
- [ ] **Step 2:** Enter email: `james@apexdefense.test`
- [ ] **Step 3:** Enter password: `TestEmployee2026!`
- [ ] **Step 4:** Click "Sign In"
- [ ] **Expected:** Redirect to [https://www.rfppipeline.com/portal/apex-defense/dashboard](https://www.rfppipeline.com/portal/apex-defense/dashboard)

### 5.2 Employee Dashboard

- [ ] **Step 5:** Verify the portal layout loads with "Apex Defense Solutions" in the sidebar
- [ ] **Expected:** Same portal layout as tenant_admin, company name and user name visible
- [ ] **Step 6:** Verify all non-partner sidebar links are visible:
  - Dashboard, Spotlight, Pipeline, Library, Proposals, Activity, Team, Documents, Billing, Settings
- [ ] **Expected:** All 10 links visible (tenant_user sees same nav as tenant_admin)

### 5.3 Employee Navigation Test

- [ ] **Step 7:** Click "Spotlight" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/portal/apex-defense/spotlights](https://www.rfppipeline.com/portal/apex-defense/spotlights) loads with same data as tenant_admin view
- [ ] **Step 8:** Click "Library" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/portal/apex-defense/library](https://www.rfppipeline.com/portal/apex-defense/library) loads
- [ ] **Step 9:** Click "Proposals" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/portal/apex-defense/proposals](https://www.rfppipeline.com/portal/apex-defense/proposals) loads
- [ ] **Step 10:** Click "Activity" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/portal/apex-defense/activity](https://www.rfppipeline.com/portal/apex-defense/activity) loads

### 5.4 Employee Restricted Actions

- [ ] **Step 11:** Navigate to Settings: [https://www.rfppipeline.com/portal/apex-defense/profile](https://www.rfppipeline.com/portal/apex-defense/profile)
- [ ] **Expected:** Profile page loads. Verify whether edit is restricted for tenant_user (may show read-only view or limited edit capability)
- [ ] **Step 12:** Navigate to Billing: [https://www.rfppipeline.com/portal/apex-defense/billing](https://www.rfppipeline.com/portal/apex-defense/billing)
- [ ] **Expected:** Either billing info displays (read-only for employee) or access is restricted with redirect
- [ ] **Step 13:** Navigate to Team: [https://www.rfppipeline.com/portal/apex-defense/team](https://www.rfppipeline.com/portal/apex-defense/team)
- [ ] **Expected:** Team list displays but invite/manage actions may be restricted (tenant_admin only)

### 5.5 Employee Cannot Access Admin

- [ ] **Step 14:** Manually navigate to [https://www.rfppipeline.com/admin/dashboard](https://www.rfppipeline.com/admin/dashboard)
- [ ] **Expected:** Redirect to portal or 403 Forbidden. Employee MUST NOT see admin panel

---

## Section 6: Partner Access (as partner@techalliance.test)

> **Prerequisite:** Sign out of the employee session.

### 6.1 Partner Login

- [ ] **Step 1:** Navigate to [https://www.rfppipeline.com/login](https://www.rfppipeline.com/login)
- [ ] **Step 2:** Enter email: `partner@techalliance.test`
- [ ] **Step 3:** Enter password: `TestPartner2026!`
- [ ] **Step 4:** Click "Sign In"
- [ ] **Expected:** Redirect to portal for Apex Defense Solutions

### 6.2 Partner Sidebar Restrictions

- [ ] **Step 5:** Verify the portal sidebar shows ONLY:
  - Proposals
  - Settings
- [ ] **Expected:** Partner user does NOT see: Dashboard, Spotlight, Pipeline, Library, Activity, Team, Documents, Billing
- [ ] **Step 6:** Verify the hidden links are truly absent (not just greyed out)
- [ ] **Expected:** Only two nav links in the sidebar navigation

### 6.3 Partner Proposal Access

- [ ] **Step 7:** Click "Proposals" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/portal/apex-defense/proposals](https://www.rfppipeline.com/portal/apex-defense/proposals) loads
- [ ] **Step 8:** Verify only proposals the partner has been invited to are visible
- [ ] **Expected:** May be empty if no proposals exist yet, or shows only assigned proposals
- [ ] **Step 9:** If a proposal exists and partner was invited: click to open the proposal workspace
- [ ] **Expected:** Partner can view the proposal with stage-scoped permissions (view/comment/edit based on invitation level)

### 6.4 Partner Settings Access

- [ ] **Step 10:** Click "Settings" in the sidebar
- [ ] **Expected:** [https://www.rfppipeline.com/portal/apex-defense/profile](https://www.rfppipeline.com/portal/apex-defense/profile) loads
- [ ] **Step 11:** Verify settings are read-only for partner
- [ ] **Expected:** Company profile displays but editing is restricted

### 6.5 Partner Cannot Access Restricted Routes

- [ ] **Step 12:** Manually navigate to [https://www.rfppipeline.com/portal/apex-defense/dashboard](https://www.rfppipeline.com/portal/apex-defense/dashboard)
- [ ] **Expected:** Redirect to proposals or access denied (partner cannot access dashboard)
- [ ] **Step 13:** Manually navigate to [https://www.rfppipeline.com/portal/apex-defense/library](https://www.rfppipeline.com/portal/apex-defense/library)
- [ ] **Expected:** Redirect or access denied (partner cannot access library)
- [ ] **Step 14:** Manually navigate to [https://www.rfppipeline.com/portal/apex-defense/team](https://www.rfppipeline.com/portal/apex-defense/team)
- [ ] **Expected:** Redirect or access denied (partner cannot access team management)
- [ ] **Step 15:** Manually navigate to [https://www.rfppipeline.com/admin/dashboard](https://www.rfppipeline.com/admin/dashboard)
- [ ] **Expected:** Redirect to portal or 403 Forbidden. Partner MUST NOT see admin panel

---

## Section 7: Cross-System Integration

> **Prerequisite:** Admin session (eric.c.wagner@gmail.com). Actions from Sections 2-4 should have generated events.

### 7.1 Event Flow Verification

- [ ] **Step 1:** Login as admin and navigate to [https://www.rfppipeline.com/admin/events](https://www.rfppipeline.com/admin/events)
- [ ] **Step 2:** Verify login events appear for all four test accounts
- [ ] **Expected:** `identity.user.logged_in` events with correct actor emails
- [ ] **Step 3:** Verify admin actions are recorded (e.g., application accept from Section 2.4)
- [ ] **Expected:** Events with `finder` namespace and correct action types
- [ ] **Step 4:** Verify customer actions are recorded (e.g., profile edit from Section 4.11)
- [ ] **Expected:** Events with `capture` namespace and correct tenantId

### 7.2 Content Bridge

- [ ] **Step 5:** If a blog post was published in CMS (Section 3.3): navigate to [https://www.rfppipeline.com/blog](https://www.rfppipeline.com/blog)
- [ ] **Expected:** Published CMS content appears on the frontend blog page (may take up to 60 seconds for ISR revalidation)
- [ ] **Step 6:** If a blog post is listed: click on it to view the full post
- [ ] **Expected:** [https://www.rfppipeline.com/blog/{slug}](https://www.rfppipeline.com/blog/how-ai-is-transforming-sbir-proposals) loads with formatted content

### 7.3 CRM Console Connectivity

- [ ] **Step 7:** From the admin panel, click "CRM Console" in the sidebar
- [ ] **Expected:** New tab opens to [https://rfp-crm-production.up.railway.app/cms/](https://rfp-crm-production.up.railway.app/cms/)
- [ ] **Expected:** CMS dashboard loads without authentication errors
- [ ] **Step 8:** Verify the CMS dashboard reflects data from frontend actions (e.g., new TODOs generated by automation rules)
- [ ] **Expected:** If automation rules triggered, corresponding TODOs or email queue items appear

### 7.4 API Health Check

- [ ] **Step 9:** Navigate to [https://www.rfppipeline.com/api/health](https://www.rfppipeline.com/api/health)
- [ ] **Expected:** JSON response with `{ "status": "ok" }` or similar health check payload
- [ ] **Step 10:** Navigate to [https://rfp-crm-production.up.railway.app/health](https://rfp-crm-production.up.railway.app/health)
- [ ] **Expected:** JSON response confirming CMS service health

---

## Section 8: Error Handling and Edge Cases

### 8.1 Invalid URLs (404 Handling)

- [ ] **Step 1:** Navigate to [https://www.rfppipeline.com/admin/nonexistent-page](https://www.rfppipeline.com/admin/nonexistent-page)
- [ ] **Expected:** 404 page or redirect. No server error (500)
- [ ] **Step 2:** Navigate to [https://www.rfppipeline.com/portal/fake-tenant/dashboard](https://www.rfppipeline.com/portal/fake-tenant/dashboard)
- [ ] **Expected:** Redirect to /login (tenant does not exist)
- [ ] **Step 3:** Navigate to [https://www.rfppipeline.com/blog/nonexistent-slug](https://www.rfppipeline.com/blog/nonexistent-slug)
- [ ] **Expected:** 404 page or "Post not found" message
- [ ] **Step 4:** Navigate to [https://www.rfppipeline.com/completely-fake-route](https://www.rfppipeline.com/completely-fake-route)
- [ ] **Expected:** 404 page

### 8.2 API Error Responses

- [ ] **Step 5:** Navigate to [https://www.rfppipeline.com/api/nonexistent](https://www.rfppipeline.com/api/nonexistent)
- [ ] **Expected:** JSON error response `{ "error": "...", "code": "..." }` with appropriate HTTP status
- [ ] **Step 6:** Open browser DevTools Network tab, then navigate to any admin API (e.g., `/api/admin/dashboard`) without being logged in
- [ ] **Expected:** 401 Unauthorized JSON response, not a stack trace or HTML error

### 8.3 Unauthorized Access Attempts

- [ ] **Step 7:** While logged in as tenant_user (james@apexdefense.test), directly visit [https://www.rfppipeline.com/admin/dashboard](https://www.rfppipeline.com/admin/dashboard)
- [ ] **Expected:** Redirect to portal dashboard or 403 Forbidden. No admin content exposed
- [ ] **Step 8:** While logged in as tenant_user, directly visit [https://www.rfppipeline.com/portal/system/dashboard](https://www.rfppipeline.com/portal/system/dashboard)
- [ ] **Expected:** Redirect to login or access denied (user does not belong to "system" tenant)
- [ ] **Step 9:** While logged in as partner_user, try to access [https://www.rfppipeline.com/api/portal/apex-defense](https://www.rfppipeline.com/api/portal/apex-defense) endpoints that should be restricted
- [ ] **Expected:** Partner cannot access endpoints beyond their scope

### 8.4 Session Management

- [ ] **Step 10:** Login as any test user. Note the time.
- [ ] **Expected:** Session is active, all pages accessible
- [ ] **Step 11:** After 8+ hours (or by clearing session cookies), try to access a protected page
- [ ] **Expected:** Redirect to /login page. Session has expired

### 8.5 Cross-Tenant Isolation

- [ ] **Step 12:** While logged in as admin@apexdefense.test, manually change the URL slug to a different tenant: [https://www.rfppipeline.com/portal/system/dashboard](https://www.rfppipeline.com/portal/system/dashboard)
- [ ] **Expected:** Redirect to login or access denied. User cannot access other tenants' portals
- [ ] **Step 13:** While logged in as james@apexdefense.test, try the same cross-tenant URL
- [ ] **Expected:** Same result -- redirect or access denied

### 8.6 Password Change Flow

- [ ] **Step 14:** Login as any test user and navigate to [https://www.rfppipeline.com/change-password](https://www.rfppipeline.com/change-password)
- [ ] **Expected:** Change password form loads with current password, new password, and confirm password fields
- [ ] **Step 15:** Enter mismatched new/confirm passwords
- [ ] **Expected:** Validation error -- passwords must match
- [ ] **Step 16:** Enter a weak password (e.g., "abc")
- [ ] **Expected:** Validation error -- password does not meet requirements

---

## Section 9: Performance and Visual Checks

### 9.1 Page Load Performance

- [ ] **Step 1:** Open Chrome DevTools > Performance tab
- [ ] **Step 2:** Navigate to [https://www.rfppipeline.com](https://www.rfppipeline.com) and record a page load
- [ ] **Expected:** First Contentful Paint < 2 seconds, no layout shift > 0.1 CLS
- [ ] **Step 3:** Navigate to [https://www.rfppipeline.com/admin/dashboard](https://www.rfppipeline.com/admin/dashboard) (while logged in as admin)
- [ ] **Expected:** Dashboard loads within 3 seconds, stat cards populate without long spinners

### 9.2 Responsive Design

- [ ] **Step 4:** View the landing page on a tablet viewport (768px - 1024px)
- [ ] **Expected:** Layout adapts gracefully, no horizontal scrollbar, no overlapping elements
- [ ] **Step 5:** View the admin dashboard on a tablet viewport
- [ ] **Expected:** Sidebar and main content area remain usable
- [ ] **Step 6:** View the portal dashboard on mobile (< 768px)
- [ ] **Expected:** Sidebar collapses or becomes a mobile menu, content remains readable

### 9.3 Console Error Check

- [ ] **Step 7:** Open browser DevTools Console on each major page:
  - Landing page
  - Admin dashboard
  - Portal dashboard
  - CMS dashboard
- [ ] **Expected:** No red errors in console. Warnings are acceptable but should be reviewed

---

## Appendix A: Test Data Cleanup

After testing is complete, the seed data can be removed by running:

```sql
-- Remove test users (cascade will handle sessions)
DELETE FROM users WHERE email IN (
  'eric.c.wagner@gmail.com',
  'admin@apexdefense.test',
  'james@apexdefense.test',
  'partner@techalliance.test'
);

-- Remove tenant profile
DELETE FROM tenant_profiles WHERE tenant_id = 'a0a0a0a0-b1b1-c2c2-d3d3-e4e4e4e4e4e4';

-- Remove test tenant
DELETE FROM tenants WHERE id = 'a0a0a0a0-b1b1-c2c2-d3d3-e4e4e4e4e4e4';
```

> **Note:** Only run cleanup after all testing is complete. The seed migration (041) is idempotent and can be re-run to recreate the data.

---

## Appendix B: Bug Report Template

When a test step fails, record:

| Field | Value |
|-------|-------|
| **Section.Step** | e.g., 4.35 |
| **Action** | What you did |
| **Expected** | What should have happened |
| **Actual** | What actually happened |
| **Screenshot** | Attach if possible |
| **Console errors** | Copy any JS errors from DevTools |
| **Browser/Device** | e.g., Chrome 126 / macOS |
| **Severity** | Critical / Major / Minor / Cosmetic |
