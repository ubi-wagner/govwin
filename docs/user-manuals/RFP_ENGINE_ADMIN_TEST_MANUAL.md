# RFP Engine Admin — User Test Manual

**Audience:** RFP Pipeline staff operating the engine — roles **`master_admin`** and **`rfp_admin`**.
**Covers:** Scouts (source monitoring & ingestion) · Spotlights / RFP Curation (the expert triage→push flow) · Portal oversight (proposals, opportunities, tenants) · Admin operations (applications, tasks, workflows).
**You are testing the live UI.** Each step says what to click and what you should see. Tick the **✅ Verify** boxes.

### Conventions
- **✅ Verify** = the expected result to confirm. ⚠️ = a known quirk to expect. 🚫 = a stub/placeholder — *do not* test as working.
- Paths are relative to the app root, e.g. `/admin/sources`. The admin area is everything under **`/admin/*`**.

### Prerequisites
- **Two admin accounts** for the curation flow (an "Approve" requires a *different* admin than the curator — segregation of duties is enforced in SQL). At least one `master_admin` for the master-only checks (§6).
- A real solicitation PDF (or a public source URL) to ingest.
- Email delivery configured if you want to verify outbound emails; otherwise verify the in-app result panels.

---

## 0. Sign in

1. Go to **`/login`**. You see heading **"Sign in"**, sub "RFP Pipeline", fields **Email** + **Password**, a **"Forgot password?"** link, and a **"Sign in"** button.
2. Enter your admin email + password → **Sign in**.
   - ⚠️ **First login on a brand-new account** (e.g. a freshly accepted applicant) is forced to **`/change-password`** ("You must set a new password before continuing"). Set a new password, then sign in again.
3. ✅ **Verify:** you land on **`/admin/dashboard`**. (Visiting bare `/admin` also redirects here.)
4. ❌ Wrong credentials show "Invalid email or password." in a red banner.

### Admin navigation (left sidebar, titled "RFP Admin")
Overview: **Dashboard** · Opportunities: **RFP Curation · Sources · Pipeline Jobs · Templates** · Customers: **Applications · Tenants · Billing · Waitlist · Purchases · Proposals** · Content: **Site Content · Document Builder · S3 Storage** · System: **System State · Event Stream · Agents · Automation · Process Monitor · Workflows · Process Ledger · System Health · Analytics** · CRM: **CRM Console**. Footer: **"Portal →"**.
> Two surfaces are **not** in the sidebar — reach by URL: the cross-portal rollup **`/admin/opportunities`** and the manual RFP upload **`/admin/rfp-curation/upload`**.

---

## 1. SCOUTS — source monitoring & ingestion

### 1.1 Review sources & run a scout
1. Nav **Sources** → `/admin/sources`. You see **"Opportunity Sources"**, a **"+ New Solicitation"** button, and three blocks: **Active Sources** (cards), **Recent Changes** (diff feed), **Recent Activity** (visits).
2. On a source card, click **"Scout Now"**.
   - ✅ **Verify:** the button shows "Scouting…" and disables; after it returns, **Recent Changes** / **Recent Activity** refresh with a new entry.
3. Other per-card actions to spot-check: **"Open Site"** (logs a visit + opens the URL), **"Add Note"**, **"Upload PDFs"** (drag-drop zone "Drop PDF files here to upload"), **"Paste Topics"** (textarea → **"Parse Preview"** → **"Import [N] Topics"**).
4. ✅ **Verify badges render:** crawl status ("Auto-crawl: …" green vs "Manual only" gray), site-type (dsip/afwerx/sam_gov/…), and action badges.

### 1.2 Configure a source (detail page)
1. Click a source card title → `/admin/sources/[profileId]`. You see **Crawl Settings**, **Admin Notes**, **Visit Instructions**, **Monitored Regions**, **Change History**.
2. **Crawl Settings:** toggle **"Auto-crawl"**, pick a **Schedule** (Daily 6am UTC / Every 12 hours / Weekly / Every 6 hours / Custom), **"Save"**. ✅ Verify the setting persists on reload.
3. **Monitored Regions:** click into the **"Add Region"** form — fill **Name**, **Region Type** (Content/Listing/Download/Table/Navigation), **Content Context**, optional Selector Hint/Sample → **"Add Region"**. ✅ Verify the region appears in the list; **"Delete"** → **"Confirm"** removes it.
4. **Change History:** on a diff row click **"Review"**. ✅ Verify it flips to "Reviewed [time]". Note the severity badge (info→critical) and the extracted-opportunities count.

### 1.3 Manually upload a solicitation
1. From Sources click **"+ New Solicitation"** (or go to `/admin/rfp-curation/upload`). Header **"Upload RFP"**.
2. Fill **Title**, **Agency** (autocomplete), **Program Type** (SBIR Phase I/II, STTR, BAA, OTA, …), optional Solicitation Number / Posted / Close dates / Description.
3. Drag files into **"Drag & drop files here, or browse"** (pdf/docx/xlsx/pptx/txt/md, **≤30 MB total**). Set one file's radio to **primary**.
4. Click **"Upload & Create Solicitation"**.
   - ✅ **Verify:** you are routed to **`/admin/rfp-curation/{solId}`** (the new solicitation's curation workspace).
   - ⚠️ A duplicate file shows an error with a **"Go to the existing solicitation →"** link.

### 1.4 Pipeline Jobs (monitor only)
1. Nav **Pipeline Jobs** → `/admin/pipeline`. ✅ Verify you see **Active Schedules** + **Recent Jobs** with status badges (pending/running/completed/failed). 🚫 No action buttons — observe only.

---

## 2. SPOTLIGHTS / RFP CURATION — the triage → push flow (core workflow)

This is the expert workflow that takes a detected/uploaded solicitation through curation and **pushes it so it becomes visible to customers**. State machine:
`new → claimed → released_for_analysis → ai_analyzed → curation_in_progress → review_requested → approved → pushed_to_pipeline` (+ `dismissed` / `rejected_review`).

### 2.1 Claim & start curation
1. Nav **RFP Curation** → `/admin/rfp-curation`. You see **"Open triage ToDos"**, the **"RFP Triage Queue"** with a status **Filter** dropdown + **"Refresh"**, and a table.
2. On a `new` row click **"Claim"**. ✅ Verify status → **claimed** (and the row is now "yours").
3. Click **"Release for AI"** (→ released_for_analysis → ai_analyzed once the shredder runs). ✅ Verify the status advances.
4. Open the row → the **Curation Workspace** (`/admin/rfp-curation/{solId}`). On an `ai_analyzed` solicitation click **"Start Curation"**. ✅ Verify status → **curation_in_progress** and the action bar updates.

### 2.2 Curate (compliance, topics, volumes, presets)
In the Curation Workspace (tabs: Documents / Topics / Compliance / Customer Interest):
1. **Compliance Matrix** (right sidebar): click **"Edit"** on a field (e.g. "Page Limit (Technical)", "Submission Format", "ITAR Required") → set value → **"Save"**. ✅ Verify a "Verified" source badge appears.
2. **Documents:** ✅ Verify you can select text in the PDF viewer to open the **Tag** popover and save a compliance variable. Star a doc to mark it **primary**.
3. **Topics:** use **"Extract Topics"** (AI) or **"Import all topics from source"**; or **"+ Add Topic"**. Open a topic → **"Edit Topic"** → **"Save"**.
4. **Apply a preset:** select topics → **"Apply Preset"** dropdown → choose a preset. ✅ Verify the topics' compliance is populated (the saved-preset path was a known bug — confirm values are non-empty, not all blank).
5. **Volumes:** **"+ Add Volume"** (number, format, name, phase) → **"+ Add required item"**. ✅ Verify volumes/items list.

### 2.3 Request review → Approve (needs a 2nd admin) → Push
1. As the curator, click **"Request Review"**. ✅ Verify status → **review_requested**.
2. **Sign in as a second admin** (the approver). Open the same solicitation. Click **"Approve"**.
   - ⚠️ **Segregation of duties:** Approve is rejected if the approver is the *same* account that curated it (enforced in SQL). Use the 2nd account. (Or **"Reject Review"** with notes → back to curation_in_progress.)
   - ✅ Verify status → **approved**.
3. As an admin click **"Push to Pipeline"**.
   - It validates the required **`submission_format`** compliance var (blocks with a missing-list if empty — set it, then retry).
   - ✅ **Verify:** status → **pushed_to_pipeline**, and the opportunity + its topics now have `is_active=true` (i.e. they become visible to customers in their Spotlight feed and tenants get scored). Cross-check in §3 / by signing into a customer portal.
4. ⚠️ Stale claims (>24h) show a "stale" badge; **"Force Release"** is **master_admin-only** (a non-master gets 401).

### 2.4 Customer interest
1. In the Curation Workspace scroll to **Customer Interest**. ✅ Verify a table of tenants who pinned this solicitation's topics (Customer, Topic, Pinned date, Purchased Y/N, stage, "View Portal").

---

## 3. PORTAL oversight — proposals, opportunities, tenants

### 3.1 Cross-portal opportunity rollup
1. Go to **`/admin/opportunities`** (direct URL). ✅ Verify the table shows, per opportunity: lifecycle badge (open/closed/archived), ranked-tenants, pinned-tenants, a proposal-stage breakdown (building/final/submitted/archived) **and a "contract" chip** (the V1→V2 arc), last activity. 🚫 Read-only.

### 3.2 View / co-draft a customer proposal
1. Nav **Proposals** → `/admin/proposals`. Click a proposal Title → it opens the **customer portal** proposal at `/portal/{slug}/proposals/{id}` (you have cross-tenant access).
2. To co-draft a section as admin: open `/admin/proposals/{proposalId}/section/{sectionId}`. ✅ Verify the canvas editor loads; edits **auto-save**; you can **Export** (DOCX/PPTX/XLSX).

### 3.3 The 72-hour admin-review / unlock gate ⭐
> There is **no literal "Unlock" or "72h" button under `/admin`.** The 72h gate is a **`ProjectCollaboration` HITL task** (`admin_review`, due 72h) launched when a proposal is created. You resolve it in the **Task Queue**, and the workspace lock/unlock itself happens on the **portal** side.
1. Go to **`/admin/dashboard`** → the **Task Queue** (titled "Your To-Dos"). Find the **"Review & unlock: …"** task (an overdue/red or due-soon item).
2. Click **"Approve / Done"**. ✅ Verify the task disappears (the review gate is resolved).
3. To actually **unlock the workspace for the customer**, act as a tenant admin in the customer portal: open the proposal → at the **final** stage use **"Unlock for Edit"** (the portal lock route). ⚠️ First unlock grants the customer a **7-day** edit window; after the RFP close date or ≥2 locks, **only rfp_admin/master_admin** can unlock.

### 3.4 Manage a tenant + AI budget
1. Nav **Tenants** → `/admin/tenants` → click a Company → `/admin/tenants/{tenantId}`.
2. In the **AI Budget & Limits** card set **Monthly budget ($)**, **Rate limit (calls/hour)**, **Per-call ceiling ($)** → **"Save"**.
   - ✅ Verify it saves. (Blank = inherit platform default; **0 = disable AI** for that tenant.)
3. ✅ Verify the Users table, proposal/library counts, and Recent Activity render.

---

## 4. ADMIN operations

### 4.1 Dashboard + Task Queue
1. `/admin/dashboard`: ✅ Verify the 8 stat cards (Pending Applications, Active Tenants, … SBIR Awards), Recent Events, and the embedded **Task Queue**.
2. The **Task Queue** (`/api/admin/tasks`) is where you complete admin work — **review** tasks (**"Approve / Done"** / **"Dismiss"**), **upload** tasks (**"Open to upload"** / **"Mark uploaded"**), **form** tasks (fill fields → **"Submit"**). ✅ Verify a completed task leaves the list and the "N overdue" pill is accurate.

### 4.2 Accept an application → provision a tenant ⭐
1. Nav **Applications** → `/admin/applications`. Expand a pending row (SBIR data auto-loads).
2. Click **"Accept"** (optionally add review notes).
   - ✅ **Verify:** a result box shows the new **Tenant ID, slug, user ID, email, and a temporary password**, plus "email sent" status and a link to `/portal/{slug}`.
   - ✅ Cross-check: the tenant now appears under **Tenants**; the customer's first login forces a password change.
3. **"Reject"** requires a reason (**≥10 chars**); **"Change Status"** (for decided apps) requires a note (**≥5 chars**).

### 4.3 Workflow / process monitors
1. Nav **Workflows** → `/admin/workflows`. ✅ Verify stats (Running/Paused/Completed 24h/Failed 24h) + the instance list (auto-refresh ~10s).
2. On a **paused** instance click **"Advance"** (you act as the human gate — force-advance) → confirm. On a **failed** one, **"Retry"**; any instance, **"Cancel"**. **"Show error"** toggles the error detail.
   - ✅ Verify the status transitions accordingly.
   - ⚠️ If you see "Migration Required", the `process_instances` table isn't present in that environment.
3. Nav **Process Ledger** → `/admin/processes`: ✅ Verify the cross-tenant health view (failing/stalled/waiting/running) with filter chips + a tenant dropdown; **"Advance"** on paused rows.
4. Nav **Automation** → `/admin/automation`: ✅ Verify the rules table; toggle a rule **Active/Inactive** and confirm it persists.

---

## 5. Quick smoke checklist (one pass)
- [ ] Sign in → land on `/admin/dashboard`.
- [ ] Sources → **Scout Now** updates Recent Activity.
- [ ] Upload RFP → routed to its curation workspace.
- [ ] Curation: Claim → Release for AI → Start Curation → edit a compliance field → **Request Review**.
- [ ] 2nd admin: **Approve** → **Push to Pipeline** → status `pushed_to_pipeline` (+ topics become customer-visible).
- [ ] Applications → **Accept** → tenant + temp password provisioned.
- [ ] Dashboard Task Queue → **Approve / Done** clears a review task.
- [ ] Workflows → **Advance** a paused instance.
- [ ] Tenants → set an AI budget and save.

---

## 6. Role gating, read-only surfaces, and stubs (don't mis-test)

**master_admin-only** (an `rfp_admin` cannot do these): the whole **System Health** page (`/admin/system`) · the **Platform AI Controls** card on **Agents** · **Force Release** on the triage queue · escalated proposal **unlock** (≥2 locks / post-close).

**Read-only (observe only — no write steps):** Pipeline Jobs, Opportunities rollup, Process Monitor (`/admin/process`), Billing, Purchases, Event Stream, System State, System Health, Analytics (except expanding a session), Waitlist, Site Content index, the admin Proposals list.

**🚫 Stubs / not what the name implies — exclude from pass/fail:**
- **CRM Console** (`/admin/crm`) — renders "Coming soon" unless `CMS_PUBLIC_URL` is set (then it's just an external link). Not an in-app surface.
- **Templates** ("Document Templates") — a **viewer**: filter + **"Preview"** only. No create/edit/delete despite the "Template Studio" naming.

**Two-account note:** testing curation end-to-end (`request_review → approve → push`) requires two distinct admin accounts (curator ≠ approver).
