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
- **Platform:** migrations high-water **108** (`node db/migrations/migrate.mjs`, tracked in `_migration_history`); migs **105–108** shipped the comp-code purchase → curation → release flow + promo codes (105), the purchase→notify-admin rule (106), `spotlight_summary` (107), and marketing content (108). Seed via `SEED_DEV_ACCOUNTS=true` (`scripts/seed_dev_accounts.mjs`) + `SEED_PAGE_CONTENT=true`.

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

> **Two releases per OPP** (design: docs/MASTER_MIRROR_OPP_DESIGN.md). **Release 1 — Spotlight:** basic ingest minimums + a **`spotlight_summary`** ("why this matches"); the **push** (§2.3) fans a bridge version to every tenant, auto-ranked — this is what makes the OPP discoverable on the customer's `/cards`. **Release 2 — Proposal portal:** the robust **skeleton** (full compliance + volumes + required items + blank templated **molds**), built **once on the master solicitation** (§2.2) and **reused per tenant** at provision (§3.3). The two are decoupled — Release 2 can precede or follow any purchase; if it isn't done when the **first** portal for an OPP is purchased, the **72h SLA** fires.

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

> **This is the master skeleton (Release 2).** The full compliance matrix, volumes, required items, and their linked **blank molds** — `document_templates` authored in the **Document Builder** / template studio and linked to an item via `template_id` + an **expert note** — are built **once on the master solicitation** and **reused by every tenant** that provisions (§3.3). A mold is blank but carries the guardrails: e.g. a "1-page technical summary" that is a 15-page Word doc with the required font, margins, and page limit. Build it any time in advance; the **first** purchase for an un-skeletoned OPP starts the 72h clock. ⚠️ The in-app template **picker** in the curation modal is **⚠ future** — link via the volume tool or verify at provision that the mold pre-fills.

### 2.3 Request review → Approve (needs a 2nd admin) → Push
1. As the curator, click **"Request Review"**. ✅ Verify status → **review_requested**.
2. **Sign in as a second admin** (the approver). Open the same solicitation. Click **"Approve"**.
   - ⚠️ **Segregation of duties:** Approve is rejected if the approver is the *same* account that curated it (enforced in SQL). Use the 2nd account. (Or **"Reject Review"** with notes → back to curation_in_progress.)
   - ✅ Verify status → **approved**.
3. As an admin click **"Push to Pipeline"** (**Release 1**).
   - It validates **both** the required **`submission_format`** compliance var **and** a non-empty **`spotlight_summary`** (blocks with a missing-list if either is empty — set them, then retry).
   - ✅ **Verify:** status → **pushed_to_pipeline**; the opportunity + all topics flip `is_active=true` and a **bridge version fans out** — one `tenant_opportunity_cards` row per active/trial tenant, **auto-ranked** against each tenant's buckets. Cross-check on **`/admin/cards`** (bridge version + replicant count) or by signing into a customer portal's `/cards`.
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

### 3.3 Purchase → curation ToDo → shadow release ⭐
> **Current model** (migs 105–108; design docs/MASTER_MIRROR_OPP_DESIGN.md, click-plan docs/HITL_IMMOBILEYES_CLICKPLAN.md). A customer **pins → Purchases** with the comp code `rfppipelinetest` → `POST /api/portal/[slug]/purchase` opens a `proposal_portals` row in **`curation_pending`** (72h `curation_due_at`, `CURATION_SLA_HOURS=72`), writes a $0 completed purchase + a **`shadow_admin_grants`** row, emits `capture:purchase.completed`, and parks a **`proposal_setup`** ToDo — **"Curate + release the purchased proposal workspace"** (`assignee_role=rfp_admin`, due 72h). Live self-serve Stripe is descoped; the comp code stands in.
1. Nav **RFP Curation** → **`/admin/rfp-curation`**. The `proposal_setup` ToDo appears under **"Open triage ToDos"** — it is the one **tenant-scoped** task surfaced here (`listOpenAdminTriageTasks`) so the buyer's tenant is reachable. Resolving it routes you **down into that tenant** as a shadow admin.
2. **In-tenant:** if the master skeleton (§2.2, Release 2) exists → a **~15-minute review**; else **build it now** (within 72h). Then open the customer's **Builds** page (`/portal/{slug}/portals`) and click **"Release to customer"** (`action=release`).
   - ✅ **Verify:** the portal flips `curation_pending → launched`, the proposal is **provisioned unlocked** (`proposal_compliance_matrix` instantiated, molds interpolated), and `OnProposalCreated → draft_v0` auto-drafts the sections (needs the pipeline worker). The customer now has an **editable V0** workspace (+ a "your proposal is ready" email if configured).
   - ⚠️ **Legacy admin-create path:** a proposal provisioned via `proposals/create` can arrive **locked at `lock_count=0`**; an rfp_admin/master_admin clears that first lock (the "release" action now permits `lock_count=0`). The live purchase→release path provisions already-unlocked.
3. **Later stages:** at the **final** stage the customer's **"Unlock for Edit"** grants a **7-day** edit window; after the RFP close date or ≥2 locks, **only rfp_admin/master_admin** can unlock.

> **Shadow admins & the ToDo backflow.** The bridge is one-way (card data flows **down** to tenants); the **only** thing that flows "up" is a **ToDo event** that routes a privileged actor **down** into a tenant's RLS-scoped shadow account to act — no customer content ever crosses to the master. Grants live in `shadow_admin_grants` (`source ∈ {t_and_c, invite}`, revocable via **"Revoke shadow admin"** on the Builds page). The same hook is meant to carry appointed **EconDev** shadows (`source='invite'`) — **⚠ future** (no role/invite UI yet). See docs/ALPHA_HITL_RUNBOOK.md.
>
> ⚠️ **Security gap (tracked).** `shadow_admin_grants` (mig 097) was meant to *replace* the admin god-view, but `verifyTenantAccess` (`frontend/lib/db.ts:52`) still returns `true` for **any** `rfp_admin`/`master_admin` — so today the grant is **auditable + revocable metadata**, not the enforced gate. Enforcing the grant and retiring the god-view is **⚠ future**.

> 💡 To start a **`ProjectCollaboration` review gate by hand** (a one-off review no purchase/bridge covers), use **§4.3's "Launch Review Gate"** form — it lands an identical HITL task in the assignee's queue.

### 3.4 Manage a tenant + AI budget
1. Nav **Tenants** → `/admin/tenants` → click a Company → `/admin/tenants/{tenantId}`.
2. In the **AI Budget & Limits** card set **Monthly budget ($)**, **Rate limit (calls/hour)**, **Per-call ceiling ($)** → **"Save"**.
   - ✅ Verify it saves. (Blank = inherit platform default; **0 = disable AI** for that tenant.)
3. ✅ Verify the Users table, proposal/library counts, and Recent Activity render.

---

## 4. ADMIN operations

### 4.1 Dashboard + Task Queue
1. `/admin/dashboard`: ✅ Verify the 8 stat cards (Pending Applications, Active Tenants, … SBIR Awards), Recent Events, and the embedded **Task Queue**.
2. The **Task Queue** (`/api/admin/tasks`) is where you complete admin work. The control shown depends on the task's **completer kind** (set when the task was created — see §4.3 Launch Review Gate, and the customer's "Assign a task"): **review** tasks (**"Approve / Done"** / **"Dismiss"**), **upload** tasks (**"Open to upload"** / **"Mark uploaded"**), **form** tasks (fill the named fields → **"Submit"**). Most pipeline gates are review gates (the default); upload/form appear when a producer explicitly set them. ✅ Verify a completed task leaves the list and the "N overdue" pill is accurate.

### 4.2 Accept an application → provision a tenant ⭐
1. Nav **Applications** → `/admin/applications`. Expand a pending row (SBIR data auto-loads).
2. Click **"Accept"** (optionally add review notes).
   - ✅ **Verify:** a result box shows the new **Tenant ID, slug, user ID, email, and a temporary password**, plus "email sent" status and a link to `/portal/{slug}`.
   - ✅ Cross-check: the tenant now appears under **Tenants**; the customer's first login forces a password change.
3. **"Reject"** requires a reason (**≥10 chars**); **"Change Status"** (for decided apps) requires a note (**≥5 chars**).

### 4.3 Workflow / process monitors + manual launchers
1. Nav **Workflows** → `/admin/workflows`. At the top are two **launch forms** above the monitor:
   - **Generate Content** — launches the CMS content vertical (AI drafts the body, then parks at a review ToDo). Fill Title + Brief → **"Generate Content"**.
   - **Launch Review Gate** ⭐ (M3) — starts a **`ProjectCollaboration` HITL gate by hand** for a one-off review no automatic bridge covers. Pick **Scope** (project/opp/spotlight/contract), **Assign to role**, **Due (hours)**; enter **Task title**, **Task type** (e.g. `admin_review`), **Entity type** (e.g. `proposal`), the **Opportunity ID** (spine key, UUID) and **Entity ref** (the entity's UUID); optionally a **Proposal ID** and a **Tenant ID** (blank = admin-scoped gate).
     - ✅ **Verify:** on submit you get "Launched… (trigger event …)", and within ~10s the task appears in the assignee's **Task Queue** and a paused instance appears in the monitor / **Process Ledger**.
     - ⚠️ The form is **guarded** — a missing required field or a non-UUID Opportunity ID / Entity ref / Tenant ID returns a clear validation error (`INCOMPLETE_OVERLAY` / `INVALID_OVERLAY` / `VALIDATION_ERROR`), never a silent corrupt task.
2. ✅ Verify monitor stats (Running/Paused/Completed 24h/Failed 24h) + the instance list (auto-refresh ~10s).
3. On a **paused** instance click **"Advance"** (you act as the human gate — force-advance) → confirm. On a **failed** one, **"Retry"**; any instance, **"Cancel"**. **"Show error"** toggles the error detail.
   - ✅ Verify the status transitions accordingly.
   - ⚠️ If you see "Migration Required", the `process_instances` table isn't present in that environment.
3. Nav **Process Ledger** → `/admin/processes`: ✅ Verify the cross-tenant health view (failing/stalled/waiting/running) with filter chips + a tenant dropdown; **"Advance"** on paused rows.
4. Nav **Automation** → `/admin/automation`: ✅ Verify the rules table; toggle a rule **Active/Inactive** and confirm it persists.

---

## 5. Quick smoke checklist (one pass)
- [ ] Sign in → land on `/admin/dashboard`.
- [ ] Sources → **Scout Now** updates Recent Activity.
- [ ] Upload RFP → routed to its curation workspace.
- [ ] Curation: Claim → Release for AI → Start Curation → edit a compliance field → set **`submission_format`** + **`spotlight_summary`** → **Request Review**.
- [ ] 2nd admin: **Approve** → **Push to Pipeline** (Release 1) → status `pushed_to_pipeline` (+ cards fan out to tenants on `/admin/cards`).
- [ ] (Optional) Build the master **skeleton** (volumes + full compliance + molds) — Release 2, reused per tenant.
- [ ] Customer purchases (comp code `rfppipelinetest`) → **RFP Curation** shows the "Curate + release" ToDo → **Release to customer** → portal `launched`, build provisioned unlocked.
- [ ] Applications → **Accept** → tenant + temp password provisioned.
- [ ] Dashboard Task Queue → **Approve / Done** clears a review task.
- [ ] Workflows → **Launch Review Gate** (e.g. an `admin_review` on a proposal) → the task lands in the queue within ~10s.
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
