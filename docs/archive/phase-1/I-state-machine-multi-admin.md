# Phase 1 §I — State Machine + Multi-Admin Workflow

**Mini-TODO scope:** Bake the state machine guarantees and the multi-admin coordination rules into the existing `solicitation.*` tools from §E. This isn't a new code surface — it's a refinement pass that adds the constraints making the workflow safe under concurrent admin activity.

**Depends on:** §E (the tools to refine)
**Blocks:** §J (e2e relies on the state machine being safe)

## Why this section exists

The state machine in `curated_solicitations.status` is the contract between admins. Without enforcement at the tool layer, two admins claiming the same row at the same time produces nonsense data, and a curator approving their own work bypasses the review gate. §I closes the race windows and adds the social-engineering guards.

§E already covers the happy path for each tool. §I adds:
1. The atomic UPDATE WHERE clauses that prevent race conditions
2. The cross-actor checks (curator ≠ approver, claimant cannot self-release without claiming first)
3. A test matrix that tries every illegal transition and asserts the right error
4. The `triage_actions` audit row insertion in EVERY state transition (not just the obvious ones)

## Items

- [ ] **I1.** State machine documentation — already in §A2's ARCHITECTURE_V5 addendum, but verify the canonical state list is consistent across:
  - `db/migrations/009_phase1_curation_extensions.sql` CHECK constraint (§B1)
  - `frontend/lib/curation/states.ts` (NEW file) — exports `const SOLICITATION_STATES = [...] as const; type SolicitationState = (typeof SOLICITATION_STATES)[number]`
  - `frontend/lib/curation/transitions.ts` (NEW file) — exports `const VALID_TRANSITIONS: Record<SolicitationState, SolicitationState[]>` mapping each state to the list of states it can transition TO. Used by tools as a safety check before issuing the UPDATE.
  - **Acceptance:** the three sources agree on the 10-state set: `new`, `claimed`, `released_for_analysis`, `ai_analyzed`, `curation_in_progress`, `review_requested`, `approved`, `pushed_to_pipeline`, `dismissed`, `rejected_review` (the 10th is the transient "rejected back to curation_in_progress" state — actually maybe it's not a separate state, just a transition; verify).

- [ ] **I2.** `frontend/lib/curation/transitions.ts` — the canonical transition table:
  ```ts
  export const VALID_TRANSITIONS = {
    new: ['claimed', 'dismissed'],
    claimed: ['released_for_analysis', 'dismissed', 'new'],  // 'new' = release the claim
    released_for_analysis: ['ai_analyzed', 'curation_in_progress'],  // ai_analyzed when shredder finishes
    ai_analyzed: ['curation_in_progress'],
    curation_in_progress: ['review_requested', 'dismissed'],
    review_requested: ['approved', 'curation_in_progress'],  // back to curation if rejected
    approved: ['pushed_to_pipeline', 'curation_in_progress'],  // back to curation if validation fails on push
    pushed_to_pipeline: [],  // terminal
    dismissed: [],  // terminal
  } as const satisfies Record<SolicitationState, readonly SolicitationState[]>;
  
  export function canTransition(from: SolicitationState, to: SolicitationState): boolean {
    return VALID_TRANSITIONS[from].includes(to);
  }
  ```

- [ ] **I3.** `frontend/lib/errors.ts` — add the new error subclasses from §A4:
  - `StateTransitionError` — `INVALID_STATE_TRANSITION`, 409
  - `ClaimConflictError` — `CLAIM_CONFLICT`, 409
  - `ReviewSelfApprovalError` — `SAME_PERSON_REVIEW`, 403 (when a curator tries to approve their own work)
  - All extend `AppError`, all populate `details` with the relevant context

- [ ] **I4.** Refine `solicitation.claim` (E3) — already correct from §E spec, just verify:
  - WHERE clause: `WHERE id = ${id} AND status = 'new' AND claimed_by IS NULL`
  - 0 rows affected → throw `ClaimConflictError`
  - INSERT into `triage_actions` with `from_state='new', to_state='claimed', action='claim'`
  - **Acceptance:** test in `__tests__/tools/solicitation-claim.test.ts` simulates a race by calling claim() concurrently from two `ctx.actor` instances; only one succeeds, the other gets `ClaimConflictError`

- [ ] **I5.** Refine `solicitation.release` (E4):
  - WHERE clause: `WHERE id = ${id} AND status = 'claimed' AND claimed_by = ${ctx.actor.id}`
  - 0 rows affected → throw `StateTransitionError` with details disambiguating "wrong state" vs "wrong actor"
  - INSERTs both a `triage_actions` row AND a `pipeline_jobs` row (atomic in a single transaction — use `BEGIN/COMMIT` via postgres.js's transaction API)
  - **Acceptance:** test verifies (a) wrong actor gets the right error, (b) wrong state gets the right error, (c) the pipeline_jobs row is rolled back if the triage_actions insert fails (transaction integrity)

- [ ] **I6.** Refine `solicitation.approve` (E7):
  - WHERE clause: `WHERE id = ${id} AND status = 'review_requested' AND curated_by != ${ctx.actor.id}`
  - The `curated_by != actor.id` is the social-engineering guard — a curator cannot approve their own work
  - 0 rows affected → look up the row to disambiguate: if `curated_by = actor.id` → throw `ReviewSelfApprovalError`; else throw `StateTransitionError`
  - INSERTs a `triage_actions` row
  - Sets `approved_by = ctx.actor.id, approved_at = now()`
  - **Acceptance:** test seeds a solicitation with `curated_by = userA.id`, calls approve as userA → `ReviewSelfApprovalError`; calls approve as userB → success.

- [ ] **I7.** Refine `solicitation.push` (E9):
  - WHERE clause: `WHERE id = ${id} AND status = 'approved'`
  - Pre-flight validation (BEFORE the UPDATE): query `solicitation_compliance` for the row, verify the required fields are populated (page_limit_technical, font_family, font_size, margins, evaluation_criteria, submission_format). If any are null or empty → throw `ValidationError` with `details: { missing: string[] }`
  - The pre-flight read + UPDATE should be in the same transaction (read with `FOR UPDATE` to lock the row)
  - On success: INSERT triage_actions, call `memory.write` for the procedural memory, emit `finder.rfp.curated_and_pushed`
  - **Acceptance:** test seeds an approved solicitation with missing compliance, asserts push throws `ValidationError`; populates the fields, asserts push succeeds and the memory was written.

- [ ] **I8.** Refine `solicitation.request_review` (E6):
  - WHERE clause: `WHERE id = ${id} AND status = 'curation_in_progress' AND claimed_by = ${ctx.actor.id}`
  - Sets `curated_by = ctx.actor.id` if not already set
  - INSERTs a triage_actions row
  - Optional `requested_reviewer_id` is stored on the row (in a new column `review_requested_for UUID REFERENCES users(id)`, added to the migration in §B1 if not already there)

- [ ] **I9.** Refine `solicitation.reject_review` (E8):
  - WHERE clause: `WHERE id = ${id} AND status = 'review_requested' AND curated_by != ${ctx.actor.id}` (same anti-self-review guard as approve)
  - Required `notes` field stored in the triage_actions row
  - Resets `review_requested_for = NULL`

- [ ] **I10.** Refine `solicitation.dismiss` (E5):
  - WHERE clause: `WHERE id = ${id} AND status IN (...)` — use the `VALID_TRANSITIONS` table to compute which source states allow dismiss
  - INSERTs a triage_actions row with the phase classification in `metadata`

- [ ] **I11.** Universal state-transition test matrix — `frontend/__tests__/scenarios/state-machine-matrix.test.ts`:
  - For each (from_state, action, to_state) tuple in the canonical transition table, write a test that seeds a solicitation in the from_state, calls the action, asserts the transition succeeded
  - For every (from_state, action) pair NOT in the table, write a test that seeds in from_state, calls the action, asserts a `StateTransitionError` with the specific code
  - This is the regression suite for the state machine. ~50 test cases minimum.
  - **Acceptance:** the matrix runs and passes; if a future change breaks the state machine, this is the canary

- [ ] **I12.** Audit timeline reads from triage_actions — add to `solicitation.get_detail` (E2): include the last 50 triage_actions for the row in the response payload, ordered by created_at DESC. The §G9 AuditTimeline component already expects this.
  - **Acceptance:** test seeds a solicitation, performs claim+release+request_review+reject sequence, calls get_detail, asserts the audit history has 4 entries in the right order

## Anti-patterns from Phase 0.5

- ❌ **Don't do read-then-update without `FOR UPDATE` or a WHERE-clause guard.** That's a classic TOCTOU race. The state-machine UPDATEs above all use atomic `WHERE` guards, not read-then-update.
- ❌ **Don't disambiguate errors by querying the row twice.** When the UPDATE affects 0 rows, you usually don't need to know WHY — `StateTransitionError` is enough. The exception is `ReviewSelfApprovalError` where the social-engineering message is genuinely useful, and even then we do a single follow-up read, not a multi-query investigation.
- ❌ **Don't allow a self-review.** This isn't about distrust; it's about catching obvious mistakes. The 0.5 audit philosophy applies — humans also need a peer-review gate.
- ❌ **Don't ship transition logic without the universal matrix test.** The matrix is the only way to know a future tool refactor doesn't break the state machine.

## Definition of Done for §I

- All 12 items checked
- `npx vitest run __tests__/scenarios/state-machine-matrix.test.ts` passes (≥ 50 cases)
- All §E tool tests still pass after the refinements
- `npx tsc --noEmit` exits 0
- `npx next build` exits 0
- Commit message: `feat(phase-1-I): state machine enforcement + multi-admin guards + transition matrix tests`
- `docs/PHASE_1_PLAN.md` Section completion tracker has §I ticked
