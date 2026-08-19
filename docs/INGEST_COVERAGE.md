# Ingest coverage — every path, every input, every actor

**The accountability ledger for the ingest pipeline.** Each cell names where the case is proven —
a committed test that runs against the live stack, never a claim. When you add an ingest path,
add its row here and its proof there; a row without a proof is a regression waiting to be
invisible.

Proof locations:
- **COV** `frontend/e2e/ingest-coverage-drive.spec.ts` (the from-scratch sweep, serial)
- **STU** `frontend/e2e/ingest-studio-drive.spec.ts` (the gate mechanics)
- **FUL** `frontend/e2e/dow-full-ingest-drive.spec.ts` (fresh 3-doc upload through the form)
- **AST** `frontend/e2e/dow-assist-drive.spec.ts` (assist + shred-gate mechanics)
- **UT-F** `frontend/__tests__/ingest-*.test.ts` (pattern extractor · provenance audit · stage/land)
- **UT-P** `pipeline/tests/test_ingest_actions.py` · `test_rfp_ingest_manager_wiring.py`
- **LED** `frontend/scripts/verify-ingest-coverage.mts` (the DB ledger gate, run after COV)

---

## Actors

| Actor | May | Proven |
|---|---|---|
| unauthenticated | nothing — 401/403 on every ingest surface | COV A1 |
| tenant_admin / tenant_user / partner_* | nothing — ingest is platform-scope | COV A2 |
| rfp_admin | every surface: upload · attach · assist · all five gate actions · assess | COV B–E |
| master_admin | same as rfp_admin (`hasRoleAtLeast(role,'rfp_admin')`) | role-gate code path shared with A2/B |
| `ingest_analyst` (agent) | advisory read, extract phase | COV D2 via worker |
| `matrix_stager` (agent) | advisory read, matrix phase | COV D2 / STU via worker |
| `curation_qa` × {citation, completeness, consistency} | refute the STAGED draft | COV D2 / STU via worker |
| `advisory_manager` (agent) | reconcile the colour team | COV D2 / STU via worker |
| `skeleton_architect` (agent) | molds phase, landed matrix only | COV D5 via worker |
| `rfp_ingest_manager` (manager) | advisory assessment incl. provenance audit | COV C1 (`assess-ingest`) · UT-P |
| `OnRfpUploaded` (automation) | shred every rule-bearing document | COV B1/C1 (fresh + attach) |
| `advance_ingest_phase` (automation) | chain hops; NEVER past the land gate | COV D2 live · UT-P (12 cases) |
| `record_ingest_review` (automation) | mark the open draft reviewed; advisory | COV D2 live · UT-P |

## Inputs

| Input case | Expected | Proven |
|---|---|---|
| Umbrella BAA alone (deferral unresolvable) | staged + BLOCKER "nowhere on file", parked | COV B1 |
| Instructions attached LATER (attach-to-existing, typed) | inline-extracted, full_text recombined, deferral resolves, assist lands clean | COV C1 |
| Full 3-doc fresh upload through the form | shreds all three, deferral resolves at first assist | FUL |
| No source text at all | 409 SOURCE_TEXT_NOT_READY, `state` names why | COV E4 · AST |
| `allowDefaultSkeleton` opt-in on unshredded | stages ALL-default, REFUSES to land (nothing-read blocker) | COV E4 |
| Admin override parse | lands, every set field stamped `override` | COV E1 |
| Regenerate with a comment | supersedes; guidance recorded + threaded to agents | COV D1 · STU |
| Duplicate file re-upload | 409 DUPLICATE_FILE (content-hash dedup) | discovered live by COV C1's first draft; asserted in upload flow tests |
| Invalid UUID / unknown action / missing solicitation | 400 / 400 / 404, all with `{error, code}` | COV E2 |
| Multi-document page-numbering restart | citations carry `docSegment` | UT-F pattern-extract |
| Competing page caps in one document | Technical-Volume-anchored rule wins | UT-F |
| Prose that looks like a volume title | not parsed as a volume | UT-F |

## Paths

| Path | Expected | Proven |
|---|---|---|
| Assist one-click, clean audit | stage → land in one click, values badged by source | COV C1 · FUL |
| Assist one-click, blocked audit | stage → PARK, blockers named, `landed:false` | COV B1/B2 |
| Auto-land over a blocker | REFUSED (machine may not publish known-unfounded) | COV B2 · UT-F stage-land |
| Human land over a blocker | allowed, attributed (`landed_by`) | COV B2 · LED |
| Studio manual: start → approve → land | phase walk with human gates | STU |
| Studio FULL AUTO: extract → matrix → review | chain through the worker, stops AT the land gate | COV D2 · UT-P |
| Review gate exits | approve REFUSED (`GATE_REQUIRES_LAND`) — land or regenerate only | COV D3 |
| Concurrent lands | one consumes the draft, one 409 LAND_BLOCKED | COV D4 |
| Concurrent approves | CAS: one advances, one 409 PHASE_CONFLICT | COV D5 |
| landed → molds → complete | approve dispatches skeleton_architect, then completes | COV D5 |
| Land with nothing staged | 409, never a 500 | COV E3 |
| Trust order on re-run | hitl/verified/override + custom_variables survive; weaker layers update | live proof in session ledger · materialize.ts `keep()` |

## Automation start/end patterning

| Emitter | Pattern | Enforced by |
|---|---|---|
| `ingest.phase_requested` (frontend gates) | START/END pair, trigger payload on the END row | `emitTrigger` helper (single place) · LED §1 |
| `ingest.phase_requested` (pipeline chain hops) | bare END (the OnReviewPhaseRequested precedent) | LED §2 (every one must spawn an instance) |
| `rfp.uploaded`, `ingest.assessment_requested` | START/END pair | LED §1 |
| `ingest.phase_{staged,regenerated,approved,landed,completed}` | SINGLE (audit records) | event-contract guard |
| Every `phase_requested` END | must spawn a workflow instance | LED §2 — the exact silent failure the `phase='single'` bug produced |

## Known non-coverage (explicit, not silent)

- **master_admin as a distinct login** — no usable seeded account (mig 124 rotated it); the role
  shares the exact `hasRoleAtLeast` gate rfp_admin exercises.
- **Adversarial challenge QUALITY** — the sandbox emulator returns stub prose, so the drive
  proves the colour team's wiring, dispatch, reconciliation and recording, not its judgment.
  Persisting per-lens structured challenges is the flagged follow-on once a live key runs it.
- **Scout-fed intake** (`stageIntake` → assist) — shares the assist path proven here; the scout
  queue itself is #176's scope.
