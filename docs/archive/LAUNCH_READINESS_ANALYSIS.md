# Launch-Readiness Analysis — Schema · Workflows · Spines · Archivability

**Date:** 2026-07-20 · **Method:** four parallel read-only audits (schema, workflow engine, spine integrity,
archival/retention), each grep- and psql-evidenced against the sandbox `govtech_intel` (118 tables, migs 001–118)
+ frontend + pipeline + CMS. Reports preserved in `scratchpad/analysis_{schema,workflows,spines,archival}.md`.

---

## Verdict — qualified thumbs-up 👍 (with a finishable punch-list)

**The architecture is sound and the converged surfaces are clean.** The master+mirror OPP bridge — the spine you
were most proud of — is **genuinely tight**: forward-only by *grant* (`opportunity_bridge` is `INSERT, SELECT`
only for the app role) **and** by code, with **zero** tenant→master backflow writes and both releases wired. The
workflow engine core is real (persistent, crash-recovering, idempotent-create, correct AI safe-skip, real
HITL park/resume). Hot-path indexing is strong — **no missing-index blocker**. Archival is **reachable** and we
already own the mechanism.

**You are not *yet* launch-ready** — but for finite, finishable reasons, none requiring redesign. Two unfinished
**greenfield cutovers** left the old model live *alongside* the new, and they were **independently found by both
the schema and spine audits** (strong corroboration). Plus a revenue-critical config default, a half-finished RLS
hardening, and — caught by the workflow audit — **two dead scheduled workflows I shipped this session, which I've
already fixed** (below). Clear the punch-list and it's a green light.

---

## The one-paragraph headline

Two **split-brains** dominate launch risk. **(1) Library:** mig 101 added the canonical `library_atoms`/`atom_tags`
*additively and never dropped or cut over* `library_units` — so ~15–28 live paths still read/write the "retired"
`library_units` (the customer **Library page**, the registered `library.save_atom`/`library.search_atoms` tools,
proposal/section lock-harvest dual-writes, the **outcome learning loop**, onboarding `create_library_defaults`, and
the **live `section_drafter` `draft_v0`** which grounds on an *empty* `library_units`), while uploads/atomize/the
canvas/`/atoms` use `library_atoms`. **A customer's content is invisible across the two surfaces.** **(2) Scoring:**
the live `OnSolicitationPushed → score_tenants.py` writes the **retired** `tenant_pipeline_items` +
`spotlight_bucket_scores`, while the canonical `tenant_opportunity_cards`/`tenant_bucket_scores` (the tables that
actually feed `/cards`) are populated **only** by the frontend bridge — so the pipeline's scoring never reaches
customers. Both are finish-the-cutover work, not redesign.

---

## Launch punch-list (ranked)

### P0 — blockers (do before launch)
| # | Item | Why | Fix | Effort |
|---|---|---|---|---|
| P0-1 | **Library split-brain** (`library_units` vs `library_atoms`) | Customer content invisible across surfaces; `draft_v0` grounds on empty units; outcome loop keyed to units | Repoint the ~15 live paths units→atoms (Library page/route, `library.save_atom`/`search_atoms` tools, lock-harvest, outcome route, `create_library_defaults`, `section_drafter`/fabric tools/`context.py`); drop the dual-writes; then drop `library_units` + satellites | M–L (focused cutover sprint) |
| P0-2 | **`FOUNDING_COHORT_BYPASS` defaults to paywall-OFF** | `paywallEnforced = env === 'false'` — anything but `'false'` bypasses the paywall (revenue) | Set `FOUNDING_COHORT_BYPASS='false'` in launch env + a deploy-time assertion | XS (config) |
| P0-3 | **Scoring split-brain** (`OnSolicitationPushed → score_tenants` writes retired tables) | Pipeline scoring never reaches `/cards`; parallel to canonical `tenant_bucket_scores` | Repoint `score_tenants.py` to the cards/bucket spine, **or** retire the workflow (the frontend bridge already auto-scores on arrival) | S–M |

### P1 — important (launch or fast-follow)
| # | Item | Why | Fix |
|---|---|---|---|
| P1-1 | **Agent-memory RLS half-finished** | `semantic_memories`/`procedural_memories`/`agent_task_log` have RLS **enabled but 0 policies, not forced** (vs `episodic_memories` forced+policy, mig 116) — deny-all or no-op depending on role | One migration: add `tenant_isolation` policy + `FORCE` to match `episodic`, before the mig-117 `rfp_agent` role is used |
| P1-2 | **OnRfpUploaded drops the curator alert on shred failure** (workflow HIGH-2) | `shred()` re-raises → managed engine fail-fasts → `notify_curator` skipped — opposite of its docstring | Make `notify_curator` independent (no `depends_on`), and/or have `shred()` return an error dict |
| P1-3 | **Managed engine is fail-fast; docstrings say continue-on-failure** (workflow HIGH-3) | A raised ACTION `break`s the whole instance, skipping independent downstream steps | Align the loop to continue-on-independent-failure, or fix the docstrings + enforce "actions return a dict on failure, never raise" |
| P1-4 | **Fire-and-forget path silently skips TODO human gates** (workflow MED-4) | `_execute_step` has no `TODO` branch → gate becomes "unknown step" → skipped; an unmigrated deploy would publish content without review | Add a `StepType.TODO` case + extend the fire-and-forget guard to `(HITL_WAIT, TODO)` |
| P1-5 | **`tenantId` is not a HITL correlation key** (workflow MED-6) | `_event_correlates` fails open with no shared key; any future tenant-scoped `wait_for` without a key would resume cross-tenant | Add `"tenantId"` to `_CORRELATION_KEYS` (only tightens) |

### P2 — nice-to-have (hygiene; safe, low-risk)
- **Drop 17 dead tables** (grep-proven zero refs): NextAuth trio (`accounts`/`sessions`/`verification_tokens` — auth is JWT), dead seeds `agent_archetypes`/`system_config`, mig-093 orphans `collaborator_library_prefs`/`library_unit_shares`, deprecated `customer_events`/`content_events`, `invitations`, `legal_document_versions`, `pipeline_runs`, `proposal_reviews`, `solicitation_templates`, `system_health_snapshots`, `tenant_actions`, `tenant_uploads`. ~14% schema-surface cut. *(Confirm `/admin/agents` reads the Python archetype roster, not the `agent_archetypes` table, first.)*
- **Drop 7 redundant plain-btree twins** of UNIQUE indexes (verify DESC-ordering reliance on the `opportunity_bridge`/`canvas_versions` twins first).
- **Config tidy:** stale `Makefile:104` `STORAGE_ROOT` line; standardize `AUTH_*` (retire `NEXTAUTH_*`); dedupe `NEXT_PUBLIC_URL`/`_APP_URL` and `AWS_REGION`/`_DEFAULT_REGION`.
- **`validate()` guards** (cheap, would have caught the workflow bug): reject a workflow trigger on `system:workflow.%`; assert every `AI_INVOKE` action ∈ `TOOL_ACTION_TO_ARCHETYPE`; check `input_map` `step.<name>` refs a real earlier step; `depends_on` cycle detection.
- **`OnProposalCreated`** notify reads `payload.proposalTitle` but the route emits `title` → null template var.

---

## ✅ Already fixed this session (found by the audit, in my own recent work)
- **Dead scheduled workflows (workflow HIGH-1):** `OnOpsDigestRequested` + `OnSocialScheduleRequested` trigger on
  `system:*`, which the processor poll excluded wholesale — they could never fire. **Narrowed the exclusion to only
  `system:workflow.%`** (the processor's own emissions); scheduled `system:*` triggers now pass. Regression-locked.
- **Cron bridge not replica/crash-safe (workflow MED-5):** the cron event-emit now **compare-and-swap CLAIMs** the
  tick (advance `next_run_at` WHERE still-due, RETURNING id) before emitting → no double-emit. Regression-locked.
- (`test_cron_event_bridge.py`; 157 tests green.)

---

## Per-dimension detail

### Schema
Not indexes (hot spine well-covered) — the two split-brains + config + RLS above, plus 17 dead tables. Note:
`scout_sources`/`scout_findings`/`scout_runs` (mig 118) are **intentional new crawl infra**, not bloat (deploy-gated).
Largest tables (sandbox): `system_events` 438, `cms_content` 130, `taxonomy_terms` 122 (live), `tenant_bucket_scores` 108.

### Workflows
18 workflows audited. Core is strong (idempotent create with the partial-index `ON CONFLICT` restated; AI safe-skip
threaded on both paths; HITL login fail-open closed via `payload.userId`; newer workflows use the robust
independent-NOTIFY pattern; `ProjectCollaboration` is the reusable canonical HITL template). Remaining gaps are the
P1-2..P1-5 above + `OnSolicitationPushed` (= the scoring split-brain). **Authoring rule for future workflows:** trigger
on `phase="end"`/`"single"`, never `system:workflow.*`; the `:end` event carries only `result` (put every field you
read there); make must-run NOTIFY steps **independent** of fallible actions; actions **return a dict on failure, never
raise**; AI_INVOKE advisory + mapped + injection-fenced; HITL gates need a resume path + a correlation key
(entityId + `tenantId`); prefer reusing `ProjectCollaboration` over new bespoke `On*` classes.

### Spines
- **OPP bridge — TIGHT ✅** — forward-only by grant + code; zero backflow (only the navigational ToDo); both releases wired.
- **library_atoms — LEAK** (P0-1). **scoring — LEAK** (P0-3). **agent** — keying (`opportunity_id`, mig 088) + single
  `agent_task_queue` are clean/no-dupes; the only leak is the agent tools reading `library_units` (folds into P0-1).
- Root cause: **one unfinished additive convergence** (mig 101 explicitly deferred the crosswalk). The *converged*
  surfaces (`/cards`, `/atoms`, canvas, the bridge) are clean; the leftovers ring the outside.

### Archivability & retention — **reachable; we own the mechanism**
The 3-table agent-memory lifecycle (`lifecycle_scheduler.py` + `decay.py`/`gc.py`/`compactor.py`) is already a
complete, audited **decay → archive-flag → time-gated-delete-with-safety-guards → `system:memory.*` event** state
machine. Generalize it into a config-driven retention worker over the event/action firehoses.

**Add NOW so future archival stays possible (cheap, additive):**
- **Time indexes** on the 8 event/log tables that have only a pkey (`audit_log`, `customer_events`,
  `opportunity_events`, `content_events`, `agent_task_results`, `pipeline_runs`, `library_harvest_log`,
  `tenant_actions`) + done-side partials on `pipeline_jobs`/`tasks`/`agent_task_queue` — else any time-window purge seq-scans.
- **Soften the two hard FKs onto `system_events`** — `process_instances.trigger_event_id` → `SET NULL`, and break the
  `system_events.parent_event_id` **self-FK** into a plain `correlation_id` (no FK). *Policy: event tables get
  correlation columns, never inbound FKs* — this is the #1 partitioning blocker.
- Proactive `archived_at` columns on `audit_log`/`system_events`/`tenant_actions`/`*_events`; grant the app role
  `INSERT, SELECT` only on `system_events`/`audit_log` (copy the `opportunity_bridge` model).

**Phased design:** (D1, weeks) missing indexes + a `retention_policies` table + a generic **dry-run-first** retention
worker (new lifecycle job, `system:retention.swept`) on safe tables first (analytics/crawler/done jobs). → (D2, months)
native **monthly range-partition** the firehoses (`system_events`, `tool_invocation_metrics`, `customer_events`,
`agent_task_log`) so archival = **partition DETACH+drop**. → (D3, longer) **tenant export→purge**: FK-derived ordered
traversal manifest (CI-asserted) → exporter (jsonl/parquet + R2 object manifest + receipt) → **object-store sweep
after verify, before SQL purge** → **membership-aware ordered purge** (delete `user_memberships`, GC orphaned users —
**never delete `users` by `users.tenant_id`**, per mig 111). Lifecycle:
`active → churned → archived_at(slumber) → [90–180d] → exported(cold) → purged` (only the last irreversible, all audited).

**Tenant archival today:** mig 113's `archived_at` is a correct **reversible soft "slumber"** only — no data movement,
no `archived` status enum, and **no export/purge tooling exists** (grep-confirmed). The blockers to a real purge are
the ~35 `NO ACTION` inbound FKs on `tenants` (ordered child-first delete), the multi-membership user hazard, and R2
objects SQL can't reclaim — all buildable, none hard. Retention/purge jobs must run as a **bypass-RLS maintenance
role** (else FORCE-RLS tables silently report 0 rows).

---

## Bottom line
Sound architecture, clean converged spines, and a real engine — **thumbs up on the design.** To *launch*, finish the
two greenfield cutovers (P0-1, P0-3), flip the paywall default (P0-2), reconcile the agent-memory RLS (P1-1), and
land the four workflow-robustness fixes (P1-2..P1-5). The two scheduled-workflow bugs are already fixed. Everything
here is finite and finishable — no redesign.
</content>
