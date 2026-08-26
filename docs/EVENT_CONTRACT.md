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

---

## 6b. The start/end bracket — phase lives in the COLUMN, never in the type name

A bracket is **one operation, one type, two rows**: a `start` row, then an `end` row whose
`parent_event_id` points back at the start. `phase` carries which half it is. A `single` is an
operation with no meaningful duration and is the default.

```
namespace  type              phase    parent_event_id   duration_ms
finder     solicitation.triaged   start    NULL              NULL
finder     solicitation.triaged   end      <the start id>    5
```

**The type name must not encode the phase.** `tool:invoke` with `phase=start|end` is the sanctioned
shape (§ the TYPE_ALLOWLIST entry); `x.start` and `x.end` as two type names is not — a consumer
grouping by `type` then sees two operations where there is one, and every correlation check reads
the pair as cross-type. `scripts/event_catalog.py` fails a NEW phase-in-name type and prints the
allowlisted ones with their reasons.

### Measured on the live table (1,591 rows, sandbox at migration head 205)

| check | result |
|---|---|
| `start` / `end` / `single` | 252 · 252 · 1,087 |
| `end` rows with no `parent_event_id` | **0** |
| `end` rows whose parent is not a `start` | **0** |
| **orphan starts** — began, never closed | **0** |
| starts closed more than once | **0** |
| `single` rows polluted with `parent_event_id` / `duration_ms` | **0** |

Two things that check does NOT show, both real and both recorded rather than smoothed over:

**1. Four types carry the phase in the name (allowlisted, not endorsed).**
`finder:ingest.run.start`/`.end` (`pipeline/src/ingest/base.py:236,431`) and
`finder:rfp.shredding.start`/`.end` (`pipeline/src/shredder/runner.py:280,452,496,554`). They
predate the convention. Renaming is a data-contract change — it orphans historical rows and breaks
`lib/tools/ingest-list-recent-runs.ts`, which reads `finder.ingest.run.end` — so they stay, listed,
with the cost written down. Nothing new may join them without a reason in the allowlist.

**2. Two thirds of `end` rows carry no `duration_ms`, and the split is exactly service-shaped.**

```
frontend brackets   tool:invoke 30 ends (median 71ms) · proposal.created 13 (28ms)
                    package.export_started 8 (350ms) · solicitation.triaged 18 (5ms)   — all populated
pipeline brackets   tool:agent.invoked 154 ends · proposal:draft.completed 9 · ingest.run.end 3
                    — 166 of 252 ends, 0 with a duration
```

Root cause is one line: `pipeline/src/events.py::emit_event` **has no `duration_ms` parameter**.
The column exists and the frontend helper fills it; the Python emitter cannot. So the most expensive
operations in the system — agent invocations — record that they finished and never how long they
took. Fixing it means adding the parameter and threading elapsed time through ~60 end-emitters
across 29 files, which is why it is bug-logged (B77) rather than half-done here.

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

## 8. Event catalog — generated inventory

> Everything between the markers is written by `python3 scripts/event_catalog.py --write`.
> Run it after adding or renaming an event type. The guards in
> `frontend/__tests__/{event-contract,audit-coverage}.test.ts` ENFORCE the contract in CI;
> this section is the human-readable inventory, and it is only as fresh as the last run.

<!-- EVENT-CATALOG:BEGIN -->

**7 registry namespaces · 295 distinct literal types** (frontend + pipeline `emit_event`; `[py]` = pipeline). Generated by `python3 scripts/event_catalog.py --write` — do not hand-edit between the markers.

Convention check at generation: **0 violation(s)**, **0 start-without-end file(s)**, **7 pipeline raw `INSERT INTO system_events`** (each verified to set namespace/type/phase).

`<dynamic>`: 4 call site(s) compute their namespace, so a static scan cannot resolve them. They are NOT a namespace — an older hand-written version of this section counted them as one and reported "8 namespaces".

**capture** (44): `amendment.flagged`[single], `application.accepted`[start], `application.rejected`[start], `application.status_changed`[start], `application.submitted`[single], `automation_preferences.updated`[single], `billing.portal_opened`[single], `bucket.deactivated`[single], `buckets.updated`[py,single], `card.applied`[single], `card.scored`[py], `checkout.started`[single], `consulting.purchased`[single], `contract.started`[single], `guardrail_template.saved`[single], `member.scope_updated`[single], `opportunity.pursuit_set`[single], `opportunity.start_recommended`[py], `opportunity.updated`[single], `portal.created`[single], `portal.stage_advanced`[single], `profile.updated`[single], `purchase.completed`[single], `stage_review.advanced`[single], `stage_review.completed`[py], `stage_review.requested`[start], `subscription.canceled`[single], `subscription.renewed`[single], `subscription.started`[single], `task.reassigned`[single], `task.rescheduled`[single], `team_member.bucket_grant_changed`[single], `team_member.deactivated`[single], `team_member.invited`[start], `team_member.reactivated`[single], `team_member.role_changed`[single], `tenant.cards_backfilled`[single], `tenant.rescored`[py], `topic.pinned`[single], `topic.unpinned`[single], `waitlist.joined`[single], `workflow.accepted`[single], `workflow.reconfigured`[start], `workspace.released`[single].

**finder** (105): `agent_config.updated`[start], `amendment.confirmed`[start], `amendment.detected`[single], `amendment.dismissed`[start], `annotation.classified`[single], `annotation.deleted`[single], `annotation.saved`[single,start], `artifact.stored`[py], `artifacts.written`[py], `candidate.classified`[single], `candidate.dismissed`[single], `candidate.released`[single], `candidates.materialized`[start], `cards.reconciled`[single], `cards.republish_failed`[single], `compliance.extracted`[py], `compliance.preset_applied`[start], `compliance.topic_override_cleared`[single], `compliance.topic_override_saved`[single], `compliance_preset.created`[single], `compliance_value.saved`[single,start], `compliance_variable.added`[single], `curation_note.added`[single], `daily_rescore.completed`[py], `document.created`[start], `document.deleted`[start], `document.primary_set`[single], `document.saved`[start], `expert_time.availability_cancelled`[single], `expert_time.availability_opened`[single], `guardrail_defaults.updated`[single], `ingest.assessment_requested`[start], `ingest.phase_completed`[py], `ingest.phase_requested`[py,start], `ingest.run.end`[py], `ingest.run.start`[py], `ingest.triggered`[single], `nudge_sweep.completed`[py], `opportunities.detected`[py,single], `opportunity.amended`[py], `opportunity.build_completed`[start], `opportunity.card_published`[single], `opportunity.ingested`[py], `opportunity.staged`[single], `opportunity.update_fanned`[start], `opportunity.update_watch_cleared`[single], `opportunity.update_watch_set`[single], `partner.company_dedup_reviewed`[single], `partner.company_registered`[single], `partner.entered`[single], `partner.exited`[single], `partner.manager_granted`[single], `partner.manager_requested`[single], `partner.manager_revoked`[single], `promo_code.revoked`[single], `promo_codes.issued`[single], `required_item.added`[single], `required_item.deleted`[single], `required_item.disposition_set`[single], `required_item.updated`[single], `rfp.sections_located`[py], `rfp.shredding.end`[py], `rfp.shredding.start`[py], `sbir_data.ingested`[start], `scoring.completed`[py], `scout.drafts_created`[py], `section_standard.created`[single], `shred.audited`[single], `shred.executed`[py], `solicitation.approved`[single], `solicitation.broadcasted`[single], `solicitation.claimed`[single], `solicitation.dismissed`[single], `solicitation.force_released`[single], `solicitation.ingest_assisted`[single], `solicitation.pushed`[single], `solicitation.released`[single], `solicitation.review_rejected`[single], `solicitation.review_requested`[single], `solicitation.triaged`[start], `solicitation_volume.disposition_set`[single], `source.change_detected`[py,single], `source.created`[start], `source.scout_triggered`[start], `source.scouted`[py,single], `source.topics_expand_triggered`[start], `source.updated`[start], `source.visited`[start], `source_diff.reviewed`[start], `source_region.created`[single], `source_region.deleted`[single], `tenant.archived`[single], `tenant.cards_backfilled`[single], `tenant.created`[single,start], `tenant.library_seeded`[single], `tenant.provisioned`[single], `tenant.restored`[single], `tenant.updated`[start], `topic.added`[single], `topic.imported`[single], `topic.released`[single], `topic.updated`[single], `topics.extracted`[single], `volume.added`[single], `volume.deleted`[single].

**identity** (5): `consent.recorded`[single], `invite.accepted`[single], `password.reset_completed`[single], `password.reset_requested`[single], `user.password_changed`[start].

**library** (38): `atom.archived`[single], `atom.created`[single], `atom.curated`[single], `atom.restored`[single], `atom.retagged`[single], `atoms.bulk_curated`[single], `capture.atomized`[single], `content.drafted`[py], `content.published`[py], `document.atomized`[single], `document.created`[single], `document.exported`[single], `document.locked`[single], `document.regenerated`[single], `document.updated`[single], `foundation.created`[single], `foundation.saved`[single], `package.atomized`[single,start], `past_proposal.deconstructed`[single], `section.atoms_selected`[single], `seed_decision.recorded`[single], `seed_job.selected`[single], `starter_set.added`[single], `starter_set.offered`[single], `template.acknowledged`[single], `template.added`[single], `template.applied`[single], `template.created`[single], `template.deleted`[single], `template.extracted`[single], `template.published`[single], `template.stable_synced`[single], `template.updated`[single], `unit.uploaded`[single], `vault.artifact_uploaded`[single], `vault.created`[single], `vault.member_invited`[single], `vault.member_revoked`[single].

**proposal** (52): `ai_review.requested`[start], `amendment.acknowledged`[single], `artifact.exported`[single], `artifact.locked`[single], `collaborator.access_revoked`[single], `collaborator.invited`[start], `comment.created`[single], `comment.resolved`[single], `compliance.checked`[start], `document.locked`[single], `draft.completed`[py], `full_draft.landed`[single], `gate_requirement.created`[start], `gate_requirement.toggled`[start], `outcome.attributed`[py], `outcome.recorded`[start], `package.export_started`[start], `package_review.requested`[start], `preview.generated`[py], `proposal.advance_ready`[single], `proposal.advanced`[start], `proposal.archived`[start], `proposal.created`[start], `proposal.draft_requested`[start], `proposal.dropbox_file_deleted`[single], `proposal.dropbox_file_uploaded`[single], `proposal.full_draft_requested`[start], `proposal.hard_deleted`[single], `proposal.locked`[start], `proposal.ready_for_customer`[single], `proposal.research_requested`[single], `proposal.restored`[start], `proposal.unlocked`[start], `proposal.v0_provisioned`[single], `review_phase.completed`[py], `review_phase.requested`[py,start], `review_todos.prestaged`[single], `section.assigned`[single], `section.diff_analyzed`[py], `section.drafted`[py], `section.exported`[single], `section.locked`[single], `section.saved`[single], `section.seeded_from_prior`[single], `section.unlocked`[single], `seed.skipped`[single], `supporting_doc.deleted`[single], `supporting_doc.status_changed`[start], `supporting_doc.uploaded`[start], `task.assigned`[single], `task.completed`[single], `visual_review.requested`[start].

**system** (43): `agent.calibrated`[py], `automation_framework.updated`[single], `content.document_published`[start], `content.document_saved`[start], `content.page_published`[start], `content.page_revalidated`[single], `content.page_saved`[start], `email.admin_alert_delivered`[single], `email.invite_delivered`[single], `email.team_invite_delivered`[single], `file.deleted`[single], `file.renamed`[single], `file.uploaded`[single], `memory.compaction_completed`[py], `memory.contradictions_resolved`[py], `memory.decay_applied`[py], `memory.edit_analyzed`[py], `memory.gc_completed`[py], `memory.outcome_attributed`[py], `memory.pattern_promoted`[py], `memory.preferences_extracted`[py], `notification.requested`[py], `platform_agent_config.updated`[start], `rule.created`[single], `sbir_data.ingested`[single], `task.created`[py], `task.nudge`[py], `workflow.engine_unavailable`[py], `workflow.escalation_ran`[py], `workflow.execution_refused`[py], `workflow.failed`[py], `workflow.instance_cancelled`[py,single], `workflow.instance_created`[py], `workflow.instance_recovered`[py], `workflow.instance_retried`[single], `workflow.instance_started`[py], `workflow.resumed`[py], `workflow.skipped_inactive`[py], `workflow.step_completed`[py], `workflow.step_failed`[py], `workflow.step_started`[py], `workflow.stuck_detected`[py], `workflow.wait_timed_out`[py].

**tool** (5): `agent.dispatch`[py], `agent.invoked`[py], `invoke`[start], `memory.recalled`[py], `memory.stored`[py].

<!-- EVENT-CATALOG:END -->
