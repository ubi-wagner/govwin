# Proposal Studio — the 3-phase gated draft→refine→compliance workflow

**Status:** built 2026-08-02. **Goal:** turn a provisioned proposal into a super-high-quality draft
through **three simple review-and-comment loops** over the agent fabric — **Draft → Refine →
Compliance** — where at each gate the admin either (a) **comments + regenerates** that phase, or (b)
**approves + advances**; or runs **all three automatically** via the doorbell. Every pass lands in
review-staged `canvas_versions` (advisory) and **never auto-locks or submits**.

## Why this shape
`OnFullDraftRequested` Mode C already chains the exact cohorts — plan → seed → draft → format → style
→ cost → package → the continuity/traceability/redaction gate — in ONE un-gated auto run. The Studio
**breaks that into three gated loops** so a human can steer between them, and reuses the *same*
`AI_INVOKE` actions (no new archetypes). It's an orchestration layer, not a new engine.

## The three phases (each a loop over its cohort)
| Phase | Cohort (existing `AI_INVOKE` actions) | The loop produces |
|---|---|---|
| **1 · Draft** | `plan_draft` (proposal_manager) → `seed_suggest` → `draft_all_sections` (section_drafter) | a full first draft grounded on the library atoms |
| **2 · Refine** | `reformat_section` (formatter) → `restyle` (stylist) → `cost_estimate` → `package` | one house style, clean scaffold, cost + assembled package |
| **3 · Compliance** | `check_compliance` (compliance_reviewer) + `check_continuity` + `audit_traceability` + `scan_redaction` (the gate cohort) | requirement coverage, continuity, and redaction findings |

Each phase's agent steps are **advisory** and **independent** (a failing/skipping agent never
dead-ends the loop); with the pipeline `ANTHROPIC_API_KEY` unset they safe-skip and the loop still
advances (the gate still surfaces).

## The gate — comment + regen, or approve
Each phase ends by setting the proposal to `awaiting_review`. The **Studio UI** shows the rendered
document (the existing full-document **preview**) plus a **comment box**, and two buttons:
- **Regenerate with comments** → re-runs *this* phase's cohort, threading the admin's comments as
  `guidance` (the same way `voice` is threaded), producing a new staged version. Stay on the gate.
- **Approve → next** → advances to the next phase (or, after Compliance, to **complete**).

A top-level **Run all 3 automatically** button is the **doorbell path**: it starts phase 1 with
`auto=true`, and each phase auto-chains the next on completion — no human stop, still landing in
review.

## As-built wiring (mirrors OnFullDraftRequested + the doorbell)
1. **State** — `proposals.studio_phase` (`draft|refine|compliance|complete`), `studio_phase_status`
   (`running|awaiting_review`), `studio_auto` (bool). **Migration 144.**
2. **Trigger** — `proposal:review_phase.requested` `{proposal_id, tenant_id, phase, auto, guidance,
   opportunity_id, source}`.
3. **Workflows** — `OnReviewPhaseRequested{Draft,Refine,Compliance}` (three classes sharing the
   trigger, branching on `payload.phase` — the Mode A/B/C pattern; `pipeline/src/workflows/on_review_phase_requested.py`).
   Each runs its cohort (guidance threaded), then one `advance_studio_phase` **ACTION**.
4. **The advance ACTION** (`workflows/actions/studio_actions.py`) — sets `studio_phase` +
   `studio_phase_status='awaiting_review'`, emits `proposal:review_phase.completed`; **if `auto`**,
   emits the next phase's `review_phase.requested` (chaining); after Compliance sets `complete`. It
   owns the phase state machine (orchestration state, not content — never writes a business content
   table).
5. **Routes** — `POST /api/portal/[t]/proposals/[p]/studio` `{action: 'start'|'regenerate'|'approve',
   guidance?, auto?}` (tenant_admin+; admins via shadow). All go through one `requestReviewPhase`
   helper (single audit path, `source`), emitting `review_phase.requested` for the right phase.
6. **UI** — `components/portal/proposal-studio.tsx`: the 3-step gated wizard (phase stepper + the
   full-document preview + comment box + Regenerate/Approve, or Run-all-automatically), on the
   proposal page. `GET .../studio` returns the current phase/status for the wizard.

## Safety (same contract as the rest of the fabric)
- **Advisory only** — every output lands in review-staged `canvas_versions`; the Studio **never**
  advances a proposal STAGE, locks a section, or submits. "Complete" means *drafted + reviewed*, not
  *submitted*.
- **Auto ≠ auto-submit** — auto-chaining runs the three *refinement* loops back-to-back; the result
  still sits in review for a human to lock/submit. It advances refinement passes, not gates.
- **Auditable** — every start / regenerate / approve / phase-completed / auto-chain posts to
  `system_events` (+ `proposal_activity_log`), `source` distinguishing `studio_portal` vs
  `studio_doorbell`. Visible in `/admin/events`.
- **Injection-fenced, runaway-bounded, safe-skip** — inherited from the fabric (the reused agents).

## Deploy-gate
The loop plumbing, gates, comment→regen, auto-chain, state, and audit run in the sandbox. The agent
*content generation* is deploy-gated on the pipeline `ANTHROPIC_API_KEY`, exactly like every agent —
unkeyed, the AI_INVOKE steps safe-skip and the phase still advances to its gate.
