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
  `user_ids`, the sentinel `delegated_managers` (portal `guardrail_config` managers), and
  `collaborators_at_stage` (the `proposal_collaborators` for the gate's stage). **The admin final-notice
  invariant is NOT a recipient — it is a floor** (§7): recipients are *added on top of* the admin, never
  instead of.
- **Trigger (which event).** A `trigger_key` = a namespaced lifecycle event (`capture:card.applied`,
  `proposal:proposal.advanced`, `proposal:document.locked`, `finder:solicitation.pushed`, …). Optional
  `condition` predicate over the event payload (reuses `conditionsMatch()` from `lib/automation/match`).
- **Timing (when, on the clock).** Either an **absolute** window `due_in_minutes` (build-side: "72h to
  set up", "5 business days to draft"), or a **relative** anchor `relative_to: {anchor: 'close_date',
  offset_minutes: -20160}` (discovery-side: "nudge 2 weeks before the solicitation closes"). The anchor
  reads a real column on the entity (`opportunities.close_date`, `tenant_opportunity_cards`,
  `proposals`). Resolves to `due_at` on the `tasks` row.
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

**Defaults are a system row, not per-tenant seeding.** A tenant with no row for a trigger falls back to a
**platform-default policy** (a code constant = today's hardcoded values: `[1,3]`, 72h, the canonical
assignee). So an un-configured tenant behaves exactly as today — the policy is **override-on-top**, never
a prerequisite. (This is the crucial de-risking property: shipping the table changes nothing until a
tenant edits a rule.)

---

## 4. The resolver (the single injection point)

```
resolveAutomationPolicy(tenantId, triggerKey, ctx) → ResolvedOverlay | null
```

- **Precedence (highest wins):** explicit per-launch override (a bridge that *must* pin a value) →
  tenant policy row → platform-default constant. A launch site passes only what it must pin; everything
  else comes from policy/default. This keeps the 72h curation SLA pinnable by the release path while
  letting a tenant tune its *build* nudges.
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

`/portal/[slug]/manage` → **Automation** (today `automation-preferences-card.tsx`, 6 checkboxes) becomes a
per-trigger policy editor, still `tenant_admin`-gated, still emitting `capture:automation_preferences.updated`.

- **Grouped by the two vocabularies** (Discovery / Build), one row per trigger the tenant can govern.
- Each row: an **on/off** (the old boolean, preserved), then **Who** (role chips + user picker +
  "delegated managers"), **When** (a due window or a "before close date" offset), **Escalate** (a nudge
  cadence builder, e.g. `[1,3,5]`), **How** (email / todo / both).
- **The admin final-notice is shown as a locked, non-removable chip** ("Your admin always gets the final
  notice") so the invariant is visible, not hidden (§7 gotcha 1).
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
so policy-driven notifies are observable and rate-limited exactly like admin rules. (Implementation
option: the policy resolver *emits synthetic `automation_rules`-shaped rows* the same evaluator consumes,
vs. a parallel evaluator. Open decision — §10.)

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
- **Budget as a policy dimension (new).** The per-tenant policy carries the agent's **budget ceiling /
  rate** for auto-runs, enforced by the fabric's existing runaway caps (round/cost/rate/budget in
  `fabric.invoke_agent`). A permissive policy can raise cadence but the caps still bind
  (`RATE_MONITORING.md` §2/§3).
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

## 10. Open decisions & GOTCHAS (for review — look here first)

1. **Admin final-notice floor is non-negotiable.** Recipients are **additive**; the policy UI must render
   the admin(+managers) terminal beat as a **locked** chip. A tenant must not be able to configure a gate
   whose escalation never reaches a human who can act. *Decision needed: is the floor admin-only, or
   admin-OR-any-active-tenant_admin if the primary is inactive?* (`_final_notice_user_ids` picks the
   oldest active admin — confirm that's the desired tie-break.)
2. **Supersession vs. parallel-run.** Do we (a) generalize `automation_rules` to carry a `tenant_id` +
   the extra dimensions and have ONE evaluator, or (b) keep two tables/evaluators federated by the
   single-owner rule (§6)? (b) is less refactor and keeps admin vs. tenant scopes clean; (a) is one
   engine but risks the double-fire class. **Leaning (b).**
3. **"New priority opportunity" needs a definition.** The discovery trigger `notify_on_new_priority_opp`
   is a boolean today; as a policy it needs a *predicate*: top-N by `rank_score`? a score threshold?
   focus-agency match? entered a named bucket? This sub-grammar can balloon — **scope it to a small,
   fixed predicate set v1** (threshold + focus-agency), extensible later.
4. **RLS-cutover.** The resolver reads `tenant_automation_policies` (RLS-forced). Tenant-scoped launches
   are fine (they set `app.tenant_id`). But any **cross-tenant admin read** of policy (the `/admin`
   platform view) must run on a BYPASS connection / owner-view — same caveat as the retired-table
   repoints (launch-readiness item #9, `DEPRECATION_CLEANUP_2026-07-22.md`).
5. **Timing anchor data availability.** `relative_to: close_date` requires the card/opp to carry a
   reliable `close_date`; some sources don't. Fallback: if the anchor column is null, degrade to a
   sensible absolute window and **log the degradation** (no silent "never nudged").
6. **Cooldown/rate on discovery notifies.** A tenant watching many buckets could be spammed on a busy
   push. Policy rows carry `cooldown_minutes`/`max_fires_per_hour` (reused) — but we need a sane default
   so a fresh policy isn't a firehose.
7. **Per-launch override precedence.** The 72h curation SLA is a **business rule**, not a tenant knob —
   the release path pins it via the explicit-override tier (§4). We must enumerate which values are
   **tenant-tunable** vs **platform-pinned** so a tenant can't, e.g., set the admin curation gate to
   30 days.
8. **Frozen-at-launch vs. live policy.** Portal `guardrail_config` is **frozen at accept-launch** (mig
   097). If a tenant edits policy mid-build, does the running portal pick up new nudges? **Proposal:**
   policy edits affect **future** launches + **future** nudge computations, but a running instance's
   already-written `nudge_schedule` stays as launched (consistency with the frozen guardrail). Confirm.
9. **Agent budget in policy vs. fabric default.** If policy carries a per-tenant agent budget, reconcile
   it with the fabric's platform default (`monthly_budget`) — policy can only **lower** below the
   platform ceiling, never raise above it (fail-safe).

---

## 11. Build order (once the design is signed off)

1. Migration + table + RLS + platform-default constant (ships inert — no behavior change).
2. `resolveAutomationPolicy()` + unit tests; repoint `launchProjectCollaboration` callers to it
   (behavior identical while every tenant rides the default).
3. Discovery NOTIFY beats + build TODO gates read the resolver.
4. Backfill the 6 booleans → policy rows; dual-read.
5. The Automation-tab editor (grammar UI) + the locked admin-floor chip.
6. Agent-fabric dimensions (auto-run enable + advisory recipients + budget) on the same rows.
7. Retire `tenant_automation_preferences` (drop rule) once zero refs.
8. Verify: `tsc`/`vitest`/`pytest wiring` + a live drive of one discovery + one build policy end-to-end
   (edit policy → trigger event → correct recipients/timing/escalation in the `tasks` row + `system_events`).

---

*This design adds a config table, a resolver, and an editor on top of the existing start→end engine —
no new workflow infrastructure. The gate, the reconcilers, the escalation floor, and the templates are
all already built and proven; #190 is where the tenant's voice enters the machine.*
