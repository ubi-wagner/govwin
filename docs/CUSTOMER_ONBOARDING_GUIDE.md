# Customer Onboarding Guide

**From Application to First AI Draft**

> **Every screenshot below was taken from the running product**, driven as a real
> `tenant_admin` (Kate Ulepic, Foundation) through the real login — not mocked, not drawn.
> Re-capture them with `cd frontend && node scripts/capture-guides.mjs --only customer`, which
> visits each documented route as that actor and **fails the run** if any surface 404s, redirects
> somewhere else, or renders an error boundary. Where a screenshot contradicted the text, the text
> was corrected; those corrections are noted inline.

---

## What is RFP Pipeline?

RFP Pipeline pairs isolated AI with expert human curation to help small businesses win federal R&D funding (SBIR, STTR, BAA, OTA, CSO). You upload your company documents, we atomize them into reusable building blocks, match you to relevant opportunities, and our AI drafts your proposal sections using your own proven content.

---

## Pricing

Founding-cohort launch target: **August 2026.**

| Product | Price | Notes |
|---|---|---|
| **Spotlight** | **$499/mo** | 3-month minimum |
| **Proposal portal — Phase I** | **$1,999** | per portal |
| **Proposal portal — Phase II** | **$4,999** | standalone |
| **Proposal portal — Phase II (linked)** | **$3,999** | when your linked Phase I is already in the system + library |

During the founding cohort, proposal portals are purchased with a **comp code** (a $0 recorded
purchase); live self-serve checkout is coming soon.

---

## Step 1: Apply for the Founding Cohort

1. Go to the RFP Pipeline homepage
2. Scroll to the application section or click **"Apply for Early Access"**
3. Fill out the application form:

| Field | What to enter |
|---|---|
| Company Name | Your legal business name |
| Contact Email | Your primary email (e.g., eric.c.wagner@gmail.com) |
| Phone | Business phone number |
| DUNS / UEI | Your SAM.gov unique entity identifier |
| CAGE Code | Your CAGE code (if you have one) |
| NAICS Codes | Comma-separated NAICS codes you perform under |
| SAM Registration | Whether you're registered on SAM.gov |
| Company Size | Number of employees |
| Years in Business | How long you've been operating |
| Clearance Level | Highest facility clearance (None, Confidential, Secret, Top Secret) |
| Tech Focus Areas | Your core technical capabilities (e.g., "machine learning, autonomous systems, RF engineering") |
| Target Agencies | Which agencies you want to pursue (DoD, DOE, NASA, NIH, etc.) |
| Target Program Types | SBIR Phase I, SBIR Phase II, STTR, BAA, CSO, OTA |
| Past Performance Summary | Brief description of relevant past contracts |
| Why RFP Pipeline | What you hope to get from the platform |

4. Click **Submit Application**
5. You'll see a confirmation message. Our admin team reviews applications within 24-48 hours.

**What happens next:** The admin (eric@rfppipeline.com) reviews your application, verifies your information, and accepts you into the system. This creates your company workspace and user account.

---

## Step 2: First Login

![The sign-in page](./assets/guides/customer/02-login.png)

1. You'll receive a temporary password from the admin (via email or direct communication)
2. Navigate to `/login`
3. Enter your email and temporary password
4. You'll be automatically redirected to the **Change Password** page
5. Enter your current (temporary) password, then your new permanent password
   - Must be at least 12 characters
   - Enter it twice to confirm
6. Click **Change Password**
7. After the password is set, you'll be redirected to your portal dashboard

---

## Step 3: Your Dashboard

After login, you land at `/portal/[your-company-slug]/dashboard`

![The tenant dashboard, with builds in the centre and the count rail on the right](./assets/guides/customer/03-dashboard.png)

**What you see:**

- **"Welcome back, {your first name}"**, and under it a one-line roll-up —
  *"6 active builds · 10 opportunities · 24 to-dos"*
- **Count tiles** (right rail) — **To-dos**, **Library** (your content atoms), **Opportunities**,
  **Buckets** and **Activity**. Each opens a drawer; on a brand-new workspace they read 0.
  *(Corrected from the screenshot: Activity is a right-rail tile, not a centre-column feed, and
  Opportunities/Buckets are not admin-only.)*
- **Centre — CONTINUE BUILDING**: a card per active build, each stamped with its stage
  (**Drafting** · **Final** · **Submitted**), a 🔒 **locked** badge once it is locked, and an
  **Open canvas →** link straight into the work
- When you have no builds yet:
  - **Admins** see a **Get started** checklist: upload company documents, set up your company
    profile, review your matched opportunities, start your first proposal build (each ticks off
    as you finish it)
  - A **base team member** with nothing assigned sees a *"You're on the team"* card instead —
    *"Nothing is assigned to you yet; ask your admin to add you to a build"* — not a checklist
    that leads nowhere

**Your sidebar navigation** (as shipped — the earlier six-item list in this guide was out of date):

| Group | Items |
|---|---|
| Work | **Command Center**, **Dashboard** |
| Pursue | **Opportunities** (the card feed at `/cards`), **Buckets** (the lenses that rank it) |
| Build | **Proposals**, **Builds** (your purchased proposal portals), **Contracts** |
| Content | **Library** (atoms — upload, atomize, review), **Vaults**, **Documents**, **Templates** |
| Coordinate | **To-dos**, **Processes** (your running workflows), **Activity**, **Team** |
| Admin | **Manage**, **Billing**, **AI Usage**, **Automation**, **Settings** |

### The Command Center

`/portal/[slug]/command` is the "what changed since I last looked" cockpit — opportunities,
to-dos, workflows and activity in one place, with an unread watermark so returning after a few
days shows you only what is new.

![The tenant Command Center](./assets/guides/customer/03b-command-center.png)

---

## Step 4: Upload Your Company Documents

**Navigate to:** **Library** in the sidebar (or click the dashboard checklist link)

**Path:** `/portal/[slug]/atoms` → the **Upload package** tab

> **Route correction.** Upload, review and browse are **tabs on one page**, not three pages. The
> three routes this guide used to name — `/library/upload`, `/library/review` and `/library` — are
> retired and now **redirect to `/atoms`**. Old bookmarks still land in the right place; the paths
> in this guide have been updated to the real ones.

![The unified library — Upload package tab](./assets/guides/customer/04-library-upload.png)

**Supported formats:** PDF, DOCX, DOC, PPTX, PPT, TXT, MD

**Size limit:** 50MB total per upload batch

### How to upload:

1. **Drag and drop** files onto the drop zone, or **click** the drop zone to browse
2. Files appear in a list below the drop zone with their name and size
3. Click **"Upload All"** to start uploading
4. For each file, you'll see:
   - **Uploading** — progress bar
   - **Atomizing...** — the system is extracting structure from your document
   - **Done** — file is uploaded and atomized
   - **Error** — something went wrong (error message shown)

### What gets uploaded:

The system reads the actual structure of your documents:
- **DOCX files**: Headings, paragraphs, lists, tables, inline formatting (bold, italic) — all preserved from the Word styles
- **PPTX files**: Each slide becomes a separate atom with its title and content
- **PDF files**: Text extracted with heading detection and list parsing
- **TXT/MD files**: Markdown headings and structure recognized

### What to upload first:

For the best AI drafting results, upload these documents in order of priority:

1. **Past Performance narratives** — your strongest completed contracts
2. **Capability statement** — your company overview
3. **Key personnel bios/resumes** — your team's qualifications
4. **Previous winning proposals** — the gold standard for AI to learn from
5. **Technical approach documents** — methodology descriptions
6. **Cost volume templates** — budget justification language

### After upload completes:

The file lands in the library and its atoms appear under the **Review** tab. The **Atomize** tab is
the hand-shred path for the same job: drop a document, draw boxes on the rendered page, and keep
only the parts you want as atoms.

![The Atomize tab — hand-shred a document into atoms](./assets/guides/customer/04b-library-atomize.png)

---

## Step 5: Review and Categorize Your Atoms

**Path:** `/portal/[slug]/atoms` → the **Review** tab

This is where you shape the quality of your library. The system extracted semantic units ("atoms") from your documents. Now you review each one.

![The Review tab](./assets/guides/customer/05-library-review.png)

### What you see:

- **Header**: Source filename, atom count
- **Bulk actions bar**: "Accept All" button, bulk category dropdown, progress indicator ("X of Y atoms reviewed")
- **Atom cards**: One card per extracted atom

### Each atom card shows:

- **Heading text** (if the atom had a heading in the original document)
- **Content preview** — first 300 characters, click to expand
- **Category dropdown** — the system's best guess based on the heading and content. Categories:
  - general, technical_approach, past_performance, key_personnel, capability_statement, cost_volume, management_approach, commercialization, abstract, qualifications, schedule, risk_management, quality, facilities, teaming, security, transition_plan, data_rights
- **Confidence badge**:
  - Green (> 70%) — high confidence in the auto-detected category
  - Yellow (40-70%) — medium confidence, worth checking
  - Red (< 40%) — low confidence, definitely review this one
- **Tags** — shown as pills, editable (click to modify, comma-separated)

### What to do with each atom:

| Action | When to use |
|---|---|
| **Accept** | Content is a good reusable unit, category is correct |
| **Reject** | Content is boilerplate, headers, footers, or not useful |
| **Change category** | Category is wrong (e.g., system guessed "general" but it's really "past_performance") |
| **Edit tags** | Add specific tags like "DARPA", "autonomy", "Phase II" |
| **Accept All** | You trust the auto-categorization and want to approve everything at once |

### Why this matters:

Accepted atoms go into your **approved library**. When the AI drafts proposal sections, it searches your library for relevant atoms and incorporates them. Better categorization = better drafts.

---

## Step 6: Browse Your Content Library

**Path:** `/portal/[slug]/atoms` → the **Library** tab

After accepting atoms, they appear in your library as a searchable, filterable list.

![The Library tab — 24 atoms with taxonomy tags and provenance badges](./assets/guides/customer/06-library.png)

- **Browse library** at the top spans **All · Foundations · Sections · Groups · Atoms** — the four
  grains a piece of content can have
- Each row carries its **grain** (`primitive` / `foundational`), title, word count, its
  **taxonomy tags** (`agency:…`, `fmt:…`, `kind:…`, `sol:…`, `vol:…`), where it came from
  (**UPLOADED** / **RETURNED**), whether it is yours (**MINE**), who added it, and its status
  (`approved`), with an **Archive** action
- **Filters**: free-text search, grain, status, active/all, plus **Select all** for bulk work
- **Reuse a past proposal** — turn a past proposal you uploaded into a reusable template: its
  winning structure kept, its content stripped, then start a fresh draft from it filled from your
  library
- **+ Create canvas** builds a foundation artifact from scratch that decomposes into the same atoms
- **+ Add starter set** copies in the shared system starter library so a new workspace is not empty

Your library grows over time. Every proposal you work on can feed content back into the library.

---

## Step 7: Review Your Opportunity Feed

**Path:** `/portal/[slug]/cards` — reached from **Opportunities** in the sidebar. (The old
`/spotlights` link still works and redirects here; verified live in this pass.)

The feed — titled **Opportunity Pipeline** — shows federal and state opportunities ranked by how
well they match your profile.

![The opportunity card feed, ranked per bucket](./assets/guides/customer/07-cards.png)

### How scoring works:

- **Tech focus areas** overlap with topic tech areas → 15 points each
- **Agency match** (your target agencies vs. the opportunity's agency) → 20 points
- **Program type match** (SBIR, STTR, BAA, etc.) → 15 points
- **Library content match** (you have atoms in a relevant category) → 10 point bonus

> **Ranking is now per Spotlight bucket.** Create a few **Spotlight buckets**
> (agency / program type / keyword filters) on the Buckets page; each opportunity card is scored and
> **ranked within every bucket**, so you can watch several theses at once. One card carries multiple
> bucket ranks — it is not duplicated per bucket.

### Each opportunity card shows:

- Topic title, with the topic number in parentheses
- Agency and program type (`National Science Foundation (NSF) · sbir`)
- A **"Closes in 5d"** chip — amber as the date approaches
- **A score pill per bucket**, not one overall number: *Advanced Manufacturing & Automation 100* ·
  *Non-dilutive Capital (SBIR/STTR & State) 75* · *Construction Technology & Housing 56* …, with a
  `+N` when the card ranks in more buckets than fit. This is the correction the screenshot forced:
  a card carries **as many ranks as you have buckets**, and there is no single "match score" field.
- **Pin to pursue** · **Not interested** (passes the card) · **Build →** (starts the purchase)

Above the cards: **Include closed** and **Show passed** toggles, a **Refresh**, the card count, and
a **Sort** selector (default *Best match*).

### What to do:

1. Browse the feed — highest-scoring cards appear first under the current sort
2. Click into topics that interest you to see details
3. **Pin to pursue** the topics you want, or **Not interested** to pass on one
4. Pinned topics count toward your **Opportunities** tile and are available for proposal creation

### Buckets — the lenses that do the ranking

**Path:** `/portal/[slug]/buckets`

![Spotlight buckets](./assets/guides/customer/07b-buckets.png)

A bucket is a saved thesis (agency / program type / keyword). Every card is scored **within every
bucket**, so you can watch several theses at once without duplicating cards. Up to **six** buckets;
a `tenant_admin` or a designee with `can_manage_buckets` maintains them.

> **If a pin or refresh fails**, the cards now surface an inline message (*"That action could not
> be completed — please try again"* or *"Could not load your opportunity cards"*) rather than
> failing silently — retry, and if it persists, tell your rep.

---

## Step 8: Purchase a Proposal Portal for a Pinned Topic

**Path:** `/portal/[slug]/cards` → the card → **Build →**

Pinning tracks an opportunity; **purchasing** a proposal portal is what unlocks the build workspace.

### How the founding cohort buys (comp code)

1. On the card, click **Build →**
2. Enter the comp code **`rfppipelinetest`** and confirm
   - This records a **$0 purchase** — live self-serve card checkout is coming soon (⚠ future); the
     comp code stands in for the founding cohort
3. Your portal opens in **"Waiting for RFP Expert Curation"** with a **live countdown (up to 72
   hours)**. An RFP expert builds/reviews the proposal skeleton for your opportunity, then
   **releases** your workspace.
4. When released, your **proposal workspace** opens already populated — this is **V0**.

> **What the 72 hours covers.** The clock is for the **expert setup** (the compliance matrix, volumes,
> and formatted blank "molds" for your opportunity) — not your drafting. If the skeleton was already
> built for a prior buyer of the same opportunity, your release is usually **~15 minutes**, not 72h.

### Your Builds page

Every portal you own lives at `/portal/[slug]/portals` — **Builds** in the sidebar, titled
**Proposal Portals**: *"Each portal is a build for an opportunity — accept guardrails to launch,
then run the stages to closeout."*

![The Builds list](./assets/guides/customer/08-portals.png)

Each row shows the portal's state (**LAUNCHED**) and four actions — **Open build →**,
**Manage workflow →**, **Advance stage**, **Force advance** — with a line telling you where you
are: *"Build ready — open the canvas to run V1. ToDos land in your task queue."*

---

## Step 8b: Accept Your Build Workflow (required, once per portal)

**Path:** `/portal/[slug]/portals/[portalId]` — raised as a **required to-do** the moment your
portal is released, and reachable from **Manage workflow →** on the Builds list.

![Workflow setup — the recommended plan, editable before you start](./assets/guides/customer/08b-workflow-setup.png)

This step did not exist when this guide was first written, and it is not optional: a released
portal parks a required **Workflow Setup** to-do, and the build does not start until a
`tenant_admin` (or a delegated manager) accepts a plan.

You are shown a **pre-filled, recommended plan** — inferred from your own prior *accepted* plans
for similar opportunities, never from anyone else's. Adjust it and press **Accept & Start**:

| Control | What it does |
|---|---|
| **Stage name + Due date** | Three stages by default — *Kickoff & Compliance*, *Draft (V0.5)*, *Review, Lock & Submit* — each with an absolute date, reorderable (↑ ↓) and removable |
| **Closed by** | Who closes the stage gate: **Human**, or an **AI-manager** that advances it for you |
| **Per-to-do row** | Type (*Acknowledge / review*, *Draft sections*, *Upload documents*), title, **owner** (a named person, or a role like *Any admin* / *Any contributor*), and its own due date |
| **+ add to-do** | Add a step the recommended plan didn't include |
| **Reminders** | Up to three nudges, in days before a to-do is due (default `5, 2, 1`); the last also copies your managers |
| **Shift timeline / Set deadline from solicitation** | Re-baseline every date at once — move the whole plan ±N days, or anchor it to the solicitation's close date |

Everything here stays editable after launch. Editing re-projects onto the live to-dos, so changing
a due date re-arms its reminders rather than leaving stale ones behind.

### The Proposal Workspace (V0) shows:

- **Proposal header**: Title, topic number, agency, program type, close date
- **Stage progress**: your build advances **V0 → V0.5 → V1** (shown as Draft → Final → Submitted)
- **Section list**: Each section with:
  - Section number and title
  - Status indicator (Empty, AI Draft, In Progress, Complete, Approved)
  - Page allocation (if the RFP specified page limits)
  - Node count (how many content blocks are in the section)
  - Version number

![The proposal workspace](./assets/guides/customer/09-proposal-workspace.png)

### The four tabs — and which one you land on

Under the header the workspace offers **Document · All Sections · My Sections · Timeline**, and where you
land depends on your access:

| You are | You open on | Why |
|---|---|---|
| A **tenant-wide** member (`tenant_admin` or staff with whole-workspace access) | **Document** | The whole proposal as one continuous canvas — the normal place to work |
| A **scoped collaborator** (assigned to specific sections) | **My Sections** | You see only what is yours; the rest of the build is not your concern |

**Document is the main surface.** It is the whole proposal as one flowing canvas, with the outline down
the left, and a chip row that summons five overlays over your own content — **Sections · Atoms ·
Provenance · Compliance · Budget**. They are all off by default; turn one on when you want to see that
layer, and off again when it's in the way. Select a span and you get **Atomize · Annotate · Reuse ·
Compliance-check**. Edits autosave, and the bar tells you what's unsaved.

![The Document tab — the whole proposal as one canvas, with the overlay chips](./assets/guides/customer/09b-fluid-document.png)

The **Proposal Studio** panel sits above it — three gated loops (Draft → Refine → Compliance) you can
step through or **Run all 3 automatically**. It is advisory: drafts land in review, and nothing locks or
submits on its own. When the build is submitted, **Record the outcome** (Won · Lost · Withdrawn) — a win
starts the contract and drops a kickoff task in your queue, and every outcome tunes your library atom
scores for future drafts.

**My Sections** is the same canvas, filtered to your assignments:

![My Sections — a collaborator's scoped view](./assets/guides/customer/09c-my-sections.png)

---

## Step 9: AI Drafts Your Sections

In the Proposal Workspace, the **AI Section Drafter** panel appears when you have empty sections.

> When your workspace is released (Step 8), the AI Section Drafter has usually **already produced a
> first pass** from the expert's notes and any library atoms (this is **V0**). Plugging your best
> atoms into the molds (Step 10) is the **V0 → V0.5** jump — typically ~15 minutes.

### How it works:

1. Click **"Draft All Sections"**
2. For each empty section, the AI:
   - **Searches your library** for relevant atoms (by category match and text search)
   - **Reads the RFP context** (compliance constraints, evaluation criteria)
   - **Drafts content** using your library atoms + RFP requirements
   - **Creates structured content** (headings, paragraphs, lists) in the canvas editor
3. Progress is shown per-section:
   - Gray dot = pending
   - Yellow dot (pulsing) = drafting...
   - Green dot = drafted
   - Red dot = failed (will retry)
4. When all sections are drafted, a summary message appears

### After drafting:

Click into any section to review the AI's work in the canvas editor.

---

## Step 10: Review and Revise in the Canvas Editor

Click any section from the workspace to open the **WYSIWYG Canvas Editor** — the per-section surface,
for when you want to work on one piece with the full node-level toolset rather than on the whole
document. (The Document tab in Step 9 is where most work happens; this is the close-up.)

![The canvas editor — the page at real dimensions, with the compliance sidebar](./assets/guides/customer/10-canvas-editor.png)

### What you see:

- **Main content area**: Your section rendered at actual page dimensions with headers, footers, and margins matching the RFP requirements
- **Sidebar**: up to six tabs — **Compliance**, **Node** (the selected block), **Add** (insert
  content), **Review** (comments), **History** (versions) and **Settings** (page layout). *Corrected
  from the screenshot: the earlier "three tabs" was the read-only subset.* A view/comment
  collaborator keeps the read panels and loses **Add** and **Settings**.
- **Your toolbox** sits above the tabs — the most-likely tool for your role and the stage you're in,
  first. It only ever offers tools that work; a card with nowhere to go is not shown.
- A **page gauge** that counts your section against its page budget as you type. It is the *same*
  ruler the export gate enforces, so what the editor says and what the download allows cannot
  disagree.

### AI Revision Tools (in the sidebar):

**Quick Actions** — one-click revision commands:
| Button | What it does |
|---|---|
| Regenerate | Rewrites the section from scratch with the same intent |
| Make shorter | Condenses by ~30% while keeping key points |
| Make longer | Expands with more detail and supporting evidence |
| More specific | Adds concrete details, metrics, and methodology |
| Simpler language | Rewrites for non-specialist readability |
| Stronger opening | Rewrites the first sentence to grab reviewer attention |
| Add metrics | Inserts quantitative data where possible |
| Fix compliance | Ensures strict adherence to RFP requirements |

**Custom instruction**: Type your own revision prompt (e.g., "Focus on our DARPA experience" or "Add reference to our Phase I results")

**Replace with library content**: Searches your library for matching atoms and rewrites using proven language from your best documents

### Export:

- **Letter-format sections** → Export as .docx (Word)
- **Slide sections** → Export as .pptx (PowerPoint)
- **Table sections** → Export as .xlsx (Excel)
- **PDF** → available for letter-format sections and documents when the renderer is up; if it
  isn't, you'll see *"PDF export is temporarily unavailable. Use .docx."* — the DOCX / PPTX /
  XLSX exports always work

The whole proposal downloads as **json · docx · pdf · zip** (`?format=…`). Figures export as native
chart objects, not pictures of charts, and sections come out in their real order.

> **The export is gated on compliance.** Font, page limits, per-section page budgets, slide counts
> and image rules are checked against what the solicitation requires, using the same ruler as the
> editor gauge. If a volume is over its limit the download tells you which rule and by how much
> rather than quietly shipping a non-compliant package.

### Finalize (V1)

When your sections are ready, **Lock all** (or **Force advance to V1** to finalize without locking
every section). Advancing to V1 auto-locks the workspace and enables the final **Download Proposal
(.docx)**. A first unlock is free if you need to make changes; further unlocks may need admin help.

### Your to-dos and your team

Everything the build asks of you lands in one queue at `/portal/[slug]/todos` — the same to-dos your
workflow plan (Step 8b) projected, plus review requests, amendment acknowledgements and broadcasts.

![The to-do queue](./assets/guides/customer/11-todos.png)

**Team** (`/portal/[slug]/team`) is where you invite colleagues and external collaborators, and set
what each can reach — the whole workspace, specific builds, or a single section to comment on.

![The team page](./assets/guides/customer/12-team.png)

**Documents** (`/portal/[slug]/documents`) is for the standalone work that is not part of a
proposal — a capability statement, a one-page flier, a deck. It uses the same canvas, and the
same size checks: a 2-page flier or a 10-slide deck is measured too.

![The documents surface](./assets/guides/customer/13-documents.png)

For the full operator walkthrough of purchase → curation → release → build, see
[`HITL_IMMOBILEYES_CLICKPLAN.md`](./HITL_IMMOBILEYES_CLICKPLAN.md) (design:
[`MASTER_MIRROR_OPP_DESIGN.md`](./MASTER_MIRROR_OPP_DESIGN.md)).

---

## Tips for Best Results

1. **Upload your BEST past proposals first** — winning content is the AI's strongest training signal
2. **Use specific, descriptive filenames** — "DARPA_Past_Performance_Autonomy_2024.docx" categorizes better than "final_v3.pdf"
3. **Review atoms carefully** — spending 10 minutes categorizing atoms saves hours of revision later
4. **Pin topics early** — even before you're ready to propose, it helps the system learn your interests
5. **Iterate with revision tools** — "Make shorter" then "More specific" is a powerful combination
6. **Accept good nodes to your library** — every accepted node becomes a building block for future proposals
7. **Export early and often** — review your .docx exports in Word to catch formatting issues

---

## What Comes Next

- **Color Team Reviews**: Pink → Red → Gold team review stages with collaboration tools
- **Team Collaboration**: Invite team members to specific proposal sections
- **Outcome Tracking**: Record win/loss results to improve future AI drafts
- **Template Library**: Pre-built section templates from real winning proposals
- **Automated Notifications**: Email alerts for new matching opportunities and approaching deadlines

---

## Need Help?

Contact eric@rfppipeline.com for support during the founding cohort.
