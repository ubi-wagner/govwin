# Spine Journey — Wiring Checklist · HITL Test Plan · UI Architecture Baseline

**Date:** 2026-06-30
**Companion:** `END_TO_END_SPEC_AND_PLAN_2026-06-30.md` (the model), `END_TO_END_SPINE_ANALYSIS_2026-06-30.md` (as-built).

This one artifact serves three jobs:
1. **Build checklist** — every link the spine needs, with status 🟢 wired / 🟡 partial / 🔴 gap / 🆕 new-feature.
2. **HITL test plan** — each stage's human gate + the event you watch to confirm it fired (the audit spine *is* the test harness).
3. **UI architecture baseline** — the surface each stage lives on, i.e. the screen map.

**Test protocol (every stage):** do the gate action → watch the **Observe** event in `/admin/events` (or the process/state pages) → confirm the **Landing** row was written → advance to the next gate. A stage passes when its event fires *and* its landing is correct. **Artery first** (the ⭐ rows), then the branches.

---

## Track A — RFP Pipeline (admin)

| # | Stage | Trigger → Action → Landing | Status | HITL gate | Observe (event) | UI surface |
|---|---|---|---|---|---|---|
| ⭐A1 | Ingest source docs | admin upload → `finder:rfp.uploaded` → `OnRfpUploaded`→shred → `solicitation_documents.extracted_text`, `curated_solicitations.full_text` | 🟢 | none (auto) | `rfp.shredding.start/end` | `/admin/rfp-curation/upload` |
| ⭐A2 | AI section + compliance extract | (in shred) Claude → `solicitation_compliance` + `curated_solicitations.ai_extracted`, status→`ai_analyzed` | 🟢 | none (auto) | status `ai_analyzed` | curation workspace |
| ⭐A3 | Topic / AOI association | `opportunity.bulk_add_topics` → `opportunities`(`solicitation_id`) | 🟢 | admin associates topics | `opportunity.topic_added` | curation workspace |
| ⭐A4 | Verify/build the matrix | `compliance.save_variable_value` → `solicitation_compliance.custom_variables` + `verified_by/at` + `curation_revisions` | 🟢 | admin verifies each var (anchored) | `compliance.variable_saved` | curation workspace (PDF + tag popover) |
| A5 | 4-level aggregation (Service-Org/Dept + component) | extend `compliance-resolver` to namespace-prefix rule sets | 🆕 | admin sets agency/office rules | `compliance.rule_saved` | curation + namespace-rules editor 🆕 |
| ⭐A6 | Author solicitation **summary** | `curated_solicitations.summary` (+ highlights) | 🔴 | admin authors | `solicitation.summary_saved` | curation workspace |
| A7 | Best-template select/build | `volume_required_items.template_id`; best-fit selection | 🟡 | admin selects/builds | `template.linked` | Template Studio + curation |
| ⭐A8 | Push to pipeline | `solicitation.push` → `finder:solicitation.pushed`; `opportunities.is_active=true` | 🟢 | **admin approves + pushes** | `solicitation.pushed` | curation workspace (Push) |
| ⭐A9 | Spotlight scoring | `OnSolicitationPushed` → `match_tenants` → `tenant_pipeline_items` + `spotlight_bucket_scores` | 🟢 | none (auto) | `tool:agent.dispatch` + scores | (events/pipeline view) |
| A10 | Master card + push-on-update | opp create/update → push → mirror rerank / mark-updated → pinned-card alert | 🟡/🆕 | admin edits master card | `opportunity.updated` → tenant pushes | **master opportunity card editor** 🆕 |

## Track B — Customer Portal

| # | Stage | Trigger → Action → Landing | Status | HITL gate | Observe (event) | UI surface |
|---|---|---|---|---|---|---|
| ⭐B1 | Mirror card / spotlight feed | read `tenant_pipeline_items` + `spotlight_bucket_scores` | 🟢 | customer browses | page view | `/portal/[t]/spotlights` |
| B2 | Pin (more info) + copy docs | `spotlight.pin` → `pursue_decision` task + **copy solicitation docs → tenant** | 🟡 (pin) / 🆕 (copy) | customer pins | `capture:topic.pinned` | spotlight detail |
| ⭐B3 | Purchase → workspace | Stripe webhook → `capture:purchase.completed` → `launchProjectCollaboration(72h)` | 🟢 | **customer buys** | `purchase.completed` | checkout |
| ⭐B4 | Proposal + sections created | `proposals/create` → `proposal_artifacts`(frozen) + `proposal_sections`(template-seeded) → `proposal.v0_provisioned` | 🟢 | none (auto) | `proposal.created` | portal proposal workspace |
| ⭐**B5** | **V0 STRAWMAN (keystone)** | `proposal.v0_requested` → `ProposalArchitect`/`section_drafter` → md→canvas → `publish_section_draft` → sections `ai_drafted` | 🔴 | none → then admin review | `proposal.section.drafted` ×N → `proposal.v0_completed` | canvas editor (sections fill in) |
| ⭐B6 | 72-hr admin review gate | `ProjectCollaboration` TODO; admin reviews + **releases** | 🟢 | **admin/manager reviews + unlocks** | `task.assigned` / `task.completed` | admin proposal review / task queue |
| B7 | Assign collaborators + rights | `createTask` + `proposal_collaborators` + `collaborator_stage_access` (comment/edit/accept) | 🟢 (R5) | admin assigns at portal build | `proposal.task.assigned` | delegation UI + canvas |
| B8 | Collaborator upload + library (Option B) | typed upload → `library_units.owner_user_id`/`visibility` + `library_unit_shares` approval | 🆕 (093 schema ✓) | collaborator uploads + **approves share** | `library.share_approved` 🆕 | collaborator library + upload-card 🆕 |
| ⭐B9 | Draft / edit sections | canvas editor; `library/similar` picker insert (fix text-only cast) | 🟢 / 🟡 | employees/collaborators draft | `proposal.section.edited` / `canvas_versions` | canvas editor |
| ⭐B10 | Section accept + lock | lock → `section.locked` → `artifact.locked` | 🟢 | **admin lock + accept** (collaborator marks complete) | `proposal.section.locked` | canvas editor |
| ⭐B11 | Harvest on lock | `proposal-harvest` → `library_units` (content atoms) | 🟢 | none (auto) | `library.harvest.completed` | library dashboard |
| ⭐B12 | Submit | stage → `submitted` | 🟢 | **customer submits** | `proposal.submitted` | portal |
| B13 | Outcome (win/loss) | outcome route → `library_units.outcome_score` (learning loop) | 🟢 | customer records outcome | `proposal.outcome.recorded` | portal |

**Cross-cutting — rights audit (Invariant 8):** emit `share_approved` (rights transfer) / `restricted` / `deleted` / `collaborator_assigned` / `locked` with actor + role-snapshot + context. 🆕 — observe in `/admin/events`. This is the legal-shield ledger; it must fire on every B7/B8/B10 action.

---

## The artery (test this end-to-end first)
**A1→A2→A3→A4→A8→A9 → B1→B3→B4→B5→B6→B9→B10→B11.** One solicitation, one tenant, one proposal, all the way to a harvested atom. The only 🔴 in the artery is **B5 (the V0 strawman)** — everything else is already wired; closing B5 makes the artery generative. Branches (A5/A6/A7/A10, B2/B7/B8/B13, the four library scopes, master/mirror, collaborator partitions, held skeleton) layer on after the artery is HITL-green.

## Automation now → later (the human→agent flip)
Every gate runs on the **one `ProjectCollaboration` template**, so each can flip from human to agent **without changing the card** — that's what HITL-testing a stage also validates:
- A2 already agent (shredder + Claude). A4 human-now → `compliance_reviewer` agent assist later. A9 already agent. **B5** = the first big human→agent (the strawman). B6/B10 stay human gates (review/accept) by design — agents *recommend*, humans *decide* (fabric guardrail). B13 human (outcome) feeds the learning loop that improves B5.

## UI architecture baseline (the screen map)
One UI primitive everywhere: **upload-card → atoms (node-addressable) → canvas → collaborate → generate → convert → download.**
- **Admin cockpit:** the **curation workspace** is the matrix-build cockpit (PDF + anchors + compliance + summary + topics + template + Push) → A1–A8. Plus **master opportunity card editor** (A10), **Template Studio** (A7), and observability (`/admin/events`, `/admin/process`, `/admin/system-state`) as the test harness.
- **Portal:** **spotlight feed/detail** (cards, B1–B2) → **proposal workspace** = the **canvas** (sections + tasks + collaborators + library picker, B4–B12) → **library dashboard** (B11/B13) + **collaborator library/upload-card** (B8).
- **The opportunity card** is the read-model that threads admin→portal (summary + matrix + template + readiness), mirrored per tenant.

---

## Build order (artery first, each link committed + observable)
1. **B5 keystone** — md→canvas converter (unit-tested here) → `draft_v0` action (guarded) → wire onto `OnProposalCreated` + emit `proposal.v0_requested`/`v0_completed`. *(deploy-HITL: purchase → sections fill)*
2. **B9 cast fix** — `library/similar` returns `canvas_nodes`; insert preserves structure. *(tsc here)*
3. **A6 summary** + surface on the card. *(migration + UI, testable here)*
4. **B8 collaborator library** UI on the 093 schema + **rights events** (cross-cutting). 
5. **A10 master/mirror + push-on-update**, then **A5 4-level matrix**, **B2 pin-copy**, **A7 best-template**, then the held skeleton.

Each step: wire → unit-test/tsc where possible → commit → you HITL-test the stage on deploy → I error-correct from the event trace.
