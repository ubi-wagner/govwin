# V1 Launch Readiness — Comprehensive Analysis & Red→Green ToDo

**Date:** 2026-06-27. **Scope:** full end-to-end surface (UI, API, AI, Automation, DB) +
the two E2E priorities (`V1_ARTIFACT_PIPELINE_DESIGN.md`, `V1_CONTROL_PLANE_DESIGN.md`).
**Purpose:** owner-reviewable analysis + complete interlinked ToDo. **No code changed to produce
this** — review, then we Red→Green.

---

## Part 1 — Method & confidence

Two multi-agent sweeps were run, then a **consolidated source-verification pass**:
1. **Readiness sweep** (UI / API / AI / Automation / DB) — bug/gap focused.
2. **Architecture re-sweep** (canvas-spec/export · ingestion/compliance/curation · V0/strawman/
   lock · settings/templates · control-tower/rollups) — flow & data-model focused.
3. **Verification** — every load-bearing and contradictory agent claim was checked against source
   (and, for migrations, applied to a throwaway Postgres 16 + pgvector). This corrected **~12
   agent false-negatives** (e.g. the `package` export route, the AI write-back, the live
   `agent_task_queue`, the tenant team page, `audit_log`, rfp_admin all-tenant access, the
   workflow heartbeat — all wrongly reported missing/dead, all verified present/live).

**Confidence:** findings below are verified, not raw agent output. Severities are recalibrated
(several agent "P0"s were downgraded once app-level mitigations were confirmed; a couple were
upgraded).

---

## Part 2 — Readiness verdict by surface

| Surface | Built | Verdict |
|---|---|---|
| **UI** | ~85% | Alpha-ready. Server-side RBAC, forgot-password E2E, canvas read-only all verified. Gaps = empty-state copy, upload hints, password-policy mismatch. |
| **API** | ~85% | Solid tenant isolation + Stripe signature verify. Fix `sql.unsafe` ingest + admin error-handling pass; invite token hardening. |
| **AI** | ~80% | Product path cost-guarded + fail-closed + current pricing. 3 **platform** Claude calls bypass cost logging (operator spend, not tenant bypass). |
| **Automation** | ~85% | Engine sound (dedup, isolation, all 4 toggles wired). One dead seeded rule. |
| **DB** | ~80% | App-level isolation solid; migrations apply clean on live PG. RLS no-op; soft-state retention intact. |
| **Artifact/V0 pipeline (E2E#1)** | ~70% | Canvas/spec/export/V0-copy/agents built; missing artifact container + authoring UI + enforcement + 3-source strawman. |
| **Control plane (E2E#2)** | ~65% | Settings/RBAC/heartbeat solid; missing control tower + health surface + rollups + archival. |

**Overall:** **alpha-ready for a controlled design-partner cohort** after Track G (hardening) +
operational wiring; the two E2E priorities (Tracks E/F) are the V1 feature build, and they are
*connect/author/enforce* work on substantial existing infrastructure, not greenfield.

---

## Part 3 — Cross-cutting confirmed findings

| ID | Finding | Sev | Surface | Ref |
|----|---------|-----|---------|-----|
| F-01 | 3 platform Claude calls skip cost-guard + `agent_task_log` (shredder per-ingest, source-scout cron, cms_content) — uncontrolled **platform** spend, no audit | P1 | AI | `shredder/runner.py:107`, `workers/source_scout.py:144`, `workflows/actions/cms_content.py:118` |
| F-02 | `sql.unsafe()` in SBIR ingest, no per-call try/catch | P1 | API | `admin/sbir-data/ingest/route.ts:291,350` |
| F-03 | RLS `ENABLE`d, **0 policies**, no `FORCE`; app=owner ⇒ no-op; isolation = app-level `WHERE tenant_id` (verified solid) — defense-in-depth + doc-vs-reality gap | P1 | DB | `001_baseline.sql:885-888` |
| F-04 | `system_health_snapshots` never written; no DB/S3/worker liveness surface (workflow heartbeat is the only live signal) | P1 | Control plane | verified 0 inserts |
| F-05 | Strawman fed 1 of 3 sources (no spotlight/customer data) | P0* | Artifact | `proposal-draft-section.ts` (0 hits) |
| F-06 | No `proposal_artifacts` container (sections grouped by string) | P0* | Artifact | table absent |
| F-07 | No expert volume/artifact/spec authoring UI | P0* | Artifact | no CRUD route/page |
| F-08 | No compliance enforcement at edit/save/export | P1 | Artifact | exporters |
| F-09 | Agents section/proposal-scoped only; `ProposalArchitectArchetype` unwired | P1 | Artifact/AI | `agent_task_queue` cols |
| F-10 | No unified control tower / event→process drill-down | P1 | Control plane | ~5 scattered pages |
| F-11 | No cross-portal project rollup | P1 | Control plane | `/admin/proposals` flat |
| F-12 | No event/audit archival job ("archive executed projects") | P1 | Control plane | grep |
| F-13 | `automation_rules` not tenant-scoped (global only) | P1 | Automation | mig |
| F-14 | Invite token enumerable UUID + no accept rate-limit | P2 | API | `api/invite/route.ts` |
| F-15 | ~15 admin routes: `await sql` outside try/catch (diagnostics) | P2 | API | various `admin/*` |
| F-16 | Format specs unstructured TEXT; CanvasRules missing min-font/images | P1 | Artifact | mig 012/001 |
| F-17 | Phase filtering missing (Phase II items in Phase I) | P1 | Artifact | `resolveVolumes` |
| F-18 | Dead rule "Social distribute on publish" (`content.published` never emitted) | P2 | Automation | `040_crm_phase1.sql:34` |
| F-19 | Password policy mismatch (change=12, reset=8 reported) | P2 | UI | `change-password-form.tsx:16` |
| F-20 | Library missing compound index `(tenant_id,category,status)` | P2 | DB | `001_baseline.sql:440` |
| F-21 | UI empty-state copy + upload validation hints | P2 | UI | proposals/spotlights pages |
| F-22 | Settings PATCHes don't write `audit_log` | P2 | Control plane | routes |

\* P0 *for the E2E#1 feature*, not for alpha go-live (alpha can ship without full V0 automation).

**Corrected non-issues (do not action):** topic.pinned "dead rule" (emitted — false positive);
tenant hard-delete cascade (by-design retention, fine for alpha); AI write-back / package route /
agent queue / team page / audit_log / rfp_admin access / heartbeat (all verified present).

---

## Part 4 — Red→Green ToDo (complete, interlinked)

> Legend: 🔴 not started. `P0–P2` priority. `[→X]` depends on X. `[∥]` parallelizable.
> Each item lists **Green** (done-criteria) + subtasks. File refs in the design docs.

### Track E — Artifact / Compliance / V0 pipeline (E2E #1)

- 🔴 **E1 · P0 · keystone** `proposal_artifacts` container. **Green:** table exists; `proposal_
  sections.artifact_id` FK; create-route groups sections into artifacts; advance/lock gate can
  require "all sections of artifact X locked".
  - E1.1 mig: `proposal_artifacts` (proposal_id, volume_id?, volume_number, volume_name,
    artifact_type, format_spec JSONB, compliance_spec JSONB, status, lock cols) + `sections.artifact_id`.
  - E1.2 create-route: create 1 artifact per required-item-group; link sections.
  - E1.3 advance/lock: artifact-scoped gate + artifact lock state.
- 🔴 **E2 · P1 · [→E1]** Structured specs. **Green:** `CanvasRules` gains `min_font_size`,
  `images_allowed`, image limits; `ComplianceSpec` type; `volume_required_items` format TEXT→JSONB;
  artifacts carry frozen specs.
  - E2.1 type changes (canvas-document.ts) + E2.2 mig (TEXT→JSONB backfill) + E2.3 freeze spec on artifact at purchase.
- 🔴 **E3 · P0 · [→E1,E2]** Expert volume/artifact/spec **authoring UI**. **Green:** RFP-admin can
  CRUD volumes + required-items + per-artifact format/compliance specs + required/optional, seeded
  from apply-preset/shredder, in the curation workspace.
  - E3.1 routes: `admin/rfp-curation/[solId]/volumes` (+`/[volumeId]/items`) GET/POST/PATCH/DELETE.
  - E3.2 UI: structured editor (replaces read-only volume list).
  - E3.3 (fast-follow) shredder *proposes* a volume/artifact structure for expert acceptance.
- 🔴 **E4 · P1 · [→E2]** Compliance **enforcement**. **Green:** `validateCanvasAgainstSpec()` runs
  at section save (warn) + final lock/export (block, 422 with violations: page/slide/min-font/
  images/required-sections).
  - E4.1 validator lib + E4.2 save-route warn + E4.3 export/lock gate + E4.4 sidebar live indicator.
- 🔴 **E5 · P0 · [→E1]** 3-source strawman + wire `ProposalArchitectArchetype`. **Green:** a
  `proposal.v0_requested` (or per-artifact) agent task drafts each section from **spotlight-bucket
  atoms + customer profile + RFP/library**; results write back per section.
  - E5.1 extend `proposal-draft-section` input (spotlightAtoms, customerProfile) + context assembly
    in the caller (query spotlight buckets + tenant profile).
  - E5.2 wire `ProposalArchitectArchetype.handles_event('proposal.v0_requested')` → fan to sections.
  - E5.3 "Generate V0" trigger (expert-initiated; cost-guarded).
- 🔴 **E6 · P1 · [→E1,E5]** Artifact/proposal-scope agent tasks. **Green:** `agent_task_queue.
  artifact_id`; task types `draft_artifact` / `review_artifact` / `review_proposal`; fabric fans to
  sections + aggregates; write-back reuses Increment-2 path.
- 🔴 **E7 · P1 · [∥]** V0 fidelity. **Green:** phase-filter volume items (`applies_to_phase`);
  merge per-item `custom_fields`; flow expert `annotations` into V0 section context.
- 🔴 **E8 · P1 · [→E1]** Gold-team across artifacts + package. **Green:** proposal-scope review
  surface (fans to all artifacts; findings as `ai_review` comments); `package` export honors
  per-artifact specs + renders images.
- 🔴 **E9 · P2 · [→E3]** Single source of truth for structure — generate `outline` from the
  volume/required-item hierarchy (or retire free-form outline).

### Track F — Admin control plane (E2E #2)

- 🔴 **F1 · P1 · [∥]** Unified control tower `/admin/control-tower` + process drill-down. **Green:**
  one dashboard (workflows by health, error rate by namespace, throughput, top tools, automation
  success/fail, service health); `/admin/processes/[instanceId]` shows step_results + event tree +
  retry.
- 🔴 **F2 · P1 · [∥]** Service/worker health. **Green:** `GET /api/admin/health` live probe (DB
  `SELECT 1`, S3 HEAD) + worker heartbeats written by pipeline loop + CMS listener (~60s);
  surfaced in F1.
  - F2.1 heartbeat table/reuse `system_health_snapshots` + writers; F2.2 probe route; F2.3 listener-lag metric.
- 🔴 **F3 · P1 · [∥]** Cross-portal project rollup `/admin/project-rollup`. **Green:** aggregate
  proposals-by-stage across all tenants (incl. abandoned), drill to per-tenant; reuse per-proposal
  status page. (Access already granted to rfp_admin.)
- 🔴 **F4 · P1 · [∥]** Event/audit archival. **Green:** `archived_at` cols + nightly pipeline job
  archiving `system_events`/`proposal_activity_log`/`automation_log` older than N days; optional
  `opportunity.closed → archive related proposals` rule.
- 🔴 **F5 · P1 · [→ B5]** Tenant-scope `automation_rules`. **Green:** `tenant_id` (nullable=global)
  + listener filter + admin "scope" column/filter; per-tenant rule creation.
- 🔴 **F6 · P2 · [∥]** Workflow template admin. **Green:** UI to activate/deactivate
  `process_templates` per global + per tenant (`tenant_automation_rule_config`); no code deploy to
  toggle a workflow for a tenant.
- 🔴 **F7 · P2 · [∥]** Settings-change audit. **Green:** every platform/tenant config + automation-
  pref PATCH writes `audit_log` (old/new/actor); `/admin/audit-log` view.
- 🔴 **F8 · P1 · [∥]** RLS decision. **Green (V1):** document app-level isolation as the enforcement
  + a test asserting every tenant-scoped query carries `tenant_id`; **OR (GA):** add tenant
  policies + `FORCE` + run app as non-owner role. Pick one (see design doc §3.5).

### Track G — Readiness hardening (ship before alpha)

- 🔴 **G1 · P1** Platform AI cost cap + logging on F-01 sites. **Green:** shredder/source-scout/
  cms_content Claude calls log to `agent_task_log` + respect the platform cap (shredder first — it
  fires per RFP ingest).
- 🔴 **G2 · P1** `sql.unsafe` ingest hardening (F-02). **Green:** parameterized or per-batch
  try/catch; constraint violations return clean errors.
- 🔴 **G3 · P2** Invite hardening (F-14). **Green:** signed/expiring token + accept rate-limit.
- 🔴 **G4 · P2 · [∥]** Admin SQL error-handling sweep (F-15). **Green:** per-`await sql` try/catch
  with specific codes across the ~15 routes.
- 🔴 **G5 · P2 · [∥]** Password-policy align (F-19) + UI empty-state/upload polish (F-21).
- 🔴 **G6 · P2 · [∥]** Remove dead rule (F-18); add library compound index (F-20).

### Track H — Operational & owed

- 🔴 **H1 · P1 · [∥]** **Tenant library seeding** (the Track-C "C3" I owe — seed company/
  collaborator/tech/bio atoms tagged at onboarding). **Green:** seeding flow + tagged
  `library_units`; feeds E5 strawman.
- 🔴 **H2 · P0 (ops)** Staging wiring + smoke: email (Resend/Google), Stripe (test keys + webhook),
  `ANTHROPIC_API_KEY`, pipeline worker loop, R2. **Green:** each path smoke-passes in staging.
- 🔴 **H3 · P1 (ops)** Execute the HITL walkthrough (`docs/baseline/HITL_ROLE_TEST_PLAN.md`) end-to-
  end once in staging. **Green:** all role tracks pass or defects filed.
- 🔴 **H4 · P1 (ops)** Security review of the branch (`/security-review`). **Green:** no open P0/P1.
- 🔴 **H5 · P2** Stripe purchase-path automated coverage. **Green:** webhook + checkout tests.

---

## Part 5 — Sequencing

```
Alpha gate (controlled cohort):   G1 → G2 → H2 → H3 → H4         (hardening + prove-in-staging)
E2E #1 (V1 feature):  E1 ─▶ E2 ─▶ E3 ─▶ E4
                        └─▶ E5(+H1) ─▶ E6 ─▶ E8      ;  E7 ∥ , E9 after E3
E2E #2 (V1 feature):  F1 ∥ F2 ∥ F3 ∥ F4 ∥ F5 ∥ F8   (mostly independent) ; F6/F7 fast-follow
Polish (continuous):  G3 ∥ G4 ∥ G5 ∥ G6 ∥ H5
```

- **Critical path to alpha:** Track G (G1/G2) + H2/H3/H4 — ~1–2 days code + a staging pass.
- **Critical path to V1 (E2E#1):** E1 → E3 → E5 (the keystone trio: container → authoring →
  strawman). E2/E4/E6/E7/E8 layer on.
- **E2E#2** is highly parallel (F1–F5/F8 independent) — mostly read-only views + two jobs.

**Recommended first review targets:** E1 (artifact container — keystone, schema decision), E3
(authoring UI — biggest net-new surface), E5/H1 (strawman + library seed — the "company meat on
the bones"), F1/F2 (control tower + health). Confirm the §5 open decisions in each design doc
before code.
