# End-to-End Wiring Sweep — 2026-07-16

Five parallel subsystem audits of the master→mirror→portal→build→automation spine, **code vs.
the architectures documented this week** (`MASTER_MIRROR_OPP_DESIGN.md`, `ARCHITECTURE_V10.md`,
`AUTOMATION_DESIGN.md`, `IDENTITY_AUTHZ_MODEL.md`, `DB_SCHEMAS.md`, `API_REFERENCE.md`). Each audit
traced real UI ↔ API ↔ DB (↔ pipeline) and cross-checked every table/column.

## Top-line verdict

**The customer-facing spine is wired end-to-end.** The master OPP spine, the per-tenant mirror
cards + Spotlight, the portal-build chain, and the event→workflow→agent automation loop all audited
**WIRED with zero schema drift**. The only **P1 breakers were in the HITL canvas-draft flow — both
fixed this cycle** (commit `82d92fb`). Everything else is P2/P3 polish or documented infra deps.

| Subsystem | Verdict | Notes |
|---|---|---|
| **Master OPP spine** (ingest → curate → approve → push → bridge fan-out) | ✅ WIRED | Both push gates real + UI-satisfiable; no schema drift |
| **Mirror cards + Spotlight** (`tenant_opportunity_cards`, buckets/scores, pin, backfill) | ✅ WIRED | Auto-scored on arrival; tenant-scoped + RLS; legacy routes redirect |
| **Portal build** (pin → purchase → curation → release → provision → V0) | ✅ WIRED | Synchronous skeleton (matrix+molds) real; AI draft + ToDo row need the worker |
| **Automation loop** (events → processor → workflows → agents → HITL → nudges) | ✅ WIRED | 12 workflows all producer+consumer; 7 agents intentionally parked (§9) |
| **Library → canvas HITL draft** (upload→atomize→pick→draft→lock) | ✅ FIXED | Library/mold/matrix/lock wired; **2 P1 draft breakers fixed this cycle** |

## Fixes applied this cycle (commit `82d92fb`, `b5ea26d`)

- **P1** — "Draft All Sections" now **persists** (wrapped nodes → `/save`); was discarding all output.
- **P1** — draft **placeholder mode** restored (no-key installs draft scaffolding instead of no-opping).
- **P2** — `action=release` now requires **`rfp_admin`** (was `tenant_admin` → customer could skip curation).
- **G1** (identity) — cross-company collaborators now **admitted + section-scoped** on the core spine
  (`verifyProposalAccess` + `isTenantWideMember`; workspace page, section editor, save, comments).

## Remaining backlog (P2/P3 — none block the core flows)

| # | Sev | Finding | Fix | Where |
|---|---|---|---|---|
| W1 | P2 | Admin `rfp-curation` "which customers pinned this opp" JOINs the **retired** `tenant_pipeline_items` → reads empty; same table backs a tenant "pipeline items" count | Repoint to `tenant_opportunity_cards` (`is_pinned` / row count) | `app/admin/rfp-curation/[solId]/page.tsx:332`, `app/api/admin/tenants/[tenantId]/route.ts:84` |
| W2 | P2 | `curated_solicitations.namespace` hardcoded `'pending'` and never updated → curation-memory flywheel (cross-cycle pre-fill) defeated on the manual path | Derive/set a real namespace at curation (agency/program) | `app/api/admin/rfp-upload/route.ts:328` |
| W3 | P2 | Curation ToDo doesn't **deep-link into the buyer tenant** (`entityHref` → generic queue); ToDo row is worker-created (async) | `entityHref` → `/portal/<slug>/portals?portal=<id>` (resolve slug from `tenant_id`); check `launchProjectCollaboration` result | `app/admin/rfp-curation/triage-todos.tsx:16` |
| W4 | P2 | Canvas "Replace from Library" pickers read deprecated `library_units` (atoms from `/atoms` workbench don't appear) | Repoint `library/similar` + `library.search_atoms` to `library_atoms`/`selectForSection` | `lib/tools/library-similar.ts`, `lib/tools/library-search-atoms.ts` |
| W5 | P2 | `AIRevisionPanel` "From Library" passes `tenantId` that fails the tool's own schema → never queries the library | Drop `tenantId` from the tool InputSchema (uses `ctx.tenantId`) | `components/canvas/ai-revision-panel.tsx:135`, `lib/tools/library-search-atoms.ts:21` |
| W6 | P2 | Draft-All doesn't ground on the **RFP excerpt / eval criteria / subsections** (never loaded into the page) | Load solicitation excerpt + item criteria in the workspace page; pass through to `DraftAllSections` | `app/portal/[tenantSlug]/proposals/[proposalId]/page.tsx`, `proposal-workspace.tsx:324` |
| W7 | P3 | `AIRevisionPanel` is mold-blind (hardcoded `pageLimit:1`, no atoms/rfpExcerpt) — pure node-text transform | Thread the section's real pageLimit/font/rfpExcerpt/atoms | `components/canvas/ai-revision-panel.tsx:53` |
| W8 | P3 | `tenant_opportunity_cards.pursuit_status` read/filtered but **no writer** (inert); dashboard filters a `'dismissed'` literal not in the CHECK | Add a pursuit-status PATCH; drop the dead literal | `api/portal/[tenantSlug]/cards/*`, `dashboard/route.ts:95` |
| W9 | P3 | Buckets `POST` (create) doesn't auto-rank a new bucket vs existing cards (UI "Rank →" covers it) | Call `rankBucket` at end of the create handler | `api/portal/[tenantSlug]/buckets/route.ts` |
| W10 | P3 | Release path hardcodes `origin_card.bucket`/`source_bucket` to null → card Origin tab shows "—" for bucket lineage | Thread the source bucket from the purchased card | `lib/provision-proposal.ts:88` |
| W11 | P3 | New-upload primary-doc flag ignored (form sends `primaryIndex`, route reads `isPrimary`) | Align the field names | `components/rfp-curation/upload-form.tsx:141` |
| W12 | P3 | `released_for_analysis` can strand if the shredder is offline (no forward button) | Surface "skip shredder / start curation" in `STATUS_FLOW` | `components/rfp-curation/curation-workspace.tsx:144` |
| W13 | P3 | Doc/line drift: master-spine ingest UI path (`/admin/rfp-upload`→`/admin/rfp-curation/upload`); `archived` event_type; several in-file workflow docstrings + `AUTOMATION_DESIGN` line numbers; `§8` `review_requested` "(no consumer)" | Refresh the doc lines | docs |
| W14 | P3 | Latent: `StepType.TODO` has no stop in the no-mig-043 fallback executor (unreachable in prod — 110 migs applied) | Add a `TODO` stop mirroring `HITL_WAIT` | `pipeline/src/workflows/processor.py:395` |

## Infra prerequisites (documented, not code gaps)
- **Pipeline worker** — the `proposal_setup` ToDo *row* + `draft_v0` AI content (the V0 *skeleton* is synchronous).
- **`ANTHROPIC_API_KEY`** (frontend) — real AI drafting; without it, placeholder mode now degrades gracefully (fixed).
- **S3/R2** — pin doc-copy + rfp-upload storage.
- **CMS event listener** — the purchase→admin-notify email (seeded rule, mig 106).
