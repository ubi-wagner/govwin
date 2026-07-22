# Customer Onboarding Guide

**From Application to First AI Draft**

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

**What you see:**

- **Company name** and welcome message
- **Count tiles** (right rail) — **To-dos**, **Library** (your content atoms), and — for admins
  — **Opportunities** and **Buckets**, each opening a drawer (all start at 0)
- **Center** — your **active proposal builds**, or, when you have none:
  - **Admins** see a **Get started** checklist: upload company documents, set up your company
    profile, review your matched opportunities, start your first proposal build (each ticks off
    as you finish it)
  - A **base team member** with nothing assigned sees a *"You're on the team"* card instead —
    *"Nothing is assigned to you yet; ask your admin to add you to a build"* — not a checklist
    that leads nowhere
- **Recent Activity** — a feed of events in your workspace

**Your sidebar navigation:**
- Dashboard
- Library / Atoms (your content atoms — upload and atomize)
- Opportunities (the **card** feed at `/cards`; the old `/spotlights` link redirects here)
- Buckets (saved Spotlight filters that **rank** your cards)
- Portals / Proposals (purchased proposal portals + your active proposals)
- Documents, Profile, Team (additional features)

---

## Step 4: Upload Your Company Documents

**Navigate to:** Library → Upload Documents (or click the dashboard checklist link)

**Path:** `/portal/[slug]/library/upload`

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

A green **"Review & Categorize Atoms"** button appears. Click it to proceed to the review step.

---

## Step 5: Review and Categorize Your Atoms

**Path:** `/portal/[slug]/library/review`

This is where you shape the quality of your library. The system extracted semantic units ("atoms") from your documents. Now you review each one.

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

**Path:** `/portal/[slug]/library`

After accepting atoms, they appear in your library as a searchable, filterable table.

- **Category filter pills** across the top — click to filter by category
- **Table columns**: Category, Content preview, Status (draft/approved/archived), Tags, Created date
- **Upload more** anytime using the "Upload Documents" button in the top right

Your library grows over time. Every proposal you work on can feed content back into the library.

---

## Step 7: Review Your Spotlight Feed

**Path:** `/portal/[slug]/cards` (the old `/spotlights` link redirects here)

The Spotlight feed shows federal opportunities ranked by how well they match your profile.

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

- Topic title and number
- Agency and program type
- Close date (with overdue highlighting in red)
- Match score
- **Pin** button — save this topic for later

### What to do:

1. Browse the feed — highest-scoring topics appear first
2. Click into topics that interest you to see details
3. **Pin** the topics you want to pursue
4. Pinned topics count toward your **Opportunities** tile and are available for proposal creation

> **If a pin or refresh fails**, the cards now surface an inline message (*"That action could not
> be completed — please try again"* or *"Could not load your opportunity cards"*) rather than
> failing silently — retry, and if it persists, tell your rep.

---

## Step 8: Purchase a Proposal Portal for a Pinned Topic

**Path:** `/portal/[slug]/cards` → the pinned card → **Purchase**

Pinning tracks an opportunity; **purchasing** a proposal portal is what unlocks the build workspace.

### How the founding cohort buys (comp code)

1. On a pinned card, click **Purchase**
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

### The Proposal Workspace (V0) shows:

- **Proposal header**: Title, topic number, agency, program type, close date
- **Stage progress**: your build advances **V0 → V0.5 → V1** (shown as Draft → Final → Submitted)
- **Section list**: Each section with:
  - Section number and title
  - Status indicator (Empty, AI Draft, In Progress, Complete, Approved)
  - Page allocation (if the RFP specified page limits)
  - Node count (how many content blocks are in the section)
  - Version number

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

Click any section from the workspace to open the **WYSIWYG Canvas Editor**.

### What you see:

- **Main content area**: Your section rendered at actual page dimensions with headers, footers, and margins matching the RFP requirements
- **Sidebar**: Three tabs — Compliance, Node Detail, Add Content

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

### Finalize (V1)

When your sections are ready, **Lock all** (or **Force advance to V1** to finalize without locking
every section). Advancing to V1 auto-locks the workspace and enables the final **Download Proposal
(.docx)**. A first unlock is free if you need to make changes; further unlocks may need admin help.

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
