# Chapter 8: RFP Curation Pipeline

## The Key Insight

There are fewer than 100 unique SBIR/STTR/BAA/OTA/Challenge RFP templates per year
across all federal agencies. Many are nearly identical cycle to cycle. But tens of
thousands of companies submit against them.

This means: **one admin curating one RFP serves N customers across M cycles.**

The RFP Curation Pipeline is the admin-side workflow where solicitations are triaged,
analyzed, marked up, compliance-verified, and staged before any customer ever sees
a purchasable proposal portal. This is NOT autonomous — it is human-gated at every
critical step, with AI assistance that improves over time.

---

## The Flow

```
SAM.gov / SBIR.gov / Grants.gov
  │
  ▼
INGESTION (automated)
  │  Download solicitation metadata + documents
  │  Text extraction from PDFs
  │  Basic classification (SBIR/STTR/BAA/OTA/Challenge)
  │
  ▼
ADMIN TRIAGE QUEUE
  │  Every new solicitation appears here
  │  Admin scans title, agency, program type, deadline
  │  THREE actions:
  │    ✗ DISMISS — not small business, wrong category, irrelevant
  │                (zero tokens spent, teaches the filter)
  │    ⏸ HOLD    — might be relevant, review later
  │    ✓ RELEASE — send to AI for deep analysis
  │
  ▼
AI SHREDDING (triggered by admin release)
  │  AI reads full solicitation text
  │  Atomizes into sections (technical volume, cost volume, etc.)
  │  Pre-extracts compliance requirements:
  │    - Page limits, font, margins, spacing
  │    - Header/footer requirements
  │    - Required sections and content expectations
  │    - Required supporting documents
  │    - Cost rules (TABA allowed? indirect rate caps?)
  │    - PI eligibility (company employee? university? STTR rules?)
  │    - Partner/sub limits (% of work/funding)
  │    - Submission format (text? slides? images/tables allowed?)
  │    - Evaluation criteria and weights
  │  Full text indexed for search
  │  AI checks memory: "Have I seen a similar RFP before?"
  │    → If high similarity (>0.9): pre-fills from prior curation
  │
  ▼
ADMIN CURATION WORKSPACE
  │  Visual RFP reader with annotation tools:
  │    - Highlight text → tag as requirement
  │    - Add text box annotations on any section
  │    - Mark compliance conditions with structured fields
  │    - Verify/correct AI pre-extracted requirements
  │    - Upload example documents (cost templates, forms)
  │    - Flag gotchas ("Section 3.2 says 10 pages but Section 5.1 says 15")
  │  
  │  Structured metadata form:
  │    - Page limits per volume
  │    - Font, margins, spacing
  │    - Required sections checklist
  │    - Required documents checklist  
  │    - Cost rules and constraints
  │    - Eligibility requirements
  │    - Evaluation criteria with weights
  │    - Submission portal and format
  │
  ▼
ADMIN APPROVAL
  │  Admin clicks "Push to Pipeline"
  │  Curated RFP + metadata + annotations + templates packaged
  │  Solicitation becomes visible to customers in Finder
  │  Pre-built outline ready for any customer who purchases
  │
  ▼
CUSTOMER PIPELINE (existing Finder flow)
  │  Customers see scored opportunities
  │  When they purchase a proposal portal:
  │    → Outline pre-populated from admin curation
  │    → Compliance matrix pre-filled
  │    → Required documents checklist ready
  │    → Cost template attached
  │    → Section structure defined with page allocations
```

---

## The Admin Curation Workspace

This is a new portal section — parallel to the customer portal but for platform
admins (you, and future RFP admins you hire).

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  ADMIN NAV: Triage Queue | Curation | Templates | Analytics │
├──────────────────────────────┬──────────────────────────────┤
│                              │                              │
│  RFP DOCUMENT VIEWER         │  STRUCTURED METADATA PANEL   │
│                              │                              │
│  [Full text of solicitation  │  Agency: ___________         │
│   with inline annotation     │  Program: SBIR Phase I  ▼   │
│   tools — highlight, tag,    │  Namespace: USAF:AFWERX:...  │
│   text box, requirement      │                              │
│   marker]                    │  COMPLIANCE:                 │
│                              │  Page limit: [15] per vol    │
│  Section 1.0 Overview        │  Font: [Arial 11pt]          │
│  ████████████████████        │  Margins: [1 inch all]       │
│  ████████████████████        │  Spacing: [single]           │
│  ██ [REQUIREMENT] ██ ←tag    │  Header: [required/optional] │
│  ████████████████████        │  Footer: [page numbers req]  │
│                              │                              │
│  Section 2.0 Technical       │  REQUIRED SECTIONS:          │
│  ████████████████████        │  ☑ Technical Volume          │
│  ████████████████████        │  ☑ Cost Volume               │
│  ████ [GOTCHA: says 10pp     │  ☑ Commercialization Plan    │
│   but Section 5 says 15] ←   │  ☑ Bio Sketches              │
│  ████████████████████        │  ☐ Facilities                │
│                              │                              │
│                              │  REQUIRED DOCUMENTS:         │
│  [Upload example docs]       │  ☑ SF-424 (/template)        │
│  [Attach cost template]      │  ☑ Budget Justification      │
│                              │  ☑ Subcontract Plan          │
│                              │                              │
│                              │  COST RULES:                 │
│                              │  TABA: [allowed/not]         │
│                              │  Indirect rate cap: [none]   │
│                              │  Partner max %: [33%]        │
│                              │                              │
│                              │  PI ELIGIBILITY:             │
│                              │  Must be employee: [yes/no]  │
│                              │  University PI (STTR): [y/n] │
│                              │                              │
│                              │  EVALUATION CRITERIA:        │
│                              │  Technical Merit: [40%]      │
│                              │  Team Qualifications: [25%]  │
│                              │  Commercialization: [20%]    │
│                              │  Cost Realism: [15%]         │
│                              │                              │
│                              │  [Push to Pipeline ▶]        │
│                              │  [Save Draft]                │
│                              │  [Assign to Admin ▼]         │
└──────────────────────────────┴──────────────────────────────┘
```

### Admin Claim/Review Workflow

When multiple admins exist:

```
NEW RFP arrives → appears in Triage Queue (unclaimed)
  │
  ├─ Admin A clicks "Claim" → status: claimed_by: admin_a
  │   Admin A triages (dismiss/hold/release)
  │   If released: Admin A curates in workspace
  │   Admin A clicks "Push to Pipeline" or "Request Review"
  │
  ├─ "Request Review" → appears in another admin's review queue
  │   Admin B reviews curation, approves or sends back with notes
  │
  └─ Unclaimed RFPs older than 48 hours get flagged as urgent
```

States: `new → claimed → released_for_analysis → ai_analyzed → curation_in_progress → review_requested → approved → pushed_to_pipeline`

---

## Solicitation Namespace and Memory

### The Namespace Convention

Every curated solicitation gets a hierarchical namespace:

```
{agency}:{program_office}:{program_type}:{phase}

Examples:
  USAF:AFWERX:SBIR:Phase1
  USAF:AFRL:STTR:Phase2
  ARMY:DEVCOM:SBIR:Phase1
  NAVY:NAVAIR:BAA:Open
  NSF:SBIR:Phase1
  DOE:ARPA-E:FOA:Open
  NASA:SBIR:Phase1
  DHS:SVIP:OTA:Prototype
```

### Cross-Cycle Memory

When an AI shreds a new AFWERX SBIR Phase I solicitation:

1. Query memory: `namespace LIKE 'USAF:AFWERX:SBIR:Phase1%'`
2. Find all prior curated solicitations with this namespace
3. Compute similarity between new RFP text and prior RFP texts
4. If similarity > 0.9:
   - Pre-fill ALL compliance metadata from the most recent prior curation
   - Highlight differences: "Page limit changed from 15 to 20 this cycle"
   - Flag: "This appears to be the same template as Cycle 2025-2 with minor changes"
   - Admin only needs to verify the pre-fill and check the diffs
5. If similarity 0.7-0.9:
   - Pre-fill what matches, flag what's different
   - "Same agency and format but evaluation criteria weights changed"
6. If similarity < 0.7:
   - New template — full curation required
   - Store as new baseline for this namespace

### Memory Entries Created Per Curation

```
Episodic:
  "Curated USAF:AFWERX:SBIR:Phase1 solicitation AF25-AT01.
   15 pages technical, Arial 11pt, 1-inch margins.
   Key gotcha: cost volume has separate page limit of 5.
   TABA allowed. Partner limit 33%."

Semantic:
  "AFWERX SBIR Phase I consistently requires: 15pp technical,
   commercialization plan, letters of support, budget justification.
   Evaluation: 40% technical, 25% team, 20% commercialization, 15% cost.
   Template has been stable for 3 cycles."

Procedural:
  "When curating AFWERX SBIR Phase I: check Section 5.1 for cost
   volume page limit (often different from technical). TABA is
   always allowed. PI must be primary company employee."
```

---

## The 1:N Economics

### One RFP Serves Many Customers

```
Admin curates 1 AFWERX SBIR Phase I solicitation:
  - 15 minutes of admin time
  - Maybe $0.50 in AI tokens for shredding

That curation serves:
  - Customer A purchases proposal portal → pre-built outline ready
  - Customer B purchases proposal portal → same pre-built outline
  - Customer C purchases proposal portal → same pre-built outline
  - ... N customers, all getting the same curated structure

Next cycle (6 months later):
  - Same RFP template comes back, 95% identical
  - AI pre-fills from memory, admin verifies diffs: 5 minutes
  - Serves another N customers

After 3 cycles:
  - AI pre-stages nearly perfectly, admin just confirms: 2 minutes
  - Compliance matrix is battle-tested across dozens of submissions
```

### The Data Flywheel

```
Cycle 1: Admin curates from scratch (15 min)
  → AI learns template structure
  → 5 customers submit using this curation
  → 2 win, 3 lose

Cycle 2: AI pre-fills 90% (admin: 5 min to verify)
  → Curation improved from Cycle 1 feedback
  → 8 customers submit (word of mouth from winners)
  → Win rate data refines scoring model

Cycle 3: AI pre-fills 98% (admin: 2 min to confirm)
  → System knows: "Last cycle, customers who emphasized X won"
  → 12 customers submit with better AI-drafted outlines
  → Platform has institutional knowledge no competitor matches
```

---

## Database Schema Additions

```sql
-- Curated solicitations (admin workspace)
CREATE TABLE curated_solicitations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id      UUID NOT NULL REFERENCES opportunities(id),
    namespace           TEXT NOT NULL,  -- 'USAF:AFWERX:SBIR:Phase1'
    status              TEXT NOT NULL DEFAULT 'new',
      -- new, claimed, released, ai_analyzed, curation_in_progress,
      -- review_requested, approved, pushed_to_pipeline, dismissed
    claimed_by          UUID REFERENCES users(id),
    claimed_at          TIMESTAMPTZ,
    curated_by          UUID REFERENCES users(id),
    approved_by         UUID REFERENCES users(id),
    pushed_at           TIMESTAMPTZ,
    dismissed_reason    TEXT,

    -- AI pre-extraction (populated after release)
    ai_extracted        JSONB,  -- raw AI extraction results
    ai_confidence       FLOAT,  -- how confident AI is in extraction
    ai_similar_to       UUID REFERENCES curated_solicitations(id),
    ai_similarity_score FLOAT,  -- similarity to prior curation

    -- Full text for search
    full_text           TEXT,
    full_text_tsv       TSVECTOR GENERATED ALWAYS AS (
                          to_tsvector('english', COALESCE(full_text, ''))
                        ) STORED,

    -- Admin annotations
    annotations         JSONB DEFAULT '[]',
      -- [{page, x, y, width, height, type: 'highlight'|'textbox'|'requirement',
      --   content, tag, created_by, created_at}]

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Compliance requirements (structured, per solicitation)
CREATE TABLE solicitation_compliance (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitation_id     UUID NOT NULL REFERENCES curated_solicitations(id),

    -- Format requirements
    page_limit_technical    INT,
    page_limit_cost         INT,
    page_limit_other        JSONB,  -- {volume_name: limit}
    font_family             TEXT,
    font_size               TEXT,
    margins                 TEXT,
    line_spacing            TEXT,
    header_required         BOOLEAN DEFAULT FALSE,
    header_format           TEXT,
    footer_required         BOOLEAN DEFAULT FALSE,
    footer_format           TEXT,
    submission_format       TEXT,  -- 'pdf', 'word', 'pptx', 'multiple'
    images_tables_allowed   BOOLEAN DEFAULT TRUE,

    -- Content requirements
    required_sections       JSONB NOT NULL DEFAULT '[]',
      -- [{name, description, page_allocation, is_mandatory, eval_weight}]
    required_documents      JSONB NOT NULL DEFAULT '[]',
      -- [{name, description, template_id, is_mandatory}]
    evaluation_criteria     JSONB NOT NULL DEFAULT '[]',
      -- [{criterion, weight_pct, description}]

    -- Cost/budget rules
    taba_allowed            BOOLEAN,
    indirect_rate_cap       NUMERIC,
    partner_max_pct         NUMERIC,  -- max % of work for sub/partner
    cost_sharing_required   BOOLEAN DEFAULT FALSE,
    cost_volume_format      TEXT,  -- 'spreadsheet', 'narrative', 'both'

    -- Eligibility
    pi_must_be_employee     BOOLEAN,
    pi_university_allowed   BOOLEAN,  -- STTR
    size_standard_naics     TEXT,
    set_aside_type          TEXT,
    clearance_required      TEXT,
    facility_clearance      TEXT,

    -- Dates
    questions_deadline      TIMESTAMPTZ,
    draft_due               TIMESTAMPTZ,
    final_due               TIMESTAMPTZ,

    -- Verification
    verified_by             UUID REFERENCES users(id),
    verified_at             TIMESTAMPTZ,
    verification_notes      TEXT,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supporting document templates (per agency/program)
CREATE TABLE solicitation_templates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitation_id     UUID REFERENCES curated_solicitations(id),
    namespace           TEXT,  -- reusable across solicitations in same namespace
    document_name       TEXT NOT NULL,
    document_type       TEXT NOT NULL,
      -- 'cost_template', 'budget_justification', 'sf424', 'bio_sketch',
      -- 'subcontract_plan', 'facilities', 'letter_of_support', 'other'
    file_path           TEXT NOT NULL,  -- path in local storage
    file_hash           TEXT,
    uploaded_by         UUID REFERENCES users(id),
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pre-built proposal outlines (created during curation, cloned on purchase)
CREATE TABLE solicitation_outlines (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitation_id     UUID NOT NULL REFERENCES curated_solicitations(id),
    outline             JSONB NOT NULL,
      -- [{section_num, title, page_allocation, requirements: [ids],
      --   content_guidance, eval_criteria_refs: [ids]}]
    notes               TEXT,
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_curated_sol_status ON curated_solicitations(status);
CREATE INDEX idx_curated_sol_namespace ON curated_solicitations(namespace);
CREATE INDEX idx_curated_sol_opp ON curated_solicitations(opportunity_id);
CREATE INDEX idx_curated_sol_fts ON curated_solicitations USING GIN (full_text_tsv);
CREATE INDEX idx_compliance_sol ON solicitation_compliance(solicitation_id);
CREATE INDEX idx_templates_sol ON solicitation_templates(solicitation_id);
CREATE INDEX idx_templates_ns ON solicitation_templates(namespace);
CREATE INDEX idx_outlines_sol ON solicitation_outlines(solicitation_id);
```

---

## How This Changes the Customer Purchase Flow

### Before (Old Model)
```
Customer purchases portal → AI generates outline from scratch → customer waits
```

### After (Curated Model)
```
Customer purchases portal →
  System looks up curated_solicitation for this opportunity →
  Clones solicitation_outline into proposal_sections →
  Copies solicitation_compliance into proposal compliance matrix →
  Attaches solicitation_templates as required document checklist →
  Customer sees: fully structured workspace, day one
    - Sections defined with page allocations
    - Compliance matrix pre-filled and admin-verified
    - Required documents listed with templates attached
    - Cost rules clearly stated
    - Evaluation criteria with weights
    - Admin annotations visible as guidance notes
```

The customer's first experience is NOT a blank page. It is a professionally
structured workspace that an expert (you) has already verified.

---

## Admin-Assisted Proposal Drafting

When a customer purchases and you have time, you can also assist their draft:

```
Customer purchases portal for AFWERX SBIR Phase I topic AF25-AT01
  │
  ├─ If customer has library content + uploaded docs:
  │    You (admin) can review their library and pre-match content
  │    to sections, giving the AI better raw material for drafting
  │
  ├─ You review the AI's draft alongside the curated requirements:
  │    "Section 3 needs more emphasis on TRL progression — AFWERX
  │     weighs this heavily per my curation notes"
  │
  └─ Your review feedback becomes agent memory:
       "For AFWERX SBIR Phase I, always emphasize TRL progression
        in technical approach. Admin flagged this as critical."
```

This is the hybrid model: admin expertise + AI capability + customer content.

---

## Financial Data Integration

### QuickBooks / Accounting Upload

Customers need salary, overhead, fringe, and G&A rates for cost volumes.
Rather than manual entry:

```
Customer uploads QuickBooks report (CSV/PDF) →
  Document processor extracts:
    - Employee salary rates
    - Fringe benefit rate
    - Overhead/indirect rate
    - G&A rate
    - Material/travel defaults
  Stored in tenant profile (encrypted) →
  Cost volume agent uses these rates when drafting budget
  
Alternatively: manual entry form in tenant profile settings
  - Direct labor rates per person
  - Fringe %
  - Overhead %
  - G&A %
  - Profit/fee %
  - Travel per diem rates
```

These persist in the tenant profile and auto-populate every cost volume.

---

## How This Integrates With Agent Memory

The Opportunity Analyst agent (Chapter 2) now has a richer role:

```
BEFORE admin curation: AI does basic metadata extraction (title, agency, dates)
AFTER admin release: AI does deep shredding with memory lookup

The AI's shredding gets better because:
1. It remembers every prior curation in this namespace
2. It knows what the admin corrected last time
3. It knows the gotchas the admin flagged
4. It pre-fills more accurately each cycle

The admin's curation gets faster because:
1. AI pre-fills from memory (90%+ after 2 cycles)
2. Diffs from prior cycle are highlighted
3. Only novel requirements need manual review
4. Templates carry forward automatically
```

---

## Impact on Chapter 2 (Archetypes)

The Opportunity Analyst archetype gains a new activation mode:

```
CURRENT: Activates on finder.opportunity.ingested (autonomous)
NEW:     Two-phase activation:
  Phase 1: Basic classification on ingestion (autonomous, cheap)
    - Is this SBIR/STTR/BAA/OTA/Challenge? What agency? What program?
    - Just enough for the admin triage queue
  Phase 2: Deep analysis on admin release (triggered, full analysis)
    - Full RFP shredding with memory lookup
    - Pre-extraction of compliance requirements
    - Similarity matching against prior curated solicitations
```

The Proposal Architect archetype now starts from curated data:

```
CURRENT: Generates outline from scratch using RFP + templates
NEW:     Clones admin-curated outline, customizes per tenant:
  - Section structure already defined by admin
  - Page allocations already set
  - Compliance matrix already verified
  - Architect focuses on: matching tenant's library content to sections,
    customizing guidance notes per tenant's strengths/weaknesses
```

---

## Summary

The RFP Curation Pipeline transforms the system from "AI does everything
autonomously" to "expert human stages everything, AI assists and learns,
customers get professionally curated workspaces." This is better because:

1. **Compliance accuracy**: Human-verified, not AI-guessed
2. **Cost efficiency**: One curation serves N customers × M cycles
3. **AI improvement**: Every curation trains the AI for next cycle
4. **Customer experience**: Pre-built workspace on purchase, not blank page
5. **Scalability**: As you hire admins, they claim and curate independently
6. **Competitive moat**: Institutional knowledge of every RFP template compounds

The architecture supports this naturally through the memory namespace model
(`USAF:AFWERX:SBIR:Phase1`), the event bus (admin actions emit events that
trigger AI learning), and the existing proposal workspace (admin workspace
is the same component with admin permissions).
