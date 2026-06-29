# V1 Orchestration Spine — Corrected Design (post 3-factor review)

> ## BUILD STATUS (2026-06-29) — R-track delivered end-to-end (13 commits, branch `claude/nice-hamilton-kBqtD`)
> Every increment 3-factor validated (unit/route · live-PG drive on a real PG · independent adversarial review).
> Migration chain 001→091 applies clean; frontend suite + pipeline workflow/task suite green.
>
> | Track | What shipped | 
> |---|---|
> | **R0** spine | `opportunity_id`+`scope` key on `process_instances` (mig 088) · `v_opportunity_rollup` (domain tables) · `proposals.origin_card` freeze (mig 089) + `getProposalCard` read-model · `/admin/opportunities` |
> | **R3** template+bridges | generic `ProjectCollaboration` reaction (overlay-driven HITL gate) · `create_instance` keys the spine · `launchProjectCollaboration` canonical launcher · create-route + Stripe-webhook bridges (**phantom retired, purchase.completed orphan closed**) |
> | **R4** card UI | `Tabs` primitive · `OpportunityCard` (frozen origin / live compliance) on the workspace |
> | **R5** automation | J1 delegation (`createTask`+assign) · W-N/O nudge→login-email + manager escalation + `/go` landing · J2 date-anchored generation · W-M typed completers · W-Q pin→nudge · W-P past-due expiry · E5 `publish_section_draft` landing primitive |
> | **R6** V2 | `contracts` table (mig 091) keyed by `opportunity_id` · win → seed contract + contract-scope kickoff gate |
>
> **Pre-existing bugs caught by the live-PG factor + fixed:** P1 `create_instance` ON CONFLICT vs the partial dedup index (every launch threw on a fresh deploy) · `_create_task` literal-path corruption · R0.3 jsonb-string read nuance (gap report §K).
>
> **Two large features remain (each warrants its own focused effort — see end of §4):** the 3-source AI **generation** (the `section_drafter`/`proposal_architect` workforce, "built but not yet wired" — it lands via the shipped `publish_section_draft`); and **E13 document-level access control** (an ACL subsystem that needs the access-model decisions — the Expert shadow-identity + per-document grants).

**This supersedes the R1/R2 status-cutover draft.** A 3-factor adversarial design review (soundness ·
migration-safety · best-vs-simpler) **converged unanimously**: *do not make a workflow instance own
status.* The proposal already owns its status correctly (OCC `version`, the all-locked gate,
force-override audit, auto-advance+lock, `stage_completion_snapshots`/`canvas_versions` freezes); the
master opp owns `curated_solicitations.status`; the pipeline item owns `pursuit_status`. Those are
**different statuses for different objects**, not duplicates — the real need is **one spine *key*
(`opportunity_id`), not one state *machine*.** The best solution is the **lean additive spine**, which
is what the original six-auditor review concluded ("a bounded additive unification layer, **not** a
refactor"). No status cutover, no per-proposal instance backfill, no new status table.

> **The one principle (corrected):** the **gate machine stays authoritative for the transition
> decision**; the **workflow instance is the ephemeral reaction/automation runtime that *references*
> status (via events) and reacts** — it never owns or drives it. `opportunity_id` unifies the *reads*.

---

## 1. The corrected model

1. **Status stays in the domain — each object owns its own.** `proposals.stage` (project build),
   `curated_solicitations.status` (curation 12-state), `tenant_pipeline_items.pursuit_status`
   (triage). `advanceProposalStage` is **untouched** — it remains the proven, transactional,
   OCC-locked, snapshot-freezing primitive.
2. **`opportunity_id` is the spine key.** Already present on `proposals`, `tenant_pipeline_items`,
   `curated_solicitations`. Add it (+ a `scope` discriminator) to `process_instances` so *automation
   runs* are opp-linked for chaining + the control tower — **not** to own status.
3. **The rollup is over the DOMAIN tables.** `v_opportunity_rollup = GROUP BY opportunity_id` over
   `opportunities ⋈ tenant_pipeline_items ⋈ proposals` — status read directly from each domain
   column. **No `process_instances` join for status** → no N:1 fan-out (a proposal already spawns
   several automated instances; joining them would multiply counts).
4. **The instance = the ephemeral reaction/automation runtime; it references status, never owns it.**
   Generalize the *existing* `OnProposalAdvancedToReview` pattern (it `wait_for`s `proposal.advanced`
   and parks a HITL ToDo, reading `stage` from the event payload) into ONE generic
   `ProjectCollaboration` template: launched on bridge events, drives HITL/tasks/nudges/agent steps,
   **reads** `proposals.stage`. Runs are **transient** (park at a gate → complete) — exactly what the
   manager's sweeps are designed for; **no weeks-long `running` row** (which the 5-min stuck-sweep
   would reap — the same phantom we already removed).
5. **The card = a read-model + a persisted forward-carried `origin_card` snapshot** for audit
   immutability. **The compliance matrix renders LIVE** (it is mutable via amendments — freezing it
   would understate the burden); only truly-immutable fields (format spec, bucket score, origin doc
   links, the opp summary at fork) are frozen.
6. **Spotlight stays *data*** (`tenant_pipeline_items`: score + pin + `pursuit_status`) — **not** a
   per-`(tenant,opp)` instance (that would be thousands of rows hammering the heartbeat/sweep loops
   for a one-INSERT "lifecycle"). `pin→nudge` = a dated `tasks` row.
7. **V2** = the same generic template + card at **contract-execution scope**; a win seeds a contract
   instance from the proposal's accumulated plan/SOW/collaborators/artifacts.

### Why this is the best solution (not a kludge, not over-engineering)
- **One spine key** unifies the reads (`GROUP BY opportunity_id`) without forcing one state machine —
  each domain keeps its correct, single owner of its own status.
- **The instance does what the engine is good at** (transient HITL/automation reactions), reusing the
  task ledger / park-resume / nudges / crash-recovery already bound to `process_instances` — no new
  table to orphan them.
- **Zero behavior change to the proven primitives** (advance/lock/gate/snapshot, ranking, isolation,
  ingest/shred, canvas). The spine is purely additive.

---

## 2. The 7 review flaws → all dissolved by the lean model
| # | Flaw (in the cutover draft) | Resolution |
|---|---|---|
| 1 | `proposals.stage` has reverse + multi-entry writers (unlock `submitted→final`, outcome `→archived`, parallel `stage/route`) the engine's forward-only step model can't express | **N/A** — the gate machine keeps owning `stage`; the instance only records/reacts |
| 2 | instance `status` CHECK is disjoint from `stage` CHECK (liveness vs position) | **N/A** — no instance status mirrors `stage` |
| 3 | a long-lived project instance is force-failed by the 5-min stuck-sweep (the removed phantom) | **N/A** — reaction runs are transient (park→complete), correctly swept |
| 4 | "advancing a gate = advancing the instance" mismaps a transactional 422-returning gate onto the engine's async step list | **Inverted** — gate stays the synchronous authoritative decision; instance reacts |
| 5 | rollup `⋈ process_instances` fans out N:1 (a proposal spawns many automated instances) | **Resolved** — rollup is over domain tables only (no instance status join) |
| 6 | dual-write double-advances the instance (the lock route *calls* `advanceProposalStage`) | **N/A** — no dual-write |
| 7 | frozen `card_snapshot` compliance matrix vs live `proposal_compliance_matrix` enforcement → understates burden after an amendment | **Resolved** — compliance renders in the LIVE tier; only immutable fields frozen |

---

## 3. Migration — additive only, staged, reversible (no cutover, no landmine)
| Phase | What | Behavior change? | Risk |
|---|---|---|---|
| **R0 keying + rollup + card read-model** | mig 088: `process_instances += opportunity_id (idx) + scope`. `v_opportunity_rollup` (domain tables). `lib/cards/card.ts` read-model + `proposals.origin_card`/`source_bucket` snapshot (frozen origin; compliance LIVE). **No per-proposal instance backfill.** | None | Trivial (additive cols + a view) |
| **R3 generic template + param store + bridges** | one `ProjectCollaboration` template (payload-parameterized reaction workflow, generalizing `OnProposalAdvancedToReview`); `process_templates.definition` JSONB param store; bridges (`purchase.completed`→project reaction — retire the phantom + the dead lock-route completer; chain via business events carrying `opportunity_id`) | Additive (new reaction workflows; bespoke `On*` stay behind a flag during bake) | Low — transient runs, correctly swept |
| **R4 card UI** | `components/ui/tabs.tsx` + `opportunity-card.tsx` + tab-lock (model on `stage-control`); `/admin/opportunities` rollup page; spotlight lock/archived states | Additive UI | Low |
| **R5 local automation on the spine** | `createTask`+process-builder (J1) · typed completers + HITL-as-upload (W-M) · `ScheduleTrigger`+date-anchor sweeper (J2/W-L) · nudge→login-email + CC-manager (W-N/O) · task timeout/retry fix (W-P) · pin→nudge (W-Q) · access↔task binding + E13 (W-T) · E5 3-source strawman + `publish_section_draft` · the 72h review as a `ProjectCollaboration` HITL step (W-S) | Additive | Low (each behind the standard test gate) |
| **R6 V2 contract scope** | `contracts` table + contract config of the template; `outcome.recorded(win)`→seed a contract instance from the proposal | Additive (new scope) | Low |

**Gone from the prior draft:** ~~R1 dual-write shadow~~, ~~R2 status cutover~~, ~~per-proposal instance
backfill~~, ~~`INSTANCE_AUTHORITATIVE` flag~~, ~~the 0-drift reconciliation harness~~, ~~`proposals.instance_id` as an owned-status link~~.

---

## 4. R-track task list (each: acceptance + 3-factor test = unit/route test · live-PG apply · independent agent review)
### R0 — keying + rollup + card (zero behavior change)
- **R0.1** mig 088: `process_instances.opportunity_id (idx)` + `scope TEXT CHECK('opp'|'spotlight'|'project'|'contract')` (nullable; linking only). **Accept:** chain 001→088 applies clean fresh; no existing query changes; sweeps unaffected (we never create long-lived rows). **3f:** schema test · live-PG · review.
- **R0.2** `v_opportunity_rollup` = `GROUP BY opportunity_id` over `opportunities ⋈ tenant_pipeline_items ⋈ proposals` (status from domain columns; per-stage proposal counts; pinned/pursuit; lifecycle_status). **Accept:** opp→bucket→project rolls up on seeded data; no instance join. **3f:** query test · live-PG · review.
- **R0.3** `proposals.origin_card JSONB` + `source_bucket TEXT`; populate in the create txn from the L0 summary + L1 bucket; **compliance NOT included (rendered live)**. `lib/cards/card.ts` assembles the card = origin snapshot + live domain projection. **Accept:** card shows frozen origin + live stage + **live** compliance. **3f:** unit (frozen-origin immutability + live-compliance) · live-PG · review.
- **R0.4** `/admin/opportunities` rollup page on the view. **Accept:** opp→bucket→project tree. **3f:** route test · live-PG · review.

### R3 — generic template + bridges (engine-grounded after the live map)
> **Engine reality (verified, 8-point map):** the live engine is `processor` hosting `WorkflowManager`;
> a launch FREEZES the trigger event's payload as the per-instance **overlay**; **steps are STATIC class
> attributes** (there is NO `process_templates.definition` column and no dynamic-step machinery — the
> catalog is on/off + audit only); a `TODO` step parks (`status='paused'`) and writes a `tasks` row whose
> fields all resolve from the overlay; `Step.condition` is **ignored** for TODO on the Manager path
> (skip via a `CONDITION` step + `depends_on`, or the trigger lambda). So the generic template is
> **one static reaction shape, parameterized by the overlay** — NOT a per-launch dynamic step graph.
> The faithful unit is **one transient gate per launch, launched reactively** (one gate per stage event),
> not one long instance pre-chaining all stages.

- **R3.1** ✅ `ProjectCollaboration` generic Workflow — trigger `proposal:project.collaboration_requested:single`
  (launchable via `launchTemplate`); a single overlay-parameterized HITL `collaborate` TODO (assignee/
  type/title/entity/nudges/due all `payload.X`) + `notify_done`. References `proposals.stage` via payload,
  never writes it. Transient park→resume→complete. **Engine (additive):** `create_instance` now keys the
  spine — writes `opportunity_id` + validated `scope` from the overlay (mig 088 cols, previously unset);
  `execute_instance` lets `payload.parkMinutes` override the park ceiling (decoupled from the task's
  `dueMinutes`). **Bugs found+fixed (gap report K3/K4):** P1 — the `ON CONFLICT` could not infer the
  PARTIAL dedup index → every launch threw (predicate restated); P2 — `_create_task` literal-path
  fallback wrote corrupt tasks (`r_or_none` guard). mig 090 pre-seeds the catalog row. **Done:** pytest
  10/10 · live-PG drive 20/20 · independent review SHIP.
- **R3.2** (REFRAMED to engine reality) — **overlay-DEFAULTS, not dynamic steps.** The per-program gate
  config (assignee/nudges/due/parkMinutes) is supplied IN the launch overlay; a launcher helper merges
  sensible code defaults. A `process_templates.definition` JSONB to let an admin EDIT those defaults +
  a bounded builder UI is a **DEFERRED nicety** (R5/roadmap), not on the deploy-now path — the bridges
  build the overlay directly. (No engine change; the frozen payload already IS the param store.)
- **R3.3** ✅ bridges via ONE canonical entry point `lib/process/project-collaboration.ts:launchProjectCollaboration`
  (guards required overlay fields so a bridge can never write a corrupt/unassigned task; both bridges call it):
  (a) the create-route launches the `admin_review` gate (scope='project') — replacing the `AdminProposalSetup`
  PHANTOM comment with the real registered HITL gate; (b) the Stripe webhook launches a `proposal_setup`
  gate (scope='opp', system-attributed) on an opportunity purchase — **closing the `purchase.completed`
  orphan (W-D)**; (c) the dead lock-route completer deleted. `launchTemplate` gained `actorType` (system
  bridges) + `LaunchActor.role` optional. **Done:** unit 7/7 (overlay build + incomplete-launch guard) ·
  live-PG event chain 10/10 (catalog gate → real trigger match → create_instance keys spine →
  rfp_admin gate parks) · full frontend suite 500/500 · independent review.

### R4 — card UI · R5 — local automation · R6 — V2
(as the table above; each task carries acceptance + the 3-factor standard; R5 items are the W-track,
now landing on the clean spine.)

---

## 5. Risk register (now minimal — all additive)
- **No behavior-changing step remains.** The only thing touching the advance path is R3.3's bridge,
  which *reacts to* `proposal.advanced` (as `OnProposalAdvancedToReview` already does) — it does not
  change the advance.
- **No backfill of long-lived instances** → no sweep collision, no production mass-fail.
- **`process_instances` semantics preserved** → reaction runs stay transient; the manager's sweeps
  keep doing their correct job on the ephemeral automated jobs they were built for.
- **Subsystems genuinely untouched** (advance/lock/gate, ranking, isolation, ingest/shred, canvas) —
  this time the claim holds because the gate machine is *not* relocated.

## 6. Recommended first build
**R0.1 + R0.2** — the `opportunity_id`+`scope` key on `process_instances` and the
`v_opportunity_rollup` view. Trivial, additive, zero-risk, and it delivers the project-status rollup
(control-plane F3) immediately while unlocking the bridges (R3) and the card (R4). Everything else
hangs off the key and the rollup, with status staying exactly where it correctly lives today.
