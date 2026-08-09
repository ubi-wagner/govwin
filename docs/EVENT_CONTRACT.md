# Event / Audit Contract — the binding specification

**Status:** canonical. This is the spec `frontend/lib/events.ts`, `pipeline/src/events.py`, and
`services/cms/src/models/events.py` reference. It defines the shape of every audited action across
the platform, the start/end/single pattern, the namespace registry, and the enforcement that keeps
them uniform. Auditing is a government-compliance requirement and our fastest regression signal, so
the rule is absolute: **no state-changing action without a `system_events` row, and every row obeys
this contract.**

Companion records: `docs/EVENT_AUDIT_2026-08-02.md` (platform sweep), `docs/EVENT_AUDIT_2026-08-08.md`
(partner-manager + the write-coverage guard).

---

## 1. The event row (`system_events`, mig 007)

Every audited action writes one or more rows to the shared `system_events` table (all three services
write the *same* table — it is the cross-service bus + the audit spine):

| Column | Meaning |
|---|---|
| `id` | uuid PK |
| `namespace` | the domain that owns the event — see §4 registry |
| `type` | `entity.action_past_tense` (snake_case) — see §3 |
| `phase` | `start` \| `end` \| `single` — see §2 |
| `actor_type` | `user` \| `system` \| `pipeline` \| `agent` |
| `actor_id`, `actor_email` | who acted (email nullable) |
| `tenant_id` | the affected tenant's uuid, or **NULL for admin/platform events** (§5) |
| `parent_event_id` | on an `end` row, the `id` of its `start` row |
| `payload` | jsonb — event detail (written as an OBJECT via `sql.json`, never a `::jsonb` string) |
| `error` | jsonb — populated on a failed `end` row; the poll loop reads it to skip failed ops |
| `duration_ms` | computed on `end` from the cached `start` timestamp |
| `created_at` | now() |

## 2. The three emitters (start / end / single)

There is exactly **one choke point per service**; call sites never `INSERT INTO system_events`
directly except the six audited pipeline paths noted in §6.

- **`emitEventSingle`** — one instantaneous event (a sign-in, a save, a grant). `phase='single'`.
- **`emitEventStart` → `emitEventEnd`** — brackets a multi-step operation. `start` returns an id;
  `end` references it via `parent_event_id`, carries `duration_ms`, and on failure carries `error`.
  `emitEventEnd` re-derives `namespace`/`type`/`actor` from the `start` row, so a handler passes them
  once. **Invariant:** a handler that emits `start` MUST emit `end` on *every* exit path (success
  return AND catch block) — which is why the source has ~1.6 `end` calls per `start`.

Emitters are **best-effort and MUST NEVER throw** — instrumentation failure logs via `lib/logger`
but never breaks the business logic it instruments.

Frontend: `frontend/lib/events.ts` (`emitEventStart`/`End`/`Single`, `userActor`/`systemActor`/
`pipelineActor`/`agentActor`). Pipeline: `pipeline/src/events.py` (`emit_event`/`emit_start`/`emit_end`,
seeds a `correlationId`). CMS: `services/cms/src/models/events.py` (`emit_system_event` — the single
CMS→bus choke point; `system`/`identity` only, never a `cms` namespace).

## 3. Type format

`type = entity.action_past_tense`, snake_case, at least one dot. Examples: `partner.entered`,
`proposal.advanced`, `application.accepted`, `section.locked`, `manager.manager_granted`.
Regex: `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`.

**Documented exceptions** (allowlisted in `__tests__/event-contract.test.ts`):
- `tool:invoke` — the generic tool-invocation bracket. The bare action is the `type`; the phase
  (start/end) lives in the `phase` column (`tool·invoke·start` / `·end`); the specific tool is in the
  payload (`lib/tools/registry.ts`). Adding an exception is a reviewed decision.

## 4. Namespace registry

Exactly **seven** event namespaces. **Never** `admin`, `cms`, or `spotlight`.

| Namespace | Owns |
|---|---|
| `finder` | Admin / platform ops: ingest, curation, sources, scoring, solicitations, tenant lifecycle, **partner-manager** (`partner.*`), documents. Admin events → `tenant_id = NULL`. |
| `capture` | Customer lifecycle: applications, purchases/subscriptions, buckets, team, portals, profile, workspace release. |
| `identity` | Auth only: sign-in, consent, invites, password reset/change. |
| `proposal` | The proposal workspace: create/advance/lock/unlock/archive/restore, sections, comments, compliance, packaging, outcomes, full-draft, review phases. |
| `library` | Content: atoms, documents, templates, vaults, foundations, starter sets, CMS content. |
| `system` | Infra: email delivery, files, workflow engine (`workflow.*`), agent memory, rules, content publishing. |
| `tool` | Tool/agent invocations (`tool:invoke` bracket, `agent.invoked`, `memory.stored`, …). |

> Note: names like `solicitation`, `volume`, `opportunity`, `compliance`, `ingest`, `memory` are the
> **entity prefix of a type** (e.g. `finder:solicitation.approved`) or *tool* namespaces — they are
> **not** event namespaces. The registry above is the whole set.

## 5. tenantId + actor conventions

- **Admin / platform events → `tenant_id = NULL`.** Tenant/portal events → the real tenant uuid.
  Partner-lifecycle events (`finder:partner.*`) are a deliberate hybrid: `finder` namespace **with**
  the affected tenant's uuid (the partner is platform-scoped, the event concerns one company).
- **Actor** = `userActor(id,email)` for a person, `systemActor()` for platform automation,
  `pipelineActor(worker)` for a background worker, `agentActor(role,tenant)` for an AI agent.

## 6. Automation, workflows & the pipeline

- **Workflows** emit `system:workflow.*` (`failed`, `execution_refused`, `engine_unavailable`,
  `instance_cancelled`, `instance_retried`) and their step outcomes (`proposal:review_phase.*`,
  `proposal:section.drafted`, `finder:scoring.completed`, …).
- **Agents** emit `tool:agent.invoked` / `agent.dispatch` and `system:agent.calibrated`; memory ops
  emit `system:memory.*` / `tool:memory.*`.
- **Raw `INSERT INTO system_events` (bypassing the helpers) — every site is inventoried + conformant**,
  and Layer-0 DB CHECKs enforce namespace/phase/actor_type on them regardless:
  - *Pipeline (6):* `agents/fabric.py`, `ingest/dispatcher.py` (×2), `ingest/base.py`,
    `ingest/topic_expander.py` (`finder:topics.expanded`), `shredder/runner.py`;
    `ingest/dispatcher.py:393` = `finder:rfp.shredded`.
  - *Frontend (3, allowlisted in `event-contract.test.ts`):* `auth.ts` (`identity:user.logged_in` /
    `user.login_failed` — raw because NextAuth `authorize()` must not import the automation-triggering
    emit layer), `lib/process/launch-template.ts` (workflow-trigger emit), `app/api/events/route.ts`
    (admin-only client emit — validates namespace **and** type first).
  - *CMS (1):* `models/events.py::emit_system_event` — the single CMS→bus choke point.
  A **new** frontend raw insert fails the event-contract guard until it uses the helpers or is reviewed in.
- `emitEventSingle` also **fires automation rules** (`lib/automation/triggers`) — so the audit spine
  and the automation spine are the same events.

## 7. Enforcement (the moat)

**Layer 0 — the database floor (the hard guarantee).** `system_events` carries three CHECK
constraints, so NO insert from ANY service (helper, raw insert, or the client-facing endpoint) can
write an invalid row — the DB itself rejects it:
- `system_events_namespace_chk` (mig 069) — `namespace` ∈ the 7 registry values. *Proven live:*
  inserting `namespace='admin'` raises a constraint violation.
- `system_events_phase_check` (mig 007) — `phase` ∈ `start` / `end` / `single`.
- `system_events_actor_type_check` — `actor_type` ∈ `user` / `system` / `pipeline` / `agent`.

The DB does **not** enforce TYPE FORMAT — that's the job of the build-time guards below plus the
client-endpoint check in `app/api/events` (which validates `type` against the `entity.action`
regex before insert). On top of the DB floor, three build-time / runtime layers:

1. **`__tests__/audit-coverage.test.ts`** (vitest) — every mutating `app/api/**` route (POST/PUT/
   PATCH/DELETE) that writes a business table on its 1-hop write path MUST emit (or be allowlisted
   with a reason). *Presence.*
2. **`__tests__/event-contract.test.ts`** (vitest) — every literal emit call site: namespace ∈
   registry (never forbidden), type = `entity.action_past_tense` (documented exceptions only), and no
   `emitEventStart` left without an `emitEventEnd` in the file. *Correctness.*
3. **Runtime dev-warn** (`lib/events.ts::warnUnknownNamespace`) — catches DYNAMIC namespaces the
   static guards can't see; logs (never throws) on an unregistered namespace.

Regenerate the catalog snapshot below with `scripts/event_catalog.py` (or the inline scanner in the
guards). To add a namespace: update the registry here, in both guards, and in `lib/events.ts`.

---

## 8. Event catalog — snapshot (2026-08-08)

**8 namespaces · 210 distinct literal types** (frontend + pipeline `emit_event`; `[py]` = pipeline).
This is a dated snapshot for compliance reference; the guards enforce the contract, not this list.

**identity** (7): `consent.recorded`, `invite.accepted`, `password.reset_completed`,
`password.reset_requested`, `user.logged_in`, `user.login_failed`, `user.password_changed`.
(`user.logged_in` / `user.login_failed` are raw inserts in `auth.ts` — see §6.)

**capture** (31): `amendment.flagged`, `application.accepted`, `application.rejected`,
`application.status_changed`, `application.submitted`, `automation_preferences.updated`,
`billing.portal_opened`, `bucket.deactivated`, `buckets.updated`, `card.applied`, `card.scored`[py],
`checkout.started`, `consulting.purchased`, `contract.started`, `guardrail_template.saved`,
`portal.created`, `profile.updated`, `purchase.completed`, `subscription.canceled`,
`subscription.renewed`, `subscription.started`, `team_member.deactivated`, `team_member.invited`,
`team_member.reactivated`, `team_member.role_changed`, `tenant.cards_backfilled`, `tenant.rescored`[py],
`topic.pinned`, `topic.unpinned`, `waitlist.joined`, `workspace.released`.

**finder** (62): `agent_config.updated`, `amendment.confirmed`, `amendment.detected`,
`amendment.dismissed`, `annotation.classified`, `annotation.deleted`, `annotation.saved`,
`compliance.extracted`[py], `compliance.preset_applied`, `compliance.topic_override_cleared`,
`compliance.topic_override_saved`, `compliance_preset.created`, `compliance_value.saved`,
`compliance_variable.added`, `document.created`, `document.deleted`, `document.primary_set`,
`document.saved`, `guardrail_defaults.updated`, `ingest.assessment_requested`, `ingest.triggered`,
`opportunity.card_published`, `opportunity.staged`, `partner.company_dedup_reviewed`,
`partner.company_registered`, `partner.entered`, `partner.exited`, `partner.manager_declined`,
`partner.manager_granted`, `partner.manager_requested`, `required_item.added`, `required_item.deleted`,
`required_item.updated`, `rfp.shredded`[py], `sbir_data.ingested`, `scoring.completed`[py],
`scout.drafts_created`[py], `section_standard.created`, `shred.executed`[py], `solicitation.approved`,
`solicitation.claimed`, `solicitation.dismissed`, `solicitation.force_released`,
`solicitation.ingest_assisted`, `solicitation.pushed`, `solicitation.released`,
`solicitation.review_rejected`, `solicitation.review_requested`, `solicitation.summary_updated`,
`solicitation.triaged`, `source.change_detected`, `source.created`, `source.scout_triggered`,
`source.scouted`, `source.topics_expand_triggered`, `source.updated`, `source.visited`,
`source_diff.reviewed`, `source_region.created`, `source_region.deleted`, `tenant.archived`,
`tenant.created`, `tenant.provisioned`, `tenant.restored`, `tenant.updated`,
`expert_time.availability_opened`, `expert_time.availability_cancelled`, `topic.added`,
`topic.imported`, `topic.updated`, `topics.expanded`[py], `volume.added`, `volume.deleted`.

**library** (28): `atom.archived`, `atom.created`, `atom.curated`, `atom.restored`,
`atoms.bulk_curated`, `capture.atomized`, `content.drafted`[py], `content.published`[py],
`document.created`, `document.exported`, `document.locked`, `document.regenerated`, `document.updated`,
`foundation.saved`, `package.atomized`, `section.atoms_selected`, `starter_set.added`,
`starter_set.offered`, `template.added`, `template.created`, `template.deleted`, `template.extracted`,
`template.updated`, `unit.uploaded`, `vault.artifact_uploaded`, `vault.created`, `vault.member_invited`,
`vault.member_revoked`.

**proposal** (48): `ai_review.requested`, `amendment.acknowledged`, `artifact.exported` (now carries `{compliant, complianceViolations}` from the export-gate compliance floor),
`artifact.locked`, `collaborator.access_revoked`, `collaborator.invited`, `comment.created`,
`comment.resolved`, `compliance.checked`, `document.locked`, `draft.completed`[py],
`full_draft.landed` (read-on-review landing of a full-draft run's staged canvases), `gate_requirement.created`, `gate_requirement.toggled`, `outcome.attributed`[py], `outcome.recorded`,
`package.export_started`, `package_review.requested`, `preview.generated`[py], `proposal.advance_ready`,
`proposal.advanced`, `proposal.archived`, `proposal.created`, `proposal.draft_requested`,
`proposal.dropbox_file_deleted`, `proposal.dropbox_file_uploaded`, `proposal.full_draft_requested`,
`proposal.locked`, `proposal.ready_for_customer`, `proposal.research_requested`, `proposal.restored`,
`proposal.unlocked`, `proposal.v0_provisioned`, `review_phase.completed`[py], `review_phase.requested`,
`review_todos.prestaged`, `section.diff_analyzed`[py], `section.drafted`[py], `section.exported`,
`section.locked`, `section.saved`, `section.seeded_from_prior`, `section.unlocked`,
`supporting_doc.deleted`, `supporting_doc.status_changed`, `supporting_doc.uploaded`, `task.assigned`,
`task.completed`.

**system** (30): `agent.calibrated`[py], `automation_framework.updated`, `content.document_published`,
`content.document_saved`, `content.page_published`, `content.page_revalidated`, `content.page_saved`,
`email.admin_alert_delivered`, `email.invite_delivered`, `email.team_invite_delivered`, `file.deleted`,
`file.renamed`, `file.uploaded`, `memory.compaction_completed`[py], `memory.contradictions_resolved`[py],
`memory.decay_applied`[py], `memory.edit_analyzed`[py], `memory.gc_completed`[py],
`memory.outcome_attributed`[py], `memory.pattern_promoted`[py], `memory.preferences_extracted`[py],
`notification.requested`[py], `platform_agent_config.updated`, `rule.created`, `sbir_data.ingested`,
`workflow.engine_unavailable`[py], `workflow.execution_refused`[py], `workflow.failed`[py],
`workflow.instance_cancelled`, `workflow.instance_retried`.

**tool** (5): `agent.dispatch`[py], `agent.invoked`[py], `invoke` (bracket — see §3), `memory.recalled`[py],
`memory.stored`[py].
