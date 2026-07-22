# V1 Hidden-Bug & Unfinished-Code Sweep — 2026-06-29

A 7-agent adversarial sweep (frontend routes · pipeline engine · CMS+AI workforce ·
DB schema/migrations · frontend unfinished-code · spine seam re-review · OCC/error-shape)
across all three services + 92 migrations, each agent briefed on the bug *classes*
already hit so it hunted for more instances. Every finding below was CONFIRMED (live PG /
live-reproduced), not speculative.

## A. Bugs FIXED in this sweep (commits on `claude/nice-hamilton-kBqtD`)

| Sev | Bug | Fix |
|---|---|---|
| **P1** | `gate_config` (and `step_status`/`step_results`/preset `compliance_data`/`volumes_data`) written `JSON.stringify(x)::jsonb` read back through postgres.js as a STRING; array/object ops then ran on CHARACTERS — broke stage advancement (advanced to a single char → CHECK 500), corrupted collaborator stage-access (~18 garbage rows), lost step state on admin unstick, wrote all-NULL compliance from saved presets | `lib/jsonb.ts:coerceJsonb` at every read site; create-route `gate_config` write → `sql.json()` |
| **P1** | Paused-deadline sweep force-failed with no `status='paused'` compare-and-swap → a human completing the task at the 72h boundary (resume→retrying) got clobbered back to `failed`, destroying the work | `WHERE id=$1 AND status='paused'`; on real fail also expire the orphaned sibling task |
| **P1** | `match_waiting_instances` resumed EVERY paused instance whose `wait_for` matched, no entity correlation → one event woke every gate of that kind across proposals/users/tenants | `_event_correlates` — resume only for the SAME entity (equality on shared correlation keys; falls back to wait_for-only) |
| **P1** | Managed (prod) execution path dropped `fabric` → every AI_INVOKE step silently skipped (the one wired step, compliance review, never ran in prod) | thread `fabric` through `WorkflowManager` → `_execute_step` → processor |
| **HIGH** | CMS event_listener fetched ALL `automation_rules` (no active filter) → operator-disabled rules still fired (duplicate admin emails) | `WHERE COALESCE(is_active, enabled, TRUE)=TRUE` |
| **MED** | Active "new application" rule named template `admin_new_application` that didn't exist → silent fallback to generic | added the template |
| **P2** | Missing per-proposal indexes (comments, compliance_matrix, reviews, stage_history) — seq-scan per workspace open + on cascade | mig 092 indexes |
| **P3** | `proposals.stage` DEFAULT `'outline'` not in its CHECK (latent) · duplicate `canvas_versions` index · `fabric` agent_task_log audit link always null · dead `error_json` read | mig 092 default→`'draft'` + drop dup; fabric/listener cleanups |
| **LOW** | `/admin/opportunities` never read the `contracts` rollup count (V2 arc invisible) | surfaced it (`::int`) |

## B. P2/P3 backlog — **RESOLVED 2026-06-29** (commits on `claude/nice-hamilton-kBqtD`)

All five were knocked out in the follow-on pass (tsc clean · 576 frontend + 557 pipeline tests
green · the jsonb mechanism + the failed-op gate live-verified on Postgres):

- **BC4 — `::uuid` shape guards → 400 not 500. ✅ FIXED (10 routes).** `isValidUUID` guards added:
  `library/[unitId]` (in `authorize()`, covers all methods), `opportunities`/`library` bulk
  `ANY($ids::uuid[])` (`.every(isValidUUID)`), `opportunities/[id]/actions`, `reviews` (GET+POST),
  `ai/compliance` (`proposalId` + body `sectionId`), `compliance`, `rfp-upload`/`upload-topic-files`
  `solicitationId`, and the `library/atomize` `fileIds` filter. Each returns `VALIDATION_ERROR` 400.
- **Client-contract jsonb double-encode → `sql.json()`. ✅ FIXED.** `gates.evidence`, `outline`
  (UPDATE+INSERT), automation `action_config` (PATCH+INSERT), `compliance_presets`
  (`compliance_data`/`volumes_data`), `templates` create + clone, `templates/[id]` PATCH
  (COALESCE-preserving `sql.json|null` pattern), and `workflows/[id]/retry`
  (`sql.json(coerceJsonb(...))`). **Empirically confirmed** on real Postgres:
  `${JSON.stringify(x)}::jsonb` round-trips as a STRING; `${sql.json(x)}` as an object.
- **Check-then-act races → `ON CONFLICT`. ✅ FIXED (3 of 4).** `applications/[id]/accept`
  (slug via `ON CONFLICT (slug)` suffix-bump loop; user via `ON CONFLICT (email) DO UPDATE`);
  `rfp-upload` (conflict → clean 409) and `upload-topic-files` (conflict → silent skip), both
  restating the partial predicate `WHERE content_hash IS NOT NULL`. **Deferred:** `proposals/create`
  `(tenant_id, opportunity_id)` — needs a product decision (re-pursue after a loss?) + a dedupe
  pass before a unique index; the single-request path already returns a clean 409 (see §B-deferred).
- **Pipeline poll robustness. ✅ FIXED.** The poll SELECTs the `error` JSONB column (present since
  mig 007) and `emit_end`/`emit_event` write it, so the long-dead "never trigger on a FAILED op"
  guard (`EventTrigger.matches()` rejects truthy `error` on BOTH the trigger and resume paths) is
  now armed; high-water-mark switched to `>=` (the `_track_processed` dedup set absorbs the
  boundary). Live-verified: a failed `end` event sets the column and `matches()` returns False.
- **`ProposalStage` type drift. ✅ FIXED.** Narrowed to the DB CHECK set
  `'draft'|'review'|'final'|'submitted'|'archived'` (dropped the legacy color-team literals, added
  `review`). Zero blast radius (the type had no external importers).

**§B-deferred (1, consciously):** `proposals (tenant_id, opportunity_id)` uniqueness — a DB
constraint needs a product decision + dedupe first (mig 092 documents the deliberate absence). The
race yields a rare *silent duplicate* draft, not a 500; the common path returns a clean 409.

**INFO — type drift (residual, cosmetic):** `formatCurrency(amount: number)` actually receives a
NUMERIC-as-string. `notify_done` reads `payload.tenantId` the launcher never sets (always null).
`system_events_namespace_chk` is `NOT VALID` — `VALIDATE` once prod data is confirmed clean.

## C. Unfinished / un-wired code (known gaps — built-but-not-connected)

**AI agent workforce** (CLAUDE.md's "built but not wired" is now PARTLY stale — `AgentFabric`
IS instantiated + threaded into the live loops, but only one archetype runs end-to-end):
- **Live:** `color_team_reviewer` — `proposal-advance.ts` enqueues `review_section` to
  `agent_task_queue` (when tenant pref `ai_review_on_advance`) → `fabric.process_task_queue`
  → writes a recommendation to `proposal_comments`. The only complete agent path.
- **Inert:** `compliance_reviewer` is the one AI_INVOKE step but skipped in prod until the
  fabric-drop fix ships + `ANTHROPIC_API_KEY` is set.
- **Dormant (defined, registered, NO producer drives them):** `section_drafter`,
  `proposal_architect`, `opportunity_analyst`, `scoring_strategist`, `capture_strategist`,
  `packaging_specialist`, `librarian`, `partner_coordinator`. `fabric.handle_event` dispatcher
  has zero callers; 10 of 11 `TOOL_ACTION_TO_ARCHETYPE` rows map actions no workflow emits.
- **The 3-source strawman gap:** `publish_section_draft` (the landing primitive, shipped + tested)
  has NO caller. To make it real, 3 missing pieces: (1) a producer event / `agent_task_queue`
  row with `agent_role='section_drafter'`; (2) an invoke that calls `fabric.invoke_agent('section_drafter')`
  drafting from library atoms + tenant_profile + RFP/compliance (ContextAssembler loads all 3);
  (3) a write-back branch that calls `publish_section_draft`.

**Frontend unfinished features:** AI color-team review path (`reviews` + `ai/review` routes
built BOTH sides, zero UI callers + a disabled "AI Review (coming soon)" button) · PDF export
(advertised in the canvas type chain, route rejects `pdf`) · `POST /api/admin/tenants` 501 stub
(manual tenant create) · `GET /api/waitlist` 501. Dead: `components/admin/metadata-editor.tsx`,
`volume-artifact-preview.tsx`, `lib/source-url.ts` (3 whole files, no importers) + ~13 dead `lib`
exports. Bypass flags: `FOUNDING_COHORT_BYPASS` (paywall off), `CMS_PUBLIC_URL` (CRM "coming soon"),
`ANTHROPIC_API_KEY` (AI→placeholder fallback).

**CMS unfinished:** social posting is stubbed — `social_poster.linkedin_post/twitter_post` raise
`NotImplementedError` (OAuth pending); create/schedule persists but delivery always fails. No
`source='cms'` WorkflowManager runs (CMS workflows execute under the pipeline manager).

**DB orphaned schema (built, never read):** `process_instances.opportunity_id`/`scope` (write-only
spine key — for the future control-tower; no reader aggregates it yet) · `tenant_pipeline_items.llm_adjustment`/`llm_rationale`
· `opportunities.full_text_tsv` + its GIN index · `opportunities.phase_type` · `agent_performance`
(write-only). ~13 dead tables (`invitations`, `agent_archetypes`, `solicitation_templates`, …).

## D. Verified CLEAN (swept, no bug)
Partial-index `ON CONFLICT` (all 6 restate their predicate — the create_instance + contracts fixes
hold) · all 20 high-traffic CHECK columns (zero violations) · tenant isolation (portal resolver +
agent tool layer both sound; shared `opportunities`/`compliance` have no tenant_id by design) ·
error-shape (every 4xx/5xx has `error`+`code`) · `await sql` wrapping · NEXT_REDIRECT re-throw ·
unawaited promises · the spine seams (overlay↔template key mapping, scope/opportunity_id propagation,
Date/jsonb boundaries, `/go` redirects, event wiring).

---

## E. HITL UI launch-readiness sweep (2026-06-29) + fixes

A dedicated sweep traced every human-in-the-loop touchpoint from pipeline parking → `tasks` ledger
→ mounted UI → wired API. **Verdict: no hard launch blockers — every HITL task a human must act on
has a real, mounted, wired resolver.**

**Verified ✅ present + wired:** task queue mounted on BOTH dashboards (portal `…/dashboard` →
`/api/portal/<slug>/tasks`; admin `/admin/dashboard` → `/api/admin/tasks`), correctly scoped ·
complete-a-task resumes the parked instance (`completeTask → forceAdvanceProcess`, mirrors the
pipeline) · delegation `AssignTaskForm` mounted on the proposal workspace (canManageTeam) → assign
route · force-advance present + paused-only on all THREE ledgers (admin Workflows, admin Process
Ledger, portal Processes), each posting an audit note (+ Retry/Cancel on the workflow monitor) ·
stage/lock gates (`stage-control.tsx`: Advance, all-locked + "Force advance anyway", Mark Met/Unmark,
Unlock/Re-lock) · the 72h `admin_review` gate is reachable in the admin queue · in-app urgency
("N overdue" sort) + email→`/go?task=` landing. Every TODO-parking workflow lands its task in a
human's queue with the review completer as a natural resolver.

**Fixed in this pass:**
- **M1 (real) — `master_admin` couldn't complete pipeline admin tasks from the dashboard queue.**
  `listOpenTasksForActor` matched `assignee_role = <role>` EXACTLY; all pipeline admin tasks are
  `rfp_admin`, so a `master_admin` saw them only in the read-only triage-todos panel. Fixed: the admin
  branch now matches `assignee_role IN ('rfp_admin','master_admin')` (consistent with
  `listOpenAdminTriageTasks`). Live-verified: a master_admin now sees the `admin_review` task.
- **Partner onboarding (real) — invite email never granted access.** The collaborator invite email
  pointed at `/login`, but a partner's access requires `proposal_collaborators.accepted_at`, set only
  by the `/invite/<token>` page → the invitee hit a 404. Fixed: a NEW collaborator's email now links to
  `/invite/<collaboratorId>` ("Accept Invitation"); an EXISTING user is auto-accepted at invite time
  (`accepted_at=now()`) and emailed a direct "Open Proposal" link; the `/invite` page password minimum
  is aligned to the server's 12 chars. Live-verified (accepted_at set for existing, null for new, the
  resolver grants).

**Closed in the follow-on pass (both previously non-blocking):**
- **M2 — typed completers now exercised. ✅ FIXED.** The delegation form (`AssignTaskForm`) gained a
  **Completion** selector — Review & approve / Upload a file / Fill a form (comma-separated field
  names) — that sets `tasks.params.kind` (+ `spec.fields` for a form). `createTask` already persists
  `params` via `sql.json`; `TaskQueue` already renders the matching completer. Review (default) sends
  no params → stays the plain approve/dismiss gate.
- **M3 — manual review-gate launcher. ✅ FIXED.** New `POST /api/admin/workflows/launch-collaboration`
  (rfp_admin+, routed through the GUARDED `launchProjectCollaboration` helper so a hand-launched gate
  is always well-formed) + a **"Launch Review Gate"** admin form mounted on `/admin/workflows`. Ops can
  now start a `ProjectCollaboration` gate by hand for a one-off review no code bridge covers.
