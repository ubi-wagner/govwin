# Library, Foundation Artifacts & Collaboration Vaults — Consolidated Design

> ⚠️ **PARTLY AS-BUILT — verified 2026-09-01 against the tree.** `scripts/seed-starter-set.mts`
> and `lib/library/starter-match.ts` do not exist; the starter-library path shipped as
> `scripts/drive-copy-starter.mts` / `drive-library-starter-copy.mts` over `library_atoms` and the
> house `rfp-pipeline` tenant (mig 152). The DESIGN below is current; those two file names are not.

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
land in the **system/house library** and are **offered to every new customer on
onboarding** (copy-on-use, not deep-seeded; idempotent; addable anytime). Because each
carries its section/group/atom decomposition, the **agents** (Librarian, Onboarding
Concierge) have a reference skeleton to match uploads against — "this is a Technical
Approach section; these are past-performance atoms" — on onboarding, bucket setup, and adds.

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
refreshes without duplicating.

Every starter decomposes to the **full `foundation ⊃ section ⊃ group ⊃ atom`
hierarchy** — the section bodies (text_block / bulleted_list / table) are
`library_eligible`, so each lands as a **canvas-ready primitive ATOM** carrying its
own `canvas_node` + the full 6-/7-tag taxonomy (headings stay structural per
`STRUCTURAL_NODES`, never their own atom). A seed of the 18 starters yields **18
foundations · 95 sections · 95 groups · 95 primitives**, and copy-on-use
(`copyFoundationToTenant`) reproduces the whole tree per tenant with `derived_from`
lineage on every grain. Proven: vitest 7/7 (build + native render + STTR⊃SBIR +
eligible-primitive/structural-heading assertion) + real-DB drives — seed
idempotency (cleared 208 → seeded 18), grain distribution 18/95/95/95, vehicle-tag
propagation to primitives (7–14 per vehicle), table-atom payload (headers+rows
preserved), and a copy-on-use proof (1/10/10/10 tree · 31/31 lineage · 10/10 canvas
nodes · min 7 tags/primitive).

**As-built (P5, shipped) — offer + one-click add:** a tenant materializes the catalog
into their own library on demand (copy-on-use), never a deep-seed. `copyStarterSetToTenant`
(`lib/library/foundation.ts`) bulk-copies the whole catalog with `derived_from` lineage,
idempotently (skips any starter whose `doc` slug the tenant already holds). The
`system-templates` route gained a bulk `POST { all: true }` alongside the single
`{ foundationId }` copy (both emit `library:template.added` / `starter_set.added`). The
`/atoms` **StarterCatalog** (P5.1) surfaces the offer front-and-center when the library is
empty ("Add all N") and as a compact add-anytime affordance otherwise. Onboarding wires a
one-time **offer** (P5.3, `offerStarterSet`): both tenant-provisioning paths (application
accept + admin-manual create) emit `library:starter_set.offered` and drop a dismissible
`tenant_admin` acknowledge ToDo linking to `/atoms` (best-effort — never fails onboarding;
idempotent per open offer). Proven on the real DB: bulk copy 3/3 (fresh 18 · idempotent
0-added/18-skipped · partial 3-refill), offer 3/3 (creates the acknowledge ToDo + emits
once · idempotent · surfaces in the tenant_admin queue).

**As-built (P6.2, shipped) — section_drafter grounds on the scaffold:** the
`section_drafter` archetype gained a `search_starter_scaffold` tool (declared first, no
`tenant_id` in its schema — tenant-discretion) that title-matches the section against the
tenant's `grain='section'` starter atoms and returns the reusable skeleton (the section's
constituent primitive guidance atoms, walked section→group→primitive). The system prompt
directs the model to pull the scaffold first, then fill it from the library; the raw RFP
excerpt stays injection-fenced. Proven: pipeline wiring tests (tool declared · no tenant_id ·
scaffold-in-prompt · rfp fence intact) + a real-DB `_match_section_grain` drive 3/3 (title
match returns the skeleton · unknown title empty · other-tenant no-leak). LLM reasoning runs
live on deploy; the sandbox verifies the tool SQL + wiring.

**As-built (P6.3, shipped) — librarian matches uploads to the skeleton:** the `librarian`
archetype gained a `match_section_skeleton` tool (no `tenant_id` in schema) that returns the
tenant's `grain='section'` skeleton — each section title + a guidance preview aggregated from
its primitives — so the model classifies each cataloged upload against the intended sections
and emits a `section_match {section_atom_id, section_title, confidence}` field per assessment.
Untrusted upload text stays fenced; the stale grain docstring was refreshed. Proven: the
librarian wiring test (updated tool set · still no tenant_id · fence) + a real-DB
`_match_section_skeleton` drive 3/3 (skeleton non-empty · guidance preview present ·
other-tenant empty).

**As-built (P6.1, shipped) — mold → starter-template link:** molds live in
`document_templates`, the starter set in `library_atoms`; the link between them is a
resolver, not a duplicated row. `matchStarterFoundation(tenantId, {title, vehicle?})`
(`lib/library/starter-match.ts`) resolves a required-item / section title to the matching
starter FOUNDATION + the specific SECTION grain inside it (walking section→foundation via
`atom_members`), narrowing by `vehicle` when given (a SBIR-Phase-I item links to the
SBIR-Phase-I starter, not STTR). Exposed at `GET …/library/starter-match?title=&vehicle=`
for curation to surface the link; it's the TS counterpart to the section_drafter grounding
match (P6.2). Proven: real-DB drive 3/3 (title→foundation+section · vehicle narrows /
bogus-vehicle null · unknown null + other-tenant null).

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

### 5.6 As-built (P8.1–P8.2, shipped)
**Schema (mig 134):** `collaboration_vaults` (the nook: owner tenant × partner) +
`vault_members` (partner emails granted to a vault; email is the invite-before-signup key) +
`library_atoms.vault_id` (vault content is `visibility='vault'` + `vault_id` set). Both new
tables are RLS FORCE'd with owner-tenant isolation (the NOBYPASSRLS backstop).

**Isolation contract (`lib/vaults/vaults.ts`, live enforcement):** `resolveVaultAccess`
returns a caller's *side* + *rights* or null — **tenant side** (platform admin, or an active
tenant_admin membership at the owner tenant): copy-in upload · atomize · download ANY grain ·
ingest · manage; **collaborator side** (an active `vault_members` grant by user id or email):
upload · atomize · download WHOLE only. Everyone else: no access. Vault atoms are excluded
from every non-vault read — the main library (`listAtomsFaceted`/`getAtom` gain `vault_id IS
NULL`, so even an admin browsing `/atoms` never sees vault content) and the tenant agents
(`section_drafter`/`librarian` search tools gain `vault_id IS NULL`, so agents never cross the
boundary). Proven: the adversarial isolation drive **7/7** — owner tenant_admin→full rights ·
collaborator→whole-only · cross-vault→null · non-member→null · other-company admin→null ·
platform-admin(shadow)→tenant · each collaborator sees only their own vault.

**As-built (P8.3–P8.6, shipped) — operable backend:** CRUD + membership routes
(`vaults` create/list, `vaults/[id]/members` invite/list — tenant_admin gated) and the
content ops over the rights matrix, all **gated by `resolveVaultAccess` (not
`verifyTenantAccess`)** so an invited collaborator who is not a member of the owner tenant
reaches ONLY their nook: `vaults/[id]/atoms` list/add (upload right, both sides →
`createVaultArtifact` decomposes + tags every grain vault), `…/atoms/[atomId]/download`
(native-format, whole-only gate — collaborator=foundation only, tenant=any grain), and
`…/atoms/[atomId]/ingest` (tenant-side → `ingestVaultFoundation` copies the tree into the
MAIN library, vault_id NULL). Proven: content drive **5/5** (grains tagged vault · invisible
to the main library even for an admin viewer · listed to both sides · whole-only vs any-grain ·
ingest→main library). **Remaining (not built):** the two-sided nook UI (P8.9), the
collaborator-content HITL ToDo (P8.7), and the instruction-based-sharing copy (P8.8).

### 5.7 As-built (pre-alpha adversarial sweep, shipped) — the isolation contract, hardened
A five-lens adversarial sweep (vault-security · API/auth · DB/SQL · agents/automation · UI)
proved the **collaborator-confinement half solid** (cross-vault, grain-extraction,
ingest/manage, cross-tenant admin, foreign-id ingest all blocked) and found the real gap in
the **tenant→vault direction**: the `vault_id IS NULL` fence had reached only 2 of ~20
`library_atoms` readers, so partner content leaked into the main library, live AI drafting,
and — highest impact — **every agent's prompt** via the pipeline `ContextAssembler`. The fix
fenced **every** main-library reader (frontend `selectForSection`/`listAtoms`/`library.search_atoms`/
download/redecompose/starter-match/copy-present-check/uploads/bulk/dashboard; pipeline
`_load_library_atoms`, `_library_search`/`_library_get_unit`, the two multi-hop tool leaf-joins,
and every archetype content/count reader) so **vault content is invisible to the main library
AND the agents**. `createVaultArtifact` now decomposes **born vault-scoped** (`createAtom`
gained `vault_id`; `decomposeAndIngest` threads it) — atomic, no window, nothing stranded on
a mid-op failure. The message-side injection fences now neutralize forged END markers (mirrors
`ContextAssembler._wrap`). Proven by a new adversarial **vault-leak drive**: seed a vault atom →
**0 leaks** across every reader under the admin + owner viewer branches that originally defeated
the visibility predicate, grains born vault-scoped 19/19. Robustness: vault-upload 2 MB cap,
UUID/NaN/email-length guards, and a partial unique index (mig 135) backstopping the starter-offer
TOCTOU. Full backbone green: tsc 0 · vitest 729→**829** · pipeline **209** · `next build` · all vault
+ starter + P6 drives.

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

---

## 9. As-built — the two-sided nook UI (P8.9 · P8.7 · P8.8)

The isolation contract, rights matrix, and content ops (§5–7) are now fronted by a
**two-sided surface**, both gated exclusively by `resolveVaultAccess` (never
`verifyTenantAccess`), so the API can never offer an action the server would refuse.

**Tenant side** (in the portal, `tenant_admin`):
- `/portal/[slug]/vaults` — the nooks index (`NooksIndex`): list + create-a-nook modal.
- `/portal/[slug]/vaults/[vaultId]` — the nook detail (`NookDetail`, `side='tenant'`,
  `TENANT_RIGHTS`): invite/revoke members, add artifact, any-grain download, **Harvest →
  library**.
- A **Vaults** nav link sits beside Library (tenant_admin-gated).

**Collaborator side** (dedicated top-level surface — a vault-only partner holds NO tenant
membership, so the portal layout would bounce them):
- `app/vaults/layout.tsx` — a thin auth-only shell (brand + sign out), no tenant nav.
- `/vaults` — `listVaultsForCollaborator` (their own nook(s) only, joined to the owner org
  name/slug). No create action — a collaborator only ever joins.
- `/vaults/[vaultId]` — the **same** `NookDetail` with `COLLAB_RIGHTS` (upload · atomize ·
  download-WHOLE-only), addressing the shared tenant-namespaced vault API via the owner slug
  (`getVaultOwnerContext`). The members panel and Harvest control are absent (no rights);
  the whole-only note rides at the foot of the list.
- The **portal dispatcher** routes a vault-only collaborator to `/vaults` at sign-in
  instead of the dead-end "no workspace" message (the redirect stays outside the try so its
  `NEXT_REDIRECT` is never swallowed).

**P8.7 collaborator-content HITL** (`notifyCollaboratorUpload`) — a COLLABORATOR upload emits
`library:vault.artifact_uploaded` for every upload and raises **one** standing `tenant_admin`
`vault_artifact_review` ToDo per nook (idempotent — a pre-check skips a second open ToDo; a
tenant-admin copy-in is self-initiated, so no ToDo). Best-effort: a notification failure
never fails the upload (the content is already safely vault-scoped).

**P8.8 instruction-based sharing** — the share-by-instruction copy rides on each upload
control per side (tenant: "copying a COPY … only add content you're comfortable with the
partner using"; collaborator: "only upload content you're comfortable with the customer
using"). Partial-share + signed exchanges remain deferred (§7).

**Verified:** `tsc` 0 · `vitest` 829 · `next build` (all four routes) ·
`drive-vault-collab-surface` 5/5 (email-match list + owner ctx · null-email isolation guard ·
collaborator side+rights · HITL 1-ToDo+2-events idempotent) · no regression in
`drive-vault-{isolation 7/7, content 5/5, leak 0-leak}` · both sides captured in-browser
(`scripts/capture-vaults.mjs`; seed `scripts/seed-vault-demo.mts`) into the Customer-Admin
(§13) and Collaborator (§8) manuals.
