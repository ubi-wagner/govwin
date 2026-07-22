# Customer-Admin (& Shadow-Admin) Manage Console — Design

**Status:** design + Phase 1 build. Successor surface to the scattered admin sibling
pages. Read `ARCHITECTURE_V10.md` and `docs/MASTER_MIRROR_OPP_DESIGN.md` first.

This is **"Page 2"** of the tenant-admin experience. Page 1 is the cockpit
(`/dashboard`) where an admin acts as a *full-access user*. Page 2 is the **Manage
console** (`/manage`): where an admin (or a descended RFP shadow-admin) **sets up and
governs** the whole customer lifecycle.

> **The spine it manages, end to end:**
> **subscribe → spotlight (buckets) → buy (portal) → build → close out → rinse/repeat**

Every tab hangs off that spine, and **one automation grammar** runs through all of it.
The same console + grammar is the template for the **RFP-Admin construct** (the mirror
image on our side of the one-way bridge).

---

## 1. Placement & gating

- **Route:** `app/portal/[tenantSlug]/manage/page.tsx` → `/portal/[tenantSlug]/manage`.
  Nests under the portal `layout.tsx`, so it inherits `NavShell`, the singular-session
  pin checks, and `ShadowSpaceBanner` for free.
- **Gate (page + nav link):** `hasRoleAtLeast(role, 'tenant_admin')`.
  - Admits `tenant_admin` (rank 60) **and the descended shadow admin** — a shadowing
    RFP/master admin keeps `role='rfp_admin'`/`'master_admin'` (rank 80/100); the
    "tenant_admin-in-session" is purely a rank compare (`lib/rbac.ts:100-112`,
    `lib/db.ts:57`). Strict `=== 'tenant_admin'` would lock every shadow admin out.
  - Excludes base `tenant_user` (40) and `partner_user` (20). Middleware only enforces
    the coarse `/portal` floor, so the page **must** carry this gate itself.
- Copy the gate block from `billing/page.tsx:33-52` verbatim. Nav link sits with the
  other admin links in `layout.tsx` (region ~116-135), gated by the already-computed
  `isTenantAdmin`.

---

## 2. Information architecture

The console mirrors the landing shell: a **center** that shows the lifecycle home (or
what you're doing), a right **`IndicatorRail`** of tiles, and one right **`Drawer`** per
surface (each self-loads on open). Pattern lifted from `components/portal/cockpit.tsx`.

**Center — Lifecycle home.** Where the tenant is on the spine: subscription state +
counts (active buckets, matched OPPs, active builds, open ToDos, library size) + quick
actions. It answers "what should I do next" at a glance.

**Rail tiles → drawers:**

| Tile | Surface | Reuses (survey) |
|---|---|---|
| **Account** | subscription/billing + company profile/settings | `BillingPanel` (default export), `ProfileEditor` (named) — server-loaded props mirrored from `billing/page.tsx` + `profile/page.tsx` |
| **Buckets** | create/edit spotlight buckets = *definition + context + content* over the master-mirror OPP list; each bucket lists its OPPs (archived/active/pending) | `SpotlightBuckets {tenantSlug, canEdit}` (default) |
| **Users & collaborators** | roster: create/invite member, change role, deactivate/reactivate; invite/revoke collaborators. Per-surface access (bucket pin, library edit, workflow actor) is granted in *those* admins, not here | `TeamInviteForm`, `TeamMemberActions` (named), `GET /team`; **gap-fills** in Phase 2 |
| **Portals & workflow** | purchased portals; each *is* workflow setup — actors → phases → task-list-per-phase → nudge protocol | `ProposalPortals {tenantSlug, canManage, isExpert}` (default); **authoring UI** in Phase 4 |
| **Automation** | **global** (tenant-level, not per-bucket): who gets ToDos/notifications/nudges, on what logic, timed off OPP open/close dates, last nudge = final notice | `AutomationPreferencesCard` (named) today; **policy layer** in Phase 3 |
| **AI usage** | agent usage/oversight | `AgentUsagePanel {tenantSlug}` (named) |

**Design rule:** buckets never own automation. Buckets are *lenses + context-matching*
on the always-searchable master-mirror OPP list; the **who/what-logic/timing lives at
tenant level** in the Automation policy. This is exactly what the last-message vision
calls out ("global and not per bucket").

---

## 3. The unifying automation grammar (the heart)

One sentence, reused on both sides of the spine:

> **`recipients` × `trigger/what-logic` × `timing` × `escalation` × `channel`**

- **recipients** — which internal users (or roles) get told. *(New: no recipient config
  exists today; recipients are hardcoded to `billing_email`/first `tenant_admin`/a task's
  single assignee.)*
- **trigger / what-logic** — `top_n` (e.g. only the top-20 by bucket score), `agencies`
  (a tenant-global allowlist, e.g. Navy / Air Force), or an `event` (pin, OPP change,
  stage advance). *(New: today only a fixed score `≥ 50` gate; `automation_rules`
  conditions are equality-only — no top-N, no set-membership.)*
- **timing** — relative to each OPP's **open/close date** (N days before close, N days
  after open) or a phase deadline. *(Partial today: only a hardcoded `[7,3,1]`-day
  `final_due` task off `close_date`; no open-date timing, no configurable cadence.)*
- **escalation** — a nudge cadence `[d1,d2,d3]` where the **last nudge is the final
  notice** and always includes the manager/recipient. *(Reuse: `tasks.nudge_schedule`,
  `tasks.nudges_sent`, and `_sweep_task_nudges`'s `is_final` → manager email already
  exist — the recipient just needs to become config-driven instead of "oldest
  tenant_admin".)*
- **channel** — `todo` (a `tasks` row), `notify` (the bell feed), or `nudge` (email).

**Two vocabularies, one engine:**

- **Discovery side (buckets/OPPs):** trigger = *pin / enters top-N / agency match / OPP
  change*; timing = *days from open or close*; recipients = *these users*. Emits
  company-level ToDos + notifications/nudges off the master-mirror card list.
- **Build side (portals):** trigger = *phase task due / actor assigned / stage advance*;
  timing = *from the phase deadline*; recipients = *the phase's actors*.

Same `recipients × trigger × timing × escalation × channel` grammar — which is precisely
what lets the **RFP-Admin construct** fall out later as the mirror (our staff as the
recipients, curation/release phases as the triggers).

### 3.1 Data model — `tenant_automation_policies` (Phase 3)

A tenant-level policy row (global; **not** keyed to a bucket):

```
tenant_automation_policies(
  id, tenant_id,
  name text,
  channel text CHECK (channel IN ('todo','notify','nudge')),
  -- what-logic
  trigger_kind text CHECK (trigger_kind IN ('top_n','agency','event')),
  top_n int,                       -- when trigger_kind='top_n'
  agencies text[],                 -- when trigger_kind='agency' (tenant-global allowlist)
  event_types text[],              -- when trigger_kind='event' (e.g. topic.pinned, card.updated)
  -- timing (relative to the OPP's open/close date)
  timing_anchor text CHECK (timing_anchor IN ('open','close','none')),
  days_before int,                 -- negative → after the anchor
  -- recipients
  recipient_user_ids uuid[],       -- explicit users …
  recipient_roles text[],          -- … and/or role buckets (tenant_admin always implied)
  -- escalation
  nudge_days int[],                -- cadence; last entry = final notice (adds the manager)
  -- housekeeping
  is_active boolean default true, created_by, created_at, updated_at
)
```

A **materializer** (a pipeline sweep, sibling to `_sweep_date_anchored_tasks`, or a
frontend cron) walks each active policy against the tenant's `tenant_opportunity_cards`
(+ `tenant_bucket_scores` for `top_n`), and for each matching card materializes a `tasks`
row / notification with `nudge_schedule = nudge_days`, `assignee_*` from `recipients`,
`due_at` from `timing`. Idempotent on `(policy_id, opportunity_id)`. The existing
`_sweep_task_nudges` then drives the escalation + final notice for free.

**Shadow-admins and admins always see & pin** — the policy governs *notification*, never
*visibility*; visibility/pin authority is the delegated grant handled elsewhere.

---

## 4. What exists vs. what we build (reuse map)

Condensed from the four subsystem surveys. **Most of the backend already exists** — the
console is largely the missing paneled *home* + a small set of gap-fills.

### Shell — 100% reuse
`NavShell`, `Drawer`, `Modal`, `IndicatorRail`, the `cockpit.tsx` compose pattern +
`DrawerShell` helper, `useContainerScale`. New route + one client `ManageConsole`.

### Account — reuse
`BillingPanel` + `ProfileEditor` with server-loaded props (mirror the two existing
pages). No new backend.

### Buckets — reuse
`SpotlightBuckets` (async rank + queued banner already fixed). No new backend for Phase 1;
"upload→atomize into library *as* you attach to a bucket" is a later enhancement.

### Users & collaborators — reuse + **gaps (Phase 2)**
- Reuse: create/invite member (`POST /team`), deactivate/reactivate
  (`DELETE`/`POST /team/[userId]`, universal soft-delete + last-admin guard), list
  (`GET /team`), invite/revoke collaborator (per-proposal routes).
- **Gaps:** (1) **no change-role route** — promoting/demoting an active member is
  impossible today → `PATCH /team/[userId]`; (2) collaborator management is
  **per-proposal only** — no tenant-level invite/revoke; (3) no "add existing / cross-org
  person as a `manual` membership"; (4) create always emails a temp password.

### Portals & workflow — reuse engine + **gaps (Phase 4)**
- Reuse: the whole System-A engine — `GuardrailConfig`/`Stage`/`StageTodo`/`Collaborator`
  types, `validateGuardrailConfig`, `instantiatePortalWorkflow`, `advancePortalStage`,
  the `tasks` ledger, and the already-built nudge + **final-notice-to-manager** runtime.
- **Gaps:** (1) **no authoring UI** — per-portal config is a hardcoded `DEFAULT_GUARDRAILS`
  constant; (2) `collaborators[]` is validated but **inert** (never creates real
  collaborator/stage-access rows or todo assignees); (3) final-notice recipient hardcoded
  to oldest `tenant_admin` + role-bucket todos never email; (4) no named/reusable
  templates in `guardrail_templates`; (5) two overlapping stage-requirement stores to
  reconcile (`guardrail_config` vs `proposal_gate_requirements`).

### Automation — reuse primitives + **build the policy layer (Phase 3)**
- Reuse: `tasks.nudge_schedule`/`nudges_sent`/`is_final`, `_sweep_task_nudges`,
  `_sweep_date_anchored_tasks`, the `tenant_automation_preferences` toggle gate, and the
  `automation_rules` engine.
- Build: `tenant_automation_policies` (§3.1) + materializer + console UI. Make the
  final-notice recipient config-driven.

---

## 5. Phased plan

| Phase | Deliverable | Risk |
|---|---|---|
| **1 — Shell** | `/manage` route + gate + nav link; `ManageConsole` (center lifecycle-home + rail + drawers) mounting **all existing** surfaces (Account, Buckets, Users, Portals, Automation, AI usage). Additive; existing pages untouched. | Low — pure composition |
| **2 — Users** | `PATCH /team/[userId]` change-role + UI; tenant-level collaborator invite/revoke; add-existing/cross-org `manual` membership; unified roster. | Med — new route + membership writes |
| **3 — Automation policy** | `tenant_automation_policies` + routes + console editor + materializer; config-driven final-notice. The grammar made real. | Med/High — new table + pipeline sweep |
| **4 — Portal workflow authoring** | `GuardrailConfig` editor (stages/tasks-per-phase/actors/nudges) → named `guardrail_templates`; wire `collaborators[]` → real rows + assignees; config-driven manager; reconcile gate stores. | High — engine wiring |
| **5 — Polish + mirror** | Lifecycle-home polish; account completeness; document the RFP-Admin mirror of this console + grammar. | Low |

Each phase: build → `tsc` 0 + `vitest` green → drive/DB-prove where it matters → commit →
push → report at the gate.

**Every phase is additive.** The existing `/billing`, `/profile`, `/buckets`, `/portals`,
`/automation`, `/agents`, `/team` pages remain as deep links; the console is their unified
home, not their replacement.

---

## 6. RFP-Admin mirror (why this is foundational)

The one-way bridge has a **master + mirror** shape. This console is the **mirror/tenant**
side of governance. The **master/RFP-Admin** construct is the same console with the same
grammar, re-pointed:

- **recipients** = our staff (curation_qa, release approvers) instead of the tenant team.
- **trigger/what-logic** = curation SLA breaches, top-N solicitations to triage, agency
  focus, purchase→curation_pending events.
- **timing** = the 72h curation SLA anchor instead of OPP open/close.
- **escalation** = the same `nudge_days` + final-notice, to the RFP-admin manager.

Building the tenant console first gives us the reusable `recipients × trigger × timing ×
escalation × channel` engine, the paneled shell, and the policy table — the RFP-Admin
side then mounts the same primitives against the master tables.
