# Phase 1 — RFP Ingestion & Expert Curation

**Status:** scoping (not yet started)
**Predecessor:** Phase 0.5b (`v0.5b-foundation-complete`, commit `2c5578a`)
**Branch:** `claude/analyze-project-status-KbAhg` (Phase 1 commits start after the 0.5b PR merges to `main`)
**Goal (from `IMPLEMENTATION_PLAN_V2.md` §Phase 1):** *Admin can triage, release, curate, and push RFPs to the customer pipeline.*

## Why this file exists

Phase 1 is the first **product surface** in the codebase. Phase 0.5/0.5b built the foundation (auth, conventions, tools, events, tests, dual-use API↔Tool architecture); Phase 1 is the first time we use that foundation to ship a feature an actual user (an `rfp_admin`) can interact with.

This doc is a **slim index** into 10 mini-TODO files under `docs/phase-1/`. Each mini-TODO is one logical chunk of work that ships as one or two commits. **Don't put implementation detail in this file** — put it in the mini-TODO. The index stays scannable so anyone (Claude session, human reviewer, future you) can navigate the phase in 30 seconds.

## Lessons from Phase 0.5a + 0.5b that bind Phase 1

Read `docs/CLAUDE_CLIFFNOTES.md` §"Lessons from Phase 0.5a and 0.5b" before starting any item below. The 10 meta-rules from that section are non-negotiable for every Phase 1 commit. The most important ones to internalize before writing code:

1. **Scope conformance:** before declaring a mini-TODO done, `ls -la` every file the mini-TODO promised. If anything is missing or empty, the section is incomplete.
2. **Build, not typecheck:** every commit runs `NODE_ENV=production NEXT_PHASE=phase-production-build npx next build` for frontend changes, `python3 -m py_compile` for Python, and a real-PG apply for SQL.
3. **Tool-first, not route-first:** every Phase 1 capability is a tool registered in `frontend/lib/tools/index.ts`. The API route is a 6-line adapter over `registry.invoke(...)`. No bespoke route handlers.
4. **Cross-language contracts:** Python (pipeline) and TypeScript (frontend) implementations of the same domain object must be byte-verified the way `pipeline/src/storage/paths.py` ↔ `frontend/lib/storage/paths.ts` were in 0.5b.
5. **Events are mandatory:** every significant action emits `start`/`end` events to `system_events` per `docs/EVENT_CONTRACT.md`. If you can't emit an event, you can't do the action.
6. **Tenant isolation tested, not assumed:** every tenant-scoped tool gets a test that seeds two tenants and proves tenant B can't read tenant A's data. (Curation tools are *admin-scoped*, not tenant-scoped — but the rule applies the moment Phase 2's customer portal lands.)
7. **No deferrals:** SUSPICIOUS findings get fixed or proven safe, not pushed to "next phase."

## Section index

| § | Mini-TODO file | Scope | Blocks |
|---|---|---|---|
| **A** | [`phase-1/A-architecture-and-conventions.md`](phase-1/A-architecture-and-conventions.md) | Architecture review, namespace registry updates, conventions cross-references, doc additions | (no code blocks; everything else depends on it) |
| **B** | [`phase-1/B-database-additions.md`](phase-1/B-database-additions.md) | Migration `009_phase1_curation_extensions.sql` — `namespace` column on memory tables, indexes for triage queue + similarity search, `triage_actions` audit table | C, D, E, H, I |
| **C** | [`phase-1/C-python-ingester-framework.md`](phase-1/C-python-ingester-framework.md) | Pipeline base ingester class + `sam_gov.py` + `sbir_gov.py` + `grants_gov.py` + cron dispatcher in `pipeline/src/main.py` | E, J |
| **D** | [`phase-1/D-shredder-and-compliance-extraction.md`](phase-1/D-shredder-and-compliance-extraction.md) | Pipeline shredder worker (pymupdf4llm + Claude prompts) + golden fixture suite + regression tests | E, G, J |
| **E** | [`phase-1/E-curation-tools.md`](phase-1/E-curation-tools.md) | `solicitation.*` and `compliance.*` and `opportunity.*` and `ingest.*` tools registered in `lib/tools/index.ts` | F, G, H, I, J |
| **F** | [`phase-1/F-curation-api-routes.md`](phase-1/F-curation-api-routes.md) | Thin API adapters under `frontend/app/api/admin/rfp-curation/**` invoking the tools from §E | G, J |
| **G** | [`phase-1/G-curation-workspace-ui.md`](phase-1/G-curation-workspace-ui.md) | `/admin/rfp-curation` triage page + `/admin/rfp-curation/[solId]` workspace page + document viewer + annotation UI + compliance picker | J |
| **H** | [`phase-1/H-namespace-memory.md`](phase-1/H-namespace-memory.md) | `memory.search_namespace` tool + `agencyKey()` helper + pre-fill + diff view for cross-cycle similarity matching | J |
| **I** | [`phase-1/I-state-machine-multi-admin.md`](phase-1/I-state-machine-multi-admin.md) | Atomic state transitions enforced inside the `solicitation.*` tools + multi-admin claim/review/approve workflow | J |
| **J** | [`phase-1/J-e2e-test-and-tag.md`](phase-1/J-e2e-test-and-tag.md) | Full ingest→triage→shred→curate→push e2e smoke test + tag `v1.0-curation-complete` | (terminal — gates Phase 2) |

## Sequencing rules

- **A is non-blocking** (pure docs) — start it day one in parallel with B
- **B blocks C, D, E, H, I** because they all read or write the new schema
- **C and D can run in parallel** once B is done (different surface areas)
- **E depends on B + D** (compliance tools call the shredder; curation tools query the new schema)
- **F is a thin layer over E** — F starts as soon as E is done (~6 lines per route)
- **G depends on F** (UI calls the API which calls the tools)
- **H depends on B + E** (memory namespace column + memory tools)
- **I is a refinement of E** — implements the state machine inside the existing tools, can land slightly after E without blocking F/G
- **J is the terminal gate** — full e2e against everything

## Definition of Done for Phase 1

A Phase 1 commit is mergeable when:

1. The mini-TODO file for its section is updated with checked items
2. `npx tsc --noEmit` → exit 0
3. `NODE_ENV=production NEXT_PHASE=phase-production-build npx next build` → exit 0 (frontend changes only)
4. `python3 -m py_compile pipeline/src/**/*.py` → exit 0 (pipeline changes only)
5. SQL migrations have been applied to a throwaway PG16 + verified idempotent (apply twice, second run is no-op)
6. New tools have at least one passing unit test that exercises them through `registry.invoke`
7. New API routes have at least one passing integration test
8. New events appear in `system_events` (verified by reading the table after running the test)
9. Cross-references in `docs/NAMESPACES.md` updated for any new event/tool/log scope

Phase 1 as a whole is done and can be tagged `v1.0-curation-complete` when:

1. All 10 mini-TODOs are checked off
2. The full e2e smoke test from §J passes
3. `docs/CLAUDE_CLIFFNOTES.md` updated to mark Phase 1 complete + Phase 2 starting
4. `CHANGELOG.md` has a Phase 1 entry
5. `git tag v1.0-curation-complete` exists and points at a commit on `main`

## Out of scope for Phase 1 (deferred to later phases)

These are tempting but **explicitly not in Phase 1**. Don't sneak them in.

| Item | Why deferred | Phase |
|---|---|---|
| Customer portal (Finder) | needs Phase 2 (Stripe + scoring + tenant onboarding) | 2 |
| Proposal workspace | needs Phase 3 (workspace + sections + collaborators) | 3 |
| Full agent fabric (Opportunity Analyst, Section Drafter, etc.) | Phase 4 — Phase 1 only uses the shredder as an "AI tool" not as an autonomous agent | 4 |
| Solicitation outline builder UI (cloning sections on purchase) | originally listed as Phase 1.9 but actually a Phase 2 prerequisite — moved to Phase 2 | 2 |
| Template upload (cost templates / forms / examples) | originally Phase 1.10 — landed in §E as `solicitation.upload_template` tool but the UI for it lives under §G as a stretch goal; if §G runs over budget it moves to Phase 2 alongside customer purchase flow | 1 stretch / 2 |
| Real-time collaborative editing in the curation workspace | nice-to-have, not in V1 | 2+ |
| Email notifications for review_requested | needs Resend wiring (Phase 2 has it) | 2 |

## How to use this index

When you start a Phase 1 work session:

1. Read this file top to bottom (~3 min)
2. Read `docs/CLAUDE_CLIFFNOTES.md` §"Lessons from Phase 0.5a and 0.5b" (~5 min)
3. Pick a mini-TODO that has all its dependencies satisfied (check the "Blocks" column above and the "Depends on" section in the mini-TODO itself)
4. Open the mini-TODO file and follow it
5. Each item in the mini-TODO has its own acceptance criteria — verify them before checking the box
6. When the mini-TODO is fully checked, commit + push, then come back here and tick the section box below

## Section completion tracker

- [ ] **A** Architecture & conventions
- [ ] **B** Database additions
- [ ] **C** Python ingester framework
- [ ] **D** AI shredder + compliance extraction
- [ ] **E** Curation tools (solicitation.*, compliance.*, opportunity.*, ingest.*)
- [ ] **F** Curation API routes
- [ ] **G** Admin curation workspace UI
- [ ] **H** Namespace memory + cross-cycle similarity
- [ ] **I** State machine + multi-admin workflow
- [ ] **J** End-to-end test + tag

When all 10 are checked, run §J's smoke test, tag the commit, update CHANGELOG.md, and Phase 1 is done.
