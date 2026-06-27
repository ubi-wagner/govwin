# V1 Tasking — Consensus-Locked Red→Green ToDo & Sub-tasks

**Built from a 4-way consensus** (3 independent competitive analyses + a source-verified column)
over 18 load-bearing questions. Every task below is anchored to a consensus verdict (the `Qn`
refs). Companion docs: `V1_LAUNCH_READINESS.md` (analysis), `V1_ARTIFACT_PIPELINE_DESIGN.md` (E2E#1
design), `V1_CONTROL_PLANE_DESIGN.md` (E2E#2 design). **No code yet — review, then Red→Green.**

> **Status (2026-06-27):** All 6 product decisions **LOCKED** (§7) + the per-(customer,proposal)
> memory refinement. Current state verified against source (4-way consensus + a 5-way code audit).
> **Decision-complete — ready to build.** Recommended start: **G1 → E1 → E3 → E5 (+H1)**, Track F
> (F1/F2/F3) in parallel. Counts: Track E = 9 items (3 keystones: E1/E3/E5) · F = 8 · G = 6 · H = 5.
>
> **§8 holds the audit refinements** (integration seams + data gaps the audit surfaced). Tracks E–H
> below must be read **together with §8** — it corrects two items (E5 dispatch/write-back, G1
> `agent_task_log`) and adds prerequisites (e.g. a `min_font_size` source, the template registry→DB
> switch). The code shipped this push was audited and is **sound** (two alleged regressions were
> verified false-positives).

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
- **E1.2** create-route: during V0 copy (purchase), create one `proposal_artifacts` row per
  volume/artifact; set `sections.artifact_id`; freeze `format_spec`/`compliance_spec` (E2). This is
  the **skeleton copy** from shared RFP space → the tenant portal (alongside the existing
  `compliance.json`/`volumes.json`/RFP-doc S3 copy to `customerProposalPath`); **emit a compliance
  event on copy** (`proposal.v0_provisioned`, namespace `proposal`, carries artifacts + copied
  doc refs). *Files:* `proposals/create/route.ts`.
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

### E3 · P0 · [→E1,E2] · Curation + Template Studio (expert authoring)  *(Q2, Q3; decisions #2, #4)*
**Green:** the RFP-expert reads the RFP and builds the full **V0 upfront** in shared RFP space —
the compliance matrix, each volume + base artifacts + all metadata — composing each artifact from
**reusable templates** (pick existing / edit + save-as-new / create new from scratch / one-off cert
or LOS), with the matrix referencing the template per artifact. This is the amortized upfront cost;
the per-purchase agent fill (E5) consumes it.
- **E3.1** volume/item routes `admin/rfp-curation/[solId]/volumes` + `.../volumes/[volumeId]/items`
  (GET/POST/PATCH/DELETE) writing `solicitation_volumes`/`volume_required_items` with structured
  specs + `required` flag + the chosen `template_id`. Auth rfp_admin+; SOP shapes.
- **E3.2** UI: structured volume→items editor (replaces the read-only display).
- **E3.3** **Template library (DB-backed, editable):** make `document_templates` CRUD —
  choose existing, **edit + save-as-new**, **create new from scratch**, and **one-off templates**
  (cert docs, simple LOS) usable in the V1 push; each carries a `canvas_preset` + `compliance_spec`
  + metadata. Routes `admin/templates` (GET/POST/PATCH) + a picker in the volume editor.
  *(Note: today templates are an in-code registry + a `document_templates` table; this makes them
  expert-editable + reusable.)*
- **E3.4** expert **notes/metadata** per volume/section (e.g. commercialization-plan guidance) →
  stored on the artifact/section `meta` and surfaced to the agent fill as refinements (feeds E5.2).
- **E3.5** *(fast-follow)* AI "scarecrow" pre-shred: a Claude pass proposes a volume/artifact +
  template structure seeded from prior curations of the same `namespace` (agency/office/program_type,
  e.g. "USAF Phase I SBIR") for the expert to accept/extend — closes Q3's auto-populate gap.
- **E3.6** tests: route auth/validation/write + template save-as-new/create + live-PG INSERT.

### E4 · P1 · [→E2] · Compliance enforcement  *(Q6 — unanimous; decision #3)*
**Green:** warn at each stage; final lock blocks when out of compliance **unless an admin forces
it**, and the force is an audited approval event. No hard stops.
- **E4.1** `lib/validators/canvas-compliance.ts::validateCanvasAgainstSpec(doc, ComplianceSpec)` →
  violations (page/slide estimate, min-font scan, images_allowed, required-sections present).
- **E4.2** section save + each stage advance: run validator → return violations (non-blocking warn).
- **E4.3** final lock + `package` export: block on violations **unless** an admin (customer admin
  or rfp_admin) passes `forceApprove:true` → proceed + emit an auditable approval event
  (`proposal.compliance_override` / activity-log row capturing actor + violations). Reuse the shipped
  force-advance+audit pattern.
- **E4.4** canvas sidebar: live compliance indicator (per-artifact page/font/violations).
- **E4.5** tests: validator unit (each rule) + warn-on-save + block-at-final + force-with-audit (vitest).

### E5 · P0 · [→E1, E3, G1, +H1] · 3-source strawman + wire ProposalArchitect  *(Q4, Q5; decision #4)*
**Green:** **purchase auto-triggers** a `proposal.v0_requested` task that drafts each section from
spotlight-bucket + customer profile + RFP/library; results write back; cost-guarded. **Depends on
G1** (platform cost cap) since this runs on every sale.
- **E5.1** `proposal-draft-section.ts`: extend `InputSchema` (`spotlightAtoms`, `customerProfile`);
  embed `<spotlight_capabilities>` + `<customer_profile>` (delimited) in the prompt.
- **E5.2** caller context assembly (tenant-scoped only): the expert-built **compliance matrix +
  chosen templates + expert notes** (from E3) as the development requirements, plus spotlight-bucket
  atoms (`spotlight_bucket_scores` → the bucket the opp was bought from) + `tenant_profiles`
  (company_summary/naics/keywords) + RFP/library. This is what makes the per-purchase fill bounded +
  well-grounded.
- **E5.3** wire `ProposalArchitectArchetype.handles_event('proposal.v0_requested')` → fan to
  per-section draft tasks (3-source context) → reuse Increment-2 write-back. *Files:* `pipeline/
  src/agents/archetypes/proposal_architect.py`, `fabric.py`.
- **E5.4** **on-purchase trigger:** create-route enqueues `proposal.v0_requested` after artifact
  creation (E1); retain a manual "Generate V0 / Re-gen" button on the proposal admin panel
  (future: AI presses it). V0-lock gate requires agent-seed-complete + expert collaboration.
- **E5.5** **per-(customer, proposal) agent isolation (MVP bar):** every agent run is scoped to
  `(tenant_id, proposal_id)`; **add `proposal_id` scope to agent _working memory_** (episodic/
  semantic/procedural — tenant-only today) + the per-proposal `context.py` reads so an agent
  recalls only that customer + that proposal. Pair with **real RLS (F8)**. Add a guard/test that
  fails if any agent tool / context / memory query omits the tenant (and, in-proposal, proposal)
  filter. (Cross-tenant reads verified impossible today; this adds proposal-level isolation + the
  DB backstop.)
  - **Carve-out (do NOT over-scope):** the tenant **library** (`library_units` — approved,
    harvested, reusable content) stays **tenant-scoped and cross-proposal by design** — it is the
    deliberate reuse surface (C4 picker / regen-from-library), pulled in **explicitly**, never
    auto-bled and never cross-tenant. Proposal-scoping applies to *working memory/context*, not to
    the library, or it breaks C2/C4 reuse.
- **E5.6** tests: context-assembly unit (spotlight+profile present, tenant-scoped) + archetype
  handles event + on-purchase enqueue (pytest + vitest).

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

### F2 · P1 · [∥] · Service/worker health  *(Q15 — unanimous; decision #6)*
**Green:** live health + worker heartbeats surfaced; heartbeat/probe interval **settable** with a
hard **min floor of 5–10s**.
- **F2.1** writers: pipeline loop + CMS listener write a heartbeat (`worker_heartbeats` table or
  reuse `system_health_snapshots`) on a **configurable interval** (default ~30–60s; settable up to
  X; clamped to a **5–10s minimum** — reject/clamp anything faster). Store the setting in
  `platform_agent_config` (or a small `platform_settings`) so it's admin-settable.
- **F2.2** `GET /api/admin/health`: DB `SELECT 1`, S3 HEAD, heartbeat read, listener lag.
- **F2.3** surface in F1; expose the interval setting in the admin UI.
- **F2.4** tests (incl. the min-floor clamp).

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

### F8 · P1 · DB-enforced RLS  *(Q18 — resolved; decision #5 — real RLS)*
**Green:** genuine DB-level tenant isolation as the backstop to app-level scoping (which already
works). Strict-isolation bar = same as the agent-isolation requirement (#4).
- **F8.1** add tenant-isolation `CREATE POLICY` on every tenant-private table (proposals,
  proposal_sections via proposal, library_units, tenant_pipeline_items, spotlight_bucket_scores,
  agent_task_*, memories, etc.) + `FORCE ROW LEVEL SECURITY`.
- **F8.2** run the **app as a non-owner DB role** with `SET app.tenant_id` (or session GUC) per
  request/agent-run; migration runner stays owner. Audit every query passes under RLS.
- **F8.3** keep the app-level `WHERE tenant_id` (defense-in-depth) + the E5.5 guard/test.
- **F8.4** stage carefully behind a flag; validate the full suite under RLS on the live-PG harness.
- **Note:** heavier than the rest of Track F; sequence after the alpha gate but before multi-tenant
  GA. Functional isolation is already in place via app scoping, so this is hardening, not a blocker.

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
   E1 ─▶ E2 ─▶ E3 (Template Studio; +E3.5 AI scarecrow) ─▶ E4
   (E1 + E3 + G1 + H1) ─▶ E5 ─▶ E6 ─▶ E8       ;  E7 ∥ ,  E9 after E3

E2E #2 (V1 feature):
   F1 ∥ F2 ∥ F3 ∥ F4 ∥ F5        (independent; F1 surfaces F2)  ;  F6 / F7 fast-follow
   F8 (real RLS) — heavier; sequence after the alpha gate, before multi-tenant GA

POLISH (continuous):  G3 ∥ G4 ∥ G5 ∥ G6 ∥ H5
```

- **Critical path to alpha:** G1, G2, H2–H4.
- **Critical path to V1 E2E#1:** **E1 → E3 → E5** (container → Template Studio → 3-source strawman).
  E5 also needs **G1** (cost cap, since it fires on every purchase) and **H1** (library seed, for
  "company meat" on the bones).
- **E2E#2** is highly parallel; F2 (health) should land before/with F1 (it surfaces F2). F8 (real
  RLS) is the one heavier item — stage it behind a flag after the alpha gate.

**All six product decisions are LOCKED (§7)** — no open decisions remain. **Recommended build
order:** `G1 → E1 → E3 → E5 (+H1)` for E2E#1, with `F1/F2/F3` running in parallel for E2E#2; then
E2/E4/E6/E8 and the polish/ops tracks.

---

## 7. Locked product decisions (owner-confirmed 2026-06-27)

1. **Artifact boundary — LOCKED: one `proposal_artifacts` per volume/artifact (the whole DOCX/
   PPT/etc.).** The canvas + `meta` + JSON sections are the segments *within* that artifact. → E1.
2. **Spec authoring — LOCKED: a reusable Template Studio (expert-driven, upfront).** The expert
   reads the RFP and builds the full V0 in shared RFP space — compliance matrix + each volume + base
   artifacts + metadata — composing each artifact from templates: **pick existing / edit + save-as-
   new / create new from scratch / one-off (cert docs, simple LOS)**, all referenced by the
   compliance matrix and saved for reuse. AI "scarecrow" pre-shred is the fast-follow (E3.5), seeded
   from prior curations of the same `namespace` (e.g. "USAF Phase I SBIR"). → E3 (Template Studio).
3. **Enforcement — LOCKED: warn at each stage; at final lock, block + enforce, BUT an admin
   (customer admin or RFP-admin) may force the approval-lock, recorded as an auditable approval
   event. No hard stops — stern warning + explicit admin acceptance on the final.** → E4 (reuses
   the shipped force-advance + audit pattern).
4. **V0 trigger + data model — LOCKED:**
   - **Purchase auto-triggers the V0 build** — create the volumes/artifacts + generate the strawman
     artifacts from the curated compliance matrix (the "launch button" is auto-pressed on purchase;
     retained for re-gen / future AI press). Cost-guarded.
   - **Agents seed → expert-admin collaborates → only then can V1 lock** (V0-lock gate).
   - **Data flow:** V0 is built in **shared RFP memory/operational space**; on purchase the
     **skeleton + the RFP documents surfaced via the spotlight buckets are COPIED into the
     customer's portal** (their S3 bucket + their DB rows holding UUIDs + relational refs to the
     copied uploads/artifacts), with a **compliance event emitted on copy**. (Resolves the prior
     A/B question: **shared master for spotlight discovery + per-tenant copy at purchase**.) →
     E1 (copy artifact skeleton + event), E5 (on-purchase trigger).
   - **Cost shape:** the expensive structural work (matrix + templates) is **upfront, human, and
     amortized across every buyer of the opp**; the per-purchase agent fill is a **bounded** draft
     grounded by that pre-built context (matrix + templates + expert notes + company + the spotlight
     bucket the opp was bought from). First draft within **72h of purchase**; expert regen/re-prompt
     with new library data; **admin literal button-push to V1**.
   - **Agent isolation (MVP bar — LOCKED):** real **RLS** + **agent-instance separation per
     (customer, proposal)** with memory + context scoped to only that customer and that proposal.
     Verified today: every run is tenant-bound, tools strip `tenant_id` from input and source it
     from context (`WHERE tenant_id=$1`), `context.py` assembles only that tenant's data (+ the
     shared RFP they purchased) — Claude never sees another tenant's data. **Refinement for MVP:**
     add `proposal_id` scope to agent *working memory* (tenant-only today) so memory is per-proposal
     — **but the tenant library stays tenant-scoped/cross-proposal by design** (deliberate, explicit
     reuse via C4; never auto-bled, never cross-tenant). → E5.5 + F8.
5. **RLS — LOCKED: do real RLS (same strict-isolation bar as #4)** — tenant policies +
   `FORCE ROW LEVEL SECURITY` + run the app as a **non-owner** DB role (migration runner stays
   owner). App-level scoping already works, so this is the DB-level backstop; stage carefully so
   every query passes under RLS. → F8 (upgraded from document+test).
6. **Health — LOCKED: heartbeat probes + updates, interval settable** (default ~30–60s, settable
   up to X) with a **hard minimum floor of 5–10s** (cannot be set faster). → F2.

**Cost dependency (eval):** the Template Studio (#2) keeps per-purchase cost low — the structural
"thinking" is upfront/human/amortized and the per-sale agent fill is *bounded* (well-grounded by
matrix + templates + notes). But the fill is still real Claude spend on every purchase, so **G1
(platform cost cap + `agent_task_log` logging) remains a hard prerequisite for the on-purchase V0
trigger (E5)** — a guardrail, not a blocker on the economics.

---

## 8. Audit refinements (2026-06-27 — 5-way code audit, source-verified)

**Audit result:** the code shipped this push is **sound** — `_post_section_recommendation`, the
extracted `advanceProposalStage` core, the **lock-route auto-advance (which *does* call the shared
core** — an audit "divergence" claim was a verified false-positive), `event_listener` gating +
fan-out, C2/C4/C5/C6, and migs 076–082 all confirmed; the tests shipped this push exist (two
"missing tests" claims were false-negatives). The plan's current-state claims **hold**. The audit
surfaced these refinements (integration seams + data gaps the plan under-specified). None invalidate
the plan; read each track item **with** its delta here.

### E-track
- **E1/E2/E8 — runtime spec source.** `CanvasRules` are authored *inline* in each section's
  `content` JSON and exporters read them there. Freezing a per-artifact spec also requires
  **redirecting the canvas editor + exporters to read the frozen `proposal_artifacts` spec**, not
  inline section content.
- **E1.3 — mandatory vs optional artifacts.** The advance gate must treat **optional** artifacts
  (`required=false`) as non-blocking; move the document-closed grouping from `volume_number` →
  `artifact_id`.
- **E2/E4 — NEW prerequisite: `min_font_size` has no data source** (only `font_size` TEXT exists,
  verified absent everywhere). Add `min_font_size` to `solicitation_compliance` + `volume_required_
  items` + shredder extraction; otherwise E4 min-font enforcement has nothing to enforce.
- **E3.1 — partly built.** `volume-add.ts` / `volume-add-required-item.ts` tools already write
  volumes/items → E3 = expose/extend via the editor UI + **add a `template_id` column** on
  `volume_required_items` + PATCH/DELETE. (Per-volume/section expert notes, E3.4, are net-new schema.)
- **E3.3 — key integration (verified).** `document_templates` exists but is **never queried**;
  create-route resolves templates from the **in-code registry** (`resolveTemplateKey`/`TEMPLATE_MAP`).
  The Template Studio must **switch create-route to read `document_templates` (DB)** + link via the
  new `template_id`.
- **E5.3/E5.4 — CORRECTED dispatch + write-back.** The queue dispatches by **`agent_role`** (not
  `handles_event`/`task_type`), so the on-purchase trigger enqueues `agent_role='proposal_architect'`
  (task_type is context only). Drafting needs a **new section-content write-back tool**
  (`publish_section_draft` → `proposal_sections.content`) + an architect→per-section fan-out — the
  Increment-2 write-back targets `proposal_comments` (reviews), **not** section content. (Today
  `ProposalArchitect` only designs the outline; `SectionDrafter` returns text with no persist tool.)
- **E5.5 — memory scope.** The 3 memory tables have **no `proposal_id`**; add the column + index +
  scope retrieval `(proposal_id = $X OR proposal_id IS NULL)` so tenant-level memories still surface
  (library stays cross-proposal).
- **E7 — smaller than written + a bug.** `applies_to_phase` + `custom_fields` columns exist and are
  populated; `resolveVolumes()` simply doesn't apply them (wire the phase filter + the merge);
  `solicitation_annotations` exists but isn't flowed into V0; and **`apply-preset` drops
  `applies_to_phase` on item insert** (fix).

### F-track
- **F2 — partly built.** `manager.py` already heartbeats (hardcoded 30s) → make it settable via the
  **existing `system_config` (key/value) table** (5–10s floor). The **CMS listener has no heartbeat**
  and there is no worker-liveness signal distinct from per-workflow heartbeats (net-new).
- **F3 — CONFIRMED missing** (conflict resolved): `/admin/proposals` is a flat per-proposal list
  (`SELECT … p.stage`, no `GROUP BY`), so the cross-portal by-stage aggregate is genuinely net-new.
- **F5 — confirmed.** `event_listener.py` `SELECT * FROM automation_rules` has no tenant filter.
- **F7 — wire, not build.** An `auditLog()` helper exists in `lib/db.ts` but is **never called** →
  F7 = invoke it on the settings PATCH paths.
- **F8 — confirmed.** 0 policies; `migrate.mjs`/`lib/db.ts` connect with the default (owner) role →
  needs policies + a non-owner role + connection switch.

### G / H
- **G1 — CORRECTED: `agent_task_log.tenant_id` is `NOT NULL`** (verified), so platform (non-tenant)
  AI calls can't be logged as-is — and `fabric` already *skips* null-tenant logging. G1 must make
  `tenant_id` nullable (or add a platform sentinel) + log the 3 platform calls + update `fabric`, so
  the platform cap covers platform spend.
- **G6 — confirmed.** The dead `content.published` rule is still seeded → remove it.
- **H1 — partly built.** `create_library_defaults.py` seeds default **categories**, not content →
  H1 = seed the actual **company/collaborator/tech/bio atoms** (feeds E5).
