# Event Audit — 2026-08-14 (follow-on to EVENT_AUDIT_2026-08-02)

Swept every **state-changing** action added since the 2026-08-02 sweep — the template-bridge →
NILOC arc, the scout-intake candidate queue, the HITL-ToDo framework, partner console, rfp-curation
amendment engine, provision/archive, and the overlay/agent wiring — against the event contract:

- **Namespaces** (exactly): `finder` (admin/platform) · `capture` (customer) · `identity` (auth) ·
  `proposal` (workspace) · `library` (content) · `system` (infra) · `tool` (invocations). Never
  `admin`/`cms`/`spotlight`.
- **Type** = `entity.action_past_tense` (snake_case). **Admin** actions `tenantId=null`; **portal**
  actions the real tenant UUID.
- **Single** via `emitEventSingle`; a multi-step op a workflow could consume emits a **start→end
  pair** (`emitEventStart`/`emitEventEnd`).

Purpose (per the request): every actor/automation/agent/human action that changes state posts an
auditable event, and **even actions not in a workflow today declare their reporting contract** so
future workflows can consume them.

## Result

~**56 state-changing actions** across three clusters. **No namespace / format / tenantId
violations** anywhere. **3 hard gaps** (silent writes) — all fixed this pass — plus a few soft
observations and one guard blind-spot.

### Fixed (commit `d7e5fed`)

| Surface | Action (was silent) | Now emits | tenantId | shape |
|---|---|---|---|---|
| `template-cards/[cardId]/ack/route.ts` | tenant acknowledges a refreshed template card | `library.template.acknowledged` | UUID | single |
| `lib/portal-workflow.ts` `advancePortalStage` | portal → executing / closeout (both paths; covers ToDo-completion auto-advance **and** explicit advance-stage) | `capture.portal.stage_advanced` | UUID | single |
| `lib/scout/candidates.ts` `materializeExtractedOpportunities` | scout→candidate-queue on-ramp (INSERT scout_findings loop) | `finder.candidates.materialized` | null | **start/end** |

### The reporting contract already in place (representative — all verified OK)

- **Template bridge** — fan-out audited as one `library.template.applied` per tenant from
  `applyTemplateToTenant` (canonical mirror of `capture.card.applied`); instantiate →
  `library.document.created`; atomize-on-download → `library.document.atomized`; admin push →
  `library.template.published` / `library.template.stable_synced` (tenantId=null).
- **Scout / intake** — `finder.opportunity.staged` + `finder.opportunities.detected` (the wake),
  `finder.candidate.{classified,released,dismissed}`, `finder.source.{scouted,change_detected}`,
  `finder.amendment.{detected,confirmed,dismissed}` (start/end) + `capture.amendment.flagged` per
  tenant, `finder.compliance.preset_applied` (start/end).
- **Partner** — `finder.tenant.{created,provisioned}`, `finder.partner.{manager_requested,
  manager_granted,manager_declined,entered,exited,company_dedup_reviewed}`,
  `capture.application.submitted`.
- **HITL / proposal / provision** — `proposal.task.{assigned,completed}` (broadcast/thread carry
  disposition), `proposal.proposal.created` (start/end), `proposal.proposal.{archived,restored}`
  (start/end), `proposal.proposal.full_draft_requested` (start/end), `library.package.atomized`,
  `library.atom.{created,archived,restored}`.

## Guard blind-spot (worth tightening)

`__tests__/audit-coverage.test.ts` marks a route "audited" if the route **or any 1-hop import**
matches `AUDIT_SIGNAL` (which includes the bare literal `system_events`). Because `lib/auth.ts` —
imported by every authenticated route — contains a raw `INSERT INTO system_events`, a route can pass
the presence check purely via its `@/auth` import even with zero `emitEvent*` calls. All three gaps
above hid behind this (the `ack` route via `@/auth`; `advancePortalStage` via an unrelated
`createTask`; `materializeExtractedOpportunities` is 2 hops from any route, outside the 1-hop scan).
**Recommendation:** exclude `lib/auth.ts` from the 1-hop audit-signal set (and/or require the emit
in the route/lib that owns the write), so this class can't recur silently.

## Punch-list (documented, not fixed — mostly pre-existing or optional)

- `lib/portal-launch.ts` `revokeShadowAdmin` (L133) revokes admin access with no event
  (pre-existing) → `finder.shadow_admin.revoked` (single, tenant).
- `lib/agent-client.ts` `requestAgentTask` enqueues to `agent_task_queue` (durable, guard-recognized
  audit table; the pipeline emits `tool.agent.invoked` on run) but posts nothing to the event spine
  at **dispatch** → optional `tool.agent.dispatch` (single) for enqueue-time visibility.
- `lib/template-stable-sync.ts` new/changed `master_templates` are captured only in the route's
  aggregate `template.stable_synced` → optional per-master `library.master_template.{created,updated}`.
- Niceties: add `candidatesQueued` to the `finder.source.scouted` payload; carry the tenant UUID on
  `finder.partner.exited` to mirror `partner.entered`; consider a start/end bracket on the long
  admin template-stable **sync** batch (all catalog × all tenants, per-entry partial failure).

## Verification

`npx tsc --noEmit` → 0 · `npx vitest run __tests__/event-contract.test.ts __tests__/audit-coverage.test.ts`
→ pass. (DB-live replay of the new events is pending the sandbox DB.)
