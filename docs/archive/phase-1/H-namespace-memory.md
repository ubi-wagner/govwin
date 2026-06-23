# Phase 1 §H — Namespace Memory + Cross-Cycle Similarity

**Mini-TODO scope:** The `memory.search_namespace` tool, the `agencyKey()` helper, and the pre-fill / diff-view logic that lets a curator working on a 2026 AFWERX SBIR Phase I solicitation see what the 2025 cycle looked like and start with the same compliance values as a baseline.

**Depends on:** §B (memory tables have the new `namespace` column), §E (memory.write tool exists from 0.5b, this is the search side)
**Blocks:** §G (the workspace UI shows the diff view), §J (e2e demonstrates cross-cycle pre-fill)

## Why this section exists

The pre-V2 product spec said: when a curator opens a new SBIR solicitation, the system should automatically check whether a similar prior cycle has been curated, and if so, pre-fill the compliance matrix from the prior cycle (so the curator's job becomes "verify the pre-fill, fix the diffs" instead of "extract from scratch"). The 0.5 baseline added the memory tables but no namespace column or search-by-namespace tool. §H closes that gap.

The cross-cycle similarity threshold (0.9 similarity → pre-fill, 0.7-0.9 → highlight diffs only, < 0.7 → fresh extraction) is documented in `docs/IMPLEMENTATION_PLAN_V2.md` Phase 1 §1.7.

## Items

- [ ] **H1.** `frontend/lib/memory/agency-key.ts` — pure function `computeAgencyKey({ agency, office, programType, phase }) → string`. Identical logic to `pipeline/src/shredder/namespace.py compute_namespace_key` from §D6. **Cross-language contract:** the two implementations get verified by `frontend/__tests__/lib/memory/cross-lang-agency-key.test.ts` which spawns Python via `child_process.execSync`, calls the Python helper with the same inputs, and asserts byte-equal output. (This is the §C9 cross-language pattern, applied to the memory key helper.)
  - **Acceptance:** unit test passes; cross-lang test passes.

- [ ] **H2.** `frontend/lib/tools/memory-search-namespace.ts` — `memory.search_namespace` tool. The doc spec is in `docs/TOOL_CONVENTIONS.md` §"Phase 1 worked examples — Example F". Implementation:
  - Input: `{ namespaceKey: string, kind?: 'episodic'|'semantic'|'procedural', limit: number }`
  - Validates `namespaceKey` matches the format from `NAMESPACES.md` (regex: `/^[A-Z][A-Z0-9-]*(:[A-Za-z0-9-]+)+$/` or similar)
  - Queries the right memory table filtered by `namespace LIKE ${key} || ':%' OR namespace = ${key}` (the LIKE prefix handles partial keys)
  - If `limit` is set and the table is large, also applies pgvector cosine similarity to rank results (the `embedding` column already exists in the baseline)
  - Returns `{ results: Memory[], count: number, namespaceKey, queriedAt }`
  - Required role: `rfp_admin`
  - tenantScoped: false
  - Registered in `lib/tools/index.ts`
  - **Acceptance:** unit test seeds 3 memories with namespace `USAF:AFWERX:SBIR:Phase1`, calls the tool, gets 3 results back; seeds 1 with `ARMY:DEVCOM:STTR:Phase2`, queries `USAF:AFWERX:SBIR:Phase1`, gets only the 3.

- [ ] **H3.** `frontend/lib/curation/prefill.ts` — pre-fill helper used by the curation workspace UI:
  - `async function loadPriorCycleSuggestions(currentSolicitationId: string, ctx: ToolContext): Promise<{ similarity: number, suggestions: ComplianceVariableValue[], priorCycleId: string }[]>`
  - 1. Fetch the current solicitation's `namespace` column
  - 2. Call `memory.search_namespace` with that key
  - 3. For each prior cycle, compute a similarity score (vector cosine on full text + the `agency_namespace_key` exact match bonus)
  - 4. For each prior cycle that scored > 0.7, fetch its `solicitation_compliance` row
  - 5. Return the suggestions with per-field `{value, source: 'prior_cycle:<solId>', confidence}`
  - 6. The UI displays them as ghost values in the compliance matrix; the curator clicks "accept" to commit them via `compliance.save_variable_value`
  - **Acceptance:** unit test seeds two solicitations with the same `namespace`, fully curates the first, verifies that loading suggestions for the second returns the first's compliance values.

- [ ] **H4.** `frontend/lib/curation/diff.ts` — diff-view generator for cross-cycle changes:
  - `function diffComplianceCycles(prior: ComplianceMatrix, current: ComplianceMatrix): ComplianceDiff[]`
  - Returns per-field: `{ variableName, priorValue, currentValue, status: 'unchanged'|'changed'|'added'|'removed' }`
  - Used by the workspace UI to highlight which fields differ from the prior cycle (curator focuses attention there)
  - Pure function, no DB
  - **Acceptance:** unit test with 5 paired field changes covering all 4 statuses

- [ ] **H5.** Workspace UI integration — `frontend/components/admin/rfp-curation/ComplianceMatrix.tsx` from §G10:
  - On mount, calls `loadPriorCycleSuggestions` (via a server action or a `/api/admin/rfp-curation/[solId]/prior-cycles` route)
  - For each compliance variable that has a suggestion: render the input pre-filled with the suggested value, with a small "Suggested from 2025 cycle" badge and an "accept" / "edit" affordance
  - When the curator edits a pre-filled value, the badge changes to "Modified from 2025 cycle"
  - When the curator clicks "Push to Pipeline", §E9's `solicitation.push` writes a new procedural memory via `memory.write` for THIS cycle, ready for the next cycle's pre-fill
  - **Acceptance:** manual click-through: with 2 fixture solicitations sharing a namespace, curate the first via the UI, then open the second — verify pre-fill ghost values appear.

- [ ] **H6.** `frontend/app/api/admin/rfp-curation/[solId]/prior-cycles/route.ts` (GET) — thin adapter for the UI to fetch prior cycle suggestions
  - Adapts: `loadPriorCycleSuggestions` (which itself calls `memory.search_namespace` + a few other tools)
  - **Acceptance:** integration test passes

- [ ] **H7.** Sanity test — full pipeline:
  - Seed Solicitation A in `USAF:AFWERX:SBIR:Phase1`, fully curate via test fixtures (compliance variables saved, pushed)
  - Confirm a procedural memory was written with `namespace = 'USAF:AFWERX:SBIR:Phase1'`
  - Seed Solicitation B in the same namespace
  - Call `loadPriorCycleSuggestions(B.id, ctx)` 
  - Assert at least one suggestion is returned with values matching A's compliance matrix
  - Assert similarity score > 0.9 since the namespace matches exactly
  - **Acceptance:** test exists and passes

## Anti-patterns from Phase 0.5

- ❌ **Don't compute the namespace key in two places without a cross-language test.** The Python (§D6) and TypeScript (§H1) versions must produce identical output for the same input. Don't trust they do — verify with `child_process.execSync`.
- ❌ **Don't query the memory tables with raw `SELECT *` from a route.** Always go through the `memory.search_namespace` tool so the audit logging path fires.
- ❌ **Don't pre-fill without showing the source.** A pre-filled value with no provenance is indistinguishable from human-entered data. Every suggestion has a `source: 'prior_cycle:<solId>'` field that the UI surfaces.
- ❌ **Don't write memories twice.** The `solicitation.push` tool from §E9 writes ONE procedural memory at push time. Earlier writes (during curation) are out of scope — Phase 4 will add finer-grained memory writes for agent learning.

## Definition of Done for §H

- All 7 items checked
- Unit + integration tests pass
- The cross-language agency-key test passes
- `npx tsc --noEmit` exits 0
- `npx next build` exits 0
- Manual click-through: pre-fill works for two fixture solicitations sharing a namespace
- Commit message: `feat(phase-1-H): namespace memory search + cross-cycle pre-fill + diff view`
- `docs/PHASE_1_PLAN.md` Section completion tracker has §H ticked
