# Phase 1 §F — Curation API Routes

**Mini-TODO scope:** Thin API adapters under `frontend/app/api/admin/rfp-curation/**` that delegate to the tools from §E. Each route is ~6 lines: parse inputs from URL params/body, call `registry.invoke(...)`, return via `ok()`/`err()` from `lib/api-helpers.ts`. Zero business logic in the route.

**Depends on:** §E (the tools must exist)
**Blocks:** §G (UI fetches these endpoints), §J (e2e walks the routes)

## Why this section exists

This is the "thin adapter" half of the dual-use architecture. After §E, all the logic is in the tools. §F is the boring HTTP shim. If a route file in §F is more than ~10 lines (excluding imports + zod schema), it's probably doing something wrong — push the logic into the tool.

## Items

The route paths follow `frontend/app/api/admin/rfp-curation/**` matching the existing stub pattern from clean-build-v2 (most are 501 stubs today; §F flips them to real handlers).

- [ ] **F1.** `frontend/app/api/admin/rfp-curation/route.ts` (GET) — list triage queue
  - Adapts: `solicitation.list_triage`
  - Query string: `status`, `claimedBy`, `limit`, `cursor`
  - ~10 lines

- [ ] **F2.** `frontend/app/api/admin/rfp-curation/[solId]/route.ts` (GET) — get detail
  - Adapts: `solicitation.get_detail`
  - URL param: `solId`

- [ ] **F3.** `frontend/app/api/admin/rfp-curation/[solId]/claim/route.ts` (POST)
  - Adapts: `solicitation.claim`

- [ ] **F4.** `frontend/app/api/admin/rfp-curation/[solId]/release/route.ts` (POST)
  - Adapts: `solicitation.release`

- [ ] **F5.** `frontend/app/api/admin/rfp-curation/[solId]/dismiss/route.ts` (POST)
  - Adapts: `solicitation.dismiss`
  - Body: `{ phaseClassification, notes? }`

- [ ] **F6.** `frontend/app/api/admin/rfp-curation/[solId]/request-review/route.ts` (POST)
  - Adapts: `solicitation.request_review`

- [ ] **F7.** `frontend/app/api/admin/rfp-curation/[solId]/approve/route.ts` (POST)
  - Adapts: `solicitation.approve`

- [ ] **F8.** `frontend/app/api/admin/rfp-curation/[solId]/reject-review/route.ts` (POST)
  - Adapts: `solicitation.reject_review`
  - Body: `{ notes }`

- [ ] **F9.** `frontend/app/api/admin/rfp-curation/[solId]/push/route.ts` (POST)
  - Adapts: `solicitation.push`

- [ ] **F10.** `frontend/app/api/admin/rfp-curation/[solId]/annotations/route.ts` (POST + GET)
  - POST adapts: `solicitation.save_annotation`
  - GET adapts: nothing — returns annotations from `solicitation.get_detail`'s payload (or a small dedicated tool `solicitation.list_annotations` if you'd rather)

- [ ] **F11.** `frontend/app/api/admin/rfp-curation/[solId]/annotations/[annId]/route.ts` (DELETE)
  - Adapts: `solicitation.delete_annotation`

- [ ] **F12.** `frontend/app/api/admin/rfp-curation/[solId]/compliance/route.ts` (POST)
  - Adapts: `compliance.save_variable_value`
  - Body: `{ variableName, value, sourceLocation? }`

- [ ] **F13.** `frontend/app/api/admin/rfp-curation/[solId]/compliance/extract/route.ts` (POST)
  - Adapts: `compliance.extract_from_text`
  - Body: `{ textFragment, sourceLocation }`

- [ ] **F14.** `frontend/app/api/admin/compliance/variables/route.ts` (GET + POST)
  - GET adapts: `compliance.list_variables`
  - POST adapts: `compliance.add_variable`

- [ ] **F15.** `frontend/app/api/admin/ingest/runs/route.ts` (GET) — list recent ingest runs
  - Adapts: `ingest.list_recent_runs`
  - Required role: `master_admin` (middleware enforced)

- [ ] **F16.** `frontend/app/api/admin/ingest/runs/[runId]/route.ts` (GET) — single run detail
  - Adapts: `ingest.get_run_detail`

- [ ] **F17.** `frontend/app/api/admin/ingest/trigger/route.ts` (POST) — manual trigger
  - Adapts: `ingest.trigger_manual`
  - Body: `{ source, runType }`

- [ ] **F18.** Verify middleware path gating — `lib/rbac.ts` `PATH_MIN_ROLE` already includes `{ prefix: '/api/admin', role: 'rfp_admin' }`. Add `{ prefix: '/api/admin/ingest', role: 'master_admin' }` (more specific prefix wins via the iteration order).
  - **Acceptance:** a `tenant_admin` calling `/api/admin/rfp-curation` returns 403; a `rfp_admin` calling `/api/admin/ingest/trigger` returns 403; a `master_admin` calling either succeeds (modulo input validation).

- [ ] **F19.** Integration tests — one per route, in `frontend/__tests__/api/admin/rfp-curation/*.test.ts`. Each test:
  1. Spins up the throwaway PG via the 0.5b `__tests__/setup/pg.ts`
  2. Seeds a curator user (`asMasterAdmin` from the actor helper)
  3. Calls the route via `fetch` against a NextJS test server (or directly via the route's exported HTTP handler — whichever the 0.5b test infra prefers)
  4. Asserts the response shape is `{ data: ... }` on 200, `{ error, code }` on 4xx
  5. Asserts the underlying DB state changed appropriately
  - **Acceptance:** ≥ 17 new integration tests (one per route from F1-F17), all pass.

- [ ] **F20.** Verify each route is < 20 lines (excluding imports + zod schema). The whole point of the dual-use architecture is that routes are thin. Run:
  ```bash
  for f in frontend/app/api/admin/rfp-curation/**/*.ts frontend/app/api/admin/ingest/**/*.ts; do
    body=$(grep -v '^import\|^export\|^const \|^//\|^$' "$f" | wc -l)
    if [ $body -gt 30 ]; then echo "FAT $f ($body lines)"; fi
  done
  ```
  - **Acceptance:** zero "FAT" warnings.

## Anti-patterns from Phase 0.5

- ❌ **Don't write business logic in the route.** Tools own the logic. Routes parse inputs, call `registry.invoke(...)`, and return.
- ❌ **Don't try/catch in the route.** `withHandler` from `lib/api-helpers.ts` does it. Throwing inside the registry → AppError → withHandler → translates to HTTP.
- ❌ **Don't bypass the registry from the route.** Routes call `registry.invoke('tool.name', input, ctx)`, never `tool.handler(input, ctx)`.
- ❌ **Don't write the same input schema twice** (once in the tool, once in the route). The tool's schema is canonical; the route imports it (or the registry exposes it via `tool.inputSchema`).

## Definition of Done for §F

- All 20 items checked
- `npx vitest run __tests__/api/admin/rfp-curation/ __tests__/api/admin/ingest/` passes
- F20 line-count check passes (no fat routes)
- `npx tsc --noEmit` exits 0
- `npx next build` exits 0
- Commit message: `feat(phase-1-F): 17 curation API routes (thin adapters)`
- `docs/PHASE_1_PLAN.md` Section completion tracker has §F ticked
