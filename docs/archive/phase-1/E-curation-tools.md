# Phase 1 §E — Curation Tools

**Mini-TODO scope:** Every Phase 1 capability gets implemented as a Tool first (registered in `frontend/lib/tools/index.ts`), then wrapped by a thin API adapter in §F. This is the dual-use architecture from `docs/TOOL_CONVENTIONS.md` doing its first real work.

**Depends on:** §B (schema), §D (shredder for `compliance.extract_from_text`)
**Blocks:** §F (API adapters), §G (UI calls API), §H (memory tools), §I (state machine), §J (e2e)

## Why this section exists

The 0.5b foundation built `lib/tools/{base,registry,errors}.ts` + 2 reference tools (`memory.search`, `memory.write`). Phase 1 is the first time we register a meaningful number of tools. Done right, every business action is one `registry.invoke(toolName, input, ctx)` call from anywhere — frontend route, future agent dispatcher, future admin CLI — without re-implementation.

## Items

Each item below is one tool. All tools are `tenantScoped: false` (curation is admin-scoped). Most require `rfp_admin`; ingest tools require `master_admin`. Each tool ships with: (a) the implementation file, (b) registration in `lib/tools/index.ts`, (c) a unit test, (d) cross-references to `docs/NAMESPACES.md` for the events it emits. Schema validation is zod.

### Solicitation tools

- [ ] **E1.** `frontend/lib/tools/solicitation-list-triage.ts` — `solicitation.list_triage`
  - Input: `{ status?: ('new'|'claimed'|'released_for_analysis'|'ai_analyzed'|'curation_in_progress'|'review_requested'|'approved')[], claimedBy?: 'me'|'unclaimed'|'any', limit: number, cursor?: string }`
  - Output: `{ items: SolicitationListItem[], nextCursor: string | null }`
  - Handler: queries `curated_solicitations` JOIN `opportunities` on `opportunity_id`, filters by status + claimed_by (resolves `'me'` to `ctx.actor.id`), orders by `created_at DESC`, applies cursor pagination
  - Required role: `rfp_admin`

- [ ] **E2.** `frontend/lib/tools/solicitation-get-detail.ts` — `solicitation.get_detail`
  - Input: `{ solicitationId: string (uuid) }`
  - Output: `{ solicitation, opportunity, compliance, annotations, triage_history }`
  - Handler: 4 queries (curated_solicitations, opportunities, solicitation_compliance, solicitation_annotations + triage_actions)
  - Throws `NotFoundError` if not found
  - Required role: `rfp_admin`

- [ ] **E3.** `frontend/lib/tools/solicitation-claim.ts` — `solicitation.claim` (the canonical worked example from `docs/TOOL_CONVENTIONS.md` §"Phase 1 worked examples")
  - Race-safe atomic UPDATE: `WHERE status = 'new' AND claimed_by IS NULL`
  - Throws `ClaimConflictError` if 0 rows affected
  - Emits `finder.rfp.triage_claimed` single event
  - Inserts a `triage_actions` row
  - Required role: `rfp_admin`

- [ ] **E4.** `frontend/lib/tools/solicitation-release.ts` — `solicitation.release`
  - State transition: `claimed → released_for_analysis`
  - Atomic UPDATE with `WHERE id = ${id} AND claimed_by = ${ctx.actor.id} AND status = 'claimed'`
  - Throws `StateTransitionError` if 0 rows
  - Emits `finder.rfp.released_for_analysis`
  - Inserts a `pipeline_jobs` row with `kind = 'shred_solicitation'` (the dispatcher from §C will pick it up)
  - Inserts a `triage_actions` row
  - Required role: `rfp_admin`

- [ ] **E5.** `frontend/lib/tools/solicitation-dismiss.ts` — `solicitation.dismiss`
  - Input: `{ solicitationId, phaseClassification: 'phase_1_like'|'phase_2_like'|'unknown', notes?: string }`
  - State transition: any unclaimed-or-self-claimed status → `dismissed`
  - Emits `finder.rfp.triage_dismissed`
  - Required role: `rfp_admin`

- [ ] **E6.** `frontend/lib/tools/solicitation-request-review.ts` — `solicitation.request_review`
  - State transition: `curation_in_progress → review_requested`
  - Optional `requested_reviewer_id` (specific admin to review; if null, anyone with `rfp_admin` can pick it up)
  - Emits `finder.rfp.review_requested`
  - Required role: `rfp_admin`

- [ ] **E7.** `frontend/lib/tools/solicitation-approve.ts` — `solicitation.approve`
  - State transition: `review_requested → approved`
  - Constraint: `approved_by` MUST be different from `curated_by` (enforced in the WHERE clause: `AND curated_by != ${ctx.actor.id}`)
  - Throws `ForbiddenError` if the actor is also the curator (with code `SAME_PERSON_REVIEW`)
  - Emits `finder.rfp.review_approved`
  - Required role: `rfp_admin`

- [ ] **E8.** `frontend/lib/tools/solicitation-reject-review.ts` — `solicitation.reject_review`
  - State transition: `review_requested → curation_in_progress`
  - Input: `{ solicitationId, notes: string (required) }`
  - Emits `finder.rfp.review_rejected`
  - Required role: `rfp_admin`

- [ ] **E9.** `frontend/lib/tools/solicitation-push.ts` — `solicitation.push` (the canonical worked example from `docs/API_CONVENTIONS.md` Example 7)
  - State transition: `approved → pushed_to_pipeline`
  - Validation: ensure required compliance variables are populated (page limits, eval criteria, submission format) — throws `ValidationError` with details if any are missing
  - Calls `memory.write` to save a procedural memory of this curation cycle for future cross-cycle learning
  - Sets `opportunities.is_active = true` (was implicitly true; this is the canonical "visible to customers" gate)
  - Emits `finder.rfp.curated_and_pushed` — the canonical Phase 1 success event
  - Required role: `rfp_admin`

- [ ] **E10.** `frontend/lib/tools/solicitation-save-annotation.ts` — `solicitation.save_annotation`
  - Input: `{ solicitationId, kind: 'highlight'|'text_box'|'compliance_tag', sourceLocation: { page, offset, length, bbox? }, payload: object, complianceVariableName?: string }`
  - INSERT into `solicitation_annotations`
  - Emits `finder.rfp.annotation_saved`
  - Required role: `rfp_admin`

- [ ] **E11.** `frontend/lib/tools/solicitation-delete-annotation.ts` — `solicitation.delete_annotation`
  - DELETE from `solicitation_annotations` with `WHERE id = ${id} AND solicitation_id = ${sid}`
  - Required role: `rfp_admin`

### Compliance tools

- [ ] **E12.** `frontend/lib/tools/compliance-list-variables.ts` — `compliance.list_variables`
  - SELECT * FROM `compliance_variables` ORDER BY category, name
  - Required role: `rfp_admin`

- [ ] **E13.** `frontend/lib/tools/compliance-add-variable.ts` — `compliance.add_variable`
  - Input: `{ name, label, category, dataType, options?, isSystem: false }`
  - INSERT into `compliance_variables`
  - Throws `ConflictError` if name already exists
  - Required role: `rfp_admin`

- [ ] **E14.** `frontend/lib/tools/compliance-extract-from-text.ts` — `compliance.extract_from_text` (worked example from `TOOL_CONVENTIONS.md`)
  - Calls the pipeline's `/internal/shred` HTTP endpoint (sync extractor from §D8)
  - Returns suggestions WITHOUT writing to DB
  - Throws `ToolExternalError` on upstream failure
  - Required role: `rfp_admin`

- [ ] **E15.** `frontend/lib/tools/compliance-save-variable-value.ts` — `compliance.save_variable_value`
  - Input: `{ solicitationId, variableName, value, sourceLocation? }`
  - UPSERT into `solicitation_compliance` (or the matching JSONB field — verify against the actual baseline schema)
  - Sets `verified_by = ctx.actor.id`, `verified_at = now()`
  - Required role: `rfp_admin`

### Opportunity tools

- [ ] **E16.** `frontend/lib/tools/opportunity-get-by-id.ts` — `opportunity.get_by_id`
  - Worked example from `TOOL_CONVENTIONS.md`
  - Required role: `rfp_admin` (for now; Phase 2 customer portal will add `tenant_user` access via a separate `opportunity.get_for_tenant` tool)

- [ ] **E17.** `frontend/lib/tools/opportunity-list-recent-ingested.ts` — `opportunity.list_recent_ingested`
  - Query: most recent N opportunities sorted by `created_at DESC`, optionally filtered by source
  - Required role: `rfp_admin`

- [ ] **E18.** `frontend/lib/tools/opportunity-fetch-raw-document.ts` — `opportunity.fetch_raw_document`
  - Returns the S3 path + a presigned URL for the original solicitation PDF
  - Required role: `rfp_admin`

### Ingest tools

- [ ] **E19.** `frontend/lib/tools/ingest-trigger-manual.ts` — `ingest.trigger_manual`
  - Input: `{ source: 'sam_gov'|'sbir_gov'|'grants_gov', runType: 'incremental'|'full' }`
  - INSERTs a row into `pipeline_jobs` with `priority = 1` (high) so the dispatcher picks it up immediately
  - Returns the job id for status polling
  - Required role: `master_admin` (broad upstream API impact; only the highest privilege)

- [ ] **E20.** `frontend/lib/tools/ingest-list-recent-runs.ts` — `ingest.list_recent_runs`
  - Reads from `pipeline_jobs` joined with the corresponding `system_events` `finder.ingest.run.end` events for run statistics
  - Required role: `master_admin`

- [ ] **E21.** `frontend/lib/tools/ingest-get-run-detail.ts` — `ingest.get_run_detail`
  - Single run detail with full event payload (`inserted`, `updated`, `skipped`, `failed`, `last_cursor`)
  - Required role: `master_admin`

### Registration + tests

- [ ] **E22.** Update `frontend/lib/tools/index.ts` — register every tool from E1-E21. Pattern matches the existing `memory.search` / `memory.write` registration. **Acceptance:** `registry.list().length` returns 21 + the 2 from 0.5b = 23.

- [ ] **E23.** Unit tests for each tool — `frontend/__tests__/tools/{tool-name}.test.ts`. Each test:
  1. Seeds the necessary fixture data (an opportunity, a curated_solicitation, a user with the right role)
  2. Calls the tool via `registry.invoke('tool.name', input, ctx)` (NOT directly — must go through the registry to verify the audit logging path)
  3. Asserts the return value
  4. Asserts the side effects (DB rows updated, events written to system_events)
  5. For state-machine tools (E3-E9), asserts the wrong-state path throws the right error
  - **Acceptance:** at least 21 new test files; `npx vitest run __tests__/tools/` exits 0; total test count goes from 85 (0.5b) to ≥ 106.

- [ ] **E24.** Cross-tool integration test — `frontend/__tests__/scenarios/full-curation-flow.test.ts`. Walks the entire happy path: ingest fixture → triage list → claim → release → (mock shredder writes ai_extracted) → curate → request_review → approve → push → opportunity visible to customer query. Covers E1+E3+E4+E6+E7+E9 in one test. **Acceptance:** test exists and passes.

## Anti-patterns from Phase 0.5

- ❌ **Don't put state-machine logic in the API route.** It belongs in the tool. The route is 6 lines.
- ❌ **Don't bypass the registry by calling `tool.handler(...)` directly.** That skips the audit event emission. Always `registry.invoke(...)`.
- ❌ **Don't return `null` from a tool handler to signal an error.** Throw a `ToolError` subclass.
- ❌ **Don't forget tenant isolation tests** — even though curation tools are admin-scoped (tenantScoped: false), there should still be a "wrong-role" test proving a `tenant_user` can't invoke a `solicitation.*` tool.

## Definition of Done for §E

- All 24 items checked
- `npx vitest run __tests__/tools/` passes
- `npx vitest run __tests__/scenarios/full-curation-flow.test.ts` passes
- `registry.list().length === 23`
- `npx tsc --noEmit` exits 0
- `NODE_ENV=production NEXT_PHASE=phase-production-build npx next build` exits 0
- Commit message: `feat(phase-1-E): 21 curation tools + cross-tool flow test`
- `docs/PHASE_1_PLAN.md` Section completion tracker has §E ticked
