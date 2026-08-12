# DATA_FLOW.md — UI → DB → back (the platform in section)

**Canonical cross-section of the request path.** One request crosses seven planes — UI, API,
domain, data — then the write echoes sideways through the event bus, into the workflow engine,
out to the agent fabric, and returns to the surface as something a person reviews. This document
is the text source-of-truth for that path; every identifier below is live in the codebase.

- **Rendered companion** (engineering cross-section, both themes, four+ traces drawn to scale):
  Claude artifact `109f7200-fb97-4e54-a921-d81ef17a56a7` (private until shared from the artifact's menu).
- **Complements** `docs/AUTOMATION_SPINE_MAP.md` (the engine's declarative internals),
  `docs/START_END_FRAMEWORK.md` (the start→end event gate, every message + trigger chain),
  `docs/MASTER_MIRROR_OPP_DESIGN.md` (the OPP master+mirror lifecycle), and `docs/EVENT_CONTRACT.md`
  (the event catalog). This doc is the *static* UI→DB architecture; the **live** per-instance DAG
  visualization is the Workflow Map at `/admin/workflows` (`app/admin/workflows/workflow-{graph,shapes,map}.tsx`,
  operator guide `docs/WORKFLOW_ADMIN_GUIDE.md`).

---

## The seven planes

A request enters at the surface (plane 01) and descends; data thickens from a rendered pixel into a
durable row (plane 04), then the write loops sideways-and-up through planes 05→07 and back to 01.

| # | Plane | Role | Key identifiers |
|---|-------|------|-----------------|
| 01 | **UI** | Next.js App Router | `app/**/page.tsx` (server components read the DB directly) · `components/**` client components (`fetch()` the API) · `lib/rbac.ts` gates every surface before render · `toast()` for transient feedback |
| 02 | **API** | The route contract | `app/api/**/route.ts` — a fixed order: `auth()` → validate (`isValidUUID`) → verify tenant access (`verifyProposalAccess` / `getTenantBySlug`) → business logic → return `{ data }` \| `{ error, code }`. Never query by id alone. |
| 03 | **Domain** | Business logic (`lib/**`) | `lib/provision-proposal.ts` · `lib/proposal-advance.ts` · `lib/opportunity-bridge.ts` · `lib/events.ts` · `lib/amendments.ts` · `lib/tools/*`. Routes stay thin; the domain carries the invariants. |
| 04 | **Data** | Postgres `govtech_intel` (shared) | postgres.js tagged templates, parameterized. Frontend + pipeline share one DB; CMS keeps its own `govtech_cms`. RLS is force-enabled in schema, **inert** until the one-op `DATABASE_URL` role cutover. Core tables: `proposals`, `proposal_sections`, `canvas_versions`, `tenant_opportunity_cards`, `opportunity_bridge`, `proposal_compliance_matrix`, `process_instances`, `system_events`. |
| 05 | **Events** | The bus (`system_events`) | Every significant action posts here — the seam between frontend, pipeline, and CMS. Seven namespaces (`finder · capture · identity · proposal · library · system · tool`), each event a start/end pair, admin actions carry `tenantId = null`. Emit via `lib/events.ts`. |
| 06 | **Engine** | Python workflow engine (pipeline) | An `EventTrigger` matches a bus event and spawns a `process_instances` row — a step DAG (`step_status` / `step_results`). Hard steps call `module.function`; AI steps map through `TOOL_ACTION_TO_ARCHETYPE`. Two invariants make it impossible for a pipeline step to consume an agent's output (see below). |
| 07 | **Agents** | Agent fabric (36 archetypes) | `AgentFabric` — tenant-bound, injection-fenced, runaway-bounded. Output is **advisory** → guardrail → land-or-review; it never auto-writes a business table. The loop returns to the surface as *proposed* revisions a builder restores. |

---

## Traces — real requests, end to end

Read left to right. Each node names the exact identifier the data passes through. `→` is descent
(write path); `↩` marks the return leg (event → workflow → agent → surface).

### Trace A — a customer saves a proposal section  *(round-trip write, version-safe)*

```
CanvasEditorPage (UI)
  → PUT /api/portal/[t]/proposals/[p]/sections/[s]/save        [API]
  → archive current content → canvas_versions @ version         [Data]  (ON CONFLICT DO NOTHING)
  → CAS proposal_sections.version = version + 1                 [Data]
  → UPDATE proposal_sections.content = new                       [Data]
  → emit proposal:section.saved → system_events                 [Event]
  ↩ { data: { version, complianceWarnings } } → toast           [UI]
```

Guarded by the numbering invariant `proposal_sections.version > MAX(canvas_versions.version_number)`:
snapshot the prior content at the live version, *then* advance the counter, so the next save can never
collide onto an occupied slot (numbering at `MAX+1` without advancing silently drops the next archive —
`ON CONFLICT DO NOTHING` — an undo/history content-loss). The admin cross-tenant save path
(`/api/admin/proposals/[p]/sections/[s]`) follows the same pattern. See `docs/FULL_DRAFT_LANDING_DESIGN.md`.

### Trace B — an opportunity reaches every tenant  *(discovery spine · one → many fan-out)*

```
admin approves solicitation (UI)
  → finder:solicitation.pushed → system_events                  [Event]
  → append card VERSION → opportunity_bridge                     [Data]  (forward-only, append-only)
  → fan out → tenant_opportunity_cards (one row per tenant)      [Data]  (lib/opportunity-bridge.ts)
  → auto-score → tenant_bucket_scores / tenant_spotlight_buckets [Data]
  ↩ customer's /cards                                            [UI]
```

The bridge is a **forward-only versioned event log**; the consumer denormalizes each version into one
row per tenant, so a customer read never joins across the fan-out. Canonical: `docs/MASTER_MIRROR_OPP_DESIGN.md`.

### Trace C — a purchase becomes a downloadable proposal  *(build spine · comp-code → package)*

```
comp-code purchase (UI)
  → proposal_portals · curation_pending (72h SLA)               [Data]
  → RFP admin releases → provisionProposalForPortal()           [Domain] (unlocked build)
  → proposal_compliance_matrix + molds                          [Data]
  → draft · lock sections                                        [UI]
  → GET .../package?format=json|docx|pdf|zip                    [API]
```

The build provisions **unlocked**. docx and the Chromium-rendered pdf share one combined-CanvasDocument
assembly; zip is per-volume-native. Sections order by the integer `sort_index` (never string-sort
`section_number`, which scrambles numbering). Self-serve Stripe is descoped — the comp code stands in.

### Trace D — an AI full-draft lands for review  *(the return loop · advisory → land-or-review)*

```
doorbell / portal · Run full draft (UI)
  → proposal:full_draft_requested → system_events              [Event]
  → OnFullDraftRequested{ModeA,B,C} → process_instances        [Engine]
  → agent cohort stages ai_revision in step_results            [Agents] (never persisted to business tables)
  ↩ POST .../land-revisions  (read-on-review, human-triggered) [API]
  → proposed canvas_versions → builder reviews + restores       [Data → UI]
```

The engine's invariants **forbid a pipeline step from consuming an agent's output**, so the landing
cannot be automatic — it lives on the frontend, human-triggered. Staged canvases (from the one-shot
full draft *and* the Proposal Studio's Draft/Refine phases, `OnReviewPhaseRequested`) become *proposed*
versions a builder restores. Advisory, all the way down. Canonical: `docs/FULL_DRAFT_LANDING_DESIGN.md`.

### Trace E — a solicitation amendment fans out and is acknowledged  *(detect → confirm → fan-out → acknowledge)*

```
admin detects an amendment (UI)
  → INSERT solicitation_amendments · emit amendment.detected    [Data · Event]  (lib/amendments.ts)
  → admin confirms → emit amendment.confirmed                    [API]  (.../rfp-curation/[solId]/amendments/[id])
  → fan out flags → proposal_amendment_flags (per active proposal) [Data]  (INSERT…SELECT; emit amendment.flagged)
  → tenant banner on affected proposals                         [UI]
  ↩ tenant acknowledges → emit amendment.acknowledged            [API]  (.../proposals/[p]/amendments)
```

Fan-out targets are guaranteed to exist: `proposal_id` / `tenant_id` come from `proposals` itself, the
`amendment_id` from the just-confirmed row (FK-safe ordering). Migration 146.

---

## Invariants — the load-bearing rules every path respects

Break one and the failure is quiet: lost history, a stranded workflow, an off-ledger action.

1. **Versioning** — `proposal_sections.version > MAX(canvas_versions.version_number)`. Number a snapshot
   at the live version, then advance the counter (compare-and-swap). Every writer follows this:
   the portal + admin section saves, `lib/proposal/lock-section.ts`, `lib/proposal-advance.ts`, and the
   read-on-review `land-revisions` route.
2. **No dead-end + input-map-ancestor** — a hard step (ACTION/TODO) never `depends_on` an AI_INVOKE agent,
   and an `input_map` may only reference a transitive `depends_on` ancestor. Together they make it
   *impossible* for a pipeline action to consume agent output — which is why agent output lands via a
   human-triggered frontend route, never a pipeline step. (`Workflow.validate()` enforces the second at boot.)
3. **Events** — seven namespaces only (`finder · capture · identity · proposal · library · system · tool`);
   type is `entity.action_past_tense` (snake_case, start/end paired); admin events carry `tenantId = null`;
   never `admin`, `cms`, or `spotlight`. The static guard `__tests__/event-contract.test.ts` enforces it.
4. **Agents** — tenant-bound (tool schemas expose no `tenant_id`), untrusted content injection-fenced,
   runaway-bounded (round / cost / rate / budget caps), and never dead-end a workflow (safe-skip). Output
   is advisory → guardrail → land-or-review; it never auto-writes a business table. Canonical:
   `docs/AGENT_WORKFORCE.md`.

---

## Where this lives

- **Source of truth (text):** this file — `docs/DATA_FLOW.md`.
- **Rendered cross-section:** the Claude artifact above (both themes, drawn to scale).
- **Interactive schema explorer:** `docs/architecture/explorer.html` — every table, field, type and FK
  from the migrated database (108 tables · 192 FKs), click-navigable down to the foreign-key
  neighborhood, with these five traces and the UI→table map built in. Regenerate it as the schema
  grows: `node frontend/scripts/architecture/{extract,generate}.mjs` (see that folder's README).
- **Live per-instance DAGs:** `/admin/workflows` Workflow Map (`docs/WORKFLOW_ADMIN_GUIDE.md`).
- **Deeper detail per plane:** `ARCHITECTURE_V10.md` (system + file tree), `docs/AUTOMATION_SPINE_MAP.md`
  (engine), `docs/START_END_FRAMEWORK.md` (event gate), `docs/EVENT_CONTRACT.md` (event catalog),
  `CLAUDE_CLIFFNOTES.md` (schema quick-reference + bug classes).

_Every identifier in this document is live in the codebase as of migration head 162
(tsc 0 · vitest 905 · next build clean)._
