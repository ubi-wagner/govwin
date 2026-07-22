# V1 Opportunity-Centric Workflow Architecture (`oppStatus : spotlightStatus : projectStatus`)

End-to-end source review by six parallel auditors (2026-06-27) against the owner's model: **one
generic workflow manager runs three scoped instances per immutable `opportunity_id`, chained by
bridge events, surfaced as one layered card with a free `GROUP BY opportunity_id` rollup, driven by
bound task primitives.** Verdict: **feasible on what we have; the heavy runtime is built; the gaps
are a bounded, additive "unification layer," not a refactor.**

## 0. Owner confirms — both clean ✅
- **Origination-doc retention CONFIRMED.** The only `DELETE FROM solicitation_documents` in the repo
  is a one-time pre-launch migration; the shredder only *adds* `extracted_text` + S3 artifacts; the
  named-doc model (`document_type` enum + `document_label` + `is_primary`) is intact and read back
  post-push. Nothing prunes the originals.
- **Zero cross-tenant bleed during ranking CONFIRMED (twice).** The live ranking path
  (`score_tenants.match_tenants`, an ACTION step) is **deterministic Python — it never invokes
  Claude**. The agent path that *could* is tenant-bound end-to-end: fabric binds `tenant_id`
  server-side, `ToolRegistry` strips `tenant_id` from LLM params + injects the bound one, every
  tenant tool filters `WHERE tenant_id=$1`, `context.py` assembles only that tenant's data, and the
  scoping tenant is the typed `system_events.tenant_id` column (not editable JSONB). Prompt-injection
  fenced.
- **The L0→L1 bridge exists:** `finder:solicitation.pushed` → `OnSolicitationPushed` → scores all
  subscribed tenants → `tenant_pipeline_items` + `spotlight_bucket_scores` (immutable `opportunity_id`
  link-back). **Per-purchase unique copies confirmed** (each proposal its own artifact/section/S3 set).

## 1. The spine (the model, as-confirmed)
`opportunity_id` is the universal key. One layered **card** forward-carries **L0 (global master) → L1
(per-tenant bucket) → L2 (per-purchase project)**. Three instances of **one generic
ProjectCollaboration template**, chained by business bridge events
(`solicitation.pushed→spotlight`, `purchase.completed→project`), each parameterized for its scope.
Status rolls up by `GROUP BY opportunity_id`. Local automation = bound task primitives
(upload-named-docs / review-section / answer-question) + date triggers + nudge→login-email.

## 2. BUILT / PARTIAL / GAP map

### BUILT (solid, reusable as-is)
- **L0 master** (shared, no `tenant_id`): `opportunities`/`curated_solicitations`/`solicitation_*`;
  ingest→skim→shred→curate→push; compliance matrix (E1/E2 frozen specs).
- **L0→L1 fork**: deterministic 5-bucket scoring, `tenant_pipeline_items` + `spotlight_bucket_scores`,
  oppID link-back, pin.
- **L2 copy at purchase**: proposals + `proposal_artifacts` (frozen `format_spec`/`compliance_spec`)
  + sections + supporting-docs + S3; `proposals.opportunity_id` link-back.
- **3-stage gate**: `gate_config`, serial completion-gated advance, **admin-only** accept/lock, the
  **force-advance override that locks + documents** open sections, artifact roll-up, stage snapshots,
  lock-gated `package`/download.
- **Engine runtime**: event-trigger start, HITL park/resume, nudges, deadlines, crash recovery,
  step/instance retry, audit transitions, **payload-driven step + task parameterization**
  (`OnCmsContentRequested` = the launch-with-overlay pattern to generalize).
- **Task ledger**: `tasks` (role+user queue, `due_at`, `nudge_schedule`, `params`/`result`) +
  `completeTask`→resume→emit + `TaskQueue` dashboard.
- **Access pre-set**: `collaborator_stage_access` (view/comment/edit) + `assigned_sections`, set by
  tenant_admin at invite (before first login). Customer-admin force-advance route wired.
- **Three card surfaces** (hand-rendered, reusable as tab bodies): spotlight card, project
  admin-panel + stage-control, curation workspace. Opportunity lifecycle (C6 archive/reopen).

### GAP — system-level (the unification spine)
| # | Gap | Delta |
|---|-----|-------|
| **W-A** | `process_instances` has **no `opportunity_id`** + no `scope` column (`source` is locked to pipeline/cms = the engine owner, not the scope) | mig: `opportunity_id` (indexed) + `scope`('opp'/'spotlight'/'project') + scope-owner id — *the keystone key for instances + rollup* |
| **W-B** | **No generic template** — 11 bespoke `On*` classes; no parameterizable "project" template | ONE payload-parameterized `ProjectCollaboration` Workflow (model on `OnCmsContentRequested`) |
| **W-C** | **No template parameter store** — `process_templates` is on/off catalog only | `definition`/`params` JSONB on `process_templates` OR a `project_workflow_config` table per (purchase,opp) |
| **W-D** | **Bridge chaining unwired** — `purchase.completed` emitted (with `opportunityId`) but no consumer (`AdminProposalSetup` phantom); workflow→workflow needs a final-action *business* event (processor skips `system:*`) | register a real project workflow on `purchase.completed`; chain scope→scope via final-step ACTION emitting the next business event carrying `opportunity_id`; retire the phantom + clean the dead lock-route completer |
| **W-E** | **No persisted forward-carrying card** — L0/L1 not copied into L2; origin is a live JOIN; source bucket not stored | `proposals.origin_card` JSONB snapshot + `source_bucket` column, populated in the create txn |
| **W-F** | **oppID rollup GAP** — `/admin/proposals` flat; no opp→bucket→project rollup | a `GROUP BY opportunity_id` VIEW (`opportunities ⋈ tenant_pipeline_items ⋈ proposals`) + `/admin/opportunities` page (= control-plane F3) |
| **W-G** | **Layered tab-card + tab-lock + spotlight lock-states + archived note** net-new UI | a `Tabs` primitive + `opportunity-card`; tab-lock modeled on `stage-control`; spotlight `locked` render on pin/purchase + `lifecycle_status` guard ("archived → contact your admin") |
| **W-H** | **Multiple proposals per opp BLOCKED** (create-route 409s on `(tenant,opp)`) — contradicts the model | lift the block; allow N independent projects per opp |
| **W-I** | **Lifecycle dates partial** — `pre_release`/`interim` missing; archive=close+30 not automated | add date cols + a close+30 auto-archive sweep |
| **W-J** | **Re-rank on new portal/profile GAP** — scoring only on `solicitation.pushed` | a `match_one_tenant()` tenant-fan-out on portal-create/profile-update |

### GAP — local-level (the bound primitives)
| # | Gap | Delta |
|---|-----|-------|
| **W-K** | **J1 human task creation** — tasks are engine-only; no `createTask` route/UI/process-builder | `createTask` core + admin/employee task-assign route + the bounded process-builder (pick people, sequence bound primitives, set time/step triggers + nudge/timeout) |
| **W-L** | **J2 date/cron triggers** — only `EventTrigger`; `due_at` relative-only | a `ScheduleTrigger` + a date-anchor sweeper that *creates* dated tasks from the compliance-matrix anchors (purchase→RFP→interim→close; +30 archive) |
| **W-M** | **Typed completers** — generic Approve/Dismiss only | bind **upload-named-docs** (`proposal_supporting_docs`, customer-named, required), **review-section** (the lock as a task), **answer-question** (text) to `completeTask`; HITL-as-upload |
| **W-N** | **nudge→login-email rule** — `task.nudge` dead-ends; no template; no role→email; no token login | `automation_rules` row `system/task.nudge→send_email` (login link) + role→email resolution + a task-nudge template |
| **W-O** | **CC-manager** — no Cc support, no `users.manager_id`, no `days_before_due` consumer | add `manager_id` + Cc + branch on nudge number (2nd/3rd → CC manager) |
| **W-P** | **Task timeout/retry orphan bug** — a timed-out instance leaves its `tasks` row `open` forever; `'expired'` is a dead enum | a task `due_at` sweep (→`expired`/retry) reconciling task↔instance deadlines |
| **W-Q** | **pin→nudge workflow GAP** | a workflow on `topic.pinned` creating a `close_date`-anchored task (today→close); cancel on unpin |
| **W-R** | **Strawman 3-source GAP** (E5) | wire `proposal.v0_requested` → `ProposalArchitect` fanned per section, fed L1 bucket atoms + `tenant_profiles` + RFP |
| **W-S** | **72h HITL gate GAP** | model the 72h review as a real `ProjectCollaboration` HITL/TODO step (pause+nudge+escalate) |
| **W-T** | **Gated-access ↔ task binding GAP** — task assignment decoupled from pre-set access; E13 per-artifact design-only | bind `_create_task`/`createTask` assignee to `proposal_collaborators`/access; build E13 per-document grants |

## 3. The buildable architecture (the unification layer)
**One generic `ProjectCollaboration` workflow template** + **a parameter store** + **`process_instances`
keyed by `opportunity_id` + scope** = the three instances (`oppStatus`/`spotlightStatus`/
`projectStatus`) of one engine, chained by **business bridge events**, surfaced as **one layered
`opportunity-card`** (tabs lock on advance; click-back audit), rolled up **free** by
`GROUP BY opportunity_id`, and driven by **typed task primitives** the customer admin sequences in a
**bounded process-builder** at purchase. Nothing here replaces the working subsystems — it keys,
parameterizes, chains, and surfaces them.

## 4. Build tasking (sequenced; each is bounded + additive)
**Phase W0 — keystone keying (unlocks the spine + the rollup):** W-A (opp_id+scope on
process_instances) · W-F (oppID rollup view + page) · W-E (persist origin card + source_bucket) ·
W-H (lift multi-proposal block).
**Phase W1 — generic engine:** W-B (ProjectCollaboration template) · W-C (parameter store) · W-D
(bridge wiring + retire phantom) · W-L (ScheduleTrigger + date-anchor sweeper).
**Phase W2 — local frictionless loop:** W-K (human task create + process-builder) · W-M (typed
completers + HITL-as-upload) · W-N (nudge→login-email) · W-O (CC-manager) · W-P (task timeout/retry
fix) · W-Q (pin→nudge) · W-T (access↔task binding).
**Phase W3 — card spine UI:** W-G (layered tab-card + tab-lock + spotlight lock-states + archived
note).
**Adjacent (already tracked):** W-R = E5 strawman · W-S = the 72h HITL gate · W-I lifecycle dates ·
W-J re-rank-on-new-portal · E4 validator · E8.2 package-by-artifact.

**Recommended first build:** Phase W0 (W-A + W-F) — the `opportunity_id` key on `process_instances`
+ the rollup — because it is the cheapest change that unlocks the entire spine (instances become
keyable + chainable + rollup-able), with zero risk to the working subsystems.
