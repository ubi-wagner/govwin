# Library, Foundation Artifacts & Collaboration Vaults — Consolidated Design

Canonical design for (a) the in-library **Create Canvas** tool, (b) the **foundation
artifact** containment model, (c) the **type × form × context** taxonomy + starter
seeding, and (d) **collaboration vaults ("nooks")** — the segregated external-partner
bridge. Launch scope is called out per section; everything else is *architected-for,
not built*. Build tasks: #231–242 (grain model #238).

---

## 1. The containment model — a canvas is a FOUNDATION ARTIFACT, not an atom

A created canvas is a **foundation artifact**: a *container* + *scaffold* + the
*exportable file* + the *taxonomy carrier*. It is **not** itself "an atom." It
**contains** the real atoms, at three nested grains:

```
FOUNDATION ARTIFACT        the canvas (doc / ppt / pdf / sheet) — container + export + taxonomy
│                          ↔ CanvasDocument
├─ SECTION   (real atom)   e.g. "Technical Approach"            ↔ CanvasSection
│  ├─ GROUP  (real atom)   a table+caption, a capability cluster ↔ group-in-section
│  │  ├─ ATOM (real atom)  paragraph / heading / table / figure  ↔ CanvasNode
```

- **Foundation artifact** — the whole document/template. Seeded, exported, tagged.
- **Section / group / atom** — *"the real atoms."* Each is independently reusable,
  taggable, versioned, lineage-tracked (`derived_from` per grain), and
  **agent-identifiable**.

**Schema:** extend `library_atoms.grain` CHECK from `{primitive, group, reference}`
to `{foundation, section, group, primitive, reference}`. **Create Canvas
auto-decomposes on save** — writes the foundation atom (canvas_nodes = the whole
CanvasDocument's flat nodes) + section/group/atom member atoms via `atom_members`,
with `derived_from` lineage when built from a template. (Refine the already-shipped
`house-docs` / `house-artifacts` from their flat 2-level shape to this 4-level model.)

---

## 2. The tool — "Create Canvas" as a first-class library action

In the library (`/atoms` tenant + `/admin` library), a **Create Canvas** action:
pick **form** (doc / ppt / pdf / sheet), pick **kind** (template | document) +
**context**, name it → mints a **foundation artifact**, opens the canvas editor, and
on save decomposes into section/group/atom real atoms. `renderCanvas(format, doc)`
exports the real `.docx / .pptx / .xlsx / .pdf` (already built + proven). Reuses the
existing `new-document-chooser` presets + Template Studio editor.

**As-built (P2.1, shipped):** the in-library **Create Canvas** action now lives on
`/atoms` — a `CreateCanvasButton` modal (name · form doc/ppt/sheet/pdf · kind · context)
→ `POST …/library/canvas` mints the foundation and decomposes it into the section/group
scaffold with the full `kind×form×format×context` taxonomy (proven 16/16 on the real DB:
each form persists `grain=foundation` + correct tags + a members-wired section scaffold;
blank canvases carry 0 primitive atoms until content is added). **Next (P2.2):** open the
new foundation in the canvas editor (load/save the foundation's `canvas_nodes` with
decompose-on-save). The format-aware exporters + Template Studio editor already exist and
are reused.

---

## 3. Taxonomy — sortable `kind × form × context`

Every library item sorts on three axes (via `atom_tags`; add a `context` dimension):

| Axis | Values |
|------|--------|
| **kind**    | template · document |
| **form**    | doc · ppt · pdf · sheet |
| **context** | proposal · marketing · commercialization · email · capability · past-performance · … |

So `templates › doc › email`, `templates › ppt › commercialization`,
`templates › doc › marketing` are real filter paths. One foundation artifact per
`kind×form×context` doubles as a **test fixture** — exercising create → decompose →
atomize → reuse → export end-to-end (same discipline as the manuals).

---

## 4. Starter seed + agents

I (dogfooding) author a starter set via the tool — **generic** foundation artifacts
(capability statement/doc, one-pager/doc, pitch deck/ppt, budget/sheet, email
templates/doc, marketing/pdf) + **common proposal** foundation artifacts (SBIR/STTR
technical volume/doc, cost volume/sheet, commercialization deck/ppt, SOW/doc). They
land in the **system/house library** and **seed every new customer library on
onboarding** (idempotent; addable anytime). Because each carries its
section/group/atom decomposition, the **agents** (Librarian, Onboarding Concierge)
have a reference skeleton to match uploads against — "this is a Technical Approach
section; these are past-performance atoms" — on onboarding, bucket setup, and adds.

**As-built (P4, shipped):** the starter set is authored as pure data in
`lib/library/starter-set.ts` (`STARTER_SET`, each a taxonomy + a `build() →
CanvasDocument`): 5 **generics** (capability-statement · one-pager · memo /doc,
pitch-deck /ppt, budget-workbook /sheet) + 13 **DoD/DoW proposal** foundations —
**DoW CSO** (solution brief + pricing), **SBIR Phase I/II**, **STTR Phase I/II**
(SBIR scaffold + the RI-partnership / allocation-of-work / IP sections), and
**Direct-to-Phase-II** (feasibility-first) — each a Technical-Volume /doc + a
Cost-Volume /sheet, plus one shared Commercialization Deck /ppt. Every proposal
foundation carries a `vehicle` tag (propagated to all grains, so the faceted
library filters by vehicle). `scripts/seed-starter-set.mts` (→ `seedStarterSet`)
idempotently seeds them into the house library under `system_starter`; re-running
refreshes without duplicating. Proven: vitest 6/6 (build + native render + STTR⊃SBIR)
+ real-DB drives (generics 5/5, vehicles 13/13 with vehicle-tag propagation, seed
idempotency 5/5).

---

## 5. Collaboration vaults ("nooks") — the segregated external bridge

A **nook** is a **customer-owned, fully-RLS-segregated *branch* library**, one per
(customer × external partner) relationship — the clearing house both sides reach.
Treated like **the collaborator's own tenant-specific RLS slice**: a collaborator sees
*only* their nook, never the customer's main library or any other nook.

### 5.1 Who can access (launch)
- **Tenant side:** ONLY **tenant_admin, including shadow** (rfp_admin descended into
  the tenant). Not tenant_users.
- **Collaborator side:** ALL **assigned collaborator email accounts** (the partner's
  people from their company/university). Granted like adding a proposal collaborator
  (invite by email → `partner_user` scoped to the nook, via `user_memberships`).

### 5.2 Rights matrix (launch)

| Action | Collaborator (assigned emails) | Tenant admin / shadow |
|--------|:------------------------------:|:---------------------:|
| Upload artifact | ✅ their content | ✅ **copy-in, NOT transfer** (incl. future signature docs: NDA, subK) |
| Atomize artifact (structure into section/group/atom) | ✅ | ✅ |
| Download **full artifact** | ✅ | ✅ |
| Download **section / group / atom** (any grain) | ❌ whole only | ✅ any grain |
| Ingest into the **proposal-portal libraries** | ❌ | ✅ |

**Two invariants that make separation ultra-clean:**
1. **Upload, never transfer** — the tenant admin uploads a *copy* into the nook; nothing
   is linked/moved from the main library, so the customer's broader library can never
   leak into the nook by reference.
2. **Collaborators extract whole-only** — a collaborator can upload + atomize (structure)
   + download whole artifacts, but can **never** pull individual grains out. The
   *customer* is the only one who harvests grains — from the collaborator's uploads —
   into the proposal.

### 5.3 Flow
1. Tenant admin (or shadow) creates a nook for a partner and invites the partner's emails.
2. Collaborator **uploads + atomizes** their content (bios, facilities, past performance).
3. Tenant admin **downloads the grains** they want (a bio atom, a facilities section) and
   **ingests** them into the proposal-portal library.
4. Tenant admin **uploads copies** into the nook for the partner (a copy of the final
   proposal; future NDA/subK for signature); the collaborator **downloads them whole**.
5. Content movement is **human-managed**; automation + agents **assist** (match, tag,
   suggest) but never auto-cross the boundary.

### 5.4 Why architect it now
The nook is the one **external-interaction boundary**, so it's the right security
surface to lock down now (RLS-segregated branch, `visibility='vault'`), even though the
rich features come later. It is the durable home for **executed agreements** (teaming,
NDA, subK — as signable *docs*), **document review/execution workflows**, and the future
**contract-management** extension. Grain-level partial sharing ("share a section, not the
publication") is the natural payoff of the foundation model — a visibility decision at the
grain, not a rebuild.

### 5.5 The nook is the home for the V1 collaborator-content HITL
The proposal workflow already *designs* a HITL step where collaborators supply
bios/facilities — never actually built. The nook **is** where that lands: the ToDo to the
partner, content in the nook, the customer reviewing + harvesting into the proposal. Same
exact shape as the future review/execution workflows.

---

## 6. Per-role ToDos (consolidated)

| Role | Library / foundation | Nook / vault |
|------|----------------------|--------------|
| **master_admin** | Own + publish the system starter set; own the taxonomy. | Platform oversight of the nook boundary. |
| **rfp_admin** | Curate the shared template library; author common proposal foundations; seed/refresh tenant libraries. | Shadow setup/support of nooks; *(future)* mediate agreements. |
| **tenant_admin** (+ shadow) | Get a pre-seeded library; create own foundations; organize by context. | Create a nook; invite partner emails; upload copies (proposal, agreements); download any grain; ingest into the proposal library. |
| **tenant_user** | Draft from a foundation; add reusable content. | — |
| **partner_user** (collaborator) | — | Access only their nook; upload + atomize + download whole artifacts (their only rights). |
| **agents** | Match uploads to the foundation scaffold; identify sections/groups/atoms. | *(future)* organize nook content + match to proposal needs. |

---

## 7. Launch scope vs. future

**Launch (built, architected):** the containment/grain model; in-library Create Canvas
(doc/ppt/pdf/sheet) with decompose-on-save; the taxonomy + sortable library + downloads;
the dogfooded starter set; onboarding seeding; the nook as an RLS-segregated branch with
the rights matrix above + the collaborator-content HITL; **instruction-based sharing**
("only upload content you are comfortable with the submitting partner using for their
proposals").

**Deferred (architected-for, not built):** grain-level partial sharing; document
review/execution workflows; executed/signed agreements (e-signature); the
contract-management extension.

---

## 8. Build sequence

Library-first, vault-second — the foundation model makes the future partial-sharing free:

1. Grain model `foundation ⊃ section ⊃ group ⊃ atom` + decompose-on-save (#238, #231).
2. In-library **Create Canvas** (#232) + sortable library + downloads (#233).
3. Dogfood the **starter set** (#234) → **seed on onboarding** (#235) → **agent hookup** (#236).
4. **Nooks**: segregated branch + rights matrix (#239) + access grant (#240) +
   collaborator-content HITL (#241); instruction-based sharing for launch (#242).
5. Per-role ToDos wired into the automation/ToDo system (#237).
