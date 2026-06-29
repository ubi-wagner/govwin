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

## B. Confirmed findings NOT yet fixed (tracked — P2/P3, lower impact)

- **BC4 · P2/P3 — `::uuid` cast without shape validation → 500 instead of 400.** ~8 sites:
  `portal/.../library/[unitId]` (authorize, widest), `opportunities`/`library` bulk
  `ANY($ids::uuid[])`, `actions`/`reviews`/`ai/compliance` body `sectionId`,
  `rfp-upload`/`upload-topic-files` `solicitationId`, `compliance`. All inside try/catch
  (no crash) → a client error surfaces as a server error. Fix: `isValidUUID` guard → 400.
- **P3 — more jsonb-string read-as-object (client-contract, not corruption):** GET routes
  return a STRING where the client expects an object — `gates.evidence`, `outline`,
  automation `action_config`; and `workflows/[id]/retry` + `templates` "save as new"
  DOUBLE-encode on clone. Fix: `sql.json()` on those writes (or `coerceJsonb` on read).
- **P2 — check-then-act races (CLASS D):** `applications/[id]/accept` slug + email
  SELECT→INSERT races (unique_violation → generic 500); `proposals/create` duplicate
  guard is racy — no DB unique on `(tenant_id, opportunity_id)` (mig 092 added a
  non-unique index; a unique constraint needs a dedupe pass first). `rfp-upload`/
  `upload-topic-files` content-hash dedup TOCTOU (500 instead of clean 409). Fix:
  `ON CONFLICT … WHERE <partial predicate>` (restate the predicate).
- **P2 — pipeline poll robustness:** the "never trigger on a FAILED op" guard is dead
  (`processor` poll doesn't SELECT `system_events.error`; `emit_end` writes error into
  payload, not the column) → failed `:end` events can spawn junk instances; high-water-mark
  uses strict `>` on `created_at` → events sharing a timestamp (same-tx multi-emit) can be
  skipped. Fix: select `error` in the poll + write the column; `>=` + the existing dedup set.
- **INFO — type drift:** `frontend/types/index.ts ProposalStage` lists `outline`/`pink_team`/
  `red_team`/`gold_team` (rejected by the DB CHECK) and omits `review` — the type lies about
  the column. `formatCurrency(amount: number)` actually receives a NUMERIC-as-string.
  `notify_done` reads `payload.tenantId` which the launcher never puts in the overlay (always
  null; cosmetic). `system_events_namespace_chk` is `NOT VALID` — `VALIDATE` it once prod
  data is confirmed clean.

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
