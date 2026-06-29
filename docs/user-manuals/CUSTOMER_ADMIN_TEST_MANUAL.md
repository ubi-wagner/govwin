# Customer Admin — User Test Manual

**Audience:** the small-business owner using the portal to pursue and build federal R&D proposals — role **`tenant_admin`**.
**Covers:** your end-to-end journey — Spotlight → pin → pursue → build a proposal → draft/review/lock/advance → team & partners → record the win.
**You are testing the live UI.** Each step says what to click and what to expect. Tick the **✅ Verify** boxes.

### Conventions
- **✅ Verify** = expected result. ⚠️ = quirk to expect. 🚫 = stub/disabled — *do not* test as working.
- `<slug>` is your company's tenant slug in the URL, e.g. `/portal/acme-defense/dashboard`.

### Prerequisites
- A `tenant_admin` account (provisioned by RFP Pipeline when your application was accepted — your **first login forces a password change**).
- At least one opportunity **pushed to the pipeline** by the RFP admin so it appears in your Spotlight feed.

---

## 0. Sign in & how email links route you

1. Go to **`/login`** → enter **Email** + **Password** → **"Sign in"**.
   - ⚠️ **First login** (temporary password) bounces you to **`/change-password`** — set a permanent password, then sign in again.
2. ✅ **Verify:** you land on **`/portal/<slug>/dashboard`**.
3. **Email "To-Do" links:** a nudge email's button opens **`/go?task=<id>`**. If you're signed out it sends you to `/login` and back; once signed in it routes you **straight to the relevant proposal** (or your dashboard task queue). ✅ Verify clicking an email link lands you on the right proposal.

### Portal navigation (left sidebar — exact labels)
**Dashboard** · **Spotlight** (path `/spotlights`) · **Pipeline** · **Library** · **Proposals** · **Processes** · **Activity** · **Team** · **Documents** · **Billing** · **AI Usage** (admin) · **Automation** (admin) · **Settings** (path `/profile`) · **Sign out**.
> Label↔path to know: **Spotlight**=`/spotlights`, **AI Usage**=`/agents`, **Settings**=`/profile`.

---

## 1. Set up your company profile (drives matching)

1. Nav **Settings** → `/portal/<slug>/profile`. Click **"Edit"**.
2. Fill **Company Summary**, **Technology Focus**, **NAICS Codes (comma-separated)**, **Keywords (comma-separated)**, plus Target Agencies / Set-Aside Types / Research Areas → **"Save"**.
3. ✅ **Verify:** the fields persist. These feed Spotlight scoring and AI drafting — your **NAICS + Keywords** directly change your match scores in §2.

---

## 2. Spotlight — find & pin opportunities

### 2.1 Browse the scored feed
1. Nav **Spotlight** → `/portal/<slug>/spotlights`. You see **"Spotlight Feed"**, "N topics found", and opportunity cards each with a **score circle** (solid = pipeline "Score"; dashed = "Est."), a match bar, a close-date countdown, and **"Why this matches:"** reason chips.
   - ⚠️ If your profile is empty you'll see "No profile data found. Scores are based on available data only." → do §1 first.
2. Use the filters **Agency**, **Program**, **Min score**, **Sort by** (Match score / Close date / Posted date). ✅ Verify the list re-filters.

### 2.2 Pin an opportunity (this creates a To-Do)
1. On a card click **"Pin"** (it shows "Saving…", then becomes **"Unpin"**).
2. ✅ **Verify three things:** (a) the card shows **Unpin**; (b) the opportunity now appears under **Pipeline** (§3); (c) a **"Decide whether to pursue: …"** To-Do appears on your **Dashboard** (due in 7 days). Clicking **"Unpin"** cancels that task.

### 2.3 Opportunity detail
1. Click **"View Details"** → `/spotlights/<id>`. ✅ Verify **"Your fit by bucket"** cards reading **"{Bucket} #rank/total"** (hover: "Ranks #N of #M in your {bucket} pipeline") — the "ranks #N in bucket" signal; plus Topic Details, a **Compliance Preview** (limited — "Full compliance matrix available after proposal portal purchase."), and **Source Documents** with **"Download"** links.
2. Action buttons: **"Pin to Spotlight"** / **"Unpin from Spotlight"**, and — **only when pinned** — **"Build Proposal"** (or **"Go to Proposal"** if one exists).

---

## 3. Pipeline — track what you're pursuing

1. Nav **Pipeline** → `/portal/<slug>/pipeline`. ✅ Verify **"My Pipeline"** lists your pinned opportunities, each with a countdown badge and a status badge — a proposal **stage** ("Drafting"/"Review"/"Final"/"Submitted") if a workspace exists, else **"Pinned"**.
2. On a pinned-but-not-yet-built card click **"Build Proposal"** (routes you to the Spotlight detail to create it). On a built one click **"Open"** → the proposal workspace.

---

## 4. Create a proposal workspace

1. From a pinned opportunity's **Spotlight detail** click **"Build Proposal"** (it shows "Creating…").
   - ⚠️ **Paywall is OFF for the founding cohort** (`FOUNDING_COHORT_BYPASS`): you can create a workspace **without a Stripe purchase**. (Wording elsewhere says "purchase a topic" — creation is free while the bypass is on.) A duplicate for the same opportunity returns a conflict.
2. ✅ **Verify:** you're routed to **`/proposals/<proposalId>`** with a section skeleton, a compliance matrix, and the opportunity card.
3. **What just happened:** the proposal is created **locked for a 72-hour admin review** — RFP staff review the skeleton/compliance before you edit.
   - ⚠️ As the **tenant_admin you do NOT see the yellow "under admin review" banner** (that's shown to your `tenant_user`/partner teammates). You see the full **Admin Panel** with a **"Locked (#0)"** chip; editors are read-only until staff unlock. When unlocked, your team gets an email "Your proposal is ready".

---

## 5. The Proposal Workspace (the core)

Open **Proposals** → a proposal → `/proposals/<proposalId>`.

### 5.1 Orientation
1. ✅ Verify the header (title, Topic/agency/Due-date) and the collapsible **"Opportunity origin & compliance"** card with **three tabs**: **Overview** (stage, Open/Locked, source bucket), **Origin** (frozen-at-purchase opp summary + bought-from bucket/score), **Compliance** (live % bar + Satisfied/Partial/Not addressed/N/A counts).
2. Tabs across the workspace: **All Sections** / **My Sections** / **Timeline** (admin default = All Sections).

### 5.2 AI-draft the sections
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
4. **Export the package:** in Artifacts click **"Export Package"** → ✅ Verify it downloads **`proposal-package-<id>.json`** (it's a JSON bundle, **not a PDF**). ⚠️ Export only works once you've locked at least once (or reached submitted/archived) — otherwise the button helper says "Lock the proposal or advance to submitted stage to export".

---

## 6. Team & partners

### 6.1 Tenant-level team (`/team`)
1. Nav **Team** → `/portal/<slug>/team`. ✅ Verify the members + collaborators tables.
2. **Invite a teammate:** in the invite form enter **Email**, **Name**, pick **Role** (**Contributor**=tenant_user / **Admin**=tenant_admin / **External Partner**=partner_user) → **"Send Invite"**. ✅ Verify a success message.

### 6.2 Per-proposal collaborators (incl. university partners)
1. In a proposal's Admin Panel → **Team & Access** → **"+ Invite"** ("Invite Collaborator").
2. Fill **Email address**, **Full name**, **Role** (**Contributor** or **External** — choose **External** for a university partner), **Permission** (**View only** / **Comment** / **Edit**), and toggle **"Assign to sections:"** chips → **"Send Invite"**.
3. ✅ **Verify:** the collaborator appears in the roster and the **Access Matrix** (sections × people, E/C/V/—).
   - ⚠️ **Onboarding caveat for partners:** the invite email's "Open Proposal" button currently points at `/login`, but a partner's access only activates after they set a password via the **`/invite/<token>`** acceptance page. If a partner "can't see the proposal", have them use the `/invite/<their-collaborator-id>` link. (See the University Partner manual.)
4. Remove someone with the **"✕"** (confirm "…access will be revoked immediately").

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
- [ ] Spotlight → **Pin** an opportunity → a To-Do appears + it shows in Pipeline.
- [ ] Spotlight detail → **Build Proposal** → routed to the workspace.
- [ ] Workspace → **Draft All Sections** → sections drafted.
- [ ] A section → edit in canvas → **Save** → **Export .docx**.
- [ ] Admin Panel → **Accept & Lock All** → **Advance** the stage.
- [ ] Team & Access → invite an **External** partner with section scope.
- [ ] Automation → toggle the two AI prefs and save.
- [ ] (After submit) Record Outcome → **Won**.

---

## 10. Stubs / disabled — keep OUT of pass/fail
- 🚫 **"AI Review (coming soon)"** (AI & Library tab) — disabled.
- 🚫 **"Export .pdf"** in the section editor — disabled; package export is **JSON**, not PDF.
- 🚫 **"Split"** in Library Review — local toggle, no backend.
- ⚠️ **Billing/Stripe** (`/billing`): **"Subscribe to Spotlight ($299/mo)"**, **"Manage Billing"**, expert-hours purchase all redirect to Stripe — with the founding-cohort bypass and no live keys, only verify the buttons render/redirect, not end-to-end payment.
