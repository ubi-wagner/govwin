# Proposal Lifecycle — Architecture & Implementation Design (V1)

**Status:** authoritative design for the open-to-close proposal process and the cost-control
substrate shipped in the current development push. Integrates with `ARCHITECTURE_V9.md`
(system as-built), `CLAUDE.md` (SOPs), and `CLAUDE_CLIFFNOTES.md` (schema/route quick-ref).
Companion: `docs/PROPOSAL_LIFECYCLE_TODO.md` (Red→Green task tracker).

**Verification baseline (this push):** tsc clean · 429 frontend tests · 524 pipeline tests ·
lint clean on changed files. RBAC, volume identity, and schema independently re-verified
(see §11). Known integration seams are tracked in the ToDo (not silently shipped).

---

## 1. Purpose & scope

A purchased proposal is a **container of digital artifacts** (Technical Volume, Cost Volume,
slide deck, …). Each artifact is a set of **major atomized sections** rendered on the canvas.
The lifecycle takes a proposal from **open** (created from a compliance matrix, AI-drafted V0
by our RFP admin) to **close** (every section accepted + locked by the customer, the proposal
advanced through its gates, submitted, and harvested back into the tenant's reusable library).

The whole process is **event-emitted and auditable end to end**: who asked for a draft, which
model answered, the accept/lock/unlock back-and-forth, document close, stage advance, and the
approved atomized content captured to the library — all queryable from `system_events` and
surfaced human-readably in the activity stream, notification bell, dashboard, and proposal
timeline.

This is also why **settable, checkable AI-call limits** exist: once the customer drives AI
draft/regen, per-tenant budget/rate/per-call guardrails are a prerequisite (§8).

---

## 2. The open-to-close process

Stages (DB enum): `draft → review → final → submitted → archived`. Per-proposal `gate_config`
(JSONB, default `["draft","final"]`) selects which gates apply; the canonical V1 config is
`["draft","review","final"]` ("the 3 stages"). "V0 / V1" are the **operational** names for the
first two passes: V0 = our RFP admin's initial build; V1 = released to the customer. The as-built
version model is **V0** (skeleton instantiated at provision) → **V0.5** (library plug-and-play) →
**V1** (draft/finalize; Force-advance available); the 72h curation SLA (`CURATION_SLA_HOURS=72`)
covers skeletoning only.

> The purchase→provision→V0 spine that precedes this lifecycle is canonical in
> `docs/MASTER_MIRROR_OPP_DESIGN.md`: comp-code purchase (`POST /api/portal/[slug]/purchase`) →
> `proposal_portals` `curation_pending` (72h) → shadow release → `provisionProposalForPortal` →
> `OnProposalCreated`→`draft_v0` auto-draft → V0. This supersedes any "admin-provisioned / no Stripe"
> language. The only backflow across the one-way opportunity bridge is a `proposal_setup` ToDo event
> (`assignee_role='rfp_admin'`, 72h, nudge [1,3]) routing a privileged actor into the tenant's RLS
> shadow account (`shadow_admin_grants`, mig 097).

```
 INGEST                 V0 (RFP admin)            HANDOFF        V1+ (customer tenant_admin)         CLOSE
 ──────                 ───────────────           ───────        ───────────────────────────        ─────
 opportunity ─▶ matrix ─▶ create proposal ─▶ AI draft + tag ─▶ accept+lock all ─▶ MANUAL advance ─▶ customer drafts/
 (curated      (volumes  (locked for admin   each section      each section       to V1 (rfp        regens/edits each
  solicitation, + items) review, sections    (proposal.        (section.locked)   admin; gate =     major section
  compliance)            from matrix)         draft_requested,                     all locked)      (ai/draft, regen,
                                              tool.invoked)                                          manual edits)
                                                                                                          │
                                                                                                          ▼
 harvest ◀─ submit/final-lock ◀─ ADVANCE (gated) ◀─ proposal.advance_ready ◀─ document.locked ◀─ accept+lock section
 (library     (proposal.advanced   (all sections      (emitted when ALL           (emitted when      (section.locked +
  atoms,        :end, harvest        locked, or         sections locked)            every section      snapshot + harvest
  approved)     completed)           force+marked)                                  of a volume         section.harvested)
                                                                                    is locked)
```

**Narrative.** (1) An opportunity is ingested and curated into a compliance matrix
(`solicitation_volumes → volume_required_items`). (2) `proposals/create` builds the proposal
**locked for admin review** (`is_locked=true`), seeding `proposal_sections` from the matrix
volumes/items (each section carries `volume_name`/`volume_number`). (3) The RFP admin drafts V0
with AI, tags sections, accepts + locks them, then **manually advances** to release to the
customer. (4) The customer's `tenant_admin` owns iteration: draft/regen/edit each major section,
then **Accept & Lock** it. (5) When every section of a volume is locked, the **document closes**
(`document.locked`); when **all** sections are locked, the proposal signals
`proposal.advance_ready`. (6) **Advance is gated on lock state** — it proceeds only when all
sections are locked, or an admin **force-advances** (which records the still-open sections as the
audit trail). (7) Advancing to `final` auto-locks → `submitted`; first lock **harvests** the
accepted content into the tenant's library as reusable, deduped atoms.

---

## 3. Roles & access

| Role | Draft/regen AI | Accept / lock / unlock section | Advance stage | Notes |
|---|---|---|---|---|
| `master_admin` | ✓ | ✓ | ✓ | platform-wide |
| `rfp_admin` | ✓ | ✓ | ✓ | builds V0; acts as tenant admin on the customer's behalf |
| `tenant_admin` | ✓ | ✓ | ✓ | **the customer owner** ("on their admin for now") |
| `tenant_user` | view + manual edit (per grant) | — | — | AI + accept/lock is admin-only in V1 |
| `partner_user` | comment/edit granted sections | — | — | stage-scoped external collaborator |

Enforcement is via `lib/proposal-access.ts::resolveUserAccess(userId, proposalId, tenantId)`,
which returns `role ∈ {admin, contributor, external}` + per-section permission sets. A
`tenant_admin` of the proposal's tenant (and any `rfp_admin`/`master_admin`) resolves to
`'admin'`; tenant access is verified at both the route layer (`verifyTenantAccess`) and inside
`resolveUserAccess` (proposal scoped by `tenant_id`). The section accept/lock routes gate on
`access.role === 'admin'` — **verified** to admit exactly the set above and exclude
tenant_user/partner_user with no cross-tenant path (§11).

---

## 4. Data model

**`proposals`** — `stage`, `gate_config` (JSONB), `is_locked`, `lock_count`, `unlock_deadline`,
`version` (OCC), `last_locked_at`/`last_unlocked_at`, `last_modified_by`.

**`proposal_sections`** — the unit of work:
- content: `content` (canvas JSON), `title`, `section_number`, `page_allocation`, `version` (OCC)
- status: `status ∈ (empty, ai_drafted, in_progress, complete, approved)`
- **lock lifecycle (mig 074):** `is_locked`, `locked_at`, `locked_by`, `volume_name`, `volume_number`
- **completion/accept (mig 046):** `completed_stage`, `completed_at`, `accepted_by`, `accepted_at`
- concurrency (mig 044): `editing_by`, `editing_since`, `last_modified_by`
- ⚠️ **no `tags`/`section_type`/`meta`** column yet — the Phase-3 keystone (§9, ToDo Track C).

**`canvas_versions`** — per-section content snapshots; `UNIQUE(section_id, version_number)`;
`snapshot_reason` (`stage_completed:<stage>`, `section_accepted:<stage>`), `source`, `created_by`.

**`stage_completion_snapshots`** (mig 046) — frozen state at each advance: `sections_snapshot`
(JSONB, now incl. each section's `locked` flag), `total_sections`, `sections_complete`,
`sections_approved`, `notes`.

**`proposal_stage_history`**, **`proposal_activity_log`** — per-stage + per-action audit rows.

**`library_units`** — harvested reusable atoms: `content`, `category`, `tags[]`, `embedding`
(vector 1536, HNSW), `confidence`, `status`, `atom_hash` (dedup), `original_proposal_id`,
`original_node_id`, `outcome`/`outcome_score`. **`library_harvest_log`** logs harvests.
**`library_atom_outcomes`** — `UNIQUE(unit_id, proposal_id)` (mig 073) ties win/loss back to atoms.

**`tenant_agent_config` / `platform_agent_config`** (mig 072) — settable AI limits (§8).

---

## 5. Event taxonomy & emitters (audit backbone)

Namespaces (per `CLAUDE.md`): `finder` (admin), `capture` (customer), `identity` (auth),
`proposal` (workspace), `library` (content), `system` (infra), `tool` (invocations). Never
`admin`/`cms`/`spotlight`. Type format `entity.action_past_tense`.

| Event | Namespace | When | Key payload |
|---|---|---|---|
| `proposal.created` | proposal | create from matrix | title, topicId, sectionCount |
| `proposal.draft_requested` | proposal | AI draft requested | proposalId, sections |
| `tool.invoked` (start/end) | tool | a model tool runs | model, archetype, durationMs |
| `compliance.checked` | proposal | ai/compliance run | proposalId, sectionId |
| `section.saved` | proposal | canvas save (OCC) | sectionId, title, version |
| `section.locked` | proposal | **accept + lock** | proposalId, sectionId, stage, volumeName |
| `section.unlocked` | proposal | reopen | proposalId, sectionId |
| `section.harvested` | library | per-section harvest on accept | proposalId, sectionId, atomsHarvested |
| `document.locked` | proposal | all sections of a volume locked | volumeName, volumeNumber, sectionCount |
| `proposal.advance_ready` | proposal | **all** sections locked | proposalId, stage, sectionCount |
| `proposal.advanced` (start/end) | proposal | stage advance | previousStage, targetStage, forced, forcedOpenSections, sectionsLocked |
| `proposal.locked`/`unlocked` | proposal | whole-proposal lock | lockCount |
| `harvest.completed` | library | whole-proposal harvest at final | atomsHarvested |
| `outcome.recorded` | proposal | win/loss | outcome |

**Human-readable surface.** `lib/event-labels.ts` is the **single canonical label + deep-link
map**, keyed on the real emitted `type` (fixing the prior `${namespace}.${type}` double-prefix
bug that rendered raw strings). It powers the **activity stream**, **notification bell** (read
filter + deep-links), **dashboard recent-activity**, and the **proposal timeline** — one fix
lands everywhere. `eventHref()` deep-links each row to its source proposal/section/opportunity.

These emitters are the **automation substrate**: `document.locked` → future collaborator
"get-ready" emails; `proposal.advance_ready` → future auto-advance under an agent manager;
new-priority-opp → customer notifications.

---

## 6. AI drafting / regeneration loop

- **Section draft** — `ai/draft` route + the registered `proposal.draft_section` tool (Claude
  **Sonnet**); inserts/updates canvas nodes. **Regen-with-prompt** is the per-node revise panel
  (`ai-revision-panel`, Sonnet, custom instruction). *Gap:* no one-click whole-section regen
  button yet (ToDo Track B).
- **Compliance check** — `ai/compliance` route (Claude **Haiku**), prompt-injection delimited,
  budget/rate guarded; returns score + issues inline.
- **AI review** — `ai/review` route emits `proposal.review_requested`, but **that event has no
  consumer**; the UI button is **deliberately disabled** ("coming soon") so it doesn't report
  success over a no-op. The `color_team_reviewer` archetype's actual live path is instead the
  advance-triggered `agent_task_queue` enqueue (§C3 Increment 2) → `fabric.process_task_queue`
  write-back into section context boxes.
- Surfaced in the **admin panel** (`proposal-ai-actions.tsx`, `role==='admin'`), which the
  customer `tenant_admin` sees (they resolve to `admin`). Contributors get per-node revise only.

Every model call flows through the cost guard (§8) before spending tokens.

---

## 7. The gate model (lock-state advancement)

- **Gate = all sections accepted + locked.** `advance/route.ts` queries `proposal_sections
  WHERE is_locked = false` inside the transaction; if any exist and `force` is not set → **422
  `SECTIONS_NOT_LOCKED`** with `details.openSections` (grouped by volume).
- **Force-advance** (admin override) proceeds and records the still-open sections as
  `forcedOpenSections` on the `proposal.advanced` event + activity log + stage snapshot — the
  audit trail for "forced to advance and marking open sections."
- **Carry-forward:** locks persist across stage advances (a locked section stays locked at the
  next stage). Re-editing at a later stage requires an explicit **unlock** (admin). This makes
  "done = locked" and avoids re-doing finished work; advancing with no new edits is valid.
- **Document close vs proposal advance:** `document.locked` fires per volume as it completes
  (automation hook); `proposal.advance_ready` fires when all are locked. Advance is **manual
  now** (RFP admin V0→V1) but gated on lock state, with the events in place to **auto-advance
  later**.
- Advancing to `final` auto-locks the proposal → `submitted`, enabling export + triggering the
  whole-proposal harvest.

---

## 8. Cost controls (the AI-spend substrate)

- **Unified guard** `frontend/lib/ai/agent-guard.ts` (live draft + compliance routes) and the
  pipeline guard in `pipeline/src/agents/fabric.py` — both enforce **monthly budget**, **hourly
  rate**, and **per-call ceiling**, costed **per model** (`MODEL_PRICING`; Haiku ≠ Sonnet).
- **Settable** (mig 072): `tenant_agent_config` (per-tenant override) → `platform_agent_config`
  (defaults + hard platform monthly cap + AI master switch) → hardcoded constant. Admin UIs:
  per-tenant on the account profile; platform-wide on `/admin/agents`. Customer read-only view:
  `/portal/[slug]/agents` (usage %, calls remaining — no dollar figures, per `RATE_MONITORING §7`).
- This is the prerequisite for customer-driven AI (§6): each draft/regen is checked + counted.

---

## 9. Integration seams & known debt (the "two models" problem)

The new **lock-state** truth coexists with the older **`status`-based** signals; several read
paths still speak `status` and now disagree. These are tracked Red in the ToDo (Track A):

1. **Review page readiness inverted** — `review/page.tsx` gates "Ready for Final" on
   `status==='complete'`, but locking sets `status='approved'`, so a fully-locked proposal reads
   "not ready." (HIGH)
2. **Advance UI can't reach the gate's escape hatch** — `stage-control.tsx` posts `{}` (never
   `force:true`) and keys visibility on the old requirements checklist; the `SECTIONS_NOT_LOCKED`
   error + `openSections` list aren't surfaced and there's no force button. (MED-HIGH)
3. **Force-advance mislabels open sections as accepted** — `advance/route.ts` stamps
   `accepted_by`/`accepted_at` on still-open sections. (MED)
4. **GET-proposal API `isEditable`** ignores `is_locked` (page is fixed; this API consumer isn't). (MED)
5. **Status↔lock unification** — `save` route still lets `status` be set independently of lock;
   **lock should become authoritative, `status` derived.** (root cause)

Resolution direction: **lock is the single source of truth**; `status` is a derived/display
concern; all readiness reads switch to `is_locked`.

---

## 10. Section meta-tagging (Phase-3 keystone — design intent)

The larger vision (library seeding, spotlight buckets, matrix-driven canvas selection) all hinge
on **section meta-tags**. **Shipped (C1, mig 075):** a discrete, hierarchical `section_standards`
taxonomy (Team→Bio, Technical→Overview/Innovation/Readiness, Commercialization, Facilities &
Equipment, Cost→Budget, … seeded for DOD/NSF/SBIR/STTR, **RFP-admin editable** via
`/api/admin/section-standards`), plus `proposal_sections.section_type` (soft ref) + `tags[]` +
`meta` (JSONB). The create-route tags each section (`lib/section-standards.ts::inferSectionType`)
and stores matrix `meta`. **Next (C2, vector-ready):** carry the classification onto harvested
`library_units` + an embedding column so meta-tags become classified, vector-searchable **shreds**
(tech highlights w/ primary ranking, readiness, team, tech overviews, commercialization, facilities
& equipment, prior funding); then tenant library seeding, spotlight-bucket scoring, and "similar
section" retrieval. **C3 (automation):** pipeline step-milestone automations the customer admin
configures at portal purchase, incl. **AI-agent review tasking** on force-advance (grammar / flow /
compliance → recommendations in section context boxes). See ToDo Track C.

---

## 11. What shipped this push + verification

| Area | Files | Status |
|---|---|---|
| Per-model spend pricing | `fabric.py`, admin usage route | 🟢 shipped |
| Unified spend guard | `lib/ai/agent-guard.ts` + draft/compliance routes | 🟢 shipped + tested |
| Settable AI limits | mig 072, admin APIs + UIs, fabric/guard | 🟢 shipped + tested |
| Portal AI usage view | `/portal/[slug]/agents` + panel | 🟢 shipped + tested |
| UI-UX audit + Tier-0/[once] fixes | auth cluster, `event-labels.ts`, scaffolding | 🟢 shipped + tested |
| Section accept/lock backbone | mig 074, lock route, workspace UI | 🟢 shipped (1a/1b) |
| Advance gated on lock state | `advance/route.ts` + tests | 🟢 shipped (2a) |
| Document-close + per-section harvest | lock route, `proposal-harvest.ts` | 🟢 shipped (2b) |
| Lock↔status unification (Phase 2c) | review page, stage-control (+force UI), advance route, API isEditable, save route | 🟢 shipped + tested |
| Section-standards taxonomy keystone (C1) | mig 075, `section_standards`, `section-standards` admin API, create-route tagging | 🟢 shipped + tested |
| Phase 3 C2 (shred classification/vector) · C3 (automation + agent tasking) · C4–C6 | — | 🔴 roadmap (ToDo Track C) |

**Independently re-verified this review:** (a) `vol.volumeName`/`volumeNumber` resolve to real
NOT-NULL DB values; (b) `access.role==='admin'` admits exactly {tenant_admin-own-tenant,
rfp_admin, master_admin}, no cross-tenant hole; (c) every column + `canvas_versions` unique
constraint the code writes exists. No correctness/security/data bugs in the new code — all open
items are integration seams + UX completeness (§9) and roadmap (§10).

---

## C3 — Automation & AI-Agent Review (design + status)

Grounded in a full inventory of the automation, workflow, agent, purchase, and
section-feedback subsystems. **Much of this is already built** — the work is wiring,
tenant-scoping, and one cross-stack write-back.

**Increment 1 — customer automation setup · 🟢 SHIPPED.** `tenant_automation_preferences`
(mig 076) + `/api/portal/[slug]/automation-preferences` (GET/PATCH, tenant_admin) + the
**Automation** portal page (grouped toggles). Conservative defaults; `configured_at` marks
setup. This is the "set it up at portal purchase" surface (a dashboard "get started" nudge +
post-purchase redirect is a small follow-on).

**Increment 2 — AI review on (force-)advance → section context boxes · 🟢 SHIPPED (trigger + run + write-back); display badge ⚠ verify.**
The agent infra is production-ready: `agent_task_queue` + `fabric.process_task_queue` (running
every ~20s, cost-guarded by the settable limits) + the `color_team_reviewer` archetype (invoked by
`agent_role`) + `requestAgentTask()` enqueue. The trigger and write-back are now wired (as-built in
`lib/proposal-advance.ts::advanceProposalStage()` + `fabric.py::_post_section_recommendation()`):
  1. **Trigger** — in the advance route, after a successful advance, if the tenant's
     `ai_review_on_advance` pref is on, enqueue one `review_section` task per locked section via
     `requestAgentTask({ agentRole:'color_team_reviewer', taskType:'review_section', proposalId,
     sectionId, input:{ requestedBy, sectionTitle, sectionText } })`. (`forced` is already on the
     `proposal.advanced` event, so "review on force-advance" is just a payload check.)
     *Design point:* pass **extracted prose** (`getNodeText` over the canvas), not raw canvas JSON.
  2. **Run** — the queue consumer already executes the archetype (cost-guarded; per-tenant budget).
  3. **Write-back** — add `_post_section_recommendation()` to `fabric.process_task_queue`: on a
     completed `review_section` task, `INSERT proposal_comments (recommendation_type='ai_review',
     section_id, user_id=requestedBy, content=summary)`. Clean hook (the loop already holds
     `proposal_id`/`section_id`/`result`).
  4. **Display** — add `recommendation_type` + `category` to `proposal_comments` (migration), have
     the comments GET + canvas sidebar carry it, and badge AI recommendations distinctly in the
     existing `CommentThread` (the "context boxes"). Attribution = the admin who triggered the review.
  *Tests:* advance enqueues-when-pref-on / skips-when-off (vitest) + the write-back inserts a comment (pytest).

**Increment 3 — notification + flow enforcement.** Have the executors consult
`tenant_automation_preferences`.
  - **3a — notification gating · 🟢 SHIPPED.** The CMS `event_listener` now gates tenant-scoped
    notification rules on the customer toggles. A rule opts in via `action_config.tenant_pref`
    (an allowlisted column); `_automation_pref_allows()` reads `tenant_automation_preferences`
    (shared DB, via the event pool) and skips the send when the toggle is off — default-on
    (ungated rules, non-tenant events, unknown prefs, missing rows, and lookup errors all
    proceed). The listener also surfaces the `system_events.tenant_id` column into the payload so
    `to_field=payload.tenantId` recipient resolution works (this also repaired the pre-existing
    `proposal.advanced` rule, which had the same to_field but no tenant in its payload). Seed
    (mig 078): rules for `proposal:document.locked` → `notify_team_on_document_locked` and
    `proposal:proposal.advance_ready` → `notify_collaborators_get_ready`, plus a `tenant_pref`
    on the existing `proposal.advanced` rule → `notify_on_stage_advanced`. Templates
    `document_locked_team_notify` + `collaborator_get_ready`.
  - **3a follow-ons · 🟢 SHIPPED.** (1) *Collaborator fan-out* (mig 079): the get-ready rule sets
    `recipients:'collaborators'`; the send_email handler emails every accepted collaborator on the
    proposal (`_resolve_collaborator_emails` — `accepted_at IS NOT NULL`, tenant-scoped, prefers
    the user-account email), falling back to the tenant admin when there are none. (2)
    *`notify_on_new_priority_opp`*: the spotlight digest (`spotlight_new_topics`) NOTIFY step
    passes `tenant_ids` (plural), which the single-recipient handler never delivered;
    `_handle_multi_tenant_notification` now fans it out per tenant, gating each on
    `notify_on_new_priority_opp` and de-duplicating per (event, tenant). The digest step carries
    `tenant_pref:'notify_on_new_priority_opp'`. This wires the 4th notify-* toggle **and** fixes the
    latent multi-tenant delivery gap.
  - **3b — auto-advance · 🟢 SHIPPED.** The advance core was extracted into
    `lib/proposal-advance.ts::advanceProposalStage()` (identical gate checks, snapshots,
    stage-history, optimistic-locking, `proposal.advanced` events, activity log, and
    AI-review-on-advance enqueue); the advance route is now a thin auth/validation wrapper over it.
    The lock route's all-locked path consults `auto_advance_when_all_locked` and, when on, calls
    the core (`trigger:'auto'`, non-forced — all sections are locked so the gate passes) one gate
    per all-locked event. Best-effort: an auto-advance failure leaves the proposal ready for a
    manual advance. The lock response carries `autoAdvancedTo` so the admin panel refreshes the
    stage. *One gate per trigger (not a full cascade to submitted) — the safe V1 semantic.*

**Compliance:** every agent invocation already passes the budget/rate/per-call guard (§8) and
fails closed; events stay in the `proposal`/`library`/`capture` namespaces; RBAC is tenant_admin+
for setup, admin-triggered for review.

---

## 12. File map (where the lifecycle lives)

- Create/seed: `app/api/portal/[tenantSlug]/proposals/create/route.ts`, `lib/compliance-resolver.ts`
- Section work: `.../sections/[sectionId]/{save,lock}/route.ts`, `components/canvas/*`,
  `app/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/page.tsx`
- AI: `.../ai/{draft,compliance,review}/route.ts`, `proposal-ai-actions.tsx`, `ai-revision-panel.tsx`,
  `lib/tools/proposal-draft-section.ts`, `lib/ai/agent-guard.ts`, `pipeline/src/agents/fabric.py`
- Advance/lock: `.../advance/route.ts`, `.../lock/route.ts`, `components/portal/stage-control.tsx`
- Access: `lib/proposal-access.ts`
- Harvest/library: `lib/proposal-harvest.ts`, `lib/tools/library-*.ts`
- Audit/events: `lib/event-labels.ts`, `activity/activity-stream-client.tsx`,
  `notification-panel.tsx`, `proposal-timeline.tsx`, dashboard recent-activity
- Workspace shell: `proposal-workspace.tsx`, `proposal-admin-panel.tsx`, `proposal-contributor-view.tsx`
- Schema: migrations `012` (volumes), `017` (canvas/library), `044` (concurrency), `046`
  (stage completion), `072` (agent config), `073` (atom outcomes), `074` (section lock)
