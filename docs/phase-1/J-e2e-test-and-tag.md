# Phase 1 §J — End-to-End Test + Tag

**Mini-TODO scope:** The terminal gate. One full e2e smoke test that walks ingest → triage → claim → release → shred → curate → review → approve → push, plus the tag ceremony that marks Phase 1 complete.

**Depends on:** §A through §I (everything)
**Blocks:** Phase 2 (cannot start until §J is checked off)

## Why this section exists

Every section A-I has its own tests. §J is the integration test that proves the sections compose correctly. The 0.5b login disaster came from each layer being correct in isolation but the layers disagreeing on contracts. §J catches that for Phase 1.

It's also the official "Phase 1 is done" marker. Without §J, we don't know whether the parts add up to a working product.

## Items

- [ ] **J1.** `frontend/__tests__/scenarios/phase-1-full-curation-e2e.test.ts` — the canonical Phase 1 e2e
  - Spins up a throwaway PG16 + applies all migrations (0.5b setup pattern)
  - Pre-seeds a `pipeline_jobs` row with `kind='ingest_sam_gov'` and `run_type='incremental'`
  - **Phase 1: ingest** — calls `pipeline.dispatch_pending_jobs` (or simulates via direct call to `SamGovIngester.run('incremental')` with a stub upstream that returns 5 fixture opportunities). Asserts 5 rows in `opportunities`, 5 `finder.opportunity.ingested` events.
  - **Phase 2: triage list** — invokes `solicitation.list_triage` as eric@rfppipeline.com. Asserts 5 unclaimed solicitations visible.
  - **Phase 3: claim** — invokes `solicitation.claim` for the first one. Asserts status='claimed', triage_actions row created, `finder.rfp.triage_claimed` event.
  - **Phase 4: release** — invokes `solicitation.release`. Asserts status='released_for_analysis', a new `pipeline_jobs` row with `kind='shred_solicitation'`, `finder.rfp.released_for_analysis` event.
  - **Phase 5: shred** — directly calls `shredder.runner.shred_solicitation` (or simulates the dispatcher consuming the job). Mocks the Anthropic client to return a canned section + compliance JSON. Asserts `curated_solicitations.ai_extracted` is populated, `solicitation_compliance` rows updated, `status='ai_analyzed'`, `finder.rfp.shredding.start` + `.end` events.
  - **Phase 6: curate** — invokes `solicitation.save_annotation` (a few annotations) and `compliance.save_variable_value` (filling in any missing required compliance variables). Status flips to `curation_in_progress`.
  - **Phase 7: request review** — invokes `solicitation.request_review`. Asserts `status='review_requested'`, `finder.rfp.review_requested` event.
  - **Phase 8: approve (as a different admin)** — seeds a SECOND `rfp_admin` user (alice@rfppipeline.com), invokes `solicitation.approve` as alice. Asserts `status='approved'`, `approved_by=alice.id`, `finder.rfp.review_approved` event. Verify that approving as eric (the original curator) WOULD throw `ReviewSelfApprovalError`.
  - **Phase 9: push** — invokes `solicitation.push` as alice. Asserts `status='pushed_to_pipeline'`, opportunity is_active=true, a procedural memory was written via `memory.write` with the right namespace key, `finder.rfp.curated_and_pushed` event with the canonical Phase 1 success payload.
  - **Phase 10: cross-cycle pre-fill** — seed a SECOND opportunity in the same `agency_namespace_key`, create its curated_solicitations row, call `loadPriorCycleSuggestions(secondSol.id, ctx)`, assert the suggestions match the first cycle's compliance values.
  - **Total assertions:** ~40-50
  - **Acceptance:** test passes green; total runtime under 60 seconds

- [ ] **J2.** Frontend smoke flow — `frontend/__tests__/e2e/admin-curation-click-through.spec.ts` (or vitest equivalent)
  - Sign in as eric@rfppipeline.com with the real password
  - Navigate to `/admin/rfp-curation`, see at least one row
  - Click `Claim` on the first row
  - Get redirected to `/admin/rfp-curation/[solId]`
  - See the document viewer render (or its loading skeleton if the PDF fixture isn't loaded)
  - See the compliance matrix
  - Click `Push to Pipeline` (after the test fixture pre-seeds the row in `approved` state to skip the multi-step flow)
  - Land on `/admin/dashboard` with a success indicator
  - **Acceptance:** test passes; if Playwright isn't wired yet, the test exists as a JSDOM-based vitest scenario.

- [ ] **J3.** Cross-language hash + key contract — re-run the cross-language tests from §C9 (content_hash determinism) and §H1 (agencyKey equivalence) as part of the Phase 1 final validation. These caught nothing in the 0.5b cycle but are mandatory to prove the Python ↔ TS contracts are still aligned after Phase 1's surface area expansion.
  - **Acceptance:** both tests still pass

- [ ] **J4.** Migration idempotency final check — apply migrations 001-009 against a throwaway PG16, then apply again, then a third time. Zero errors all three runs.
  - **Acceptance:** ✓

- [ ] **J5.** `next build` final check — `NODE_ENV=production NEXT_PHASE=phase-production-build npx next build` exits 0 with all Phase 1 routes compiled. Verify the build output includes:
  - `/admin/rfp-curation` (server component)
  - `/admin/rfp-curation/[solId]` (server component)
  - All 17 API routes from §F
  - **Acceptance:** ✓

- [ ] **J6.** Update `docs/CLAUDE_CLIFFNOTES.md` — flip "Current state" from "Phase 1 starting" to "Phase 1 complete, Phase 2 (Customer Portal) is next." Update the commit count, the latest commit hash, and the section completion tracker reference.

- [ ] **J7.** Update `CHANGELOG.md` with a Phase 1 entry:
  ```markdown
  ## v1.0-curation-complete — YYYY-MM-DD
  ### Added
  - 3 ingesters (SAM.gov, SBIR.gov, Grants.gov) + cron dispatcher
  - AI shredder with versioned Claude prompts + golden fixture regression suite
  - 21 curation tools (solicitation.*, compliance.*, opportunity.*, ingest.*, memory.search_namespace)
  - 17 API routes (thin adapters)
  - Admin curation workspace UI: triage queue + document viewer + annotation tools + compliance picker
  - Cross-cycle namespace memory + pre-fill
  - Multi-admin claim/review/approve workflow with state machine
  - Migration 009: namespace columns, triage_actions audit table, solicitation_annotations
  ### Changed
  - `pipeline/src/main.py` is no longer a sleep loop — runs the cron dispatcher + job consumer
  - `curated_solicitations.status` CHECK constraint enforces the canonical 10-state set
  ### Tests
  - 50+ new unit tests (one per tool)
  - 17+ integration tests (one per route)
  - 1 cross-tool curation flow test
  - 1 universal state-machine matrix test (~50 cases)
  - 1 e2e smoke test (the §J1 flow)
  - 1 frontend click-through (§J2)
  - 5 golden fixture regression tests (§D7)
  - Total test count: from ~85 (post-0.5b) to ~200+
  ```

- [ ] **J8.** `docs/PHASE_1_PLAN.md` — tick all 10 sections in the Section completion tracker.

- [ ] **J9.** Final commit — single commit with all the §J test additions + the doc updates. Message:
  ```
  feat(phase-1-J): e2e + click-through + final validation; Phase 1 complete
  ```

- [ ] **J10.** Tag — `git tag v1.0-curation-complete` on the merge commit on `main`. Note: if Phase 1 is shipping via a multi-PR approach, the tag goes on the merge commit of the LAST PR that closes Phase 1.

## Anti-patterns from Phase 0.5

- ❌ **Don't tag a phase complete without the e2e passing.** 0.5 was tagged "complete" multiple times when it wasn't. The §J test is the only signal that matters.
- ❌ **Don't skip the cross-language contract recheck at the end.** Easy to assume the §C and §H tests still pass; verify they do.
- ❌ **Don't merge §J as part of a noisy PR.** §J should land in a PR titled "Phase 1 e2e + Phase 1 complete" so the merge commit on main is the obvious tag target.

## Definition of Done for §J (== Definition of Done for Phase 1)

- All 10 §J items checked
- The §J1 e2e test passes
- The §J2 click-through passes
- All previous test files still pass (J3 cross-language, J4 migrations, J5 next build)
- `docs/CLAUDE_CLIFFNOTES.md` flipped to Phase 2 starting
- `CHANGELOG.md` has the Phase 1 entry
- `docs/PHASE_1_PLAN.md` has all 10 sections ticked
- `git tag v1.0-curation-complete` exists and points at the merge commit
- The first sentence of `CLAUDE_CLIFFNOTES.md` Current state section reads "Phase 1 is complete and tagged as `v1.0-curation-complete`"

When all of the above is true, **Phase 2 can start.** Not before.
