# Template Stable + Template Bridge — analysis & design

**The ask:** build a *stable* of pristine templates (DoD/NSF/DoE proposals · marketing brochures · tech
overviews · company/capability decks · investor decks), **copy 100% into every tenant on creation**, surface
them in the customer portal **as cards over a bridge** (like OPP cards), let an admin **push new ones** and
**version-up/​update** old ones, and keep them **skeleton-only** — once instantiated, the new doc is the
artifact and the template was never used for anything but a skeleton. This doc is the analysis + design;
**no code moves until sign-off.** Grounded in a two-agent source sweep (OPP bridge + template/copy model).

---

## 1. The problem — today there are THREE overlapping template systems, and two of them are a shared dependency

| # | System | Where | Copy or shared? | Versioned? |
|---|---|---|---|---|
| A | **Code constants** — 18 `CanvasDocument`s (`DOD_SBIR_PHASE1_TECHNICAL`…) | `lib/templates/*`, `getTemplate`/`TEMPLATE_CATALOG` | **shared via code** — read live at the provisioning *fallback* (`provision-proposal.ts:189`) | no |
| B | **`document_templates`** rows | mig 017/086; 9 rows, all `is_system=true, tenant_id=NULL` | **shared global** — read **live cross-tenant** by the chooser (`portal/templates/route.ts:75`) + provisioning (`volume_required_items.template_id`) | **no** (only `updated_at`; "save as new" forks a copy) |
| C | **Starter *library*** — `starter-set.ts` → `library_atoms` `system_starter` (303 atoms in the `rfp-pipeline` platform tenant) | mig 152 | **COPIED per-tenant** on creation (`copyStarterSetToTenant`, `foundation.ts:307`) **and** copy-on-download (`/library/system-templates`) | n/a |

Only **C** follows the model you want (copy-into-each-tenant, isolated, proven by `verify-keep-copy.mts` +
`docs/COPY_INWARD_GUARDRAIL.md`). **A and B are the deprecation risk you named**, precisely:

- **B is the primary risk.** `is_system=true` templates (`tenant_id=NULL`) are read **live** at the template
  chooser and at **every proposal provision** (`proposals/create/route.ts:430`, `provision-proposal.ts:189`,
  via `volume_required_items.template_id`). Instances already created are safe copies — but the **catalog and
  all future creates are live-coupled to the shared rows.** Rename/drop/deprecate one → every tenant's chooser
  and every future provision changes under them.
- **A** — change a code constant → all future provisions across all tenants change.
- The **starter "download"** path (`/library/system-templates`) copies at download time but reads the
  `rfp-pipeline` masters **live**; drop them → `CATALOG_EMPTY`.

And the three overlap on the same content (e.g. "Capability Statement" exists as a starter-set def *and* a
mig-150 system `document_template`; "SBIR P1 Technical" as a code const *and* a starter def). **No template
bridge and no template versioning exist today** — this is greenfield.

## 2. The target — one owned store, fed by a forward-only bridge, skeleton-only

Collapse the three systems into **one canonical template store that every tenant OWNS a copy of**, fed by a
**template bridge that mirrors the OPP-card bridge 1:1**. The instance-is-the-artifact rule then falls out for
free, because a tenant's template is a *copied snapshot with no FK back to the master* — exactly like a
`tenant_opportunity_card`.

```
  master template (admin-authored, pristine, {anchor}-only)
        │  admin "push"  (publishAndFanOut)
        ▼
  template_bridge  (L0 · global · append-only · UNIQUE(template_id, version) · GRANT SELECT/INSERT only)
        │  fanOut → active/trial tenants ;  backfill → NEW tenant on creation ;  reconcile → read-repair
        ▼
  tenant_template_cards  (L1 · per-tenant · RLS-forced · denormalized snapshot · bridge_version · NO FK back)
        │  "New doc from this"  (instantiate = COPY)
        ▼
  tenant_documents / proposal_sections   ← THE ARTIFACT (independent copy; template never touched again)
```

## 3. The design — mirror the OPP-bridge quintet

The OPP bridge (`lib/opportunity-bridge.ts`, mig 094) is the proven blueprint; the template bridge copies its
exact shape.

**Schema (new migration):**
- **`template_bridge`** (L0) — `id`, `template_id` (FK master), `version` INT (monotonic per template),
  `event_type` CHECK `('published','updated','deprecated','republished')`, `template` JSONB (the full
  pristine snapshot = the copied payload), `posted_by`, `posted_at`, `UNIQUE(template_id, version)`.
  `GRANT SELECT, INSERT … TO govtech_app` only (forward-only at the storage layer).
- **`tenant_template_cards`** (L1) — `id`, `tenant_id` (FK), `template_id` (**soft ref, NO FK** — shard-safe),
  `template` JSONB (copied snapshot), `bridge_version` INT, `category`/`agency`/`format`/`title` (denormalized
  for the card grid), `update_available` BOOL, `updated_at`, `UNIQUE(tenant_id, template_id)`. **RLS
  ENABLE+FORCE** on `app.tenant_id`.
- **`tenant_template_cursor`** — per-tenant forward progress (not RLS'd; cross-tenant consumer). *(Optional —
  `reconcile` can run cursor-free like the OPP one does in practice.)*

**`lib/template-bridge.ts`** — the quintet mirroring `opportunity-bridge.ts`:
1. `buildTemplateSnapshot(templateId)` — the pristine template body + its catalog metadata → the `template`
   JSONB (the "what gets copied" definition).
2. `publishTemplate(templateId, eventType)` — race-safe monotonic version (`ON CONFLICT (template_id,
   version) DO NOTHING` retry), inserts the snapshot.
3. `applyTemplateToTenant(tenantId, ev)` — upsert into `tenant_template_cards` under `withTenant()`, with the
   **forward-only guard** `WHERE EXCLUDED.bridge_version > tenant_template_cards.bridge_version`; sets
   `update_available` when a tenant's existing card is superseded; emits `library:template.applied`.
4. `fanOutTemplate(ev)` — `SELECT id FROM tenants WHERE status IN ('active','trial')` → apply per tenant
   (per-tenant failure never fails the batch).
5. `backfillTenantTemplates(tenantId)` + `reconcileTenantTemplates(tenantId)` — head-version of every template
   on tenant creation; read-repair on every `/templates` GET.

**Admin push** — a `template.push` tool/route (mirror `solicitation.push`) → `publishAndFanOut`; version-up
is the same call with `event_type='updated'` → new bridge version → forward-only re-apply → `update_available`
on each tenant card. Namespace: `finder:template.published` (admin) + `library:template.applied` (per tenant).

**Copy-on-create (your "100%")** — wire `backfillTenantTemplates` into the **same four provisioning sites**
that already call `backfillTenant` + `copyStarterSetToTenant`: `admin/tenants/route.ts`,
`applications/[id]/accept/route.ts`, `partner/create-partner-org.ts`, `partner/own-org.ts`. One new call each.

**Portal surface — mirror the LIBRARY meta pattern + preview (per sign-off).** `/portal/[tenantSlug]/templates`
page + `TemplateCards` component styled like the **library** (rich meta cards — category · agency · format ·
anchor count — grouped DoD/NSF/DoE · Marketing · Tech · Company · Investor, searchable), each with a
**read-only canvas preview** (reuse `CanvasRenderer readOnly` / the fluid view) so you see the skeleton before
committing. RLS read route over `tenant_template_cards`. Card actions: **"New doc from this →"** (instantiate
= copy-create-add to the working workspace, §4) + an **"Update available · Resync"** banner (mirror the
pinned-card `pin_update_available`→resync loop). This becomes the single "start from a template" surface (§6).

## 4. Instance-is-the-artifact + version semantics (the cleanest part)

Your rule — *"once instantiated, that's the artifact and the template was skeleton-only"* — is satisfied by
construction and is **cleaner than the OPP amendment engine**:

- **Instantiate = COPY.** "New doc from this" reads the tenant's `tenant_template_cards.template` snapshot →
  `interpolateTemplate` (fill `{company_name}` etc., leave customer anchors) → INSERT a **new**
  `tenant_documents` / `proposal_sections` row (a full independent copy). This is exactly what
  `documents/route.ts` + `provision-proposal.ts` already do. The template card is **read-only** and is never
  edited or consumed for anything but a skeleton.
- **Version-up touches ONLY the skeleton, never instances.** A new master version fans out a new
  `tenant_template_cards` snapshot + raises `update_available`. Already-instantiated docs are untouched copies
  — the customer chose them; you don't rewrite their artifacts. The banner just lets them start *new* docs
  from the fresher skeleton (or ignore it). This is why templates ride mechanism (a) of the OPP bridge (bridge
  re-version + forward-only re-apply + `update_available`/resync), **not** the amendment→proposal fan-out.

**Atomize-on-download into the library (per sign-off) — the template's bones become owned reuse.** When a
tenant instantiates a template ("download" = copy-create-add), fire the **same atomize path proposal artifacts
use** (`createAtom`/`decomposeAndIngest`, best-effort, gated) on the *interpolated* copy → the template's frame
+ section-skeleton + slot placeholders land as **structural atoms** in the tenant's library, tagged by
category/agency. This is the on-download trigger, mirroring how a proposal artifact atomizes on its lifecycle
event. Two triggers feed one pipeline: **on-download → structure** (skeleton bones, generic), **on-lock →
content** (`proposal-atom-harvest`, the filled prose). Best-effort so instantiate never fails on it.

## 5. The content stable — catalog (have vs. gaps)

**Already built (18, now pristine after this session's fixes):**
DoD/DoW — SBIR P1 Technical · SBIR P1 Cost · SBIR P2 Technical · STTR P1/P2 Technical · D2P2 Technical · CSO
Briefing. NSF — Project Pitch · SBIR/STTR P1 Project Description. DoE — SBIR P1 · STTR P1 Technical.
Marketing — One-Pager · Capability Statement (Two-Pager) · Whitepaper · Sales Deck. Commercialization Plan.
Investor — One-Pager · Pitch Deck.

**Gaps to fill for a "best-of-breed stable" (proposed):**
- **Tech overviews** (you named): Technology Overview one-pager · Technical Whitepaper / architecture brief ·
  Product/Capability data-sheet.
- **Company information decks** (you named): Company Overview / Capability Deck (distinct from the *sales*
  deck) · Past-Performance / Quals deck · Team & Facilities one-pager.
- **Investor**: Executive Summary / Teaser · Financial-Model summary (spreadsheet) · Cap-table one-pager.
- **Agency breadth**: NSF SBIR Cost · DoE Cost · a generic **BAA/OTA/CSO** narrative · NIH SBIR (if in scope).
- Each authored **pristine** (structure + `{anchor}` meta-tags only, per this session's rule), validated by
  the same interpolation audit.

### SUITE (2026-08) — the 34-template stable, internet-researched + real-data-proven

The catalog is now **34 pristine templates across 11 categories**, covering all the major forms:
- **Agency proposals:** DoD/DoW (SBIR P1/P2 Technical · Cost · STTR P1/P2 · D2P2 · CSO Briefing · **BAA White Paper**
  · **OTA/CSO Solution Brief**) · NSF (Project Pitch · SBIR/STTR Project Description) · DOE (SBIR · STTR) ·
  **NASA (SBIR/STTR Phase I — 10-part EHB)** · **NIH (Research Strategy: Specific Aims + Significance/Innovation/Approach)**.
- **Universal proposal forms (`forms`):** **Quad Chart · Executive Summary · Statement of Work (MIL-HDBK-245D) ·
  Budget Justification (R&R A–K) · Biographical Sketch (Common Form) · Current & Pending Support · Data Management
  & Sharing Plan · Facilities/Equipment/Other Resources · Letter of Collaboration (NSF verbatim) · SF-424A Budget**.
- **Collateral:** Marketing (one/two-pager · whitepaper · sales deck) · Commercialization Plan · Investment
  (one-pager · pitch deck) · **Technology Overview Deck** · **Company Capability Deck**.

Each new template's **canonical structure, page limits, required tables, and compliance-critical rules were
researched from current (2025-26) agency solicitations/guides** (AFRL BAA Guide, DIU CSO, MIL-HDBK-245D, SF-424A
instructions, NASA/DHS SBIR solicitations, DARPA BAA Guide, NIH PHS-398/SciENcv, NSF PAPPG 24-1) — sources in the
session log.

**Proven by a fill+compliance harness (`scratchpad/fill-harness`):** every template, interpolated with **REAL
Foundation 3DP company/actor data** (Kate Ulepic; 3D-printed formwork; TRL 6–7; $410B TAM; DoD SBIR 24.3), runs
through the same canvas engines the live editor/export gate use — `estimatePageCount`/`estimateSlideCount` +
`validateStandaloneCanvas` (the compliance floor). Result: **34/34 fill their pages/sections, every profile anchor
resolves, and every one clears the compliance floor (0 violations).** The harness also caught a real defect — the
four slide decks overflowed the 16:9 frame once real (longer) text filled their bullet slides; fixed by dropping
the co-located images on the dense content slides (visuals stay on title/dedicated slides). Filled artifacts export
end-to-end to docx + Chromium-rendered PDF with the real data laid out correctly. This is the OPP-ingest flywheel:
richer templates that encode each solicitation's required layout make matching + drafting a new opportunity
progressively easier.

## 6. Consolidation — collapse 3 systems → 1, retire the shared coupling

The bridge only removes the deprecation risk if we also **stop the live cross-tenant reads**:
- Make `document_templates` (owned copies via the cards) the **single store**. The 18 **code constants become
  the authoring/seed source** that publishes bridge versions (kill the code-vs-DB duplication), or are
  migrated into master rows.
- **Repoint provisioning + the chooser** off the live `is_system` read onto the tenant's **owned**
  `tenant_template_cards` (via a small `resolveTenantTemplate(tenantId, key)` shim). `volume_required_items.
  template_id` resolves to the tenant's copy, not the global row.
- **Retire** the `/library/system-templates` live-download path (superseded by copy-on-create + the card
  shelf) and fold the atom `system_starter` "reference" risk into the same owned model.
- Net: every tenant owns every template; the global masters become **author-side only**; changing/dropping a
  master never breaks a tenant — it just publishes a new version they can opt into. The `COPY_INWARD_GUARDRAIL`
  now covers templates too.

## 7. Phased build (each phase green + live-proven; no code until sign-off)

1. **Bridge plumbing** — mig (`template_bridge` + `tenant_template_cards` + RLS) + `lib/template-bridge.ts`
   (the quintet) + unit tests mirroring the OPP-bridge tests.
2. **Copy-on-create** — wire `backfillTenantTemplates` into the 4 creation paths; prove a fresh tenant lands
   with the full owned set (isolation proven like `verify-keep-copy`).
3. **Portal cards + instantiate** — `/portal/[tenantSlug]/templates` + `TemplateCards` + RLS route +
   "New doc from this" (copy → artifact) + "Update available · Resync".
4. **Admin push + version-up** — `template.push` route/tool + the Studio "publish/version" action → bridge.
5. **Consolidate + retire** — repoint provisioning/chooser to owned cards; retire the live `is_system` reads +
   the download path; migrate the code constants to the bridge as seed versions.
6. **Content stable** — author the gap templates (§5), each pristine + interpolation-audited.

### AS-BUILT (2026-08) — phases 1–3 SHIPPED + live-proven

- **Phase 1 (bridge plumbing + copy-on-create) — SHIPPED.** mig **177** (`master_templates` + `template_bridge`
  L0 forward-only + `tenant_template_cards` L1, RLS ENABLE+FORCE) · `lib/template-bridge.ts` (the quintet:
  `buildTemplateSnapshot`/`publishTemplate`/`applyTemplateToTenant`/`fanOutTemplate`/`publishAndFanOutTemplate`
  + `backfillTenantTemplates`/`reconcileTenantTemplates`) · `scripts/seed-template-masters.mts` (18 masters →
  bridge v1 → fan-out). `backfillTenantTemplates` wired into all 4 creation paths next to
  `copyStarterSetToTenant`. Proven: 18 masters → 72 owned cards (18 × 4 tenants), every card carries the full
  `canvasDocument` (real isolated copies).
- **Phase 2 (portal cards + preview + instantiate + atomize-on-download) — SHIPPED.**
  - `GET /portal/[t]/template-cards` (list, meta) + `GET …/[cardId]` (body, preview) + `POST …/[cardId]/use`
    (instantiate). All three use **explicit `tenant_id` predicate (belt) + `withTenant` (suspenders)** — the belt
    is what scopes the read TODAY (owner role still bypasses RLS; a live browser drive caught the leak — 72 cards
    instead of 18 — before the belt was added).
  - `/portal/[t]/templates` page + `TemplateStableGallery` (cards grouped by category, format badge,
    update-available badge, Preview drawer = `CanvasRenderer readOnly`, "Use this template"). Nav link added.
  - Instantiate reuses `starterFromTemplate` → `tenant_documents`. The card is a `tenant_template_cards` snapshot,
    NOT a `document_templates` row, so `source_template_id` (FK) stays **NULL**; provenance is the new soft
    `source_template_key` (mig **178**).
  - **Atomize-on-download** (`lib/documents/atomize-on-export.ts`, wired into the standalone-doc export route):
    first export decomposes the FILLED canvas into the library (`decomposeAndIngest`), once-only via a CAS on
    `tenant_documents.atomized_at` (mig 178) so re-exports never duplicate. Emits `library:document.atomized`.
    (A blank skeleton instantiate does NOT atomize — the anchors would pollute the library; the trigger is the
    filled download, "just like the proposal artifacts".)
  - Proven: data-layer (instantiate FK-safe + tenant-scoped → atomize → idempotent no-op → all atoms
    tenant-scoped → clean) + live browser (login → 18 cards → preview anchors intact → Use → editor with toast).
- **Phase 3 (admin push + version-up) — SHIPPED.** `/admin/template-stable` roster (masters × category, format
  badge, `master vN · bridge vN · X/Y tenants current` reach) + **Sync from catalog** (`POST …/template-stable/sync`
  → `lib/template-stable-sync.ts`: NEW masters publish, CHANGED masters version-up + publish, UNCHANGED skipped —
  no version churn) + per-master **Push new version** (`POST …/template-stable/[id]/publish` → `publishAndFanOutTemplate`).
  Forward-only fan-out applies the new skeleton to every tenant card + flags `update_available` (instances
  untouched); the tenant gallery's **Refreshed ✕** badge acks it (`POST …/template-cards/[cardId]/ack`). Emits
  `library:template.stable_synced` + `library:template.published`. Proven live (admin drive): 18 masters,
  Sync = "18 unchanged" (idempotent), Push "Commercialization Plan" → bridge v2 → all 4 tenant cards v2 +
  update_available (bridge rows `1:published, 2:republished`).
- **Phase 6 (content-stable gaps) — IN PROGRESS.** The two named deck gaps authored pristine (anchor-only,
  interpolation-audited): **Technology Overview — Deck** (`tech-overview-deck`, category `tech`) and **Company
  Capability — Deck** (`company-capability-deck`, category `company`) — the government capability briefing.
  Both registered in the catalog and shipped through the Phase 3 sync (created → fanned to 4 tenants);
  audit-proven: every profile anchor resolves, anchors stay literal when unset, zero baked-in money/emails
  (`{n}` is the shared preset footer's page-number token, resolved at export). Stable now 20 templates, 8
  categories, live on tenant shelves. Remaining §5 gaps (NSF/DoE cost sheets, generic BAA/OTA) still to author.
- **Phase 5 (retire the customer-facing shared reads) — SHIPPED (surgical).** The live `is_system` shared
  reads that customers depended on for STANDALONE documents are retired: `portal/[t]/templates` GET and
  `documents` POST now read only the tenant's OWN saved templates (`tenant_id = $tenant AND is_system = false`);
  the pristine starter stable is served exclusively by the owned template-card gallery. The `documents/new`
  chooser drops its "System library" group and adds a "Browse the template library →" link to the gallery
  (blank presets + own saved templates remain). Proven live: `GET /templates` returns 0 shared rows
  (anySystem=false), chooser shows no system group.
  **Deliberately NOT touched** (different mechanisms, not the starter-set sharing risk): `proposals/create`'s
  `item.templateId` read (admin-linked compliance MOLDS via `volume_required_items`), the admin
  `document_templates` management surface, and `library/system-templates` (a benign copy-INWARD of library
  foundations, already mitigated by KEEP+COPY eager-copy). Full 3-systems→1 consolidation (migrating the admin
  `document_templates` publish path onto the bridge) remains a later, separately-scoped follow-on.

## 8. Thoughts + open calls (your "thoughts?")

**My recommendation:** do it, and use it as the forcing function to **collapse the three template systems into
one owned, versioned store** — that's the real win; the bridge is the delivery mechanism. It removes a genuine
architectural liability (live cross-tenant coupling in the hottest path — proposal provisioning), and it reuses
a battle-tested spine, so the risk is mostly content + wiring, not novel infrastructure.

**Open calls for you (each changes the build):**
1. **Copy-on-create vs copy-on-first-use.** You said 100% on creation — I'll honor it (backfill on create).
   Cost is trivial (skeletons are small JSONB); the upside is zero live coupling. *Recommend: copy-on-create.*
2. **Version-up never rewrites instances** (only offers a fresher skeleton). *Recommend: yes* — it's your
   "instance is the artifact" rule; rewriting someone's artifact would be wrong.
3. **Consolidate now or add-alongside?** Retiring the live `is_system` reads (§6) is the higher-risk part
   (touches provisioning). *Recommend: build the bridge + cards first (phases 1–4, additive, safe), then do
   the consolidation (phase 5) as a deliberate follow-on* — so the risky repoint is isolated and separately
   proven.
4. **Scope of the stable.** Confirm the gap list (§5) — especially "tech overview" vs "company deck" vs
   "sales deck" boundaries, and which agencies (NIH? generic BAA/OTA?) are in scope now vs later.
5. **Admin authoring UX.** Author masters in the existing **Template Studio** (`/admin/templates`) and add a
   "Publish version → push to all tenants" button, or a separate template-admin plane? *Recommend: extend
   Template Studio* (it already has publish/save-as-new; add versioned push).

## 9. Two-lens check

- **Human:** a customer opens **Templates** in their portal and sees an owned shelf of pristine, on-brand
  starting points — grouped, searchable, one click to a new artifact — that never breaks under them and quietly
  offers "a newer version is available" when you improve one.
- **Machine:** one owned store per tenant, fed by a forward-only append-only bridge with a monotonic version +
  RLS-isolated per-tenant copies + no FK to the master (shard-safe) — the exact proven OPP-bridge invariants,
  plus the copy-inward guarantee extended to templates. No live cross-tenant reads in the provisioning path.

*(Grounded in `lib/opportunity-bridge.ts` + mig 094 (bridge blueprint); `lib/library/foundation.ts`
`copyStarterSetToTenant` + `verify-keep-copy.mts` + `COPY_INWARD_GUARDRAIL.md` (the copy-on-create model);
`document_templates` migs 017/086/150–169 + `provision-proposal.ts` + `portal/templates/route.ts` +
`lib/templates/*` (the three current systems + the shared coupling).)*
