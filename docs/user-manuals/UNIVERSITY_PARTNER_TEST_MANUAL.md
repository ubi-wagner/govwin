# University Partner (Collaborator) — User Test Manual

**Audience:** an **external university collaborator** invited to help on **one** proposal — role **`partner_user`**.
**You are a guest, scoped to the sections you were granted** (view / comment / edit) on a single proposal. You do **not** see the rest of the customer's portal. This manual tests exactly what a partner can and cannot do.

> **Where you fit:** `partner_user` is the lowest portal tier — a per-proposal, **stage-scoped** collaborator on the customer's **V0 → V1** build (design: docs/MASTER_MIRROR_OPP_DESIGN.md). It is also today's stand-in for an appointed **reviewer / EconDev "manager" gate**; a dedicated manager role is **⚠ future**.
**Conventions:** **✅ Verify** = expected result · ⚠️ = quirk/known issue · 🚫 = blocked/not available to partners.

### Prerequisites (set up by the customer admin)
- The customer's `tenant_admin` invites you on a proposal (Admin Panel → **Team & Access** → **"+ Invite"**, Role = **External**, a **Permission**, and one or more **sections**).
- You receive an **invite email** with a temporary password.

---

## 0. Accept the invite & sign in

You receive an **invite email** ("You've been invited to collaborate on …").
1. Click the email's **"Accept Invitation"** button → it opens the acceptance page **`/invite/<your-collaborator-id>`**.
   - ✅ Verify it shows who invited you, the proposal title, and the company.
2. Enter **Password** + **Confirm** — **use at least 12 characters** — → **"Set Password & Accept"**.
3. ✅ **Verify:** you're taken **straight into the proposal workspace** (`/portal/<slug>/proposals/<proposalId>`).
   - This step is what activates your access (it records your acceptance). Until you complete it, the workspace would show "Not found".
4. After onboarding, normal sign-in is **`/login`** with the password you set → you land on your **Proposals** list.

> If you were **already** a GovWin user (you have an existing account), the invite email instead shows an **"Open Proposal"** button — your access is granted immediately, just sign in and open it.

---

## 1. What you can SEE (the restricted view)

1. ✅ **Verify the nav is restricted:** the only sidebar item you see is **Proposals**. (The customer's **Opportunities** (`/cards`), **Buckets**, **Atoms**, **Library**, **Builds**, **Team**, **Billing**, etc. are hidden; typing those URLs bounces you back to Proposals.)
2. Nav **Proposals** → you see **only the proposal(s) you collaborate on** (not the company's other proposals).
3. Open your proposal. ✅ Verify it opens to the **"My Sections"** view by default, showing only your granted sections.
   - 🚫 Opening a proposal or section you were **not** granted shows a **"Not found" (404)** page — you never see its title, team, or compliance.

---

## 2. What you can DO in the workspace

Your granted sections are grouped by permission:

### 2.1 Edit a section (only **Edit**-granted, current-stage, unlocked)
1. Under **"Shared With Me"** ("You were invited as an external collaborator.") click **"Open Editor →"** on an edit-granted section.
2. Edit content in the canvas: click a node to select; edit text inline; use the right sidebar **"Add"** tab (Heading / Paragraph / Bullet List / Table / …) and **"Node"** tab (alignment, font, bold/italic, color). Reorder / Accept / Revert / Delete a node as needed.
3. Click **"Save"** (toolbar).
   - ✅ **Verify:** save succeeds and the version increments.
   - ⚠️ You may hit guard errors and that's expected: **"Proposal is locked"** (under admin review/locked), **"Edit window expired"**, **stage-locked** (a section completed in an earlier stage becomes read-only), or a **conflict** if someone saved at the same time.
4. Return with **"← Back to Proposal"**.

### 2.2 Comment on a section (**Comment**-granted)
1. Under **"Sections (Comment Only)"** click **"View & Comment"**.
2. In the editor sidebar **"Node"** tab, select a node → **"Comments"** → type a comment → post.
   - ✅ **Verify:** the comment is saved on commentable/editable sections.
   - ⚠️ **Comment/View sections still show a "Save" button**, but it will **fail with a permission error** server-side (the UI doesn't grey it out). Use **Comments**, not Save, on these.

### 2.3 View-only sections
- Under **"Other Sections (View Only)"** click **"View"** — read-only. Fully ungranted sections list as "— No access".

### 2.4 See the section's requirements
- In the editor sidebar **"Compliance"** tab ✅ verify you can see that section's status (page-limit vs max, font, margins, content sources). (You do **not** see the proposal-wide compliance matrix — that's admin-only.)

### 2.5 Upload a supporting document (if enabled)
1. On the proposal page find **"My Dropbox"** → drop zone **"Drop files here or click to upload"**.
2. ✅ **Verify:** your file uploads (≤50 MB) and you can delete **your own** files.
   - ⚠️ Blocked when the proposal is locked or already submitted/archived.
   - 💡 If the customer **delegates you a task** to provide a document (e.g. a letter of support), you do it **right here** in My Dropbox — there's no separate To-Do dashboard for partners. You have no task-assignment or gate-launch controls yourself (those are manager/admin-only).

---

## 3. What you CANNOT do (expected blocks)

| You try to… | Result |
|---|---|
| Use the AI tools (AI Revision / "Replace with library content" / Draft) | 🚫 The panel may appear, but the action **fails with a 403** — AI drafting requires internal staff. Not available to partners. |
| **Save** a comment/view-only section | 🚫 Server returns "Edit permission required" (no visible disabled state). |
| Advance / complete a stage, **Accept & Lock** a section | 🚫 Not available (no advance/lock controls render for you). |
| Manage the team / invite others / **Assign a task** | 🚫 Hidden (manager-only). |
| **Export** the proposal / download the package | 🚫 Not available. |
| Open a **non-granted** proposal or section | 🚫 "Not found" (404). |
| Reach Dashboard / Opportunities (`/cards`) / Buckets / Library / Team / Billing | 🚫 Hidden in nav; direct URLs bounce you back to Proposals. |

⚠️ **Access changes over stages:** there's no automatic revocation when a stage completes — you keep your grants, but a section that was **completed in a prior stage becomes read-only** (an Edit grant effectively becomes comment/view on it). The admin can remove you entirely (then your access is revoked immediately and the proposal 404s for you).

---

## 4. Quick smoke checklist (one pass)
- [ ] Accept the invite via **`/invite/<token>`** (≥12-char password) → land in the proposal.
- [ ] Confirm the nav shows **only Proposals**, and the proposal opens to **My Sections** with just your sections.
- [ ] On an **Edit** section: edit a node → **Save** succeeds.
- [ ] On a **Comment** section: post a **comment** (and confirm **Save** is rejected there).
- [ ] On a **View** section: read-only.
- [ ] Upload a file to **My Dropbox** (if enabled); confirm you can delete your own.
- [ ] Confirm a **non-granted** proposal/section → "Not found".
- [ ] Confirm AI tools / advance / export / team management are not available.

---

## 5. Known issues to expect (so they aren't logged as new bugs)
1. ⚠️ **AI tools render but 403 for partners** — the AI Revision / "Replace with library content" panel appears but the action is rejected (not wired for external collaborators).
2. ⚠️ **Save isn't greyed out on comment/view sections** — clicking it fails server-side with a permission error instead of the button being disabled. Use **Comments** on those sections.

> Fixed in this release (previously broken): the invite email now routes new partners to the **Accept Invitation** page (so access activates correctly — no more 404), and the acceptance page now requires the same **12-character** minimum as the server.
