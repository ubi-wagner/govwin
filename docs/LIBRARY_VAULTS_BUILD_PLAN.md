# Library + Vaults — Granular Build Plan (dev · test×3 · doc)

The remaining half of the library/vault vision, decomposed into small, independently
shippable tasks. **Every task carries the same cadence — DEV → TEST×3 → DOC:**

- **DEV** — the code change (smallest coherent unit).
- **TEST×3** — ≥3 real-scenario proofs against the **real DB / real unmocked functions**
  (mocks that replace the logic-under-test don't count). Each task lists its 3 scenarios.
- **DOC** — update the named doc(s): the canonical design (`docs/LIBRARY_AND_VAULTS_DESIGN.md`),
  `CLAUDE_CLIFFNOTES.md` (schema), `docs/SECURITY_AND_SAFETY.md` (RLS), the role manuals, and
  `docs/CONTINUATION.md` (as-built state) as applicable.

**Per-task verification backbone** (from CLAUDE.md): `npx tsc --noEmit` (0) → `npx vitest run`
→ schema via `db/migrations/migrate.mjs` on the sandbox → `npx next build` for risky diffs →
a live Playwright drive for UI slices → an adversarial multi-agent sweep for the large (vault)
diff. Commit + push each green slice; append the result to the scratchpad `findings.md`.

Canonical design: `docs/LIBRARY_AND_VAULTS_DESIGN.md`. Build sequence: library-first,
vault-second (§8) — the foundation-grain model already shipped (#238/#231/exporters/ribbon),
so partial-sharing is a future visibility flip, not a rebuild.

Legend: ✅ done · ▶ this plan. **Already shipped:** grain model, taxonomy, Create-Canvas API,
copy-on-use + shared scaffold, 4-format exporters of the full element set, the ribbon drawer.

---

## EPIC P2 — In-library "Create Canvas" UI  (finishes #232; API already shipped)

**P2.1 — "Create Canvas" button + new-canvas modal on the library page**
- DEV: a `+ Create canvas` action on `app/portal/[tenantSlug]/atoms` (and the library page)
  opening a modal: title · kind (template|document) · form (doc|ppt|pdf|sheet) · context ·
  collection → `POST /api/portal/[tenantSlug]/library/canvas`; on 200, route to the editor.
- TEST×3: (1) form=doc → a `foundation` row + section/group/primitive grains + `kind/form/format=docx/context`
  tags persist; (2) form=sheet → `format=xlsx`, opens the sheet editor; (3) missing title → 400 `{error,code}`,
  no row written.
- DOC: design §2; Customer-Admin manual "Create a canvas".

**P2.2 — Open the new foundation as a blank canvas in the editor**
- DEV: after create, navigate to the doc/slide/sheet editor seeded with the blank foundation
  (`blankCanvasForForm`), form→editor mapping (doc→CanvasEditor, ppt→SlideEditor, sheet→SheetEditor).
- TEST×3: (1) doc opens editable + saves back to the foundation; (2) ppt opens the slide editor;
  (3) sheet opens the sheet editor; each round-trips a save.
- DOC: Customer-Admin manual (screens).

**P2.3 — "Start from a template" catalog + copy-on-use in the modal**
- DEV: a second modal tab lists `GET …/library/system-templates` (the `system_starter` catalog);
  "Add to my library" → `POST` copy-on-use → open the tenant copy.
- TEST×3: (1) catalog lists only `system_starter` foundations; (2) copy materializes the full grain
  tree in the tenant with `derived_from` lineage on every grain; (3) editing the copy never mutates
  the source (independence).
- DOC: design §2/§4; manual.

---

## EPIC P3 — Sortable/filterable library + native downloads  (#233)

**P3.1 — Library list API (faceted)**
- DEV: `GET …/library/atoms?kind=&form=&context=&collection=&grain=&q=&page=` — taxonomy-faceted,
  grain-filtered, ILIKE-escaped search, `::int` counts, pagination; returns facet counts for the chips.
- TEST×3: (1) `form=ppt` returns only deck foundations; (2) `kind=template&context=proposal` intersects
  correctly; (3) `q` with `%`/`_` is escaped (no injection, literal match).
- DOC: CLIFFNOTES (route), design §3.

**P3.2 — Faceted library browse UI**
- DEV: filter chips (kind × form × context) + grain toggle (foundation|section|group|primitive) +
  sort (recent|title|usage) + result grid with taxonomy badges + derivative/lineage badge.
- TEST×3: (1) selecting a chip narrows the grid (drive); (2) grain toggle switches the level;
  (3) empty result renders the empty state (no crash).
- DOC: Customer-Admin manual (library tour).

**P3.3 — Download a foundation/atom in its native format**
- DEV: a per-row `Download` → `renderCanvas(format, canvas_nodes)` for the atom's `form`
  (doc→docx, ppt→pptx, pdf→pdf, sheet→xlsx); streams the bytes.
- TEST×3: (1) a doc foundation downloads a valid `.docx` (PK zip + document.xml); (2) a sheet
  downloads a valid `.xlsx`; (3) a section grain downloads just its nodes.
- DOC: manual.

---

## EPIC P4 — Dogfood the starter template set  (#234)

**P4.1 — Author the GENERIC starters**
- DEV: build (via the Create-Canvas path) letter · memo · one-pager · deck · sheet foundations as
  canvas JSON, using the extended elements where they earn it (callouts, dividers, a chart in the deck).
- TEST×3: (1) each decomposes to grains on save; (2) each renders in all 4 exporters without throwing;
  (3) taxonomy tags (`kind=template`, right `form/format`, `context=general`) present.
- DOC: design §4; a starter-set index in the doc.

**P4.2 — Author the PROPOSAL starters** — the DoD/DoW vehicle set (user-specified)
- Vehicles (each = a Technical-Volume foundation `doc` + a Cost-Volume foundation `sheet`;
  a shared commercialization deck `ppt` reused across them). Tag each with a `vehicle`
  dimension so the library filters by vehicle:
  1. **DoW CSO** (Department of War — Commercial Solutions Opening): two-step — a Solution
     Brief/white-paper `doc` {Problem/Need · Solution & Innovation · Technical Approach ·
     Company & Team · Rough Pricing · Commercialization/Transition} → Full Proposal expands it;
     Pricing `sheet`.
  2. **SBIR Phase I**: TV {Significance of the Problem · Phase I Technical Objectives · Phase I
     Work Plan · Related Work · Relationship to Future R&D (Phase II vision) · Commercialization
     Strategy · Key Personnel · Facilities/Equipment · Subs/Consultants · Prior Support}; Cost `sheet`.
  3. **SBIR Phase II**: TV {Significance · Phase I Results & Feasibility · Phase II Objectives ·
     Phase II Work Plan/SOW · Commercialization Plan (expanded) · Key Personnel · Facilities ·
     Related Work · Subs}; Cost `sheet` (base + options).
  4. **STTR Phase I**: SBIR Phase I scaffold **+ {Research Institution & Partnership · Allocation
     of Work (≥40% SBC / ≥30% RI) · IP & Data-Rights Allocation}**; Cost `sheet`.
  5. **STTR Phase II**: SBIR Phase II scaffold + the same RI-partnership/allocation sections; Cost `sheet`.
  6. **Direct-to-Phase-II (DP2)**: TV {Phase I Feasibility Documentation (equivalent-work evidence) ·
     Phase II Objectives · Phase II Work Plan · Commercialization Plan · Key Personnel · Facilities};
     Cost `sheet`.
- TEST×3: (1) each vehicle's TV decomposes into its expected sections (assert per-vehicle scaffold);
  (2) each Cost `sheet` exports a formula-bearing `.xlsx`; (3) `context=proposal` + `vehicle=<slug>` +
  `kind=template` tags present on every grain.
- DOC: design §4 (the vehicle set + scaffolds).

**P4.3 — Seed script → house library (`system_starter`)**
- DEV: `scripts/seed-starter-set.mts` upserts every starter into the house tenant under
  `collection=system_starter` (idempotent by slug; re-run replaces cleanly).
- TEST×3: (1) fresh run creates N foundations; (2) re-run is a no-op (same count, same ids/lineage);
  (3) `listSystemFoundations()` returns them all with correct facets.
- DOC: design §4; CONTINUATION (how to (re)seed).

---

## EPIC P5 — Onboarding seed (shared scaffold + copy-on-use, NOT deep-seed)  (#235)

**P5.1 — Empty-library state surfaces the starter catalog**
- DEV: when a tenant library is empty, render the `system_starter` catalog with a
  "Add starter templates" CTA (reads the shared scaffold cross-tenant, read-only).
- TEST×3: (1) empty tenant shows the catalog; (2) non-empty tenant hides the zero-state;
  (3) catalog is read-only (no tenant rows created on view).
- DOC: manual (getting started).

**P5.2 — "Add starter set" bulk copy-on-use**
- DEV: one action deep-copies the whole `system_starter` set into the tenant via
  `copyFoundationToTenant` (lineage per grain); idempotent (skip already-copied by lineage).
- TEST×3: (1) adds N foundations with lineage; (2) re-click is idempotent (no dupes);
  (3) each copy is independently editable.
- DOC: design §4.

**P5.3 — Wire into onboarding/provision**
- DEV: surface the catalog on first library visit (or a `capture:tenant.provisioned` handler that
  *offers*, never force-seeds) per the shared-scaffold decision.
- TEST×3: (1) new tenant first-visit offers the set; (2) after add, offer clears; (3) event path
  is safe-skip if the house scaffold is absent.
- DOC: design §4; CONTINUATION.

---

## EPIC P6 — Agent hookup (starters as scaffold)  (#236)

**P6.1 — Mold → starter-template link**
- DEV: the required-item → template picker lists `system_starter`/tenant foundations; linking a
  starter sets the mold's template so provision skeletons from it.
- TEST×3: (1) picker lists starters; (2) linking persists on the mold; (3) provision builds the
  skeleton from the linked starter's sections.
- DOC: design §4; RFP-Admin manual.

**P6.2 — `section_drafter` grounds on the starter section scaffold**
- DEV: pass the linked foundation's section grains as scaffold context to the drafter (grain-aware),
  fence untrusted tenant content as always.
- TEST×3: (1) a section with a starter scaffold drafts against it; (2) no scaffold → current fallback;
  (3) injection-fenced (a hostile atom can't redirect).
- DOC: `docs/AGENT_WORKFORCE.md`; design §4.

**P6.3 — `librarian` matches uploads to the scaffold**
- DEV: on upload→atomize, the librarian suggests section/group/atom classification against the
  starter scaffold (advisory → guardrail → land-or-review; never auto-writes business tables).
- TEST×3: (1) an uploaded doc gets scaffold-matched suggestions; (2) suggestions are advisory
  (require accept); (3) runaway bounds hold (round/cost caps).
- DOC: AGENT_WORKFORCE.

---

## EPIC P7 — Per-role onboarding ToDos  (#237)

**P7.1 — Emit role-scoped library/vault ToDos**
- DEV: on provision/first-login emit ToDos per §6: tenant_admin (create a canvas · add starters ·
  organize by context · create a nook) · tenant_user (draft from a foundation) · partner_user
  (upload to your nook). Namespaced events, tenantId set.
- TEST×3: (1) tenant_admin gets the admin set; (2) tenant_user gets the draft ToDo only;
  (3) partner_user gets the nook ToDo only.
- DOC: design §6; manuals.

**P7.2 — Auto-complete ToDos on the matching action + surface on landing**
- DEV: completing the action (first canvas created, starters added, first draft, first nook upload)
  resolves the ToDo; surface the open set on the role landing.
- TEST×3: (1) create-canvas resolves its ToDo; (2) add-starters resolves its ToDo; (3) landing shows
  only unresolved ToDos.
- DOC: manuals.

---

## EPIC P8 — Collaboration Vaults / "nooks" (the external-boundary security phase)  (#239–242)

**P8.1 — Migration: vault tables + RLS scaffolding**
- DEV: mig `library_vaults(id, tenant_id, partner_label, created_by, …)` +
  `vault_members(vault_id, user_membership_id|email, role='partner_user')` +
  `library_atoms.vault_id uuid NULL` + extend the `visibility` CHECK with `'vault'`;
  `ENABLE`/`FORCE ROW LEVEL SECURITY` on all three.
- TEST×3: (1) migrate applies clean on the sandbox; (2) CHECK rejects a bad visibility; (3) a
  vault atom requires a `vault_id` (constraint).
- DOC: CLIFFNOTES (schema); design §5; SECURITY_AND_SAFETY.

**P8.2 — RLS policies (the isolation contract)**
- DEV: policies — partner_user sees ONLY their `vault_id` rows; tenant_admin/shadow sees all vaults
  of their tenant; tenant_user sees none; admin/CMS cross-reads on a BYPASS/owner-view.
- TEST×3: (1) collaborator A cannot read collaborator B's nook; (2) collaborator cannot read the
  tenant's main library; (3) tenant_admin reads all their nooks. (Run against the real RLS-forced DB.)
- DOC: SECURITY_AND_SAFETY (RLS matrix); design §5.

**P8.3 — Create-a-nook (+ list)**
- DEV: tenant_admin/shadow creates a nook (tenant × partner) and lists their nooks; `capture` event.
- TEST×3: (1) admin creates a nook; (2) tenant_user is 403; (3) list is tenant-scoped.
- DOC: Customer-Admin manual.

**P8.4 — Invite partner emails → vault-scoped `partner_user`**
- DEV: invite-by-email (mirror the proposal-collaborator flow) → `user_memberships` `partner_user`
  scoped to the vault; onboarding link.
- TEST×3: (1) invited email gets a vault-scoped membership; (2) the same email at another tenant is
  isolated; (3) revoke removes vault access (last-collab semantics).
- DOC: design §5.1; manual.

**P8.5 — Collaborator rights: upload · atomize · download-WHOLE-only**
- DEV: collaborator upload + atomize into the nook; download restricted to **whole artifacts** —
  the grain-download route hard-403s for `partner_user` (whole-only invariant).
- TEST×3: (1) collaborator uploads + atomizes; (2) collaborator downloads a whole artifact;
  (3) collaborator grain-download → 403.
- DOC: design §5.2; Collaborator manual.

**P8.6 — Tenant-admin rights: copy-in upload · any-grain download · ingest**
- DEV: tenant_admin uploads a **copy** into the nook (never a link/transfer from the main library),
  downloads any grain, and **ingests** a harvested grain into the proposal-portal library.
- TEST×3: (1) upload is a copy (no reference to main-library rows); (2) admin downloads a section
  grain; (3) ingest lands the grain in the proposal library with lineage.
- DOC: design §5.2/§5.3; manual.

**P8.7 — V1 collaborator-content HITL lands in the nook**
- DEV: the long-designed "collaborator supplies bios/facilities" HITL — ToDo to the partner →
  content in the nook → customer review + harvest → proposal. Wire the ToDo + the review surface.
- TEST×3: (1) HITL ToDo reaches the partner; (2) partner upload satisfies it; (3) customer harvest
  advances the proposal step.
- DOC: design §5.5; HITL runbook.

**P8.8 — Instruction-based sharing (launch) + defer partial/signatures**
- DEV: the guardrail copy ("only upload content you're comfortable with the partner using") at the
  upload boundary; explicitly gate the deferred features (grain-partial-share, e-sign) behind flags.
- TEST×3: (1) the instruction renders at upload; (2) partial-share UI is absent/flagged-off;
  (3) signature affordances are absent/flagged-off.
- DOC: design §7 (launch vs future).

**P8.9 — Nook UI (both sides)**
- DEV: tenant-admin nook console (vaults · members · artifacts · grain download + ingest) +
  collaborator nook view (upload · atomize · download-whole). Reuses the responsive drawer/shell.
- TEST×3: (1) admin console lists members + artifacts; (2) collaborator view hides grain controls;
  (3) responsive (narrow viewport) drives clean.
- DOC: manuals (both roles) + screenshots.

**P8.10 — Adversarial RLS isolation proof (security gate)**
- DEV: an adversarial multi-agent sweep + a real-DB isolation harness across the whole vault surface.
- TEST×3+: cross-tenant read blocked · cross-nook read blocked · collaborator-grain-extract blocked ·
  main-library-into-nook leak blocked · owner-bypass reads scoped. Findings must be *proven*.
- DOC: SECURITY_AND_SAFETY (final posture); CONTINUATION.

---

## Cross-cutting closeout

**DOC-FINAL** — reconcile as-built: `LIBRARY_AND_VAULTS_DESIGN` (as-built), `ARCHITECTURE_V10`,
`CLIFFNOTES` (tables/columns/routes), `SECURITY_AND_SAFETY` (vault RLS), `CONTINUATION` (sprint
state), and the Customer-Admin + Collaborator manuals.

**VERIFY-FINAL** — full backbone green on the whole diff: `tsc` 0 · `vitest` · `migrate` on sandbox
· `next build` · Playwright drive of the library + nook journeys · adversarial sweep (API/React/SQL,
proven) for the vault diff. Commit + push; final `findings.md` entry.

---

### Sequencing (blockers)

```
P2 (Create-Canvas UI) ─► P3 (sortable + downloads) ─► P4 (starter set) ─► P5 (onboarding) ─► P6 (agents)
                                                                     └─► P7 (role ToDos, after P2/P5)
P8 (vaults) is independent of P2–P6 up to P8.1–P8.2 (schema+RLS first),
   then P8.3→P8.9 in order; P8.10 gates the vault release.
DOC-FINAL + VERIFY-FINAL close each epic and the whole plan.
```
