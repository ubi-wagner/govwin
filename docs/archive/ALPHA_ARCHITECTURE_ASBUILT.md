# Alpha Architecture — as-built (2026-07-05)

The current, verified system as it stands for the founding-cohort Alpha. Full design depth lives in
`ARCHITECTURE_V10.md`; component/role status + ToDos in `ALPHA_TODO_BACKLOG.md`; the test script in
`ALPHA_HITL_RUNBOOK.md`. This doc is the **topology + canonical data flows + what changed this cycle**.

---

## 1. Topology

```
                         ┌──────────────────────────── shared Postgres (govtech_intel) ───────────────────────────┐
  Browser ── HTTPS ──►  Frontend (Next.js 15, Railway)          Pipeline worker (Python 3.12, Railway)            │
                        · portal + admin UI + API routes         · main.py: 5 asyncio loops                        │
                        · tools registry (/api/tools/[name])       - ingester consumer (60s)                       │
                        · postgres.js (sql tagged templates)       - workflow processor (10s) + AgentFabric        │
                        · Anthropic (product AI: draft/compliance) - health (:8080)                                │
                        · S3/R2 client (uploads, pin-copy, export) - lifecycle scheduler                           │
                                    │                              - agent-task-queue consumer                     │
                                    └──────────────► system_events ◄──────────────┘                               │
                                                     (the bus)                                                     │
   CMS (FastAPI, own DB) ── polls system_events (notification.requested) ──► Gmail/Resend email                   │
                         └───────────────────────────────────────────────────────────────────────────────────────┘
   Object storage: Cloudflare R2 (S3-compatible) — rfp-admin/ · rfp-pipeline/ · customers/<slug>/…
```

Frontend + pipeline share the DB; CMS has its own DB and bridges via the shared `system_events` table.
Migrations (000→**108**) auto-apply on frontend deploy (`entrypoint.sh → db/migrations/migrate.mjs`).

---

## 2. The canonical value spine (data flow)

```
ADMIN                                           CUSTOMER
  rfp-upload / intake                             signup (accept) ──► backfillTenant ──┐
     │  opportunities + curated_solicitations         │  tenants + tenant_admin        │
     ▼                                                 ▼                                ▼
  rfp-curation (skeleton)                          /portal/<slug>/cards  ◄── tenant_opportunity_cards (L1)
     · solicitation_volumes + volume_required_items         ▲                          │ per-bucket scores
     · solicitation_compliance                              │ fanOutBridgeEvent        │
     · document_templates ── template_id ──┐                │ (active+trial tenants)   │ pin ──► R2 copy
     ▼                                      │          opportunity_bridge (L0, forward-only)
  solicitation.push ──► publishAndFanOut ───┴───────────────┘                          │
                                                                                       ▼
  provision (via portal release)  ◄──── comp-code purchase → curation_pending (72h SLA) → admin resolves "needs curation" ToDo (migs 105–108)
     · proposal_artifacts (volume tree)     resolveTopicCompliance ─► buildArtifactSpecs
     · proposal_sections (molds)            template canvas_document ─► interpolate {company_name} ─► section.content
     · proposal_compliance_matrix (not_addressed)
     ▼
  RELEASE (admin "release" provisions the build UNLOCKED)  ──►  CUSTOMER BUILD
                                                · sections/[id]/save (OCC)  · ai/draft (Sonnet-4)  · ai/compliance (Haiku)
                                                · Accept & Lock All ─► matrix→satisfied + harvest→library_atoms
                                                · advance draft→final ─► auto-lock→submitted (downloads on)
                                                · package?format=docx ─► real .docx
```

Everything above is **driven-verified this cycle** except the descoped items (self-serve Stripe;
automated amendment re-propagation) — see the HITL runbook §4.
The master→mirror opportunity architecture and the two-release (Spotlight vs proposal-portal) model behind this
spine are specified in **`docs/MASTER_MIRROR_OPP_DESIGN.md`** (canonical OPP→proposal design).

## 3. The unified library / atom loop (greenfield canonical)

```
upload (atoms/upload) ─► reference atom ─► select blocks ─► POST /atoms (primitive, source_anchor→ref)
        library_atoms + atom_tags + atom_lineage (RLS FORCE, visibility-enforced)
                    │  scored selector (/atoms/select: vol/kind/context)  ─► fills a section mold (draft)
                    ▼
   section lock ─► harvestSectionToAtomLibrary ─► derivative atom (source=download_derivative,
                    bound to document_cocoon, derived_from the source atoms) — idempotent per section.
```
Legacy `library_units` is the retired parallel (deprecate-in-phases; see `LIBRARY_CONVERGENCE_STATUS_2026-07-03.md`).

## 4. Events + automation

- **Bus:** every state change emits to `system_events` (7 namespaces: finder/capture/identity/proposal/
  library/system/tool; phase start/end/single). Payloads are **objects** (jsonb fix load-bearing).
- **Workflow engine:** `main.py` workflow processor polls every 10s, matches events to 12 templates,
  creates `process_instances` that **carry `opportunity_id`** from the frozen event overlay. HITL steps park
  a `tasks` row; completing it (`completeTask`) resumes the parked instance and emits — the human IS the
  advance trigger.
- **Agent workforce (`AgentFabric`):** 3 live producers (section_drafter/color_team_reviewer/
  compliance_reviewer); ~7 dormant. Spend fail-closed (`agent-guard`). See backlog Tier 3.5.

## 5. Fault-tolerance posture
- Best-effort side effects (backfill, harvest, matrix, notifications, auto-score) never fail the primary write.
- Optimistic-lock CAS on section save + proposal lock/unlock; compare-and-swap on lifecycle transitions.
- Idempotent: accept, section lock, atom-return, card upsert (ON CONFLICT tenant+opp).
- AI: fail-closed budget/rate/cap guard; honest degrade without keys; workflow-instance failure non-fatal.

## 6. What changed this cycle (delta vs V10)
- **Bug classes squashed (verified):** jsonb string-scalar (56 writes → `sql.json`, mig 104 backfill);
  `'t':'f'}::bool` edit no-op (3 tools); phantom `tenant_memberships`; sbir ON CONFLICT no-op → real dedup.
- **Onboarding:** accept returns the temp password + emits `tenant.cards_backfilled`; **river mirrors on signup**.
- **Skeleton→mold:** `volume_required_items.template_id`+`expert_notes` are now writable and **reach the
  provisioned section** (interpolated); greenfield provision now populates the **compliance matrix**.
- **Release:** admin can release a freshly-provisioned (`lock_count=0`) proposal to the customer.
- **Download:** the button returns a real **.docx** (was a JSON manifest); exporter hardened against
  missing canvas/node styles.
- **Migration:** 104 (jsonb backfill + `sbir_awards` unique index).

## 7. Migration map (greenfield tail)
088 opportunity_spine · 089 proposal_origin_card · 090 project_collaboration · 091 contracts_v2 ·
092 sweep_hardening · 093 collaborator_library_scope · 094 oppcard_bridge_spine · 095 oppcard_pin_docs ·
096 tenant_spotlight_buckets · 097 portals_shadow_guardrails · 098 portal_workflow_guardrails ·
099 intake_meta · 100 submission_stage_lifecycle · 101 unified_library_taxonomy · 102 atomizer_support ·
103 event_payload_jsonb_fix · 104 jsonb_string_scalar_backfill + sbir dedup ·
**105 curation_pending/promo_codes · 106 purchase→notify_admin · 107 spotlight_summary · 108 marketing content**.
