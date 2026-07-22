# START_END_FRAMEWORK.md — the embedded start→end spine (bridge · engine · agent-automation)

**Status:** as-built, proven against the live tree at migration **129** (every `file:line` below was
read, not remembered). This is the canonical map of *how work starts and ends at three nested depths*,
*every message that crosses the bridge in both directions*, and *every trigger→step→trigger chain* the
declarative engine runs — written so a **compliance domain** can be layered on without re-deriving any of it.

Design-of-record companions (this doc supersedes their spine framing where they disagree — see §9 drift):
`docs/AUTOMATION_SPINE_MAP.md` (engine), `docs/MASTER_MIRROR_OPP_DESIGN.md` (bridge),
`docs/AUTOMATION_POLICY_DESIGN.md` (#190 grammar), `docs/AGENT_WORKFORCE.md` (agents).

---

## 0. The one-paragraph model

Work is **three nested start→end loops joined by one ledger (`tasks`)**, riding **two cooperating
subsystems**. The **outer** loop is a *project portal* — a `proposal_portals` row with its own status
machine (`curation_pending → launched → executing → closeout → archived`). Inside it, each **phase**
(P0, P1, … — “Draft / Review / Final”) is a *stage* in `guardrail_config.stages[]`, cursored by
`current_stage_index` and advanced only when **all its `tasks` are done**. Inside a phase, an **intrastep
1:N fan-out** (e.g. `draft_v0` drafting every empty section) starts and ends within a single `ACTION` step,
bounded by a `*.completed:start(N)` … `:end(drafted,skipped)` event pair. Around all of this the **Python
declarative engine** (`process_instances`) runs *transient* reactions — one short-lived instance per event
or gate, never a weeks-long row — and the **master↔mirror bridge** feeds opportunities in (forward-only)
and routes an admin back down (ToDo + shadow). Every beat is a **row** (`system_events`,
`process_instances`, `process_instance_transitions`, `tasks`), so “did it start / complete / complete-before-
the-nudge” is always answerable from the database. **This is the surface compliance extends: a new phase, a
new 1:N step, a new trigger, or a new gate all plug into the exact seams named in §8.**

```
┌─ proposal_portals row ─────────────────────────────────────────────────────── OUTER: the portal
│   status: curation_pending → launched → executing → closeout → archived|abandoned
│   ┌─ guardrail_config.stages[i]  (current_stage_index) ───────────────────────  MIDDLE: a phase (P0,P1…)
│   │   advance gate = ALL open tasks WHERE params.stage=key are done
│   │   ┌─ ACTION step: draft_v0 (or any *.completed:start/end) ─────────────────  INNER: intrastep 1:N
│   │   │   emit proposal:draft.completed:start (sections=N)
│   │   │     for each section:  section_drafter → markdown_to_canvas → publish_section_draft
│   │   │   emit proposal:draft.completed:end (drafted, skipped)
│   │   └───────────────────────────────────────────────────────────────────────
│   └───────────────────────────────────────────────────────────────────────────
└──────────────────────────────────────────────────────────────────────────────
        ▲ fed forward by the bridge (Release 1 discovery + Release 2 build)
        ▼ backflow: ToDo → RFP-admin shadow-descent  (content never flows up)
```

**Two subsystems, one ledger.** Do not conflate them (the historical doc did — §9/D5):

| Subsystem | Owns | State lives in | Driven | Where |
|---|---|---|---|---|
| **Python declarative engine** | transient event reactions, AI steps, HITL parks, nudges | `process_instances` + `process_instance_transitions` + `tasks` | event-driven (poll) | `pipeline/src/workflows/` |
| **Frontend portal phase-machine** | the portal lifecycle + phase advance | `proposal_portals` (`status`,`current_stage_index`) + `guardrail_config` + `tasks` | imperative (route calls) | `frontend/lib/` |

They **meet at the `tasks` ledger**: the phase-machine writes stage ToDos into `tasks`; the engine’s
time-sweeper nudges/escalates those same `tasks`; completing a task can both advance a phase (frontend gate)
and resume a parked engine instance (`complete_task → resume_instance`).

---

## 1. The start→end gate (the atom of the whole system)

Every discrete operation emits a **two-phase event pair** on `system_events`: a `phase='start'` and a
`phase='end'` (or a single `phase='single'` for atomic signals). Triggers match a specific phase, and a
**failed** operation still emits a terminal `end` with `error` set + empty payload — which the matcher
**refuses** so failures never spawn junk instances (`pipeline/src/workflows/base.py:64-78`, `:70`).

**A workflow instance starts** when the processor’s 10-second poll finds a `system_events` row matching a
registered trigger (`processor.py:628-644`; self-trigger exclusion `AND NOT (namespace='system' AND type
LIKE 'workflow.%')` at `:639`; 5-min cold-start lookback `:620-624`). Match → `create_instance`
(`manager.py:138-249`) writes one **`process_instances`** row.

**The running-instance table `process_instances`** (`db/migrations/043_process_instances.sql:5-58`) is the
engine’s state atom:

| Column | Role | Cite |
|---|---|---|
| `workflow_name` | = the `Workflow` subclass; 1:1 to the `process_templates` catalog | 043:7 |
| `trigger_event_id` FK→`system_events` | the start event; **dedup** | 043:8 |
| `status` CHECK `pending\|running\|paused\|completed\|failed\|cancelled\|retrying` | lifecycle | 043:12-13 |
| `current_step`, `current_step_index` | cursor within the step DAG | 043:14-15 |
| `step_results`, `step_status` jsonb | per-step accumulator (crash recovery) | 043:18-19 |
| `deadline`, `last_heartbeat_at` | HITL park clock / liveness | 043:24-25 |
| `payload` jsonb | the frozen trigger overlay (launch inputs) | 043:38 |
| `opportunity_id`, `scope` (`opp\|spotlight\|project\|contract`) | the mig-088 spine key (nullable, additive) | `088_opportunity_spine.sql:10-13`; written `manager.py:180-182,211-212` |
| **UNIQUE `(workflow_name, trigger_event_id)`** | idempotent spawn — one instance per (template,event) | 043:57-58; ON CONFLICT `manager.py:198-199` |

**A workflow instance ends** when `execute_instance` has run every step in topological `depends_on` order
(`base.py:295-313`), sets terminal `status` + `completed_at`, records a `process_instance_transitions` row,
and emits `system:workflow.instance_{completed|failed|cancelled}` (`manager.py:670-702`). Terminal states are
also reached by the time-sweeper (heartbeat / pending-TTL / paused-deadline — §5).

**The gate is derived, never held.** Every status change writes a `process_instance_transitions` row
(`manager.py:1992-2019`; table `043:61-71`) plus a single-phase `system:workflow.*` event (`_emit_event`
forces `phase='single'`, `manager.py:2021-2042`). So *start / complete / complete-before-nudge* are all
answerable from `{system_events, process_instances, process_instance_transitions, tasks}`.

**Human gates park the instance.** `TODO` and `HITL_WAIT` steps set `status='paused'` with a `deadline`
(`payload.parkMinutes` → step `timeout_minutes` → 1440 default, `manager.py:491-547`); a `TODO` additionally
writes a `tasks` row (`_create_task`, `manager.py:839-959`). **Resume is entity-correlated**:
`match_waiting_instances` (`manager.py:1425-1479`) wakes a paused instance when a later event satisfies the
parked step’s `wait_for` **and** shares entity keys (`_event_correlates` — `proposalId, userId, sourceId,
opportunityId, sectionId, contentId, tenantId`, `manager.py:1486-1505`); task completion resumes via
`complete_task → resume_instance` (`manager.py:961-1009, 1333-1423`), which sets `status='retrying'` so
`poll_retrying_instances` (`manager.py:1518-1532`) re-drives from the next step.

**The engine is mandatory — there is no fire-and-forget.** If `process_instances` is absent the processor
refuses to drop the event and emits `system:workflow.engine_unavailable` / `workflow.execution_refused`
(`processor.py:595-616, 705-727`).

---

## 2. The embedding — `portal[ phase[ step(1:N) ] ]`

The three depths live in **different tables**, joined by `tasks`. This is the heart of the doc.

### OUTER — the project portal (the build container)
A **`proposal_portals`** row, **not** a `process_instances` row. Its status machine:

- CHECK `guardrails_pending → launched → executing → closeout → archived|abandoned`
  (`db/migrations/097_portals_shadow_guardrails.sql:18-19`), plus the pre-launch **`curation_pending`**
  (mig 105 — a comp-code purchase opens the portal here; 72h curation SLA).
- Phase cursor: `current_stage_index INT DEFAULT 0` (`db/migrations/098_portal_workflow_guardrails.sql:10-11`).
- **Bounding transitions** (all frontend, RLS-scoped, imperative):
  purchase → `curation_pending`; `releaseFromCuration` CAS `curation_pending→launched`
  (`frontend/lib/portal-launch.ts:112-127`); `acceptGuardrails` CAS `guardrails_pending→launched` (`:79-103`);
  `advancePortalStage` drives `launched→executing→…→closeout` (`frontend/lib/portal-workflow.ts:165-176`);
  `setPortalStatus` `closeout→archived|abandoned` (`portal-launch.ts:141-146`).

### MIDDLE — a phase (P0, P1, …) = a stage in `guardrail_config.stages[]`
Phases are **declared data, not code**: `guardrail_config.stages[] = [{key,label,todos[]}]`
(types `portal-workflow.ts:33-46`; the system default seeds `draft / review / final`, `098:23-27`).
Hard cap **3 stages** (`getGuardrailLimits` `portal-workflow.ts:49-65`; validated `:68-85`).

- **Phase start:** `instantiatePortalWorkflow` sets `current_stage_index=0` and creates the stage-0 ToDos
  (`portal-workflow.ts:117-131`) via `createStageTodos` — one `tasks` row per `stage.todos[]`, stamped
  `params.stage = stage.key`, `entity_type='portal'`, `entity_id=portalId`, nudge cadence attached (`:88-114`).
- **Phase end → next phase start (the join + advance):** `advancePortalStage` (`portal-workflow.ts:134-177`).
  **All-N-done gate:** counts open `tasks WHERE entity_type='portal' AND entity_id=portalId AND
  params->>'stage'=curKey AND status NOT IN ('completed','cancelled')`; blocks with `incomplete_todos`
  unless `force` (`:152-159`). On pass: `current_stage_index += 1`; past the last stage → `status='closeout'`
  (`:165-170`); else `status='executing'` + `createStageTodos(next)` (`:172-176`).
  **Force-advance** = a manager/admin override of the very same gate (§8 lists the seam).

### INNER — the intrastep 1:N fan-out (per-section)
The canonical 1:N lives **inside one `ACTION` step**, `draft_sections → workflows.actions.draft_v0.draft_v0`
on `OnProposalCreated` (`on_proposal_created.py:160-169`):

- **Fan-out:** selects every still-fillable section (`status IN ('empty','ai_drafted')`, `draft_v0.py:116-126`)
  and loops, running **`section_drafter → markdown_to_canvas → publish_section_draft`** per section with a
  per-section `try/except` so one bad section never aborts the rest (`draft_v0.py:155-207`).
- **Bounding start/end:** emits `proposal:draft.completed:start` with `sections=N` before the loop
  (`draft_v0.py:143-149`) and `proposal:draft.completed:end` with `{drafted,skipped}` after (`:209-218`) —
  the fan-out’s own start→end gate. It is idempotent (only touches empty/ai_drafted) and safe-skips wholesale
  if the fabric / API key is absent (`:133-137`).
- **Join-back to a human phase:** at provision, `preStageProposalReviewTodos` pre-creates the `section_review`
  (stage `draft`) and `final_review` (stage `final`) gate ToDos, policy-parameterized
  (`frontend/lib/automation/prestage-todos.ts:38-59, 84-111`). Those ToDos are the phase whose all-N-done gate
  (MIDDLE) advances the portal — so the agent drafts, then the human reviews.

**Why the Python engine is “transient” here:** `ProjectCollaboration` is documented in-code as “a TRANSIENT
reaction … never a weeks-long running row; **Multi-gate = multi-launch**”
(`pipeline/src/workflows/project_collaboration.py:20-21, 56-60`). The long-lived build *is* the
`proposal_portals` machine; the engine just fires short reactions around each event/gate.

---

## 3. The bridge — every message, both directions

The master (RFP-admin) and each tenant mirror are **two spines joined only by a soft `opportunity_id` key**.
The bridge is **structurally forward-only**: `opportunity_bridge` is granted **`SELECT, INSERT` only**
(`db/migrations/094_oppcard_bridge_spine.sql:45`) — no UPDATE/DELETE exists to carry content back up.

### 3a. FORWARD (master → mirror) — entry `frontend/lib/tools/solicitation-push.ts:53`
Tool `solicitation.push` (`rfp_admin`, `tenantScoped:false`). Four gates, then an atomic transaction, then the
fan-out:

| Gate (all must pass) | Requires | Cite |
|---|---|---|
| Status | `curated_solicitations.status == 'approved'` | push.ts:112-117 |
| Compliance | `submission_format` present (named col or `custom_variables`) | :49-51, :124-134 |
| Spotlight summary | non-empty `spotlight_summary` (the Release-1 discovery gate) | :140-145 |
| **Date guard (mig 128, decision ⑤)** | **zero** activated opps/topics with `close_date IS NULL` | :154-171 |

`open_date` is always backfilled `COALESCE(open_date, now())` (`:207`), so “no expected open without an
expected close” holds transitively. The forward writes:

| # | Write / message | Target | Branch | Cite |
|---|---|---|---|---|
| W1 | `status → pushed_to_pipeline` (CAS on `approved`) | curated_solicitations | race-safe | push.ts:178-186 |
| W2 | `is_active=true, submission_stage='open', released_by/at` | opportunities | **umbrella + every topic** atomically (`id=landing OR solicitation_id=sol`) | :203-213 |
| W3 | audit `action='push'` | triage_actions | always | :216-222 |
| W4 | `revision_type='status_changed'` | curation_revisions | best-effort | :240-252 |
| W5 | `publishAndFanOut(opp)` per activated opp | bridge + tenant cards | loops the activation set | :290-309 |
| E1 | **`finder:solicitation.pushed`** (`topicCount`) | system_events | emitted **last**, so per-tenant `card.applied` sorts earlier | :311-324 |

The fan-out (`opportunity-bridge.ts`): `publishAndFanOut:251` → `publishToBridge:151`
(INSERT one `opportunity_bridge` row, `version = max(version)+1`, `card` = the customer snapshot from
`buildCardSnapshot:65`, resolving **both** umbrella `cs.opportunity_id=o.id` and topic `o.solicitation_id=cs.id`
arms `:84`) + `fanOutBridgeEvent:230` (`SELECT tenants WHERE status IN ('active','trial'):233` → `applyToTenant`
per tenant `:241`). `applyToTenant:175` upserts one `tenant_opportunity_cards` row
`ON CONFLICT (tenant_id, opportunity_id)` (`:190-202`), flips `pin_update_available` only for **pinned** cards
whose `bridge_version` advanced (`:198-200`), advances `tenant_bridge_cursor` (`:205-209`), and emits
**`capture:card.applied`** (`:217-223`).

**Scoring is NOT in the fan-out** — `applyToTenant` emits `capture:card.applied` and the **pipeline** scores
tenant-side (§4). The bridge JSONB snapshot is deliberately shard-safe (no JOIN back to global `opportunities`,
`094:52`).

**Other forward entry points:** lifecycle changes → `republishIfReleased` (`opportunity-bridge.ts:269`,
**no-op if the opp was never released**, `:275-285`); new-tenant `backfillTenant` (`:290`) applies each opp’s
latest bridge head (wired at tenant-create, application-accept, and a manual backfill route).

### 3b. The TWO releases over the one-way bridge

| | **Release 1 — Spotlight / discovery** | **Release 2 — Proposal-portal / build** |
|---|---|---|
| Trigger | `solicitation.push` | admin resolves the `proposal_setup` ToDo → `action=release` |
| Entry | `solicitation-push.ts:53` | `releaseFromCuration` `portal-launch.ts:112` → `provisionProposalForPortal` `provision-proposal.ts:35` |
| Master state | `pushed_to_pipeline`; opps active | shared **skeleton** (`solicitation_volumes` / `volume_required_items` / `solicitation_compliance` / `document_templates`) — built once, reused per tenant |
| Mirror state | `tenant_opportunity_cards` upsert + `capture:card.applied` → `tenant_bucket_scores` | per-tenant `proposals` / `artifacts` / `sections` + **`proposal_compliance_matrix` row per item** (`not_addressed → satisfied` on lock, `provision-proposal.ts:134-138`) + molds |
| On the bridge? | **Yes** — the fan-out *is* Release 1 | **No** — deliberately off the bridge |

They are decoupled: Release 2 can precede or follow purchase; a later buyer reuses the already-built skeleton
(fast release, no 72h). ⚠ The “proposal-ready” nudge back to the mirror card is **not built**
(`MASTER_MIRROR_OPP_DESIGN.md:131-137`).

### 3c. BACKWARD (mirror → master) — the only up-signals
Content never flows up. Two things do:

| Direction | Message | Carrier (table / event) | Built? | Cite |
|---|---|---|---|---|
| UP | **ToDo: purchase needs curation** | `capture:purchase.completed` + `tasks(task_type='proposal_setup')` via `launchProjectCollaboration` | **LIVE** | purchase/route.ts:136-172; project-collaboration.ts:59 |
| UP | admin notification of the ToDo | `automation_rules` seed → `notify_admin` (CMS email) | **LIVE** | mig 106:3-16; surfaced `tasks.ts:109` |
| UP | **shadow descent/ascent audit** | `identity:shadow.descended` / `shadow.ascended` (navigational; carries `actingAs`, **no content**) | **LIVE** | shadow-transition/route.ts:35-42 |
| ④(a)↓ | information request (cron/on-demand: “how many open gates?”) | *(intended: bridge system-info)* | **DESIGN-ONLY** | AUTOMATION_POLICY_DESIGN.md:332-334 |
| ④(a)↑ | information response (aggregate counts/status — never rows) | *(intended)* | **DESIGN-ONLY** | :333-336 |
| ④(b)↓ | control-tuning update (framework/policy change pushed down) | *(intended)* | **DESIGN-ONLY** | :335-336 |
| ④(b)↑ | ACK / NAK (tenant applied it) | *(intended)* | **DESIGN-ONLY** | :335-336 |

**Decision ④’s four-message “bridge conversation” is 100% design-only — zero code exists.** A grep for any
ack/nak / info-request / control-tuning channel across `frontend/` and `pipeline/` returns nothing. Today,
“control-tuning down” is realized only as (i) the forward card/lifecycle fan-out and (ii) later-buyer skeleton
reuse; `resolveGatePolicy` + `tenant_automation_policies` (mig 127) is built but is a **tenant-local read at
fire time**, *not* the ④ protocol. **§8 names exactly where ④ plugs in when compliance needs it.**

### 3d. The shadow-account backflow (how an admin “shadows down”)
`proposal_setup` ToDo lands in the admin triage queue at `/admin/rfp-curation` (`triage-todos.tsx:60`, fed by
`listOpenAdminTriageTasks` — admin-scoped **plus the one tenant-scoped `proposal_setup` exception**,
`tasks.ts:109-117`). The admin clicks into the tenant portal; `ShadowSpaceBanner` (`shadow-space-banner.tsx:15`)
POSTs `/api/admin/shadow-transition {direction:'down', tenantId}` → emits `identity:shadow.descended`
(audit-only; it does **not** itself grant access). `app.tenant_id` is set by `withTenant(tenantId, fn)`
(`frontend/lib/rls.ts:16-21` — `SELECT set_config('app.tenant_id', …, true)`, **SET LOCAL**, tx-scoped).

**RLS is authored but INERT today (single-layer).** mig 094 ENABLE+FORCEs RLS with a
`tenant_id = current_setting('app.tenant_id')` policy (`094:70-76`), but the app connects as the **owner role**
and `govtech_app` is `NOLOGIN` (`094:22-28`) — an owner connection **bypasses FORCE**. So tenant isolation
today rests on the **SQL `WHERE tenant_id` predicates + the `verifyTenantAccess` admin god-view** (returns
`true` for any `master_admin`/`rfp_admin`, `frontend/lib/db.ts:57`). `shadow_admin_grants` (mig 097:44-59) is
auditable, revocable **metadata — not the enforced gate**. The `NOBYPASSRLS govtech_app` cutover is the pending
backstop (§8: compliance data will need it real).

### 3e. Bridge invariants
Forward-only (`094:45`) · no content backflow (up-signal is a notification only, `opportunity-bridge.ts:217-223`)
· republish only if released (`:275-285`) · date-guard (`push.ts:154-171`) · **FK-vs-soft-ref ordering**:
`purchases.opportunity_id` **has** an FK (`001_baseline:813`), `proposal_portals.opportunity_id` and
`tenant_opportunity_cards.opportunity_id` are **soft refs, no FK** (`097:15`, `094:51`) — validate the FK target
before the paired soft-ref write or a bad id 500s on the FK throw.

---

## 4. The agent-automation framework across the two scopes

Two scopes ride the same engine: **discovery (buckets)** and **build (portals)**. The #190 layer parameterizes
*who is notified × when × how* over both.

### 4a. Discovery scope (buckets)
`capture:card.applied` (from the fan-out) triggers `OnCardApplied` (`on_tenant_rescore.py:30-52`), whose single
`ACTION` runs `rescore_tenant_card` (`rescore.py:172-214`). **Auto-scoring on arrival is algorithmic, not the
agent:** `score_card` (`rescore.py:87-138`, a faithful port of the frontend `scoreCard`) writes
`tenant_bucket_scores` under `SET LOCAL app.tenant_id` (`:149-161`) against every active
`tenant_spotlight_buckets` row (`:164-169`). `OnBucketsUpdated` (`:55-73`) rescopes all open cards when the
tenant edits buckets. The **`scoring_strategist` agent** is the *overlay* — it fires on **pin**
(`cards/[opportunityId]/pin/route.ts:73`), not on arrival, and lands a clamped ±15 adjustment **beside** the
algorithmic score in `tenant_bucket_scores.factors` (clamp `guardrails.py:111-120`).

**Priority predicate (decision ③):** the bucket-parameter half (keywords/naics/agency/program/set-aside + a
`timeline` factor off `close_date`) is implemented in `score_card` (`rescore.py:102-133`). The **“else
company-match + time-to-close” no-bucket fallback is NOT implemented** — `rescore_tenant_card` returns
`no_active_buckets` when the tenant has no buckets (`:189-190`); the fallback exists only in catalog copy +
design. (§9 gap.)

### 4b. Build scope (portals)
`section_drafter` drafts V0 on provision (§2 INNER). The **governable triggers** exposed to tenants
(`catalog.ts:18-59`):

| trigger_key | scope | agentCapable | actually consumed by | Cite |
|---|---|---|---|---|
| `capture:card.applied` | discovery | — | catalog only — no resolver call-site | catalog.ts:20-25 |
| `proposal:document.locked` | build | — | ⚠ **catalog + mig-129 backfill only — no consumer** | catalog.ts:27-32 |
| `proposal:collaborator.get_ready` | build | — | ⚠ **no consumer** | catalog.ts:33-38 |
| `proposal:proposal.advanced` | build | ✅ | ⚠ **no consumer** | catalog.ts:39-45 |
| `section_review` | build | — | **`preStageProposalReviewTodos`** | catalog.ts:46-49; prestage-todos.ts:40 |
| `final_review` | build | ✅ | **`preStageProposalReviewTodos`** | catalog.ts:52-58; prestage-todos.ts:51 |

The four **live** `resolveGatePolicy` call-sites resolve keys that are **framework-hard, not in the catalog**:
`proposal_setup` (SLA-pinned) at `purchase/route.ts:150` + `stripe/webhook/route.ts:184`; `admin_review`
(SLA-pinned) at `proposals/create/route.ts:761`; `contract_kickoff` at `outcome/route.ts:309`. Plus the two
catalog gates via prestage. ⚠ **`document.locked` / `collaborator.get_ready` / `proposal.advanced` are
tenant-editable but wired to nothing** — see §9 (the highest-priority gap this doc surfaces).

### 4c. The resolver — four-level precedence (the #190 grammar core)
`resolveGatePolicy` (`policy.ts:104-164`). Merge order, applied so a tenant can never exceed the framework:

1. **gate defaults (base)** — the call-site’s literal `gateDefaults` (`:108-117`).
2. **tenant policy** — overlays only fields the tenant actually set (`enabled`, non-empty `nudgeDays`,
   `dueInMinutes>0`, `channel`, cooldown, rate) from `tenant_automation_policies` (mig 127) read via
   `withTenant` (`:122-148`).
3. **framework default / cap — wins last** — caps `nudgeDays` at `max_nudges_per_gate` (default 3); if
   `pinnedToCurationSla`, **hard-pins** `dueInMinutes = curation_sla_minutes` (72h) from the
   `automation_framework` singleton (mig 126) (`:151-161`).
4. **explicit per-launch override** — the caller may pass literal `gateDefaults`/`pinnedToCurationSla`; the raw
   admin launch route stays the explicit tier.

Realized precedence: **framework-hard pin ▸ tenant policy ▸ gate defaults ▸ framework default**. **Fail-safe:**
any read error returns gate defaults verbatim (`:94-97, 134-136`); `enabled=false` ⇒ the caller safe-skips
(`prestage-todos.ts:87`, `purchase/route.ts:157`). Everything ships **inert** — a tenant that edits nothing
gets exactly today’s behavior.

### 4d. The escalation floor (decision ①) and the budget ceiling (decision ⑨)
The floor is enforced **downstream in the pipeline sweeper, not in the resolver** (noted `policy.ts:20-24`).
`WorkflowManager._final_notice_user_ids` (`manager.py:1141-1228`): the **tenant admin is always** appended
(non-removable, `:1153-1163`); **delegated managers** are additive (`guardrail_config.collaborators[role=
'manager']`, resolved globally by email, deduped, `:1167-1208`); the **RFP-Pipeline shadow backstop** (oldest
active `rfp_admin`/`master_admin`) is appended only if no admin/manager resolved (`:1214-1226`) and is
suppressed when the portal opted out of oversight (`rfpOversight === false`, `:1185,1214`). Fired on the final
nudge (`_emit_task_nudge_email`, `is_final`, `:1123-1139`).

The **agent budget ceiling** is enforced in the fabric: `automation_framework.agent_monthly_budget_ceiling_usd`
(default $200, `126:29`) is read into platform config (`fabric.py:1046-1052`) and `_check_budget` caps the
tenant’s effective monthly budget at it — **a tenant may only lower below it** (`fabric.py:1161-1169`). The
fabric’s own runaway caps still bind regardless (`MAX_TOOL_ROUNDS=20`, `RATE_LIMIT_PER_HOUR=50`,
`DEFAULT_MONTHLY_BUDGET_USD=50`, `PER_CALL_CEILING_USD=0.50`, `fabric.py:129-132`).

### 4e. Agent invariants (verified, all 5 live agents)
tenant-bound (no `tenant_id` in any tool schema; trusted from task context) · advisory → guardrail →
land-or-review (never auto-writes business tables; the only bounded auto-apply is scoring’s ±15 into `factors`)
· injection-fenced (**central** `ContextAssembler` wraps ALL untrusted content in `<untrusted_data>` + the
treat-as-data rule, `context.py:90-103, 797-849`) · runaway-bounded · never dead-ends (unmapped/failed
`AI_INVOKE` safe-skips; the fabric returns an error dict, never raises). ⚠ The **per-archetype** fence belt is
uneven — see §9/F-C.

---

## 5. The two stateless reconcilers

Both re-derive state from `{system_events, process_instances, process_instance_transitions, tasks}` each tick.

**① Event processor** — `run_workflow_processor` (`processor.py:546-873`), the **only** execution path. Polls
`system_events` every **10 s** (5-min lookback, excludes `system:workflow.*`), in-proc + DB-unique dedup. Per
event: match trigger → `create_instance` → `execute_instance`; then resume paused HITL via
`match_waiting_instances`; then re-drive `retrying` via `poll_retrying_instances`.

**② Time sweeper** — `WorkflowManager._stuck_detection_loop`, every **60 s** (`manager.py:1660-1934`), four passes:
1. **Task nudges** (`_sweep_task_nudges:1011-1080`) — when `now ≥ due_at − nudge_days[n]`, emit `system:task.nudge`
   once per threshold (idempotent via `nudges_sent`); the **final** threshold escalates by email to the §4d floor.
2. **Date-anchored tasks** (`_sweep_date_anchored_tasks`, ~hourly, `:1230-1331`) — one `final_due` task per active
   proposal from `opportunities.close_date`, nudge `[7,3,1]`; expires human tasks >30 d past due.
3. **Stuck detection** (`:1691-1806`) — running instance `last_heartbeat_at < now()−5min` → `failed` +
   `system:workflow.stuck_detected`; stale `pending` >1 h → `failed`.
4. **Paused-deadline** (`:1808-1929`) — past `deadline` → run the parked step’s `on_timeout`, then **CAS**
   `WHERE status='paused'` → `failed`, expire the sibling task, emit `system:workflow.wait_timed_out`.

(A 30 s `_heartbeat_loop` refreshes liveness; `_recover_orphaned_instances` runs once at boot.) **Cron event
emission is a *third*, separate loop** — `tick_schedules` in `pipeline/src/ingest/dispatcher.py:113-154`
(inside `run_consumer_loop`, 60 s), which CAS-claims a due `pipeline_schedules` row and inserts the
`system_events` trigger — **not** the sweeper (a historical doc says otherwise, §9/D-Engine-3).

---

## 6. Every trigger → step → emitted-event → next-trigger chain (20 workflows)

Auto-discovered `base.py:374-398`; a class whose `validate()` errors is **dropped** (`:321-330`). Every step
also emits `system:workflow.step_{started,completed,failed}`; the “emits” column lists **domain** events beyond
those. `AI` = `AI_INVOKE` step, `TODO`/`HITL` = human park.

### Reactive (event-triggered)
| Workflow | trigger (condition) | steps | domain emits → next trigger | Cite |
|---|---|---|---|---|
| **OnRfpUploaded** | `finder:rfp.uploaded:end` | shred · extract_compliance · AI `ingest` · AI `matrix.stage` · AI `skeleton.build` · NOTIFY | admin review → `finder:solicitation.triaged:end` | on_rfp_uploaded.py:92-167 |
| **OnSolicitationReviewRequested** | `finder:solicitation.triaged:end` (toState=`review_requested`) | AI `curation.qa` · NOTIFY | admin push → `finder:solicitation.pushed` | on_solicitation_review_requested.py:55-85 |
| **OnSolicitationPushed** | `finder:solicitation.pushed:single` | match_tenants · NOTIFY | bridge fan-out → `capture:card.applied` | on_solicitation_pushed.py:88-116 |
| **OnCardApplied** | `capture:card.applied:single` | rescore_tenant_card | `capture:card.scored`/`tenant.rescored` | on_tenant_rescore.py:30-51 |
| **OnBucketsUpdated** | `capture:buckets.updated:single` | rescore_tenant | — | on_tenant_rescore.py:55-72 |
| **OnProposalCreated** | `proposal:proposal.created:end` | AI `architect` · AI `capture.generate_strategy` · AI `cost_estimate` · AI `match_past_performance` · **draft_sections (1:N)** · NOTIFY | `proposal:draft.completed:start/end` | on_proposal_created.py:94-186 |
| **OnProposalAdvancedToReview** | `proposal:proposal.advanced:end` (target=`review`) | AI `check_compliance` · NOTIFY · **TODO** `proposal_review` (wait_for advance-out) | self-resumes | on_proposal_advanced.py:155-222 |
| **OnProposalAdvancedToFinal** | `proposal:proposal.advanced:end` (target=`final`) | AI `package` · generate_preview · NOTIFY | — | on_proposal_advanced.py:225-263 |
| **OnProposalOutcomeRecorded** | `proposal:outcome.recorded:end` | attribute_outcome · AI `outcome.analyze` | — | on_proposal_outcome_recorded.py:43-78 |
| **OnProposalSectionEdited** | `proposal:section.saved:single` | analyze_section_diff | — | on_proposal_section_edited.py:42-66 |
| **OnCollaboratorInvited** | `proposal:collaborator.invited:end` | AI `partner.coordinate` · NOTIFY | — | on_collaborator_invited.py:89-130 |
| **OnSourceChangeDetected** | `finder:source.change_detected:single` (meaningfulChanges>0) | AI `amendment_delta` · create_draft_solicitations · NOTIFY · **TODO** `source_review` (on_timeout→notify) | resumes `finder:source_diff.reviewed:end` | on_source_change_detected.py:105-173 |
| **OnOpportunitiesDetected** | `finder:opportunities.detected:single` | AI `opportunity.scout` · NOTIFY · **TODO** `triage_new_opportunities` | `system:task.created` | on_opportunities_detected.py:109-162 |
| **OnApplicationAccepted** | `capture:application.accepted:end` | AI `onboarding.concierge` · create_library_defaults · **HITL** (wait_for `identity:user.logged_in:single`) | resumes on login | on_application_accepted.py:104-145 |

### Scheduled (cron → `tick_schedules` → event)
| Workflow | trigger | cron | steps | Cite |
|---|---|---|---|---|
| **OnOpsDigestRequested** | `system:ops.digest_requested:single` | `0 13 * * *` | AI `ops.digest` · NOTIFY | on_ops_digest_requested.py:48-72 (seed 118:27) |
| **OnSolicitationUpdateScan** | `finder:solicitation.update_scan_requested:single` | `0 */6 * * *` | AI `amendment_delta` · NOTIFY | on_solicitation_update_scan.py:35-59 |
| **OnContentResurfaceRequested** | `library:content.resurface_requested:single` | `0 13 * * 1` | AI `content.curate` · NOTIFY | on_content_resurface_requested.py:34-59 |
| **OnSocialScheduleRequested** | `system:social.schedule_requested:single` | `0 14 * * *` | AI `social.schedule` · NOTIFY | on_social_schedule_requested.py:32-57 |

### Imperatively launched (`launchTemplate` overlay — `trigger_key` phase MUST be `single`)
| Workflow | trigger | steps | launched by | Cite |
|---|---|---|---|---|
| **ProjectCollaboration** | `proposal:project.collaboration_requested:single` | **TODO** collaborate (all `payload.*`) · NOTIFY | purchase (`proposal_setup`, nudges `[1,3]`, due 72h) / Stripe / proposals-create | project_collaboration.py:79-133; project-collaboration.ts:59-127 |
| **OnCmsContentRequested** | `library:content.requested:single` | AI `content.generate` · draft · **TODO** `content_publish` · publish · NOTIFY | CMS overlay | on_cms_content_requested.py:50-133 |

### AI_INVOKE dispatch + boot gate
`_execute_ai_invoke` maps the action via **`TOOL_ACTION_TO_ARCHETYPE`** (`processor.py:225-261`, 30 entries) and
**safe-skips** (never a DB write) if the fabric is absent or the action is unmapped (`:281-289`). `validate()`
**rejects an unmapped `AI_INVOKE` at boot** (`base.py:204-213`) and `register_workflow` drops the whole
workflow — so an agent step can never be added without wiring its archetype.

---

## 7. All-messages appendix (the event catalog)

Every message rides one bus — `system_events`. ~180 distinct `namespace:type` messages exist; this section
gives the plumbing, the events that actually **drive behavior**, and the conformance audit. (The exhaustive
per-type emitter list is in the mapping appendix `scratchpad/maps/03-events.md`.)

### 7a. Emit paths (three) and the automation gotcha
- **Frontend:** `emitEventStart` / `emitEventEnd` / `emitEventSingle` (`frontend/lib/events.ts:110,149,220`);
  two raw inserts — login (`auth.ts:108`) and the `launchTemplate` re-emit (`launch-template.ts:119`); an
  rfp-admin backdoor `POST /api/events` (`events/route.ts:99`).
- **Pipeline:** `emit_event`/`emit_start`/`emit_end` (`pipeline/src/events.py:20,70,93`) + raw `_emit_event`
  in the manager, ingest, shredder, fabric, and the cron→event bridge (`dispatcher.py:144`).
- **CMS:** `emit_event` (`services/cms/src/models/events.py:13`) writes `cms_events` **then bridges to
  `system_events` hard-coded as `namespace='system', phase='single'`** (`:54`) — which is why CMS never
  violates the namespace rules (§7d).

> **⚠ The automation gotcha:** only **`emitEventSingle`** runs `evaluateAutomationRules` after insert
> (`events.ts:240-248`). `emitEventStart`/`emitEventEnd` do **not** — so a `:start`/`:end`-only event never
> fires *frontend* automation; it is seen only by the pipeline poller and the CMS listener. Wire tenant
> automation to a `:single` event (or the pipeline engine), never to a bare `:start`.

### 7b. The three consumer mechanisms
1. **Pipeline workflow engine** — the in-code `EventTrigger` declarations (§6) + three `wait_for` resume
   triggers (`identity:user.logged_in:single`, `finder:source_diff.reviewed:end`,
   `proposal:proposal.advanced:end`). **These are the only *guaranteed* consumers** (static, in the code).
2. **Frontend `evaluateAutomationRules`** (`triggers.ts:44`) — matches DB `automation_rules` on
   `(namespace,type)`; **fires only on the `emitEventSingle` path**.
3. **CMS `event_listener`** (`services/cms/src/event_listener.py:94`) — polls all rows, phase-aware,
   **tenant-preference-gated**, plus a hard-coded handler for `system:notification.requested` (`:592`).

### 7c. The events that actually drive behavior (everything else is audit + rule-eligible)
The 23 static consumers are exactly the §6 chain table + the three `wait_for` resumes + `system:notification.
requested → CMS`. **~130 other event types are fire-and-forget** (audit trail + eligible for a DB
`automation_rule`, but no in-code consumer): all `finder` curation/source/compliance events, `capture`
billing/team events, most `proposal`/`library` events, every `system:workflow.*` lifecycle event, every agent
`memory.*`/`agent.*` event, all `tool:*`, and every CMS-bridged `system:*` type.

**The escalation/notification carrier:** the pipeline final-notice escalation (§4d) emits
`system:notification.requested` (`manager.py:1121,1128`; `processor.py:369`), consumed **only** by the CMS
`_handle_notification_requested` handler — the one hard-coded, non-rule-based cross-service consumer.

### 7d. #190 automation events — all three are fire-and-forget today
| event | emit site | consumer |
|---|---|---|
| `capture:automation_preferences.updated` | **two** routes: `automation-preferences/route.ts:148` (OLD) **and** `automation-policies/route.ts:161` (NEW) | none in-code; audit / rule-eligible only |
| `system:automation_framework.updated` | `automation-framework/route.ts:127` (tenantId ∅) | none — pure audit |
| `proposal:review_todos.prestaged` | `prestage-todos.ts:117` (tenantId T) | none static |

**⚠ The split-brain (§9/F-B):** the CMS listener’s notification gates read the **OLD**
`tenant_automation_preferences` *table* (`event_listener.py:255,282` — `notify_team_on_document_locked`,
`notify_collaborators_get_ready`, `notify_on_stage_advanced`, `notify_on_new_priority_opp`), while #190’s
grammar editor writes the **NEW** `tenant_automation_policies` table. mig 129 seeded NEW from OLD **once**;
subsequent grammar edits do not update the OLD table the CMS still reads. So for `document.locked` /
`collaborator.get_ready` / `proposal.advanced` there are two divergent sources of truth.

### 7e. Namespace conformance
**No forbidden namespace** (`admin`/`cms`/`spotlight`) is emitted anywhere across all three services — verified.
Soft findings (§9): three `finder` tools emit `tenantId: ctx.tenantId ?? null` (a tenant uuid if run inside a
shadow ctx — contradicts “admin events → tenantId null”): `compliance-save-variable-value.ts:262`,
`compliance-add-variable.ts:63`, `solicitation-delete-annotation.ts:57`; and `finder:process.force_advanced`
(`force-advance.ts:163`) always carries `inst.tenantId` even on the `finder` branch. CMS three-segment types
(`content_pipeline.generation.requested`) are cosmetic-only (all under `system`).

| namespace | tenantId | ~count | role |
|---|---|---|---|
| `finder` | ∅ (admin) | ~70 | curation, sources, solicitations, compliance, volumes, tenants, ingest, shred, lifecycle |
| `capture` | T | ~28 | cards, buckets, portals/purchases, applications, team, billing |
| `proposal` | T | ~40 | creation, advance, sections/atoms/artifacts, collaborators, comments, reviews, gates, tasks, outcomes |
| `library` | T | ~16 | atoms, documents, templates, CMS-content workflow |
| `identity` | ∅ | 7 | login, password, invite, consent, shadow transitions |
| `system` | ∅ / T | many | workflow lifecycle, agent memory/learning, storage, templates, automation CRUD, `notification.requested`, all CMS-bridged |
| `tool` | — | 3 | `invoke.start`, `agent.dispatch`, `agent.invoked` (all start/end) |

---

## 8. Extending into compliance — the plug-in seams

Every extension point, named with its exact seam, so a compliance phase/gate/agent/message drops in without
re-deriving §1–§6:

| To add… | Plug in at | Pattern |
|---|---|---|
| **A new phase (P_n)** | `guardrail_config.stages[]` (≤3 cap) **or** a `GateSpec` in `REVIEW_GATES` (`prestage-todos.ts:38-59`) | declare `{key,label,todos[]}`; the all-N-done gate (`advancePortalStage`) advances it for free |
| **A new intrastep 1:N step** | a new `ACTION` on an `On*` workflow that loops an entity set | emit a `*.completed:start(N)` / `:end(done,skipped)` pair (copy `draft_v0.py`); per-item try/except; idempotent |
| **A new reactive trigger→step chain** | a `Workflow` subclass in `pipeline/src/workflows/on_*.py` | set `trigger` + `steps`; `validate()` gates it at boot; producer emits the `namespace:type:phase` |
| **A new agent step** | add to `TOOL_ACTION_TO_ARCHETYPE` (`processor.py:225-261`) + a `Step(step_type=AI_INVOKE, action='tool.…')` | boot gate refuses an unmapped action; advisory-only output |
| **A compliance gate on section lock** | already wired — `lock-section.ts:91-100` flips `proposal_compliance_matrix.status='satisfied'`; matrix seeded at provision (`provision-proposal.ts:135,171`) | a compliance phase advances on the same all-N-tasks-done gate |
| **A tenant-tunable compliance notification** | add a `TRIGGER_CATALOG` entry (`catalog.ts`) **and a consumer** that calls `resolveGatePolicy({scope,triggerKey})` | ⚠ do **not** repeat the §9/F-B mistake — a catalog entry with no consumer is a no-op |
| **The ④ bridge conversation (info/control up-down)** | design-only today; seam is `system_events` (system-info request/response) + an ACK/NAK `tasks`/event pair | keep it system+solution info only — never customer content (the forward-only invariant) |
| **Real tenant isolation for compliance data** | the pending `NOBYPASSRLS govtech_app` cutover (`094:22-28`, `rls.ts`) | until then, isolation is SQL predicates + `verifyTenantAccess` — compliance PII needs the cutover |

---

## 9. Known gaps & doc-vs-code drift (as-built truth)

Proven findings from the mapping sweep — carried into the refactor. **F-** = code finding; **D-** = doc drift.

**F-B (HIGH — product correctness).** The tenant grammar editor exposes `proposal:document.locked`,
`proposal:collaborator.get_ready`, `proposal:proposal.advanced` as tunable (and mig 129 backfills them), but
**no `resolveGatePolicy` call-site consumes them** — a tenant configures automation that never fires. Only
`section_review`/`final_review` are actually wired. *Fix: wire the three build triggers to a real consumer, or
gate them in the UI as not-yet-active.*

**F-C (MEDIUM — security defense-in-depth).** `section_drafter` (`section_drafter.py:145`, `<rfp_context>`) and
`color_team_reviewer` (`color_team_reviewer.py:140`, `<proposal_section>`) fence untrusted content with
non-canonical markers and **omit the treat-as-data guard in `build_messages`**. They are **backstopped** by the
central `ContextAssembler` fence, so not exploitable today, but the belt is uneven and the docs overstate
coverage. *Fix: canonical fence + guard + a `test_<agent>_wiring.py` for each.*

**F-D (MEDIUM — guardrail limits).** The seeded system-default limits row caps `maxManagers:1`
(`098:19`), while the mig-123/#190 intent (and `FALLBACK_LIMITS`, `portal-workflow.ts:24`) is 25 — and
`getGuardrailLimits` prefers the seeded row (`:55-60`), so an admin can delegate only **one** manager, silently
constraining the escalation floor. *Fix: a migration to lift the seeded manager/collaborator caps to intent.*

**F-A (LOW — dead code).** `autoScoreCard` (`bucket-ranking.ts:88`) has **zero callers** (only a stale comment
at `default-buckets.ts:4`) — superseded by the event-driven `rescore.py`. *Fix: remove + correct the comment.*

**Phase-C gaps (design-consistent, not bugs).** `resolveGatePolicy({scope:'discovery'})` is never called
(discovery NOTIFY beats unbuilt); the “else company-match + time-to-close” no-bucket fallback (decision ③) is
unimplemented (`rescore.py:189-190`); cron-digest *delivery* (decision ⑥) is deferred. Decision ④ is design-only.

**Doc drift to correct:**
- **D-Engine-1/2 (HIGH):** `AUTOMATION_SPINE_MAP.md` lists trigger keys `proposal:proposal.outcome_recorded`
  (:158,:181) and `finder:solicitation.review_requested` (:145,:172) that **no producer emits** — the real keys
  are `proposal:outcome.recorded:end` and `finder:solicitation.triaged:end`+cond. A reader wiring to the doc’s
  keys would get silence.
- **D-Engine-3 (HIGH):** the same doc attributes cron dispatch to the time-sweeper (:76,:90-92); it is
  `tick_schedules` in `dispatcher.py` (§5).
- **D-Engine-5 (MED):** the doc frames the portal build as a `process_instances` template; it is the
  `proposal_portals` phase-machine (§2).
- **D-Bridge-1 (MAJOR):** `MASTER_MIRROR_OPP_DESIGN.md` says the fan-out scores in-tx via `autoScoreCard`;
  scoring is tenant-side/event-driven (§4a) and `autoScoreCard` is dead (F-A).
- **D-Agent-1..5:** `AGENT_WORKFORCE.md`/`AGENT_FABRIC_DESIGN.md` call 15 archetypes “dormant” (all 25 have
  invocation sites), omit the `research_scout` producer, and overstate the injection-fence/test coverage (F-C).
- **CLAUDE.md** says “migrations at 125”; the tree is at **129**.

---

*Maintainers: keep this doc `file:line`-true. When you add a phase/step/trigger/agent/message, update §6 (the
chain table) and §8 (the seam), and re-run the four-way mapping sweep before a release.*
