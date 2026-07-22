# AUTOMATION_POLICY_DESIGN.md — the global per-tenant automation policy layer (#190)

**Date:** 2026-07-22 · **Status:** DESIGN (for review — not yet built). This is the spec for the
**one genuinely-open piece** named in `docs/AUTOMATION_SPINE_MAP.md` §7 gap #1 and
`docs/AUTOMATION_DESIGN.md` §9: the customer-facing **grammar** that parameterizes the already-built
workflow engine per tenant.

**Read first:** `docs/AUTOMATION_SPINE_MAP.md` (the engine — start→end gate, two reconcilers, the
`ProjectCollaboration` exemplar). This doc is the **overlay grammar** on top of that substrate; it adds
no new engine. Companion: `docs/AGENT_WORKFORCE.md` + `docs/AGENT_FABRIC_DESIGN.md` (§9 here is how the
agent fabric plugs into the same policy).

---

## 0. TL;DR

The engine is generic: a template resolves **every** gate field from an overlay payload
(`ProjectCollaboration` reads `assigneeRole` / `nudgeDays` / `dueMinutes` / `assigneeUser` /
`completeTemplate` from `payload.*`). Today those fields are **hardcoded at each launch site**
(`launchProjectCollaboration({ nudgeDays: [1,3], dueMinutes: 4320, assigneeRole: 'rfp_admin' })`) or
reduced to a **boolean** in `tenant_automation_preferences` (6 on/off toggles). There is **no per-tenant
policy** that answers, for a given trigger, **who** to involve, **when** (clock), and **how to escalate**.

**#190 = that policy.** One table (`tenant_automation_policies`), one resolver
(`resolveAutomationPolicy(tenantId, triggerKey, ctx) → overlay`), called at every launch/notify site in
place of the hardcoded literals. The grammar is `recipients × trigger × timing × escalation`, expressed
once and spoken in two vocabularies (discovery / build). It **supersedes** the 6 booleans and **shares
the trigger space** with the admin `automation_rules` engine under a strict single-owner rule.

Nothing about the start→end gate, the reconcilers, or the templates changes. This is a **resolution
layer** + **a config table** + **an editor**.

---

## 1. What already exists (the substrate — do NOT rebuild)

| Piece | Where | What it gives us |
|---|---|---|
| Generic HITL gate | `pipeline/src/workflows/project_collaboration.py` | A `TODO` step whose `assignee_role`/`assignee_user`/`nudge_days`/`due_in_minutes`/`task_type`/`entity_ref` **all resolve from the overlay** per instance. |
| Canonical launcher | `frontend/lib/process/project-collaboration.ts` `launchProjectCollaboration()` | Type-guards the overlay; **today hardcodes** `nudgeDays ?? [1,3]`, `dueMinutes ?? 4320` (72h), literal `assigneeRole`. **This is the primary injection point for the policy.** |
| Escalation invariant | `pipeline/src/workflows/manager.py` `_final_notice_user_ids()` | The final nudge **always** → the tenant's oldest active `tenant_admin`; a **portal** task **also** → `guardrail_config.collaborators[role='manager']` (resolved globally by email). Additive, deduped. |
| Time sweeper | `manager.py` | Emits nudge *n* when `now() ≥ due_at − nudge_schedule[n]`; the **last** nudge routes to `_final_notice_user_ids`. |
| Boolean prefs (to supersede) | `tenant_automation_preferences` (mig 076) + `frontend/.../automation-preferences/route.ts` + `automation-preferences-card.tsx` | 6 tenant booleans: `notify_team_on_document_locked`, `notify_collaborators_get_ready`, `notify_on_stage_advanced`, `notify_on_new_priority_opp`, `ai_review_on_advance`, `auto_advance_when_all_locked`. **Recipients/timing/escalation are absent.** |
| Admin rule engine (to federate) | `automation_rules` (migs 028/078/087) + `frontend/lib/automation/triggers.ts` `evaluateAutomationRules()` + `automation_log` | trigger(namespace,type) → conditions → action(`create_todo`/`notify_admin`/deferred email·social·publish), with **cooldown + hourly rate-limit + a durable start/finalize log**. Fires off the event queue (best-effort, never breaks the emit). |
| Portal guardrails | `proposal_portals.guardrail_config` (mig 097) | Per-portal phases, delegated managers, nudge cadence — **frozen at accept-launch**. The build-side escalation recipients. |

**The point:** every knob the policy needs to turn already exists as an overlay field or a config column.
#190 supplies the **values** per tenant, from **one place**, instead of scattering them across launch
sites and reducing them to booleans.

---

## 2. The grammar: `recipients × trigger × timing × escalation`

A tenant's automation policy is a **set of rules**, one per **(scope, trigger_key)**. Each rule is the
four-dimensional sentence:

```
ON   <trigger_key>            (a lifecycle event, optionally conditioned)
FOR  <scope>                  discovery | build
IF   <condition>              (top-N | focus-agency | close-date window | stage | always)
THEN involve <recipients>     roles + named users + delegated-managers + collaborators-at-stage
WITH timing <timing>          due_in_minutes  OR  relative-to(open|close ± offset)
AND  escalate <escalation>    nudge_days[] cadence  →  ALWAYS final-notice to admin(+managers)
VIA  <channel>                email (today) | in-app todo | both
```

- **Recipients (who).** A resolved user set from: `roles` (e.g. `tenant_admin`, `tenant_user`), explicit
  `user_ids`, the sentinel `delegated_managers` (portal `guardrail_config` managers — who carry admin
  authority on that portal, decision ②), and `collaborators_at_stage` (the `proposal_collaborators` for the
  gate's stage). **The escalation floor is NOT a recipient — it is a floor** (decision ①): recipients are
  *added on top of* the floor. The floor is the **tenant admin (always, non-removable) + delegated managers
  + the RFP-Pipeline shadow backstop** — an admin can add managers but can never delegate themselves off it.
- **Trigger (which event).** A `trigger_key` = a namespaced lifecycle event (`capture:card.applied`,
  `proposal:proposal.advanced`, `proposal:document.locked`, `finder:solicitation.pushed`, …). Optional
  `condition` predicate over the event payload (reuses `conditionsMatch()` from `lib/automation/match`).
- **Timing (when, on the clock).** Either an **absolute** window `due_in_minutes` (build-side: "72h to
  set up", "5 business days to draft"), or a **relative** anchor `relative_to: {anchor: 'close_date',
  offset_minutes: -20160}` (discovery-side: "nudge 2 weeks before the solicitation closes"). The anchor
  reads a real column on the entity (`opportunities.close_date`, `tenant_opportunity_cards`,
  `proposals`). Resolves to `due_at` on the `tasks` row. **The `close_date` anchor is guaranteed present**
  (decision ⑤): a card can't be created without open+close dates — estimated (`is_estimated`) if
  unpublished, upgraded to official on publish — so there is no null-anchor case.
- **Escalation (how it climbs).** `nudge_days: int[]` relative cadence (already the `nudge_schedule` on
  `tasks`). The **last entry always adds the admin(+managers)** via the existing `_final_notice_user_ids`
  — the policy can lengthen/shorten the cadence and add earlier recipients, but the terminal beat is a
  fixed safety net.

### Two vocabularies, one grammar

| | **Discovery** (buckets / OPPs — capture side) | **Build** (portals — proposal side) |
|---|---|---|
| Triggers | `capture:card.applied`, `capture:card.rescored`, `finder:solicitation.pushed`, focus-agency match, entered-top-N | `proposal:proposal.created/advanced`, `proposal:document.locked`, `proposal:section.locked`, `proposal:collaborator.invited` |
| Recipients | tenant_admin + chosen tenant_users watching that bucket | phase actor(s) + delegated managers + collaborators-at-stage |
| Timing | **relative** to `close_date` (gov deadline) | **absolute** `due_in_minutes` (internal build SLA) |
| Escalation | remind-before-close cadence → admin | 3-nudge build cadence → admin + delegated managers |
| Parameterizes | the **NOTIFY beats** after `OnCardApplied` | the **TODO gates** of the portal guardrail workflow |

Same table, same resolver, same escalation floor — the only difference is which triggers and which
timing anchor each rule uses.

---

## 3. Schema (`tenant_automation_policies`)

A new table supersedes the 6-boolean `tenant_automation_preferences` (backfill in §8). One row per
(tenant, scope, trigger_key); the four dimensions are typed columns + a small JSONB for the recipient
set and condition.

```sql
CREATE TABLE tenant_automation_policies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    scope           TEXT NOT NULL CHECK (scope IN ('discovery','build')),
    trigger_key     TEXT NOT NULL,               -- 'namespace:type' (matches the river)
    enabled         BOOLEAN NOT NULL DEFAULT true,

    -- recipients (who) — resolved to user_ids at fire time
    recipient_roles TEXT[]  NOT NULL DEFAULT '{}',        -- e.g. {tenant_admin,tenant_user}
    recipient_users UUID[]  NOT NULL DEFAULT '{}',        -- explicit
    recipient_flags TEXT[]  NOT NULL DEFAULT '{}',        -- {delegated_managers,collaborators_at_stage}

    -- trigger refinement (which)
    condition       JSONB   NOT NULL DEFAULT '{}',        -- conditionsMatch() predicate over payload

    -- timing (when)
    due_in_minutes  INTEGER,                              -- absolute window (build)
    relative_anchor TEXT CHECK (relative_anchor IN ('open_date','close_date','stage_entered')),
    relative_offset_minutes INTEGER,                      -- signed; -20160 = 2 weeks before

    -- escalation (how)
    nudge_days      INTEGER[] NOT NULL DEFAULT '{1,3}',   -- relative cadence; last beat → admin floor

    -- delivery
    channel         TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','todo','both')),

    -- concurrency guards (mirror automation_rules so policy notifies can't spam)
    cooldown_minutes    INTEGER NOT NULL DEFAULT 0,
    max_fires_per_hour  INTEGER NOT NULL DEFAULT 0,

    configured_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, scope, trigger_key)
);
-- RLS: FORCE + tenant_isolation on current_setting('app.tenant_id') — same pattern as
-- proposal_portals (mig 097). Cross-tenant admin reads go through a BYPASS/owner-view (§7 gotcha 4).
```

**Defaults are the platform framework row, not per-tenant seeding.** A tenant with no row for a trigger
falls back to the **platform framework** (decision ⑦/§12 — the RFP-admin-tunable defaults: `[1,3]`, 72h,
the canonical assignee, max buckets, agent budget ceiling). So an un-configured tenant behaves exactly as
today — the policy is **override-on-top**, never a prerequisite. (This is the crucial de-risking property:
shipping the table changes nothing until a tenant edits a rule.)

> **This table is the *tenant* level.** The full model has **three** levels (§12): the **platform
> framework** (RFP-admin, the control-plane defaults + the hard-to-tenant values), this **tenant** table,
> and the **portal** config (per-build, on `proposal_portals.guardrail_config`, templated from the last
> portal — §13). The resolver (§4) merges them by precedence.

---

## 4. The resolver (the single injection point)

```
resolveAutomationPolicy(tenantId, triggerKey, ctx) → ResolvedOverlay | null
```

- **Precedence (highest wins, §12):** explicit per-launch override → **portal** config → **tenant** policy
  → **platform** framework default. A launch site passes only what it must pin; everything else resolves
  down the chain. **Framework-hard values** (72h SLA, max buckets, overlay frameworks, agent skills/tools)
  are settable **only** at the platform level — a tenant/portal attempt to move them is refused, so the 72h
  curation SLA can't be tuned down by a tenant while per-portal *build* nudges stay tenant-owned.
- **Returns** `{ enabled, assigneeRole, assigneeUser?, recipientUserIds[], nudgeDays[], dueMinutes | dueAt,
  channel, cooldownMinutes, maxFiresPerHour }` — i.e. exactly the `ProjectCollaboration` overlay fields
  plus the resolved recipient set for NOTIFY beats.
- **`enabled=false` ⇒ safe-skip**, never a dead-end (the workflow safe-skips the NOTIFY/TODO per the
  engine's never-dead-end rule).
- **Call sites** (replace the hardcoded literals with a resolver call):
  - `launchProjectCollaboration()` callers — curation gate, build gates, collaborator onboarding.
  - the discovery **NOTIFY beats** after `OnCardApplied` / `OnSolicitationPushed`.
  - `evaluateAutomationRules()` — reads the policy as the tenant-scoped complement to admin rules (§6).
- **Recipient resolution** reuses `_final_notice_user_ids`' patterns: roles → users by
  `(tenant_id, role, is_active)`; `delegated_managers` → portal `guardrail_config`; `collaborators_at_stage`
  → `proposal_collaborators`. **Always union the admin floor** at the terminal nudge.

---

## 5. UI — the Automation tab grows from 6 toggles to the grammar

> **This is the tenant surface — one of three (decision ⑦ / §12).** The RFP-Pipeline **control-plane** page
> owns the framework (SLA, max buckets, overlay frameworks, agent settings + monitors); the **portal-build
> wizard** (§13) owns per-portal actors/timelines/nudges. This section is the middle one: the company
> admin's tenant tab.

`/portal/[slug]/manage` → **Automation** (today `automation-preferences-card.tsx`, 6 checkboxes) becomes a
per-trigger policy editor, still `tenant_admin`-gated, still emitting `capture:automation_preferences.updated`.

- **Grouped by the two vocabularies** (Discovery / Build), one row per trigger the tenant can govern.
- Each row: an **on/off** (the old boolean, preserved), then **Who** (role chips + user picker +
  "delegated managers"), **When** (a due window or a "before close date" offset), **Escalate** (a nudge
  cadence builder, e.g. `[1,3,5]`), **How** (email / todo / both).
- **The escalation floor is shown as a locked, non-removable chip** ("You (admin) always get the final
  notice — add managers to share it") so the invariant is visible, not hidden (decision ①).
- RFP-admin sees the **same editor in shadow** (already how `/manage` works) plus a platform-default
  view under `/admin/automation`.

Copy stays in the customer's language ("Give collaborators a heads-up as their stage approaches") — the
grammar is the plumbing, not the words.

---

## 6. Federation with the admin `automation_rules` engine (single-owner rule)

There are **two** evaluators and they must never both fire on one trigger (CLIFFNOTES Mistake 19 —
`namespace:type:phase` double-fire / one-owner-per-trigger):

- **`automation_rules` / `evaluateAutomationRules` (TS, admin-authored)** owns **admin-side, cross-tenant,
  simple single-hop reactions** (create an admin ToDo, notify the RFP admin). It is admin/finder scope.
- **`tenant_automation_policies` / `resolveAutomationPolicy` (tenant-authored)** owns **the per-tenant
  parameterization of the lifecycle templates** (build gates + discovery notifies). It is customer scope.

**Rule:** a trigger_key is owned by exactly one of them. Discovery/build lifecycle triggers → policy;
admin-ops triggers → automation_rules. The policy layer **reuses** the rules engine's proven machinery —
`automation_log` (start/finalize rows), `cooldown_minutes`, `max_fires_per_hour`, `conditionsMatch()` —
so policy-driven notifies are observable and rate-limited exactly like admin rules. **Decision ② (settled):
keep the two engines** — federated by the single-owner rule, not merged. Managers-being-admins is a
recipient/authority fact and doesn't blur the trigger-ownership split (a manager tunes via the tenant/portal
policy editor, never the RFP-ops console).

---

## 7. The agent fabric plugs into the SAME policy (automation + agent fabric, unified)

An `AI_INVOKE` step is just another step the engine parks/runs — so the policy governs agents with the
same four dimensions, plus two agent-specific ones:

- **Trigger → auto-run?** The policy row's `enabled` decides whether an agent archetype auto-runs on a
  trigger for this tenant (e.g. "AI review on advance" — already a boolean today; becomes a policy rule
  with recipients for where the advisory lands).
- **Recipients = where the advisory lands.** An agent's output is **advisory → guardrail → land-or-review**
  (never auto-writes business tables — `AGENT_WORKFORCE.md`). The policy's recipients decide *who is
  notified / whose review queue* the advisory routes to.
- **Escalation.** If the agent safe-skips (budget/round/guardrail stop), the policy's escalation still
  fires the human beat — the workflow never dead-ends.
- **Budget as a policy dimension, under a platform ceiling (decision ⑨).** The per-tenant policy sets the
  agent's auto-run budget/rate — but can only **lower** it below the **platform ceiling**, which is itself
  **RFP-admin-tunable** in the control plane (§12). The fabric's runaway caps (round/cost/rate/budget in
  `fabric.invoke_agent`) still bind regardless (`RATE_MONITORING.md` §2/§3) — a permissive policy raises
  cadence but never the ceiling.
- **RLS.** Agent auto-runs go through the `rfp_agent` NOBYPASSRLS path with `SET app.tenant_id` (mig 117);
  the policy is read tenant-scoped. No new isolation surface.

So the same Automation tab has an **AI agents** group (today 1 boolean, `ai_review_on_advance`) that
generalizes to: *which* agents auto-run on *which* triggers, *where* their advice lands, and *what budget*
they may spend — one grammar for humans and agents.

---

## 8. Migration & backfill (lossless supersession)

1. `1XX_tenant_automation_policies.sql` creates the table + RLS.
2. **Backfill from the 6 booleans:** each configured `tenant_automation_preferences` row → the equivalent
   policy rows (`notify_on_stage_advanced=true` → a `build`/`proposal:proposal.advanced` rule
   `enabled=true`, recipients=`{tenant_admin,tenant_user}`, default cadence; `ai_review_on_advance` → the
   agent rule; etc.). Un-configured tenants get **no rows** (they ride the platform default).
3. Keep `tenant_automation_preferences` **readable** for one release (dual-read) so nothing breaks
   mid-deploy; flip the card + routes to the policy table; then retire the booleans in a later migration
   (per the **drop rule** — superseded-with-successor + zero refs).
4. The card's `configured` flag and the `capture:automation_preferences.updated` event carry forward.

---

## 9. Monitoring (already a query, by design)

- Every policy firing writes an `automation_log` start/finalize row (reused engine) **and** the workflow
  step emits `system:workflow.step_started/completed` — so "did the notify fire, to whom, was it
  suppressed by cooldown" is SQL, not new instrumentation.
- `/admin/automation` shows platform defaults + a per-tenant policy view; `/admin/workflows` shows the
  live instances the policy parameterized; `/admin/agents` shows the agent auto-run spend the policy
  authorized. The river (`system_events`) remains the ground truth.

---

## 10. Resolved decisions (review 2026-07-22) — supersedes the prior gotchas

All nine review items are decided; the rest of this doc is updated to match. §12 (three-level tunability)
and §13 (portal-build & templating) carry the structural decisions from ⑦.

**① Escalation floor = the tenant admin (ALWAYS) + delegated managers + the RFP-Pipeline shadow backstop.**
The tenant admin is the **non-removable default on every final nudge** — they may *add* managers but can
**never offload accountability** and drop themselves (an admin who delegates duties to managers is *still*
notified). Delegated managers are **additive** on top; the **RFP-Pipeline shadow admin** ("us") is the
ultimate backstop when a tenant has no active admin/manager. So the floor is **admin-always ∪ managers ∪
platform-backstop** — never removable, never the void. (`_final_notice_user_ids` already always includes
the tenant admin + portal managers; the only change is adding the RFP-Pipeline-shadow backstop for the
no-active-recipient case.)

**② Two engines — CONFIRMED, and it holds even though managers are admins.** Managers-as-admins is a
*recipient / authority* fact (a delegated manager resolves with tenant_admin authority **on that portal**),
not a *trigger-ownership* fact. The federation splits by trigger owner (tenant lifecycle → policy engine;
RFP-ops → `automation_rules`), which who-counts-as-admin doesn't touch. It actually reinforces two: a
manager tunes automation through the **tenant/portal policy editor**, never the RFP-ops console. The
resolver just treats `delegated_managers` as carrying admin authority for "who may satisfy an admin gate."
**Still two.**

**③ "Priority OPP" = the bucket's parameters (extensible), else company-match + time-to-close.** When the
OPP sits in a bucket, that bucket's parameters (which we expand over time) define priority — the bucket IS
the predicate. With **no** bucket, priority = a match against the tenant's **company profile** + proximity
to the **close date**. No separate fixed predicate table.

**④ RLS cutover — IN SCOPE, via shadow-down; cross-tenant goes over the BRIDGE, not a content-BYPASS.**
Access model:
- RFP admin **shadows down** into a tenant portal (sets `app.tenant_id` to that tenant).
- Tenant admin shadows down into **their own** proposals.
- Everyone else lives at the **company (tenant) level** or as a **collaborator on a specific portal**.
Every actor is tenant-scoped, so the resolver's reads are correct under `NOBYPASSRLS`. **Cross-tenant is a
bridge conversation, never a cross-tenant SELECT of tenant data.** The platform ↔ tenant exchange runs over
the forward-only bridge as one of two shapes, and carries **system + solution information only — never
content** (the master-mirror invariant, generalized):
- **(a) information: request DOWN → response UP** — cron or on-demand (e.g. "how many active cards / open
  gates?"). The tenant scope answers with counts/status; the platform aggregates the **answers**, not the rows.
- **(b) control-tuning: update DOWN → ACK/NAK UP** — a framework/control change from the RFP-admin control
  plane (§12) pushed down; the tenant scope applies it and returns ACK/NAK.
So platform dashboards aggregate **bridge system-info** the tenant pushed up (no BYPASS read of tenant
tables), and genuinely per-tenant reads (e.g. CMS `matched_opportunities`, already `WHERE tenant_id=$1`)
run tenant-scoped. **Net: no content-reading BYPASS connection is needed at all** — cleaner than owner-views,
RLS stays pure, and it's the same "system/solution info up, no customer data" rule the OPP bridge already
enforces. Concur — and this makes the RLS cutover a bridge-wiring job, not a BYPASS-carve-out.

**⑤ No card without dates — the null anchor is designed out.** An OPP card **cannot be created without an
open AND a close date**, and **may never pass its expected open date without an expected close date**
(enforced RFP-admin-side at ingest). If the org hasn't published, the RFP admin enters **ESTIMATED** dates
(`is_estimated=true`); when the org publishes, they upgrade to **OFFICIAL**. So `relative_to: close_date`
always has an anchor — the degrade path is deleted.

**⑥ Regulator — build it, low priority; delivery is cron digests; the DB is sacrosanct.** Build the
cooldown/rate regulator but it's not urgent. Delivery is **cron-based**: a batched **summary update +
ToDo notifications**, not a per-event firehose. **Hard rule: everything lands in the DB first** — the
ToDo/notification rows exist regardless of delivery cadence; nothing is ever dropped.

**⑦ Everything is tunable — at three levels** (platform / tenant / portal). This replaces "tunable vs
pinned": the 72h SLA, max #buckets, workflow-overlay frameworks, and agent skills/tools/budget-ceiling are
*hard to the tenant* but **RFP-admin-tunable** in a special control-plane page; the tenant tunes buckets +
roles + nudges; the portal tunes per-build actors/timelines/nudges. Full model in **§12**; the portal
build wizard + templating in **§13**.

**⑧ Frozen-vs-live = the gate model. Sound.** Anything **ahead of the active build phase** is tunable;
the **current phase and previously-locked phases are frozen**. You change things by **setting up the next
phase and force-advancing** — exactly what the gates already enforce. Policy edits therefore land on future
phases; an in-flight phase keeps its launched `nudge_schedule`.

**⑨ Agent budget — tenant lowers within a platform ceiling the RFP admin tunes.** A tenant policy can only
**lower** an agent's budget below the platform ceiling (fail-safe), and the **ceiling itself is
RFP-admin-tunable** in the same control plane (⑦/§12).

---

## 11. Build order (once the design is signed off)

1. Migration + tables + RLS + the **platform framework** row (§12) seeded from today's constants
   (72h SLA, max buckets, overlay frameworks, agent skills/tools/budget-ceiling). Ships inert.
2. **Card-creation date guard (⑤):** require open+close (estimated or official, `is_estimated` flag) at
   card creation, RFP-admin-side; block a create that passes expected-open without expected-close.
3. `resolveAutomationPolicy()` + unit tests; repoint `launchProjectCollaboration` callers to it
   (behavior identical while every tenant rides the framework default). Precedence per §12.
4. Discovery NOTIFY beats + build TODO gates read the resolver; escalation floor → managers-then-platform (①).
5. Backfill the 6 booleans → tenant policy rows; dual-read.
6. The three editing surfaces (§12): RFP-Pipeline **control-plane** page (framework + agent settings +
   monitors), the tenant **Automation** tab (buckets/roles/nudges), the **portal-build wizard** (§13).
7. Agent-fabric dimensions (auto-run enable + advisory recipients + budget-within-ceiling) on the rows.
8. Retire `tenant_automation_preferences` (drop rule) once zero refs.
9. Verify: `tsc`/`vitest`/`pytest wiring` + a live drive of one discovery + one build policy end-to-end,
   incl. the gate rule (⑧: edit a future phase = takes; edit the active phase = refused).

---

## 12. The three-level tunability model (⑦)

Everything is tunable — the question is *by whom*. Three levels, most-specific-wins **within what each
level is allowed to set**:

| Level | Who tunes it | What's tunable | Surface | Overridable below? |
|---|---|---|---|---|
| **Platform (framework)** | **RFP-Pipeline admin** | 72h review SLA · max #buckets · standard workflow-overlay frameworks · agent settings (skills · tools · **budget ceiling**) | a special **"this changes the framework"** control-plane page (same surface as the system-state / operations monitors) | **No** — these read as *hard* to tenant + portal; only the RFP admin moves them |
| **Tenant** | **company admin** | bucket creation + simple report/nudge rules (ToDo + email, **≤3 nudges timed off the OPP dates** on the mirror card) · which roles may **update / view / pin** OPPs · who may **purchase** a portal | the tenant **Automation** tab in `/manage` | overrides framework *defaults* where the framework allows |
| **Portal** | **company admin at build** (RFP admin in shadow) | per-portal **actors · timelines · nudge cycles** + first-draft mode (§13) | the **portal-build wizard** | most specific; **templated from the last portal** (§13) |

**Resolution precedence (high → low):** explicit launch override ▸ **portal** config ▸ **tenant** policy ▸
**platform** framework default. Framework-hard values (SLA, max buckets, overlay frameworks, agent
skills/tools) are set **only** at the platform level — a tenant/portal edit that tries to move them is
refused, not silently applied. This is the enumeration ⑦ asked for: *hard-to-tenant / RFP-tunable* =
{SLA, max buckets, overlay frameworks, agent skills·tools·budget-ceiling}; *tenant-tunable* =
{buckets, their nudge/report rules, OPP roles, purchase rights}; *portal-tunable* =
{actors, timelines, nudge cycles, first-draft mode}.

**Release note (from ⑦):** the 72h is the **RFP-admin** window to review + build the matrix + release,
at the RFP-Pipeline level — and a build may be released **as soon as** the matrix + skeleton are ready
(not forced to wait), or updated later by the RFP admin (which **pushes updates down the secondary
spines**). Once released to a purchasing tenant, the release is **pushed to all tenant OPP cards**, so a
**later purchaser gets the build immediately**.

---

## 13. Portal-build configuration & templating (⑦)

At portal build (company-admin level; an RFP admin can do it in shadow), a wizard sets — **per portal**:

1. **First-draft mode** — an **"Agent first"** checkbox (agents draft V0), else the RFP admin / company
   admin drafts the first copy by moving down into the tenant portal. (All three paths already exist; this
   is the selector.)
2. **Manager setup** — assign the portal's managers (they carry admin authority, ②). The **RFP-Pipeline
   shadow admin is PRE-CHECKED**; unchecking it raises an **explicit opt-out modal** ("you're declining
   RFP-Pipeline oversight on this build") so the decline is deliberate and audited.
3. **Actors · timelines · nudge cycles** — the per-portal build cadence that feeds the guardrail
   workflow's TODO gates (≤3 nudges → the floor in ①).

**Templating:** the **first** portal is **clean and must be completed**; **every subsequent portal is
templated from the last** — the prior portal's config carries forward as editable defaults. A tenant
configures once and thereafter refines. (Mechanically: the wizard seeds the new `guardrail_config` +
portal policy rows from the most recent completed portal for that tenant.)

---

*This design adds config tables, a resolver, and three editing surfaces on top of the existing start→end
engine — no new workflow infrastructure. The gate, the reconcilers, the escalation floor, and the templates
are all already built and proven; #190 is where the tenant's — and the RFP admin's — voice enters the
machine, at the right level.*
