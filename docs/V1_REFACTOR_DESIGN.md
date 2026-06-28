# V1 Orchestration Refactor — Target Design, Migration & Task List

**Decision:** a **scoped refactor of the orchestration/status/card/workflow layer** — *not* a rewrite,
*not* the additive bolt-on. Keep the proven primitives (engine runtime, tenant isolation, canvas/
artifacts, task ledger, gate/lock machine, ingest/shred). Lift orchestration OUT of the three
discrete subsystems INTO one `opportunity_id`-keyed **workflow instance** that **owns status** and
**carries the card**. Grounded in the 6-auditor review (`V1_WORKFLOW_ARCHITECTURE.md`,
`V1_LIFECYCLE_ARCHITECTURE.md`).

> **The one principle:** there must be **one process state machine** (the instance), and the
> subsystem status columns (`proposals.stage`, `curated_solicitations.status`,
> `tenant_pipeline_items.pursuit_status`) become **derived projections it keeps in sync within the
> same transaction** — never independent state machines. That single decision is the difference
> between the clean architecture and the four-source-of-truth kludge.

---

## 1. Target object model

### 1.1 The instance (extend `process_instances` — reuse the engine machinery)
The runtime per `(opportunity_id, scope, owner)`. New columns:
- `opportunity_id UUID` (indexed) — the immutable spine key (carried across every bridge).
- `scope TEXT CHECK ('opp'|'spotlight'|'project'|'contract')` — the layer.
- `entity_ref UUID` — the owning domain row (`curated_solicitations.id` for opp, the
  `tenant_pipeline_items.id` for spotlight, `proposals.id` for project, `contracts.id` for V2).
  (`tenant_id` already exists; null for opp/global.)
- `card_snapshot JSONB` — the **forward-carried** card layers (L0 inherited at fork, frozen) +
  derived pointers. The live status comes from the instance's own `status`/`current_step`.
The instance's `status` + `current_step` are the **authoritative process state**. The domain row gets
a back-reference (`proposals.instance_id`, etc.).

### 1.2 The card (persisted, layered, forward-carried)
The card the UI renders = **`instance.card_snapshot` (frozen L0/L1 it inherited) + the instance's
live status/step + a thin domain projection**. At each fork the parent's card layer is **copied into
the child's `card_snapshot`** (so a later master edit/close does not mutate the child's audit). The
audit trail of step results / HITL waits / uploads / reviews is the instance's transitions +
`system_events` (already `:start`→`:end`). No re-render-from-three-tables.

### 1.3 The generic template
**One `ProjectCollaboration` template** (payload-parameterized; modeled on `OnCmsContentRequested`).
Its step set is config, each step's `actor` is `human(role) | agent(archetype) | system` (swappable).
Run as three configs (opp/spotlight/project) + the V2 execution config. The existing bespoke `On*`
classes are **demoted to thin bridges/launchers** (they create/advance instances on a business
event) — they do not own lifecycle.

### 1.4 Status single-source-of-truth (the crux)
The advance/lock machine is reframed: **advancing a gate = advancing the project instance**, which
*as a same-transaction side effect* writes `proposals.stage`, locks sections, and freezes snapshots.
`proposals.stage` etc. stay as **denormalized reads** the instance keeps current — never updated
independently. Gate guards (all required sections locked, etc.) become the instance step's
precondition. One machine; the columns are projections.

### 1.5 The rollup
`v_opportunity_rollup` = `GROUP BY opportunity_id` over
`opportunities ⋈ tenant_pipeline_items ⋈ proposals ⋈ process_instances` → opp→bucket→project(→
contract) status, free. (= control-plane F3.)

---

## 2. Migration path — staged, each phase independently shippable + reversible

| Phase | What | Behavior change? | Reversible? |
|---|---|---|---|
| **R0 — additive keying** | mig: instance `opportunity_id`/`scope`/`entity_ref`/`card_snapshot`; `proposals.instance_id`; indexes; the rollup view. Backfill: one `project` instance per existing proposal (status mirrors `proposals.stage`); populate `card_snapshot`. | **None** (columns populated, gate machine still authoritative) | Yes (drop columns/view) |
| **R1 — dual-write shadow** | the advance/lock machine ALSO advances the project instance (shadow); a consistency check asserts `instance.step == proposals.stage`. | None (instance is a shadow) | Yes (stop writing the shadow) |
| **R2 — cutover** | flip source of truth: the **instance drives**; `proposals.stage` becomes a derived write of the instance transition; reads move to the instance/rollup; gate guards become instance-step preconditions. Gated by R1 showing 100% agreement on the live-PG harness. | **Yes** (the real cutover) | Yes-with-care (feature flag; revert reads to `proposals.stage`, which R1 keeps current) |
| **R3 — generic template + param store** | one `ProjectCollaboration` template; `process_templates.definition` JSONB param store; the bounded process-builder writes it; reaction workflows → bridges (`purchase.completed`→project instance; `solicitation.pushed`→spotlight instance); add the opp + spotlight instances. | Additive (project lifecycle now template-driven) | Yes (keep the bespoke path behind a flag during bake) |
| **R4 — card persistence + UI** | persist the layered card forward-carry at each fork; Tabs primitive + `opportunity-card` + tab-lock; rollup page; spotlight lock/archived states. | Additive UI | Yes |
| **R5 — local automation on the spine** | the W-track lands on the clean spine: `createTask`+process-builder, typed completers, nudge→login-email, CC-manager, `ScheduleTrigger`+date-anchor sweeper, pin→nudge, task timeout/retry fix, access↔task binding, E5 strawman, 72h HITL gate. | Additive | Yes |
| **R6 — V2 contract scope** | the contract-execution config of the same template + card; `outcome.recorded(win)`→fork a `contract` instance seeded from the proposal. | Additive (new scope) | Yes |

**Why this order is safe:** R0/R1 are zero-behavior shadows (the instance is populated + kept in
sync but not yet authoritative), so the risky cutover (R2) only flips reads *after* R1 has proven the
shadow agrees on real data. Everything is flagged + reversible.

---

## 3. Detailed task list (R-track) — each with acceptance + 3-factor test

**3-factor test standard (every task):** (1) **unit/route test** (vitest/pytest), (2) **live-PG
apply + functional query** on the throwaway DB, (3) **independent adversarial review** (agent) of the
diff before merge. A task is "done" only when all three pass.

### R0 — Additive keying (zero behavior change)
- **R0.1** mig `088`: `process_instances += opportunity_id (idx), scope (CHECK), entity_ref, card_snapshot JSONB`; `proposals += instance_id (FK)`. **Accept:** chain applies clean fresh; columns nullable; no existing query changes. **3f:** schema test · live-PG apply · review.
- **R0.2** backfill mig: one `project` instance per existing proposal (`opportunity_id` from the proposal, `status` mirroring `stage`, `entity_ref`=proposal.id), set `proposals.instance_id`; idempotent (`WHERE instance_id IS NULL`). **Accept:** every proposal has exactly one instance; re-run is a no-op. **3f:** backfill test · live-PG re-run idempotency · review.
- **R0.3** `v_opportunity_rollup` view (`GROUP BY opportunity_id`). **Accept:** opp→bucket→project counts/stages roll up correctly on seeded data. **3f:** query test · live-PG · review.
- **R0.4** `lib/cards/card.ts` — assemble the card read-model from instance + domain projection (no behavior change; new read path). **Accept:** card matches today's rendered fields. **3f:** unit · live-PG · review.

### R1 — Dual-write shadow
- **R1.1** `advanceProposalStage` + section-lock route also advance the project instance (shadow write, same txn). **Accept:** every stage change advances the instance; instance never authoritative yet. **3f:** advance/lock tests assert the shadow · live-PG · review.
- **R1.2** consistency assertion + a reconciliation report (`instance.current_step` ↔ `proposals.stage`). **Accept:** 100% agreement across a seeded full-lifecycle run. **3f:** lifecycle test · live-PG report = 0 drift · review.

### R2 — Cutover (flagged)
- **R2.1** behind `INSTANCE_AUTHORITATIVE` flag: instance drives; `proposals.stage` written as a derived side-effect of the transition; reads (status/queue/rollup) switch to the instance. **Accept:** with flag on, behavior identical to R1; with flag off, unchanged. **3f:** full advance/lock/section suite green under both flag states · live-PG lifecycle · adversarial review of the flip.
- **R2.2** gate guards reframed as instance-step preconditions (all-required-locked, gate_config order, force-override audit). **Accept:** every prior gate test passes through the instance path. **3f:** the 50+ advance/lock vitest green · live-PG · review.

### R3 — Generic template + param store + bridges
- **R3.1** `ProjectCollaboration` generic Workflow (payload-parameterized steps; actor swappable). **Accept:** runs a 1-gate and a 3-gate config from payload; agent-or-human step parity. **3f:** pytest matrix · live-PG instance run · review.
- **R3.2** `process_templates.definition JSONB` + the param store + `launchTemplate` reads it. **Accept:** an admin overlay produces the right instance config. **3f:** unit · live-PG · review.
- **R3.3** bridges: `purchase.completed`→project instance (retire the phantom + dead lock-route completer); `solicitation.pushed`→spotlight instance; chain via final-step business events carrying `opportunity_id`. **Accept:** purchase fires a real project instance; no phantom. **3f:** webhook/create test · live-PG event chain · review.
- **R3.4** opp + spotlight instances (the other two scopes of the template). **Accept:** ingest/push create opp+spotlight instances keyed by `opportunity_id`. **3f:** pytest · live-PG · review.

### R4 — Card persistence + UI
- **R4.1** persist forward-carry: copy parent card layer into child `card_snapshot` at each fork (`proposals.origin_card` + `source_bucket`). **Accept:** child card frozen against later master edits. **3f:** fork test · live-PG immutability check · review.
- **R4.2** `components/ui/tabs.tsx` + `opportunity-card.tsx` + tab-lock (model on `stage-control`). **Accept:** 3 layered tabs, prior-tab read-only + click-back. **3f:** component test · manual run · review.
- **R4.3** `/admin/opportunities` rollup page on `v_opportunity_rollup`. **Accept:** opp→bucket→project tree. **3f:** route test · live-PG · review.
- **R4.4** spotlight lock/archived states (lock on pin/purchase; `lifecycle_status` guard → "archived, contact your admin"). **Accept:** purchased/archived cards lock + redirect. **3f:** route/UI test · live-PG · review.

### R5 — Local automation on the spine (the W-track, now clean)
- **R5.1** `createTask` core + admin/employee task-assign route + the bounded process-builder (writes the R3.2 param store). 
- **R5.2** typed completers (upload-named-docs / review-section / answer-question) bound to `completeTask`; HITL-as-upload.
- **R5.3** `ScheduleTrigger` + date-anchor sweeper (purchase→RFP→interim→close; +30 archive).
- **R5.4** nudge→login-email rule + role→email + task-nudge template; CC-manager (`users.manager_id` + Cc; branch on nudge #).
- **R5.5** task timeout/retry fix (sweep `due_at`→expired/retry; reconcile task↔instance deadlines).
- **R5.6** pin→nudge workflow (close_date-anchored).
- **R5.7** access↔task binding + E13 per-document grants.
- **R5.8** E5 3-source strawman + `publish_section_draft`; the 72h HITL gate as a `ProjectCollaboration` step.
- Each: acceptance + the 3-factor test standard.

### R6 — V2 contract scope (fast-follow)
- **R6.1** `contracts` table + `contract` scope config of the template; `outcome.recorded(win)`→seed a contract instance from the proposal (timelines/SOW/collaborators/artifacts). **Accept:** a win forks a contract instance reusing the same card+engine. **3f:** pytest · live-PG · review.

---

## 4. Risk register + rollback
- **R2 cutover is the only behavior-changing step** → gated behind `INSTANCE_AUTHORITATIVE` + R1's
  proven 0-drift; rollback = flip the flag (reads revert to `proposals.stage`, which R1 keeps
  current). 
- **Backfill (R0.2)** → idempotent + a count assertion (every proposal ↔ exactly one instance).
- **Generic template (R3)** → bespoke `On*` path stays behind a flag during bake; instances are
  additive until R3.3 retires the phantom.
- **No subsystem rewrite** → ingest/shred/canvas/isolation/gate-logic untouched; the refactor is the
  orchestration seam only.

## 5. Why this is the best solution (not the kludge)
- **One state machine** (the instance) → no four-source sync; the rollup is a `GROUP BY`, not a
  reconciliation.
- **Config-driven workflows** → extensible + agent-swappable without code; V1 and V2 share the
  template/card/engine.
- **Forward-carried persisted card** → audit is immutable per fork; master edits don't rewrite
  history.
- **Bounded + reversible** → keeps every proven primitive; the only cutover is flagged and shadow-
  verified first.
