# V1 Tasking — Consensus-Locked Red→Green ToDo & Sub-tasks

**Built from a 4-way consensus** (3 independent competitive analyses + a source-verified column)
over 18 load-bearing questions. Every task below is anchored to a consensus verdict (the `Qn`
refs). Companion docs: `V1_LAUNCH_READINESS.md` (analysis), `V1_ARTIFACT_PIPELINE_DESIGN.md` (E2E#1
design), `V1_CONTROL_PLANE_DESIGN.md` (E2E#2 design). **No code yet — review, then Red→Green.**

---

## 1. Consensus matrix (3 analyses + verified)

`A/B/C` = the three independent analysts; `V` = my source-verified column. Verdict = locked
consensus. (B=BUILT, P=PARTIAL, M=MISSING.)

| Q | Question | A | B | C | V | **Consensus (locked)** |
|---|----------|---|---|---|---|------------------------|
| 1 | `proposal_artifacts` container | P | P | P | M | **MISSING** — sections grouped only by `volume_name` string; volumes exist at RFP/curation level, not reified per-proposal |
| 2 | Expert volume/spec authoring | B* | B* | B* | P | **PARTIAL** — `apply-preset` bulk-writes volumes/items; **no granular per-item create/edit UI/route** |
| 3 | Shredder fills `volume_required_items` | P | P | M | M | **MISSING** — shredder writes `solicitation_compliance` only |
| 4 | Strawman uses 3 sources | P | P | P | M | **PARTIAL** — RFP excerpt + library atoms only; **no spotlight/customer data** |
| 5 | Agent task scope | B | Mx | P | M | **PARTIAL** — proposal/section scope only; **no artifact/volume scope** |
| 6 | Compliance enforcement | M | M | M | M | **MISSING (unanimous)** — exporters apply specs, never validate |
| 7 | Specs structured vs TEXT | Str | P | B | P | **PARTIAL** — `canvas_preset` JSONB; `volume_required_items` = `format_rules` JSONB **+ TEXT** font/margin cols |
| 8 | `CanvasRules` min_font/images | M | M | P | M | **MISSING** — no `min_font_size`/`images_allowed` on the canvas spec |
| 9 | Whole-proposal `package` export | B | B | B | B | **PRESENT (unanimous)** |
| 10 | AI write-back → `proposal_comments` | B | B | B | B | **PRESENT** — `fabric._post_section_recommendation` |
| 11 | `agent_task_queue` live | B | B | B | B | **PRESENT** — write `requestAgentTask` → consume `process_task_queue` (`main.py:83`) |
| 12 | rfp_admin all-tenant access | B | B | B | B | **PRESENT** — `verifyTenantAccess` (`db.ts:52`) |
| 13 | Unified control tower | P | P | P | P | **MISSING** — observability scattered across multiple admin pages |
| 14 | Cross-portal project rollup | B† | P | M | M | **MISSING** — flat list + process view exist; **no proposal-by-stage aggregate** |
| 15 | `system_health_snapshots` written | M | M | M | M | **MISSING (unanimous)** — table never written |
| 16 | Event/audit archival job | M | M | M | M | **MISSING (unanimous)** |
| 17 | `automation_rules` tenant-scoped | M | M | M | M | **MISSING (unanimous)** — global only, no `tenant_id` |
| 18 | RLS enable-without-policy | I | I | I | I | **FACT unanimous** (4 ENABLE / 0 POLICY); **effect = owner-bypass no-op**, app-level `WHERE tenant_id` is the real enforcement |

\*B for the apply-preset path, all flagged the granular editor missing. †A's "BUILT" was the
process-instance view, not the project rollup. x B="MIXED".

**Confidence:** unanimous on 11/18; 3/3-substantive on the rest after resolving framing. This is
the locked basis for the tasking below.

---

## 2. Track E — Artifact / Compliance / V0 pipeline (E2E #1)

> Keystone trio: **E1 → E3 → E5**. Everything else layers on.

### E1 · P0 · keystone · `proposal_artifacts` container  *(Q1)*
**Green:** a proposal owns N artifacts; sections belong to exactly one artifact; advance/lock gates
operate at artifact scope; package export iterates artifacts.
- **E1.1** mig `083_proposal_artifacts.sql`: `proposal_artifacts(id, proposal_id FK CASCADE,
  volume_id FK?, volume_number, volume_name, artifact_type, format_spec JSONB, compliance_spec
  JSONB, status, is_locked, locked_at, locked_by, created_at, updated_at)` + `proposal_sections.
  artifact_id UUID FK CASCADE` + idx `(proposal_id, volume_number)`. *Files:* `db/migrations/`.
- **E1.2** create-route: during V0 copy, create one `proposal_artifacts` row per volume/required-
  item group; set `sections.artifact_id`; freeze `format_spec`/`compliance_spec` (E2). *Files:*
  `proposals/create/route.ts`.
- **E1.3** advance/lock: extend gate to "all sections of artifact locked ⇒ artifact locked; all
  artifacts locked ⇒ proposal advance-ready"; artifact-level lock state. *Files:*
  `lib/proposal-advance.ts`, `sections/[sectionId]/lock/route.ts`.
- **E1.4** backfill mig for existing proposals (group sections by `volume_name`/`volume_number`).
- **E1.5** tests: vitest (artifact creation on purchase; artifact lock gate) + apply chain on live PG.
- **Accept:** schema on live PG; create-route groups; artifact gate passes tests; backfill idempotent.

### E2 · P1 · [→E1] · Structured specs + CanvasRules  *(Q7, Q8)*
**Green:** one typed `ComplianceSpec`; `CanvasRules` carries min-font + image rules; artifact
`compliance_spec` frozen at purchase.
- **E2.1** `canvas-document.ts`: add `min_font_size?`, `images_allowed?`, `image_max_width/height?`
  to `CanvasRules`; add `ComplianceSpec` (`max_pages,max_slides,min_font_size,images_allowed,
  required_sections[],header_required,footer_required`).
- **E2.2** mig `084`: normalize `volume_required_items` `font_size`/`margins`/`line_spacing` TEXT →
  a `canvas_preset` JSONB (parse + backfill); keep `format_rules`/`required_sections`.
- **E2.3** freeze `compliance_spec` onto `proposal_artifacts` at purchase from `volume_required_
  items` + `solicitation_compliance` (page/slide/min-font/images/required-sections).
- **E2.4** tests: type round-trip; mig + backfill on live PG.

### E3 · P0 · [→E1,E2] · Expert authoring UI  *(Q2, Q3)*
**Green:** RFP-expert can create/edit volumes + per-item format/compliance specs + required/optional
in the curation workspace (not just apply-preset).
- **E3.1** routes `admin/rfp-curation/[solId]/volumes` (GET/POST/PATCH/DELETE) + `.../volumes/
  [volumeId]/items` (GET/POST/PATCH/DELETE) writing `solicitation_volumes`/`volume_required_items`
  with structured specs + `required` flag. Auth rfp_admin+; SOP `{data}`/`{error,code}`.
- **E3.2** UI: structured editor (volume list → items → per-item spec form + required toggle),
  replacing the read-only display in the rfp-curation workspace.
- **E3.3** *(fast-follow sub-task)* shredder *proposes* a volume/artifact structure (a Claude pass)
  writing draft `volume_required_items` for expert acceptance — closes Q3's auto-populate gap.
  *Files:* `pipeline/src/shredder/`.
- **E3.4** tests: route auth/validation/write (vitest) + live-PG INSERT.

### E4 · P1 · [→E2] · Compliance enforcement  *(Q6 — unanimous)*
**Green:** violations warned at save, blocked at final-lock/export.
- **E4.1** `lib/validators/canvas-compliance.ts::validateCanvasAgainstSpec(doc, ComplianceSpec)` →
  violations (page/slide estimate, min-font scan, images_allowed, required-sections present).
- **E4.2** section save route: run validator → return violations (non-blocking warn).
- **E4.3** final-lock + `package` export: run validator → 422 with violations unless explicit override.
- **E4.4** canvas sidebar: live compliance indicator.
- **E4.5** tests: validator unit (each rule) + save-warn/export-block (vitest).

### E5 · P0 · [→E1, +H1] · 3-source strawman + wire ProposalArchitect  *(Q4, Q5)*
**Green:** a `proposal.v0_requested` task drafts each section from spotlight-bucket + customer
profile + RFP/library; results write back.
- **E5.1** `proposal-draft-section.ts`: extend `InputSchema` (`spotlightAtoms`, `customerProfile`);
  embed `<spotlight_capabilities>` + `<customer_profile>` (delimited) in the prompt.
- **E5.2** caller context assembly: query spotlight-bucket atoms (`spotlight_bucket_scores` →
  library/spotlight atoms) + `tenant_profiles` (company_summary/naics/keywords) + RFP/library.
- **E5.3** wire `ProposalArchitectArchetype.handles_event('proposal.v0_requested')` → fan to
  per-section draft tasks (3-source context) → reuse Increment-2 write-back. *Files:* `pipeline/
  src/agents/archetypes/proposal_architect.py`, `fabric.py`.
- **E5.4** "Generate V0" expert-triggered, cost-guarded action on the proposal admin panel.
- **E5.5** tests: context-assembly unit (spotlight+profile present) + archetype handles event (pytest).

### E6 · P1 · [→E1,E5] · Artifact/proposal-scope agent tasks  *(Q5)*
**Green:** agents can draft/review a whole artifact or the whole proposal.
- **E6.1** mig `085`: `agent_task_queue.artifact_id` (nullable) [+ `volume_number`].
- **E6.2** `requestAgentTask` accepts `artifactId`; task types `draft_artifact`/`review_artifact`/
  `review_proposal`.
- **E6.3** `fabric`: handle artifact/proposal-scope tasks → fan to sections + aggregate; reuse write-back.
- **E6.4** tests (vitest enqueue + pytest fan-out).

### E7 · P1 · [∥] · V0 fidelity  *(Q3-adjacent)*
**Green:** Phase-correct, no dropped detail.
- **E7.1** phase-filter volume items by `applies_to_phase` in `resolveVolumes`.
- **E7.2** merge per-item `custom_fields` into V0 section `meta`.
- **E7.3** flow expert `annotations` into V0 section context.
- **E7.4** tests.

### E8 · P1 · [→E1,E6] · Gold-team across artifacts + package images  *(Q6, Q9)*
**Green:** proposal-scope review fans to all artifacts; package honors per-artifact specs + renders images.
- **E8.1** proposal-scope review surface (findings as `ai_review` comments).
- **E8.2** `package` export: per-artifact `format_spec` + image rendering (currently placeholder).
- **E8.3** tests.

### E9 · P2 · [→E3] · Single source of truth for structure  *(outline vs volumes)*
**Green:** `outline` generated from the volume/required-item hierarchy (or retired). tests.

---

## 3. Track F — Admin control plane (E2E #2)

> Mostly independent, mostly read-only views + two jobs.

### F1 · P1 · [∥] · Control tower + drill-down  *(Q13)*
**Green:** one `/admin/control-tower` + `/admin/processes/[instanceId]` drill-down.
- **F1.1** page: workflows-by-health, error-rate by namespace (24h), event throughput, top tools
  (p95), automation success/fail, service health (from F2). Read-only queries over `system_events`/
  `process_instances`/`automation_log`/`tool_invocation_metrics`.
- **F1.2** drill-down: `process_instances.step_results` + correlated `system_events` tree + retry/force-advance.
- **F1.3** tests (query shape).

### F2 · P1 · [∥] · Service/worker health  *(Q15 — unanimous)*
**Green:** live health + worker heartbeats surfaced.
- **F2.1** writers: pipeline loop + CMS listener write a heartbeat (`worker_heartbeats` table or
  reuse `system_health_snapshots`) ~60s.
- **F2.2** `GET /api/admin/health`: DB `SELECT 1`, S3 HEAD, heartbeat read, listener lag.
- **F2.3** surface in F1.
- **F2.4** tests.

### F3 · P1 · [∥] · Cross-portal project rollup  *(Q14 — resolved MISSING)*
**Green:** proposals aggregated by stage across all tenants (incl. abandoned).
- **F3.1** `/admin/project-rollup`: `tenants LEFT JOIN proposals` grouped by stage + last-activity;
  drill to per-tenant.
- **F3.2** reuse the per-proposal status page for drill-down.
- **F3.3** tests.

### F4 · P1 · [∥] · Event/audit archival  *(Q16 — unanimous)*
**Green:** retention job + archive of executed projects.
- **F4.1** mig: `archived_at` on `system_events`/`proposal_activity_log`/`automation_log` + index.
- **F4.2** nightly pipeline job: archive > N days (mark `archived_at` [+ optional S3 parquet]).
- **F4.3** optional rule `opportunity.closed → archive related proposals`.
- **F4.4** tests.

### F5 · P1 · Tenant-scope `automation_rules`  *(Q17 — unanimous)*
**Green:** per-tenant rules possible; global rules still work.
- **F5.1** mig: `automation_rules.tenant_id` (nullable=global).
- **F5.2** event_listener filter `(tenant_id IS NULL OR tenant_id = event tenant)`.
- **F5.3** admin automation UI scope column + per-tenant rule creation.
- **F5.4** tests (extend `test_automation_pref_gate.py`).

### F6 · P2 · [∥] · Workflow template admin  *(Q13-adjacent)*
**Green:** per-tenant enable/disable of workflows w/o code deploy (`tenant_automation_rule_config`); UI. tests.

### F7 · P2 · [∥] · Settings-change audit
**Green:** every platform/tenant config + automation-pref PATCH writes `audit_log`; `/admin/audit-log` view. tests.

### F8 · P1 · [∥] · RLS decision  *(Q18 — resolved)*
**Green (V1):** document app-level isolation as the enforcement + a test asserting every tenant-
scoped query carries `tenant_id`; update CLAUDE.md. **OR (GA):** add tenant policies + `FORCE ROW
LEVEL SECURITY` + run app as a non-owner role.

---

## 4. Track G — Readiness hardening (ship before alpha)

| ID | P | Task | Source | Green |
|----|---|------|--------|-------|
| G1 | P1 | Platform AI cost cap + `agent_task_log` logging on the 3 unguarded Claude calls (shredder per-ingest first) | F-01 | calls logged + respect platform cap |
| G2 | P1 | `sql.unsafe` ingest hardening | F-02 | parameterized / per-batch try-catch; clean errors |
| G3 | P2 | Invite token signed/expiring + accept rate-limit | F-14 | enforced |
| G4 | P2·[∥] | Admin SQL error-handling sweep (~15 routes) | F-15 | per-`await sql` try/catch + codes |
| G5 | P2·[∥] | Password-policy align (12 vs 8) + UI empty-state/upload polish | F-19,F-21 | consistent + role-correct copy |
| G6 | P2·[∥] | Remove dead rule (`content.published`) + add library `(tenant_id,category,status)` index | F-18,F-20 | applied |

---

## 5. Track H — Operational & owed

| ID | P | Task | Green |
|----|---|------|-------|
| H1 | P1·[∥] | **Tenant library seeding** (the Track-C "C3" owed: company/collaborator/tech/bio atoms tagged at onboarding) — feeds E5 | seeding flow + tagged `library_units` |
| H2 | P0(ops) | Staging wiring + smoke: email (Resend/Google), Stripe (test+webhook), `ANTHROPIC_API_KEY`, pipeline worker loop, R2 | each path smoke-passes |
| H3 | P1(ops) | Execute HITL walkthrough end-to-end once in staging | all role tracks pass or defects filed |
| H4 | P1(ops) | Branch security review (`/security-review`) | no open P0/P1 |
| H5 | P2 | Stripe purchase-path automated coverage | webhook + checkout tests |

---

## 6. Sequencing & dependency graph

```
ALPHA GATE (controlled cohort):   G1 → G2 → H2 → H3 → H4            (~1–2 days code + staging pass)

E2E #1 (V1 feature):
   E1 ─┬─▶ E2 ─▶ E3(+E3.3) ─▶ E4
       └─▶ E5(+H1) ─▶ E6 ─▶ E8        ;  E7 ∥ ,  E9 after E3

E2E #2 (V1 feature):
   F1 ∥ F2 ∥ F3 ∥ F4 ∥ F5 ∥ F8        (independent)  ;  F6 / F7 fast-follow
   (F1 consumes F2's health output)

POLISH (continuous):  G3 ∥ G4 ∥ G5 ∥ G6 ∥ H5
```

- **Critical path to alpha:** G1, G2, H2–H4.
- **Critical path to V1 E2E#1:** E1 → E3 → E5 (container → authoring → 3-source strawman). E5
  needs H1 (library seed) to have "company meat" for the bones.
- **E2E#2** is highly parallel; F2 (health) should land before/with F1 (it surfaces F2).

**Suggested review order (before any code):** E1 (schema + artifact-boundary decision) → E3 (the
big net-new UI) → E5/H1 (the strawman + seed) → E2/E4 (specs + enforcement) → F1/F2/F3 (tower +
health + rollup). Confirm the four open product decisions in each design doc (`§5`) at the same time.

---

## 7. Open product decisions (must answer before coding the keystones)
1. **Artifact boundary** — one `proposal_artifacts` row per volume, or per required-item? *(Rec:
   per volume; required-items become sections under it.)*  → gates E1.
2. **Spec authoring seed** — preset + manual (V1) vs shredder-proposed structure (E3.3 fast-follow)?
3. **Enforcement hardness** — warn-on-save / block-on-final-lock (Rec) vs block-on-save.
4. **Strawman trigger** — expert-clicked "Generate V0" (Rec, cost-control) vs auto-at-purchase.
5. **RLS** — document+test for alpha (Rec) vs full policies+FORCE for GA.
6. **Health depth** — live probe + heartbeats (Rec) vs probe-only.
