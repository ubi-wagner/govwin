# Monday Runbook — Immobileyes → Navy STTR, end to end

**Goal:** ingest a new RFP, build its matrix, load Immobileyes' prior proposals into
the library as reusable atoms, spotlight-rank the opp, then have the Immobileyes
admin pick the Navy opp, spin up a portal, and generate the package — all through
the screen, tenant-isolated and role-gated.

**Proven:** the whole loop runs green against the live schema via
`frontend/scripts/monday-journey-e2e.mts` (ingest → matrix → atomize → spotlight →
provision → draft-from-atoms → lock → harvest-with-lineage → export; tenant-isolated).
Run it any time as a smoke test:

```bash
cd frontend && DATABASE_URL=… PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
  node --import tsx scripts/monday-journey-e2e.mts
```

Personas: **RFP Admin** (`rfp_admin`) does ingest + curation; **Immobileyes Admin**
(`tenant_admin`) does the library + portal build. RFP Admin can act inside any
tenant via the shadow/god-view.

---

## Step 1 — RFP Admin: ingest the RFP + build the matrix

1. **Ingest the opportunity.** Go to **`/admin/rfp-curation/upload`** (upload the RFP
   PDF → creates the `opportunity` + `curated_solicitation` + extracts text/topics),
   or **`/admin/intake`** for a no-file notice. New or attach-to-existing both work.
2. **Curate the compliance matrix + skeleton.** Open the solicitation in
   **`/admin/rfp-curation`** → the curation workspace:
   - **Compliance Matrix** sidebar — set/confirm the required elements.
   - **Volumes panel** — *Add volume* (e.g. Technical Volume, Cost, Supporting), then
     *Add required item* under each (the section molds). Optionally set page/slide
     limits + fonts per item.
   - Each required item can point at a **template** (`template_id`) — see Step 5.
   > The per-proposal `proposal_compliance_matrix` is **materialized automatically**
   > when the portal is provisioned (Step 4) from this skeleton — you author the
   > skeleton, not the per-proposal rows.

## Step 2 — Load Immobileyes' prior proposals into the library

Do this inside Immobileyes' portal (RFP Admin can via shadow, or the Immobileyes
admin does it):

1. Go to **`/portal/immobileyes/atoms`** → **"Upload package"** tab.
2. **Drag in the prior proposal set** (docx/pdf/pptx/txt — up to 12 files).
3. Fill the optional **package context** (the "FROM" pedigree): agency, program
   (SBIR/STTR/BAA/OTA/CSO/RIF), phase, solicitation, topic. This stamps every atom
   so reuse ranks by *where it came from*.
4. Click **Atomize package.** Each file becomes a **foundational document** (a
   `document_cocoon` + a `reference` atom) and every section becomes a tagged,
   reusable **primitive** atom (content-class `kind`/`vol`/`fmt` + your context).
5. Switch to the **Library** tab to browse them — filter by any tag (click a chip),
   by status, or grain; the detail drawer shows lineage + a content preview.

> This is the value prop: a completed proposal, uploaded once, becomes the atoms
> that assemble the next one. Repeat for as many prior packages as you have.

## Step 3 — Spotlight: rank the opp for the tenant

When the opportunity is activated/pushed, it fans onto the tenant as an
**opportunity card** (`tenant_opportunity_cards`) and is **auto-scored into spotlight
buckets** (`tenant_spotlight_buckets` / `tenant_bucket_scores`). The Immobileyes admin
sees ranked cards at **`/portal/immobileyes/cards`**. (Ingesting a dozen open opps and
letting it run is the way to sanity-check bucketing against a real spread.)

## Step 4 — Immobileyes Admin: select the Navy opp → create the portal

1. At **`/portal/immobileyes/cards`**, open the Navy opp card → **purchase with the
   comp code** (`rfppipelinetest`). This creates a `proposal_portal` in
   `curation_pending` (72h SLA) and parks an RFP-admin "Curate + release" task.
2. **RFP Admin releases it:** in **`/portal/immobileyes/portals`**, click **"Release
   to customer"** (rfp_admin only). Release **provisions the build UNLOCKED** — the
   proposal, its artifacts (volumes), section molds, and the compliance matrix are
   instantiated from the Step-1 skeleton.
   > Friction note: the Release button lives in the tenant portal page; navigate to
   > the Immobileyes portal URL to click it (no deep-link from `/admin` yet).
   > Faster demo path: **"Open portal"** on that page provisions directly from an
   > opportunity id (paste the opp UUID).

## Step 5 — Generate the package through the pipeline

Open **`/portal/immobileyes/proposals/{id}`** (the build workspace). As `tenant_admin`:

1. **Draft.** "Draft All Sections" grounds each mold on the **best-matching library
   atoms** (scored by vol/kind + your Step-2 context) — so the Immobileyes prior work
   flows straight into the new proposal. Or edit any canvas by hand in the section
   editor (WYSIWYG), insert atoms, and AI-revise per block.
2. **Revise + Save.** Edit on the canvas; **Save** (optimistic-locked; versions are
   archived to `canvas_versions`).
3. **Lock.** *Accept & Lock* a section, *Lock All*, or **Lock Volume** (hierarchical
   push: section → artifact → volume → proposal). Every lock advances the compliance
   matrix to **satisfied** and **harvests the section back into the library** as a new
   derivative atom with lineage to the atoms it was built from (non-destructive: the
   sources are usage-marked, never mutated).
4. **Advance** the stage when sections are locked (Force-advance available to admins).
5. **Download.** Per volume, once locked: **Download** (native docx/pptx/xlsx) + **PDF**;
   whole proposal as **.docx** (one combined doc) or **Download all (.zip)** — every
   volume in its native format bundled together (the lossless "download my proposal").

Result: the finished package, assembled from Immobileyes' own atoms, exportable in
every format — and its sections are now back in the library for the *next* pursuit.

---

## Capabilities & where they live (quick reference)

| Capability | Where (UI) | API / lib |
|---|---|---|
| Ingest RFP / opportunity | `/admin/rfp-curation/upload`, `/admin/intake` | `api/admin/rfp-upload`, `lib/intake.ts` |
| Curate matrix + volumes + molds | `/admin/rfp-curation` (curation workspace) | `volume.*` / `compliance.*` tools |
| **Author templates (skeleton builder)** | `/admin/templates` → **New Template** → WYSIWYG canvas editor; Edit/Delete | `api/admin/templates` (create/PATCH/DELETE) |
| **Upload + atomize a package** | `/portal/[t]/atoms` → **Upload package** | `atoms/atomize-package` → `lib/atomize-package.ts` |
| **Browse + curate the library** | `/portal/[t]/atoms` → **Library** | `atoms` (list), `atoms/[id]` (detail/status) |
| Refine / hand-shred one doc | `/portal/[t]/atoms` → **Atomize** | `atoms/upload`, `atoms` (create) |
| Spotlight cards + buckets | `/portal/[t]/cards` | `tenant_opportunity_cards` / buckets |
| Buy / create portal | `/portal/[t]/cards` (comp code), `/portal/[t]/portals` | `portal/[t]/purchase`, `portals/[portalId]` |
| Build: draft / save / lock / advance / download | `/portal/[t]/proposals/[id]` | `sections/*`, `lock-scope`, `advance`, `artifacts/[id]/export` |
| **Edit: insert + format toolbar** (all doc types) | canvas editor top bar (`CanvasToolbar`) | per-node handlers; per-section export docx/pptx/xlsx/**pdf** |
| **Per-volume page-budget gauge** (pages/slides/tabs) | proposal workspace Artifacts tab (`VolumeLayoutGauge`) | `artifacts/[id]/layout` → `paginate()` |
| **Save volume as template** (extract skeleton) | Artifacts tab → **Save as template** (`SaveAsTemplate`) | `templates/extract` → `lib/templates/extract-skeleton` |

## Guardrails baked in

- **Tenant segmentation at every level.** Every library/portal write goes through
  `verifyTenantAccess` + RLS (`withTenant` sets `app.tenant_id`); the E2E asserts a
  second tenant sees zero atoms. Verified.
- **Role-gated UI.** rfp_admin/master_admin: ingest + curation + release. tenant_admin:
  library + full portal build. Reads open to collaborators; partner_user is scoped.
- **Same spine, any document size.** A one-page flier and a full multi-volume proposal
  run the identical atom → mold → draft → lock → harvest loop (see
  `docs/PORTAL_PRIMITIVES_REPLICATION.md`).

## Known friction (workarounds noted; on the polish list)

1. **Release reachability** — click Release from the tenant's `/portal/[t]/portals`
   page (navigate to the tenant URL); there's no `/admin` deep-link yet.
2. **"Open portal" opportunity id** — the direct-create path wants a raw opportunity
   UUID; the comp-code card path is the friendly one.
3. **tenant_user build access** — only `tenant_admin` (or an explicitly-granted
   collaborator) can draft/lock; log in as the Immobileyes admin.
4. **Whole-proposal export is .docx** — use per-artifact export for pptx/xlsx/pdf.
5. **Manual atom picker** — drafting auto-selects the best atoms today; a hand-pick
   picker for a section is on the list (P2).
