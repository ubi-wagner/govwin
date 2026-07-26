# Customer Admin — User Test Manual

**Audience:** the small-business owner using the portal to pursue and build federal R&D proposals — role **`tenant_admin`**.
**Covers:** your end-to-end journey — browse **Opportunities** cards → rank with **Buckets** → **pin** → **purchase** (comp code) → wait for RFP-expert curation (72h) → build **V0 → V0.5 → V1** (draft / library / lock / advance) → team & partners → record the win.
**You are testing the live UI.** Each step says what to click and what to expect. Tick the **✅ Verify** boxes.

### Conventions
- **✅ Verify** = expected result. ⚠️ = quirk to expect. 🚫 = stub/disabled — *do not* test as working.
- `<slug>` is your company's tenant slug in the URL, e.g. `/portal/acme-defense/dashboard`.

### Prerequisites
- A `tenant_admin` account (provisioned by RFP Pipeline when your application was accepted — your **first login forces a password change**).
- At least one opportunity **pushed** by the RFP admin so it appears in your **Opportunities** feed (`/cards`). A brand-new account is auto-mirrored the whole live opportunity river at signup.
- **Test-instance notes** (for whoever stands up the environment): migrations run via `node db/migrations/migrate.mjs` (high-water **137**; migs **105–108** shipped the comp-code purchase → curation → release model + `spotlight_summary`). Seed with `SEED_DEV_ACCOUNTS=true` (`scripts/seed_dev_accounts.mjs`) + `SEED_PAGE_CONTENT=true` (marketing pages).

---

## 0. Sign in & how email links route you

1. Go to **`/login`** → enter **Email** + **Password** → **"Sign in"**.
   - ⚠️ **First login** (temporary password) bounces you to **`/change-password`** — set a permanent password, then sign in again.
2. ✅ **Verify:** you land on **`/portal/<slug>/dashboard`**.
3. **Email "To-Do" links:** a nudge email's button opens **`/go?task=<id>`**. If you're signed out it sends you to `/login` and back; once signed in it routes you **straight to the relevant proposal** (or your dashboard task queue). ✅ Verify clicking an email link lands you on the right proposal.

### Portal navigation (left sidebar — exact labels)
**Dashboard** · **Opportunities** (path `/cards`) · **Buckets** · **Atoms** · **Library** · **Builds** (path `/portals`) · **Proposals** · **Processes** · **Activity** · **Team** · **Documents** · **Billing** · **AI Usage** (admin) · **Automation** (admin) · **Settings** (path `/profile`) · **Sign out**.
> Label↔path to know: **Opportunities**=`/cards`, **Builds**=`/portals`, **AI Usage**=`/agents`, **Settings**=`/profile`. The old **Spotlight** (`/spotlights`) and **Pipeline** (`/pipeline`) links now **redirect to `/cards`** — the legacy `tenant_pipeline_items` surface is **retired** (see docs/MASTER_MIRROR_OPP_DESIGN.md).

---

## 1. Set up your company profile (drives matching)

1. Nav **Settings** → `/portal/<slug>/profile`. Click **"Edit"**.
2. Fill **Company Summary**, **Technology Focus**, **NAICS Codes (comma-separated)**, **Keywords (comma-separated)**, plus Target Agencies / Set-Aside Types / Research Areas → **"Save"**.
3. ✅ **Verify:** the fields persist. These feed AI drafting; your ranking of the **Opportunities** feed is driven by the **Buckets** ranking lenses you define (§2).

---

## 2. Opportunities & Buckets — browse, rank & pin

### 2.1 Browse the opportunity cards
1. Nav **Opportunities** → `/portal/<slug>/cards`. You see **"Opportunity Pipeline"**, "N cards", an **"Include closed"** checkbox, and **"Refresh"**. Each card shows the **title**, **agency · program type**, a **"Closes {date}"** line, and a submission-stage badge (**NOFO / Pre-Release / Updated / Closed / Archived**).
   - These are your denormalized **mirror cards**, fanned to you over the one-way bridge from the RFP-side master opportunity (design: docs/MASTER_MIRROR_OPP_DESIGN.md). A brand-new account is back-filled the whole live river at signup.
   - ⚠️ The card does **not** yet render a numeric rank inline (the page copy says "ranked by your spotlight buckets" — the per-bucket rank shows on the **Buckets** page, §2.2). Inline card ranks are **⚠ future**.
2. Toggle **"Include closed"** to reveal archived/closed opportunities (hidden by default) → ✅ Verify the list refreshes.

### 2.2 Buckets — your ranking lenses
1. Nav **Buckets** → `/portal/<slug>/buckets`. You see **"Spotlight Buckets"** — "Your ranking lenses — each ranks the whole pipeline by the criteria you set."
2. In **"New bucket"** fill **Name** (e.g. "AF Autonomy"), **keywords** (comma-sep), **agencies** (comma-sep), **program types** (SBIR, STTR), **NAICS codes** (comma-sep), optional **Include closed** → **"Create"**. ✅ Verify the bucket appears. (As `tenant_admin` you can create/delete; a `tenant_user` can view + rank.)
3. On a bucket click **"Rank →"**. ✅ Verify a ranked list **#1 … #N** of your opportunity cards against that lens. Every card is scored against **every** active bucket (one card, up to 5 bucket scores — not 5 cards).
   - 🚫 Attaching library **atoms** as extra bucket *context* is **⚠ future** — buckets rank on the fields above only.

### 2.3 Pin an opportunity (copies the OPP's files to you)
1. On a card click **"Pin (copy docs)"** ("…", then the card gains a **"Pinned"** badge + **"Unpin"**).
2. ✅ **Verify:** pinning copies the opportunity's attached source documents into your tenant space (`customers/<slug>/pinned/<oppId>/…`) and arms update nudges. A pinned card whose master advanced shows an amber **"Update available"** with **"Resync"**.
3. Only a **pinned** card exposes the **"Purchase"** button (§3). **"Build →"** jumps to your **Builds** list for that opportunity.
   - ⚠️ Pinned-opp push **nudges** to you (email/bell) are **⚠ future**; the amber "Update available" badge works today.

---

## 3. Builds — purchase, wait for curation, release (→ V0)

> **How you buy (current model).** Live self-serve **Stripe checkout is descoped**; the founding cohort buys with a **comp code**. Pin an opportunity → **Purchase** → enter the comp code → your build opens in **"Waiting for RFP Expert Curation"** (a 72-hour expert SLA). An RFP expert curates the skeleton and **releases** it — then your workspace is live and **unlocked**. Design of record: docs/MASTER_MIRROR_OPP_DESIGN.md; operator side: docs/HITL_IMMOBILEYES_CLICKPLAN.md.

### 3.1 Purchase a proposal workspace (comp code)
1. On a **pinned** card (§2.3) click **"Purchase"** → the **"Purchase proposal workspace"** modal.
   - ⚠️ **Card checkout is shown at the top but not enabled** ("Card checkout is not available yet — use an access code below"). Enter the founding-cohort **comp code `rfppipelinetest`** in the code box at the bottom → the purchase completes at **$0**.
2. ✅ **Verify:** you're routed to **Builds** (`/portals?opp=…`) and the build reads **"Waiting for RFP Expert Curation."** Behind the scenes this opened a `proposal_portals` row in **`curation_pending`** with a **72h** `curation_due_at`, wrote a $0 completed purchase, granted the RFP expert a **shadow-admin** visit to your tenant, emitted `capture:purchase.completed`, and parked a **"Curate + release the purchased proposal workspace"** ToDo on the RFP admin (due 72h).
   - ⚠️ A second purchase of the **same** opportunity returns **409 "This opportunity already has a workspace."**

### 3.2 Wait for curation
1. Nav **Builds** → `/portal/<slug>/portals`. ✅ Verify the purchased build shows the amber **"Waiting for RFP Expert Curation"** panel and a live **"Expert SLA: {time} remaining"** countdown (flips to "past 72h target" if overdue).
   - **What the 72h covers:** the RFP expert building/reviewing the **master skeleton** (compliance matrix + volumes + section molds) — **not** your drafting. If the skeleton was pre-built for this opportunity, it's a ~15-minute review, not 72h.

### 3.3 Release → V0
1. When the RFP expert clicks **"Release to customer"**, the portal flips `curation_pending → launched`, the proposal is **provisioned unlocked**, the compliance matrix is instantiated, and the `draft_v0` auto-draft fires. This is **V0** — a section skeleton with molds + guardrails, matrix rows, and (once the pipeline worker runs the auto-draft) AI-drafted first-pass sections.
2. ✅ **Verify:** the build now shows **"Open build →"** → `/proposals/<proposalId>` — an **editable** workspace (no admin-review lock in the live release path). Your team gets a "your proposal is ready" email if email is configured.
   - ⚠️ On the legacy **admin-create** provision path the workspace can arrive **locked at `lock_count=0`**; an RFP/master admin clears that first lock via the release action. The live purchase→release path above provisions already-unlocked.

---

## 4. The version model — V0 → V0.5 → V1

Your build advances through three versions. **The 72h SLA covers skeletoning (→ V0) only** — there is no clock on the draft itself.

| Version | What it is | How you get there |
|---|---|---|
| **V0** | Skeleton instantiated for you: compliance matrix + blank templated **molds** + guardrails (blank, but carrying font / margins / page-limit), plus the `draft_v0` first pass | RFP expert builds the master skeleton; **Release** provisions & auto-drafts (§3.3) |
| **V0.5** | **Library plug-and-play** — pull your **atoms** into the molds so the sections read as yours (~15 min) | You (or a shadow-admin helper) in the workspace (§5.2–5.3, §7.1) |
| **V1** | Draft finalized: compliance run, sections locked, stage advanced | **Accept & Lock** all + **Advance**, or **Force advance** (§5.4–5.5) |

Everything from here happens in the **Proposal Workspace** (§5). ⚠️ Fully automated V0→V1 "workplan" nudges are **⚠ future** — today the build is customer-executed (shadow-assisted).

---

## 5. The Proposal Workspace (build V0.5 → V1)

Open **Proposals** (or **Builds** → **"Open build →"**) → a proposal → `/proposals/<proposalId>`.

### 5.1 Orientation
1. ✅ Verify the header (title, Topic/agency/Due-date) and the collapsible **"Opportunity origin & compliance"** card with **three tabs**: **Overview** (stage, Open/Locked, source bucket), **Origin** (frozen-at-purchase opp summary + bought-from bucket/score), **Compliance** (live % bar + Satisfied/Partial/Not addressed/N/A counts).
2. Tabs across the workspace: **All Sections** / **My Sections** / **Timeline** (admin default = All Sections).

### 5.2 AI-draft the sections
> ⚠️ On the **Release** path the `draft_v0` auto-draft may have **already** filled your empty sections (V0) — so some rows arrive "drafted." Re-draft or revise as needed. Auto-draft requires the **Python pipeline worker** running with the pipeline `ANTHROPIC_API_KEY`.
1. In **All Sections**, click **"Draft All Sections"** (the AI Section Drafter; appears when there are empty sections and the proposal is unlocked — else use **"Show AI Drafter"**).
2. ✅ **Verify:** each section row cycles "drafting… → drafted" and you see "All sections drafted. Review each section and accept or revise the AI content." (This is live; requires the tenant's AI to be enabled and within budget.)
3. Alternatively, in the Admin Panel **"AI & Library"** tab click **"Draft with AI"** → toast "AI drafting queued for N sections…".

### 5.3 Edit a section in the canvas
1. Open a section → `/proposals/<id>/sections/<sectionId>` (**"← Back to Proposal"** to return).
2. Edit content in the canvas; use the right **sidebar** per-node AI controls (revise / accept / revert / **replace from library**). **Save** with the toolbar **Save**.
3. Export this section: **"Export .docx"** (live), **"Export .pptx"** (slides), **"Export .xlsx"** (if a table node exists). 🚫 **"Export .pdf"** is **disabled ("Coming soon")** — don't test it.

### 5.4 Compliance & the Admin Panel
The **Admin Panel** (All Sections tab) has four tabs:
1. **Artifacts:** sections grouped by volume. Per section: **"Accept & Lock"** (green; needs content) ⇄ **"🔒 Unlock"**, and **"Open"**. Bulk **"Accept & Lock All (N)"**. ✅ Verify a locked section shows "APPROVED/locked" and the volume's "X of Y locked" updates.
2. **Team & Access:** see §6.
3. **Compliance:** click **"Run Compliance Check"** → ✅ Verify per-variable passed/failed/partial with excerpts/suggestions. Manage **Stage Gate Requirements** (**"Load Gates"**, toggle, add a gate: Stage + label + **"Add"**).
4. **AI & Library:** **"Draft with AI"** (live). 🚫 **"AI Review (coming soon)"** is **disabled** — built but not wired for V1; don't test. (Record Outcome lives here too — §8.)

### 5.5 Advance the stage (the gate)
On the **Stage/Gate bar**:
1. Click **"Advance to {Next} →"** (visible when you can advance and the proposal isn't locked).
2. ⚠️ **All-locked gate:** if some sections aren't accepted & locked, advance is blocked and an amber box lists "N sections not yet accepted & locked". As an admin you then get **"Force advance anyway →"** (force-override).
   - ✅ Verify: with all sections locked, **Advance** moves the stage (e.g. draft → final); with some unlocked, you see the blocked list + the force option.
3. At **final** stage: **"Unlock for Edit"** / **"Re-lock"** appear. ⚠️ After the first unlock you get a **7-day** edit window; "Further changes require RFP Pipeline support" appears at lock #2.
4. **Download the package:** in Artifacts click **"Download Proposal (.docx)"** → ✅ Verify it downloads a real **`.docx`** Word document (headings / tables / TOC) — **not** a JSON manifest (the button now POSTs `?format=docx`; the old `.json`-bundle behavior is **superseded**). ⚠️ Export only works once you've locked at least once (or reached submitted/archived) — otherwise the button helper says "Lock the proposal or advance to submitted stage to export".

---

## 6. Team & partners

### 6.1 Tenant-level team (`/team`)
1. Nav **Team** → `/portal/<slug>/team`. ✅ Verify the members + collaborators tables.
2. **Invite a teammate:** in the invite form enter **Email**, **Name**, pick **Role** (**Contributor**=tenant_user / **Admin**=tenant_admin / **External Partner**=partner_user) → **"Send Invite"**. ✅ Verify a success message.

### 6.2 Per-proposal collaborators (incl. university partners)
1. In a proposal's Admin Panel → **Team & Access** → **"+ Invite"** ("Invite Collaborator").
2. Fill **Email address**, **Full name**, **Role** (**Contributor** or **External** — choose **External** for a university partner), **Permission** (**View only** / **Comment** / **Edit**), and toggle **"Assign to sections:"** chips → **"Send Invite"**.
3. ✅ **Verify:** the collaborator appears in the roster and the **Access Matrix** (sections × people, E/C/V/—).
   - The invited person gets an email: a **new** user sees **"Accept Invitation"** (→ sets a password, ≥12 chars, then lands in the proposal); an **existing** GovWin user is granted immediately and sees **"Open Proposal"**. (See the University Partner manual.)
4. Remove someone with the **"✕"** (confirm "…access will be revoked immediately").

### 6.3 Delegate a task to a teammate (choose how it's completed)
On the proposal page, expand the **"Assign a task"** section (collapsed by default; visible to managers, above the workspace).
1. Enter a **Task** title, optional **Details**, an **Assign to** (**"Anyone on the team"** or a specific named collaborator), a **Completion** type, and an optional **Due** date → **"Assign task"**.
2. **Completion** sets how the assignee closes it in their **Dashboard** To-Do queue:
   - **Review & approve** (default) → the assignee sees **"Approve / Done"** / **"Dismiss"**.
   - **Upload a file** → the assignee sees **"Open to upload"** + **"Mark uploaded"**.
   - **Fill a form** → reveals a **Form fields** box; type **comma-separated** field names (e.g. `Past performance ref, Contract value, POC email`). The assignee then fills those named fields → **"Submit"**. ⚠️ A form task with **no** field names is rejected ("Add at least one field name").
3. ✅ **Verify:** "Task assigned." and the task appears in the assignee's Dashboard To-Do queue with the **matching control** (Approve / Upload / Form). It's nudged toward its due date, and a named assignee gets the `/go?task=` email link (§0).
   - ⚠️ You can only assign to your own team's roles (teammate, partner) — not to RFP-staff roles.

---

## 7. Library, automation, usage

### 7.1 Library
1. Nav **Library** → `/library`. ✅ Verify stat cards (Total Atoms, Categories, Winning Atoms, Usage). Use **"Upload Documents"** → **"Upload All"** → **"Review & Categorize Atoms"** (`/library/review`).
2. In **Review**: per atom set a category/tags → **"Accept"** (or **"Reject"**); bulk **"Accept All"**. 🚫 **"Split"** is a local-only toggle (no backend) — don't rely on it.

### 7.2 Automation preferences (changes proposal behavior)
1. Nav **Automation** → `/automation` (admin). ✅ Verify the checkboxes and toggle **"AI review on advance"** and **"Auto-advance when all locked"** → **"Save automation preferences"**.
   - ✅ Verify both persist; with **Auto-advance** on, locking the last section advances the stage automatically; with **AI review on advance**, advancing queues an AI review.

### 7.3 AI Usage
1. Nav **AI Usage** → `/agents` (admin). ✅ Verify Total AI Calls / Allocation Used % / Calls Remaining and the per-agent table for the selected period (7/30/90d). (No dollar figures shown.) If disabled: "AI is currently disabled for your account…".

---

## 8. Record the outcome (seeds V2)

1. Advance the proposal to **submitted** (or archived). In the Admin Panel **AI & Library** tab the **Record Outcome** controls appear.
2. Click **"Won"** (awarded) / **"Lost"** / **"Withdrawn"**, add optional notes → **"Record as Won/Lost/Withdrawn"**.
3. ✅ **Verify:** "Outcome recorded… N library atoms updated." A **Won** outcome also seeds a V2 **contract** on the same opportunity (visible to RFP staff on the admin rollup) and elevates your winning library atoms.

---

## 9. Quick smoke checklist (one pass)
- [ ] Sign in → dashboard; set Profile (NAICS/Keywords) and save.
- [ ] **Opportunities** (`/cards`) → **Pin (copy docs)** an opportunity; create a **Bucket** → **Rank →**.
- [ ] Pinned card → **Purchase** (comp code `rfppipelinetest`) → **Builds** shows "Waiting for RFP Expert Curation" + 72h countdown.
- [ ] After RFP expert **Release** → **Open build** → editable workspace (**V0**).
- [ ] Workspace → **Draft All Sections** → sections drafted.
- [ ] A section → edit in canvas → **Save** → **Export .docx**.
- [ ] Admin Panel → **Accept & Lock All** → **Advance** the stage.
- [ ] Team & Access → invite an **External** partner with section scope.
- [ ] Automation → toggle the two AI prefs and save.
- [ ] (After submit) Record Outcome → **Won**.

---

## 10. Stubs / disabled — keep OUT of pass/fail
- 🚫 **"AI Review (coming soon)"** (AI & Library tab) — disabled.
- 🚫 **"Export .pdf"** in the section editor — disabled ("coming soon", no renderer). The whole-proposal **package download is now `.docx`** (superseded the old JSON manifest); PDF export is **⚠ future**.
- 🚫 **"Split"** in Library Review — local toggle, no backend.
- ⚠️ **Billing/Stripe** (`/billing`): live self-serve checkout is **descoped** — the founding cohort buys proposals with the **comp code `rfppipelinetest`** (§3.1), and Spotlight subscription billing is **⚠ future**. Only verify billing buttons render/redirect, not end-to-end payment.

---

## 11. Pricing (launch — August 2026)

Superseded since older drafts (which showed "$299 Spotlight / $999 Phase I"). Current price sheet:

| Product | Price | Notes |
|---|---|---|
| **Spotlight** (subscription) | **$499/mo** | **3-month minimum** — no month-to-month |
| **Phase I** proposal | **$1,999** | one-time, per opportunity |
| **Phase II** proposal | **$4,999** | no linked Phase I |
| **Phase II** proposal (linked) | **$3,999** | when a **linked Phase I** is already in the system + library — the "**only $3,000 more**" upgrade |

## 12. ⚠ Future — not yet built (don't test as working)
- Inline numeric card rank on `/cards` (ranks show on **Buckets**, §2.2).
- Library **atoms as bucket context** (§2.2).
- Pinned-opp push **nudges** (email/bell); the "Update available" badge works (§2.3).
- **Auto-skip curation** when the master skeleton is pre-built (every purchase opens `curation_pending` today, §3).
- Fully automated **V0→V1 workplan** nudges/actions (build is customer-executed today, §4).
- Live self-serve **Stripe** checkout + Spotlight subscription billing (§10).
