# Phase 1 §A — Architecture & Conventions

**Mini-TODO scope:** Pure documentation. No code, no migrations. The other 9 sections all depend on these docs being correct and current, so §A runs first (or in parallel with §B since that's also independent).

**Depends on:** nothing
**Blocks:** every other section reads from these docs

## Why this section exists

The Phase 0.5b conventions docs are written for the foundation. Phase 1 introduces new domain concepts (curation state machine, ingester cron pattern, shredder prompt versioning, namespace memory keys, multi-admin workflow) that need their place in the canonical docs. If §A is skipped, every Phase 1 section will invent its own conventions on the fly and we'll repeat the 0.5a/0.5b mistake of inconsistent foundations.

## Items

- [ ] **A1.** Verify the background-agent updates from this Phase 1 scoping pass actually landed in the conventions docs:
  - [ ] `docs/NAMESPACES.md` has Phase 1 event types (`finder.ingest.run.*`, `finder.opportunity.ingested`, `finder.rfp.triage_*`, `finder.rfp.shredding.*`, `finder.rfp.curation_*`, `finder.rfp.review_*`, `finder.rfp.curated_and_pushed`, `system.ingester.rate_limited`, `system.shredder.budget_exceeded`)
  - [ ] `docs/NAMESPACES.md` has Phase 1 tool namespaces (`solicitation.*`, `compliance.*`, `opportunity.*`, `ingest.*`, `memory.search_namespace`)
  - [ ] `docs/NAMESPACES.md` has the **Memory namespace keys** section with the `{agency}:{program_office}:{type}:{phase}` format
  - [ ] `docs/NAMESPACES.md` has Phase 1 log scopes (`ingest.sam-gov`, `ingest.sbir-gov`, `ingest.grants-gov`, `shredder`, `curation`, `triage`, `compliance`)
  - [ ] `docs/API_CONVENTIONS.md` has Phase 1 worked examples (claim route, list route, push route)
  - [ ] `docs/TOOL_CONVENTIONS.md` has Phase 1 worked tool examples (`solicitation.claim`, `compliance.extract_from_text`, `memory.search_namespace`)
  - **Acceptance:** `grep -l "finder.rfp.curated_and_pushed" docs/NAMESPACES.md` returns the file; `grep -l "solicitation.claim" docs/TOOL_CONVENTIONS.md` returns the file.

- [ ] **A2.** `docs/ARCHITECTURE_V5.md` Phase 1 addendum (appended at the end, ~80 lines, **don't rewrite the existing doc**):
  - Section title: `## Phase 1 Addendum — Curation Pipeline (added 2026-04)`
  - Subsections:
    - **Data flow** — diagram (ASCII or mermaid) of: external sources (SAM.gov, SBIR.gov, Grants.gov) → pipeline ingester → `opportunities` table → `curated_solicitations` row at `status='new'` → admin triage → `released_for_analysis` → shredder worker → `curated_solicitations.ai_extracted` JSONB populated → admin curation workspace → `pushed_to_pipeline` → opportunity becomes visible to customers
    - **State machine** — full enum: `new → claimed → released_for_analysis → ai_analyzed → curation_in_progress → review_requested → approved → pushed_to_pipeline` with the `dismissed` terminal branch and `rejected_review → curation_in_progress` cycle
    - **Tool catalog** — short list of every Phase 1 tool with one-sentence descriptions, links into `docs/TOOL_CONVENTIONS.md` for full specs
    - **Event lifecycle** — paragraph explaining how each lifecycle phase emits its corresponding event from `docs/NAMESPACES.md`
    - **Multi-admin workflow** — how `claimed_by` + `curated_by` + `approved_by` columns enforce single-claimant + reviewer-distinct-from-curator
    - **Cross-cycle memory** — how `memory.search_namespace` lets the Opportunity Analyst (Phase 4) and human curators (Phase 1) reuse prior cycles
  - **Acceptance:** the addendum exists, doesn't replace any existing content, and every subsection cross-links to the relevant `docs/{NAMESPACES,API_CONVENTIONS,TOOL_CONVENTIONS,EVENT_CONTRACT}.md` file by section anchor.

- [ ] **A3.** `docs/DECISIONS.md` — append Phase 1 decisions block. Use the existing decision-record format. Decisions to capture:
  - **D-Phase1-01: Ingesters live in pipeline, not as tools.** External-API polling is a worker concern, not an interactive tool concern. Ingesters import directly from `pipeline/src/ingest/*.py` and run on cron. They emit `finder.opportunity.ingested` events; everything downstream (triage, curation, shredder) uses tools. Rationale: agents shouldn't trigger polling of upstream rate-limited APIs as a side-effect of memory.search; the cron path is the only path.
  - **D-Phase1-02: Shredder is dual-callable.** The shredder runs as a pipeline worker on `released_for_analysis` events, AND can be invoked synchronously by an admin via `compliance.extract_from_text` (the worker writes to DB and calls Claude; the sync path just calls Claude and returns suggestions without persisting). Rationale: humans need a fast "preview suggestions" loop in the workspace; agents need a durable async path.
  - **D-Phase1-03: Curation is admin-scoped, not tenant-scoped.** `curated_solicitations`, `solicitation_compliance`, and the related tools are visible to all `rfp_admin` users regardless of tenant. The `tenant_id` column is null on these tables. Rationale: opportunities are global; only the customer-facing scoring + portal layers (Phase 2) become tenant-scoped.
  - **D-Phase1-04: Memory namespace key format is `{agency}:{program_office}:{type}:{phase}`.** Three-part variant `{agency}:{type}:{phase}` is allowed for sources that don't expose program office (NSF, NIH). Documented in `docs/NAMESPACES.md` §"Memory namespace keys".
  - **D-Phase1-05: Shredder prompts live in versioned files.** `pipeline/src/shredder/prompts/v1/section_extraction.txt`, `compliance_extraction.txt`, etc. Each prompt has a version number that gets stamped into `system_events` payloads so we can attribute future quality regressions to specific prompt versions. Rationale: prompt drift is the #1 cause of LLM regression; versioning is the only audit trail.
  - **D-Phase1-06: Golden fixture suite is mandatory.** §D ships at least 5 real RFPs (one per source × at least one Phase I + one Phase II) with hand-verified expected extractions. Regression test runs the shredder against them on every Phase 1 commit. Rationale: a free-form LLM extractor with no ground truth is a quality time bomb.
  - **D-Phase1-07: State transitions are guarded by the tool, not the API route.** Every `solicitation.*` tool that mutates state runs an atomic UPDATE with a WHERE clause on the source state — no "select then update" race windows. The API route is a thin adapter and has no state-machine logic.
  - **Acceptance:** all 7 decisions appended to `docs/DECISIONS.md` with the canonical format (id, date, status, decision, rationale, consequences); existing decisions untouched.

- [ ] **A4.** `docs/ERROR_HANDLING.md` — append Phase 1 error codes (small edit, ~30 lines):
  - New `IngesterRateLimitError` (`code: INGESTER_RATE_LIMITED`, `httpStatus: 429`) — thrown by ingesters when an upstream API returns 429 or our local rate-limit guard fires
  - New `IngesterContractError` (`code: INGESTER_CONTRACT_VIOLATED`, `httpStatus: 502`) — thrown when an upstream API returns a payload that doesn't match the expected schema (SAM.gov occasionally adds fields)
  - New `ShredderBudgetError` (`code: SHREDDER_BUDGET_EXCEEDED`, `httpStatus: 503`) — thrown when a single shredding run exceeds the per-document Claude token budget
  - New `StateTransitionError` (`code: INVALID_STATE_TRANSITION`, `httpStatus: 409`) — thrown by `solicitation.*` tools when the requested state transition is illegal from the current state
  - New `ClaimConflictError` (`code: CLAIM_CONFLICT`, `httpStatus: 409`) — thrown when an `rfp_admin` tries to act on a solicitation claimed by a different admin
  - All extend `AppError`, all populate `details` with the relevant context
  - **Acceptance:** the 5 new classes appended in `lib/errors.ts` AND documented in `docs/ERROR_HANDLING.md` table — but **the actual `lib/errors.ts` edit is deferred to Mini-TODO E** (where the tools that throw them get built); §A only updates the doc.

- [ ] **A5.** `docs/CLAUDE_CLIFFNOTES.md` — verify the background agent updates landed (the agent finished cleanly at 269 lines; spot-check that the "Lessons from Phase 0.5a and 0.5b" section is present and the "Current state" section reflects Phase 1 starting). **Acceptance:** `grep -c "Lessons from Phase 0.5" docs/CLAUDE_CLIFFNOTES.md` returns ≥ 1.

- [ ] **A6.** Cross-doc consistency check — for every new namespace/tool/event introduced by §A1-A5, verify there's a single canonical definition site (`NAMESPACES.md` for the name, `TOOL_CONVENTIONS.md` for the contract, `EVENT_CONTRACT.md` for the event shape, `ERROR_HANDLING.md` for the error code). Run a grep audit:
  ```bash
  for term in "finder.rfp.curated_and_pushed" "solicitation.claim" "memory.search_namespace" "INGESTER_RATE_LIMITED" "{agency}:{program_office}:{type}:{phase}"; do
    echo "=== $term ===" 
    grep -rn "$term" docs/ | head -5
  done
  ```
  **Acceptance:** every term resolves to ≥ 1 doc and the locations make sense (no orphan terms, no duplicate definitions).

## Anti-patterns from Phase 0.5

(Each is something Phase 0.5 actually did wrong; calling them out so §A doesn't repeat.)

- ❌ **Don't write a new convention without updating the canonical doc.** 0.5a invented `withHandler` in `lib/api-helpers.ts` without ever cross-referencing `API_CONVENTIONS.md`. Result: developers had two conflicting patterns to choose from.
- ❌ **Don't append to the wrong doc.** Tool error codes go in `lib/tools/errors.ts` (referenced from `TOOL_CONVENTIONS.md`), not bare error codes in `lib/errors.ts`. Phase 0.5b had to refactor this.
- ❌ **Don't skip the cross-link step.** Every doc that mentions a namespace must link to `NAMESPACES.md`. Without the link, the doc rots when the namespace gets renamed.
- ❌ **Don't bundle "I'll write the doc later" as a follow-up.** Every 0.5a deferral became a 0.5b crisis. §A is done before §B starts.

## Definition of Done for §A

- Every checkbox above is ticked
- `git diff docs/` shows the expected changes (no other files modified)
- All cross-link greps in A6 return matches
- A new commit landed with message `docs(phase-1-A): Phase 1 conventions + decisions`
- `docs/PHASE_1_PLAN.md` Section completion tracker has §A ticked
