# ToDo / HITL Framework — Map · Gap Analysis · Implementation Plan

**Status:** mapping (2026-08-12) · **Scope:** every human-in-the-loop ToDo for rfp_admin,
tenant_user/tenant_admin, and the shadow-admin descent. Per the house policy: **full map → gap
analysis → plan → implement**. This doc is the single source of truth for that wiring.

---

## 1. The framework as built (verified map)

### 1.1 The ledger
`tasks` (mig 053) — one row per ToDo: `task_type`, `assignee_role` | `assignee_user_id`,
`tenant_id`, `entity_type`/`entity_id`, `process_instance_id`+`step_name` (set when the ToDo is a
**parked workflow step**; NULL for a **standalone human delegation**), `status`
(open·in_progress·completed·cancelled·expired), `due_at`, `nudge_schedule`, `nudges_sent`,
`params`, `result`.

### 1.2 The catalog (single source of truth for a ToDo's workflow)
`frontend/lib/tasks/workflows.ts` — `TASK_WORKFLOWS` keyed by `task_type`, each with a human name,
ordered steps, `actionStep`, a `completer` (review·upload·form·acknowledge), and `producedBy`.
`resolveTaskWorkflow` NEVER returns undefined — an unmapped type collapses to the **`broadcast`**
floor (read + acknowledge). **Defined today:** review_section, proposal_setup, proposal_build,
contract_kickoff, document_request, intake_form, delegated_task, admin_review, proposal_review,
curation_release, broadcast.

### 1.3 Who PRODUCES ToDos
**Pipeline (parked workflow steps — `StepType.TODO`, carry `process_instance_id`):**

| task_type | assignee_role | workflow file | in catalog? |
|---|---|---|---|
| `content_publish` | rfp_admin | on_cms_content_requested.py:102 | ❌ |
| `triage_new_opportunities` | rfp_admin | on_opportunities_detected.py:155 | ❌ (catalog has `admin_review`) |
| `source_review` | rfp_admin | on_source_change_detected.py:160 | ❌ |
| `proposal_review` | tenant_admin | on_proposal_advanced.py:200 | ✅ |
| `proposal_draft_stage_review` | tenant_admin | on_full_draft_requested.py:130 | ❌ |
| `proposal_style_lock_review` | tenant_admin | on_full_draft_requested.py:182 | ❌ |
| `proposal_full_draft_review` | tenant_admin | on_full_draft_requested.py:330 | ❌ |
| `advisory_overlay_review` | tenant_admin | advisory_overlay.py:138 | ❌ |
| *(payload-driven)* | payload | project_collaboration.py:105 | via generic |

**Frontend (`createTask`, standalone — `process_instance_id` NULL):**

| task_type | assignee | site | in catalog? |
|---|---|---|---|
| `proposal_setup` | rfp_admin | stripe/webhook:201, purchase:164 | ✅ |
| `application_triage` | rfp_admin | applications/route.ts:201 | ❌ |
| `admin_review` | rfp_admin | proposals/create:780 | ✅ |
| `contract_kickoff` | tenant | outcome:347 | ✅ |
| *(delegated)* | user/role | tasks/assign, launch-collaboration | delegated_task |

(Agent tasks — `catalog`, `seed_map`, `research`, `analyze_fit`, `score_adjustment`,
`proposal.compliance_check` — go to the **`agent_task_queue`**, NOT the human `tasks` ledger; they
are a separate lane and out of scope for this HITL map.)

### 1.4 Where ToDos are SURFACED
- **Admin (rfp_admin/master_admin):** `app/admin/dashboard/page.tsx` + `app/admin/rfp-curation/triage-todos.tsx`
  mount `TaskQueue` on `/api/admin/tasks` → `listOpenTasksForActor` (admin branch) + `listOpenAdminTriageTasks`.
  Query returns tasks where `assignee_role IN ('rfp_admin','master_admin') OR assignee_user_id=me`.
- **Tenant (tenant_user+):** `components/portal/cockpit.tsx` mounts `TaskQueue` on
  `/api/portal/[tenantSlug]/tasks` → `listOpenTasksForActor` (tenant branch), gated by `verifyTenantAccess`.
- **Completion:** POST to the same routes → `completeTask` → closes the row, then **resumes** the
  parked instance via `forceAdvanceProcess` (paused→retrying; the pipeline reconciler runs the next
  step). Standalone tasks (no instance) just close. `manager_request` is special-cased out.

### 1.5 Completers + deep-links
`lib/tasks/completers.ts` — `review`·`upload`·`form`·`acknowledge`. `uploadHref` maps ONLY
`entity_type='proposal'` → the proposal workspace; every other entity type gets **no CTA link**.

### 1.6b Census + resume mechanics (verified)
**~21 live task types.** Catalogued **6** (proposal_setup, contract_kickoff, admin_review,
proposal_review, delegated_task, broadcast). Collapse to the broadcast floor **~15**
(triage_new_opportunities, content_publish, source_review, proposal_draft_stage_review,
proposal_style_lock_review, proposal_full_draft_review, advisory_overlay_review, vault_artifact_review,
partner_registration_triage, manager_request, starter_set_offer, application_triage, `review`,
final_due, and the portal stage set acknowledge/complete_sections/upload_documents). Dead catalog
entries (defined, produced nowhere) **5** (review_section, proposal_build, document_request,
intake_form, curation_release).
**Resume:** R1 — `completeTask` → `forceAdvanceProcess` (paused→retrying) → pipeline
`poll_retrying_instances` re-drives from the next step (the real human path). R2 — for TODOs that
declare `wait_for` (proposal_review, source_review), an entity event correlates via
`match_waiting_instances`. **Every parked pipeline gate resumes correctly** — the loop is intact; the
incompleteness is *labeling/completer/surfacing*, not the mechanics.

### 1.6 Nudge / escalation (policy)
Pipeline `manager.py:1014` sweeps open tasks with `due_at`+`nudge_schedule` → fires in-app + email
nudges (idempotent via `nudges_sent`) + an escalation floor. `lib/automation/policy.ts`
`resolveGatePolicy` is the injection point for per-gate cadence × timing × recipients (the #190
policy layer; inert until a tenant edits a policy). **New ToDos MUST route their nudge cadence
through this**, not hard-code it.

---

## 2. Gap analysis  *(verified against source + two mapping agents; the framework's incompleteness, exactly)*

**G1 — Catalog drift (HIGH; the "every ToDo is a defined workflow" invariant is nominal-only).**
At least **11** produced task types are absent from `TASK_WORKFLOWS`, so they collapse to the generic
**broadcast note** ("Read · Acknowledge", `acknowledge` completer) — the human sees "Broadcast note"
with the wrong steps + completer instead of the real workflow. Missing: `content_publish`,
`triage_new_opportunities`, `source_review`, `proposal_draft_stage_review`,
`proposal_style_lock_review`, `proposal_full_draft_review`, `advisory_overlay_review`,
`application_triage`, `vault_artifact_review` (lib/vaults/vaults.ts:286),
`partner_registration_triage` (lib/partner/registration.ts:124), `manager_request`
(lib/partner/manager-request.ts:57). Conversely `review_section`/`proposal_build` are **defined but
produced nowhere** (section lock happens inline in the canvas) — dead catalog entries.

**G2 — Shadow-admin HITL is unreachable through the queue (HIGH; the crux of the ask).** Verified:
an rfp_admin/master_admin descent does **NOT** swap the session role (`api/enter/route.ts:40-43`,
"admins don't pin — they shadow"; contrast `api/partner/enter:42-44` which *does* `unstable_update`
to `tenant_admin`). So in-tenant they run `listOpenTasksForActor`'s **admin branch** → they get
admin-bucket tasks, NOT the company's `tenant_admin`/`tenant_user` ToDos. Three failures compound:
(a) the cockpit todos **badge counts all tenant tasks** but the drawer shows only admin-bucket rows →
count≠queue; (b) `completeTask`'s assignee check is **role-exact** (`tasks.ts:305-310`: `rfp_admin ≠
tenant_admin`) → 403 even with the cross-tenant god-view; (c) the only working lever is the *separate*
`/processes` force-advance (workflow-parked ToDos only) — **human-delegated** tenant ToDos
(`process_instance_id` NULL: `manager_request`, `vault_artifact_review`, `delegated_task`) are
entirely unreachable. The `verifyTenantAccess` docstring (`lib/db.ts:125-127`) asserts the opposite —
**a doc/impl mismatch to fix**.

**G3 — tenant_admin ↔ tenant_user ToDos silo (HIGH).** The tenant branch matches
`assignee_role = ${role}` **exactly** (`tasks.ts:85`), not hierarchically. A `tenant_user`-bucket ToDo
is invisible to the `tenant_admin` (and vice-versa) unless targeted by user-id. A ToDo parked on the
"wrong" bucket is never seen. (Admin side is inclusive: `IN ('rfp_admin','master_admin')`.)

**G4 — partner_user ToDos are orphaned (MED).** The tenant assign route permits `partner_user`
(`tasks/assign/route.ts:60`) and two catalog entries are `side:'both'`, but the tenant tasks GET
requires `tenant_user+` (`tasks/route.ts:31`) → partner_user 403, and no `TaskQueue` mounts on any
partner surface. Any partner_user-assigned ToDo can never be seen or completed.

**G5 — Admin triage is split + partly read-only (MED).** `/admin/dashboard` (completable,
cross-tenant `listOpenTasksForActor`) vs `/admin/rfp-curation` triage (read-only,
`listOpenAdminTriageTasks`, different scope). No single admin inbox; `proposal_setup`'s real
completion is the curate/release workspace, not the queue.

**G6 — `manager_request` uncompletable from the queue (MED).** It lands in the assigned admin's
cockpit but any completer click 409s (`tasks.ts:317-319`); real completion is only the Team page. The
rfp_admin fallback variant (tenant NULL) has no null-tenant Team page → the admin must descend.

**G7 — Deep-links + completer correctness (MED).** `uploadHref` only knows `entityType='proposal'`
(`completers.ts:60`); content/source/opportunity/vault ToDos get no "open the thing" CTA. And the
collapsed-to-broadcast review gates use `acknowledge` (a bare "got it" that resumes with no captured
approve/reject verdict; a reject should hold the instance, not silently advance). Wiring
`content_publish`→Content Studio is the content instance of this (#163).

**G8 — Portal stage ToDos don't advance their own workflow (MED, genuine broken loop).**
`acknowledge`/`complete_sections`/`upload_documents` (portal-workflow.ts:112) are standalone;
`completeTask` closes the row but has **no hook to `advancePortalStage`** — completing every stage ToDo
does NOT move the portal forward; a manager/admin must separately call the advance route. The "resume"
is out-of-band, not part of completion.

**G9 — Mislabeled "to-dos" link (LOW).** The base tenant_user empty state routes "to-dos" to
`/processes` (the instance ledger), not the cockpit ToDo drawer (`dashboard/page.tsx:189`).

> **Net:** the ToDo *loops* mostly work (parked gates resume correctly). What's "not complete" is
> (i) **catalog fidelity** — ~15 real ToDos mislabel as broadcast/acknowledge instead of their real
> workflow+completer (G1); (ii) **role surfacing** — shadow-admin can't reach tenant ToDos (G2),
> tenant_admin↔tenant_user silo (G3), partner_user orphaned (G4); (iii) **two real broken loops** —
> manager_request from the queue (G6), portal-stage advance (G8); (iv) **deep-links/verdict capture** (G7).

---

## 3. Implementation plan  *(per policies/processes — phased, green + committed at each step)*

**P1 — Catalog fidelity + a drift guard (G1).** Add the ~15 produced-but-uncatalogued `task_type`s to
`TASK_WORKFLOWS` with real name/steps/`completer`/`producedBy` (esp. the review gates →
`review` completer, not `acknowledge`); retire the 5 dead entries (or wire `document_request`/
`intake_form` if the delegation UI should stop overloading `delegated_task`). Add a **vitest drift
guard** that greps every `createTask`/`_create_task`/`INSERT INTO tasks` `task_type` and asserts a
catalog entry exists (mirrors `__tests__/automation-catalog.test.ts`). Pure/low-risk; biggest UX win.

**P2 — Role surfacing (G2, G3, G4) — the security-sensitive core.** In `listOpenTasksForActor`:
(a) **G3** make the tenant assignee match **hierarchical** (`assignee_role` at-or-below the actor's
tenant role) so tenant_admin sees tenant_user ToDos; (b) **G2** when an admin is scoped to a specific
tenant (descended), ALSO return that tenant's `tenant_admin`/`tenant_user` ToDos — the shadow-admin IS
tenant_admin-by-derived-membership, and this is **bounded to the one descended tenant** (no cross-tenant
widening; audited). Mirror the same effective-role rule in `completeTask`'s assignee check so a
descended admin can complete them. Fix the cockpit badge to match the drawer. Fix the
`verifyTenantAccess` docstring. **(G4)** decide partner_user ToDos: either mount a partner ToDo surface
or stop the assign route offering `partner_user`. → **Guardrail: this is the only change that touches
data-segregation; it must stay bounded to the descended tenant and be covered by a cross-tenant denial
test (own-tenant allowed · other-tenant denied · descended-admin allowed-in-that-tenant-only).**

**P3 — Fix the two real broken loops (G6, G8).** `manager_request`: the queue should route to the
Team-page action (not show a generic Complete that 409s); the rfp_admin fallback needs an admin-plane
resolve surface. Portal-stage ToDos: on the last stage ToDo completing, call `advancePortalStage`
(or make the stage advance the completion hook), so completing the work moves the portal.

**P4 — Deep-links + verdict capture (G7, #163).** Generalize `uploadHref`→`taskHref(entityType,…)`:
content_pages→`/admin/site/docs/[type]/[slug]`, source→curation, opportunity→intake, proposal→workspace,
vault→vault. Give the review gates an approve/reject completer that writes the verdict to `result`
(reject holds the instance instead of silently advancing). Thread `tenantSlug` into the admin mount so
admin upload CTAs work.

**P5 — Policy + single admin inbox (G5) + prove.** Route any new/rewired producer's nudge/due/
escalation through `resolveGatePolicy` (no hard-codes). Consolidate the admin triage to one completable
inbox (or make `/admin/rfp-curation` completable). Then: tsc + vitest (incl. the drift guard + the
cross-tenant denial test) + a live drive per role — park one ToDo of each shape, confirm it renders
with its real workflow + completer in the right queue (rfp_admin · tenant_admin · tenant_user ·
descended shadow-admin), complete it, confirm resume. Screenshots per role.

Order: **P1 → P2 → P3 → P4 → P5**, each green + committed before the next. P2 is the one requiring an
explicit guardrail sign-off (data segregation) before it ships.
