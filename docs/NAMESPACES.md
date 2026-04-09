# NAMESPACES.md — Canonical Namespace Registry

**Status: BINDING. Phase 0.5b.**

This document is the single source of truth for every dotted namespace
used anywhere in the system: event types, tool names, log scopes, DB
table names, role names, and storage prefixes. Adding a new namespace
requires a PR touching this file. Any reviewer may reject a PR that
introduces an unregistered namespace.

See also:
- `docs/API_CONVENTIONS.md` — HTTP contract
- `docs/TOOL_CONVENTIONS.md` — tool interface + registry
- `docs/STORAGE_LAYOUT.md` — S3 bucket structure
- `frontend/lib/rbac.ts` — role hierarchy
- `db/migrations/001_baseline.sql` — baseline schema

---

## Why namespaces

Every side-effect in the system is either an event, a tool invocation,
or a log line. The Agent Fabric (Phase 4) depends on a coherent event
stream it can replay to reconstruct past agent decisions — that replay
only works if every producer tags its output with a stable, dotted
namespace. The same namespacing discipline lets the admin events
browser (`/admin/events`) filter reliably, lets audit queries join
across the three event buses without string-matching heuristics, and
lets the tool registry (`lib/tools/`) route agent requests to the
right implementation without loading every module on every call.
Unnamespaced events and tools are forbidden; they break replay,
audit, and routing simultaneously.

---

## Event namespaces

Every row written to `opportunity_events`, `customer_events`,
`content_events`, or (Phase 1+) `system_events` MUST carry an
`event_type` matching one of the namespaces below. Event types are
snake_case after the final dot. Verbs are past-tense (`ingested`,
`claimed`) because events describe things that have already happened.

| Namespace    | Owner phase | What triggers emission                                                                 | Example event types                                                                                                                                                                                                                          |
|--------------|-------------|----------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `finder.*`   | Phase 1     | Opportunity ingestion, triage, curation, push to published pipeline                     | `finder.opportunity.ingested`, `finder.rfp.triage_claimed`, `finder.rfp.released_for_analysis`, `finder.rfp.shredding_complete`, `finder.rfp.curation_started`, `finder.rfp.review_requested`, `finder.rfp.curated_and_pushed`, `finder.rfp.dismissed` |
| `capture.*`  | Phase 2     | Customer conversion, subscription, proposal purchase, workspace provisioning           | `capture.tenant.created`, `capture.subscription.started`, `capture.proposal.purchased`, `capture.workspace.provisioned`                                                                                                                      |
| `proposal.*` | Phase 3     | Proposal workspace actions: drafting, stage progression, review, packaging, submission | `proposal.section.drafted`, `proposal.stage.advanced`, `proposal.review.requested`, `proposal.package.generated`, `proposal.submitted`                                                                                                       |
| `agent.*`    | Phase 4     | Agent Fabric lifecycle, memory operations, tool calls from agents                      | `agent.task.queued`, `agent.task.started`, `agent.task.completed`, `agent.task.failed`, `agent.memory.written`, `agent.memory.searched`, `agent.tool.invoked`                                                                                |
| `identity.*` | Phase 0.5   | Authentication lifecycle                                                                | `identity.user.signed_in`, `identity.user.signed_out`, `identity.user.password_changed`, `identity.user.invited`, `identity.user.accepted_invite`                                                                                            |
| `system.*`   | Phase 0.5   | Platform-level events (not user-facing)                                                 | `system.migration.applied`, `system.deploy.completed`, `system.error.unhandled`, `system.capacity.threshold_crossed`                                                                                                                         |
| `tool.*`     | Phase 0.5b  | Tool registry audit trail (exactly one start + one end per invocation)                  | `tool.invoke.start`, `tool.invoke.end`, `tool.invoke.error`                                                                                                                                                                                  |

### Phase 1 event types — `finder.*`

The `finder.*` namespace is owned by Phase 1. Every event type below is
registered; emitters outside this list are rejected at review. Types
ending in `.start` / `.end` form a bracketed pair correlated via
`parent_event_id` (see `docs/EVENT_CONTRACT.md`). Types not suffixed
are single-phase events (`phase = 'single'`).

| Event type                          | Phase       | Fires when                                                                                        | Payload                                                                                                                                                      |
|-------------------------------------|-------------|---------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `finder.ingest.run.start`           | start       | An ingester job dequeues from `pipeline_jobs` and begins a fetch cycle.                           | `{ source: 'sam_gov' \| 'sbir_gov' \| 'grants_gov', run_type: 'incremental' \| 'full', expected_page_count?: number }`                                        |
| `finder.ingest.run.end`             | end         | The same ingester job commits its last page (success or failure — `error` populated on failure). | Start payload merged with `{ inserted: number, updated: number, skipped: number, failed: number, last_cursor?: string }`                                    |
| `finder.opportunity.ingested`       | single      | Exactly once per new `opportunities` row inserted by an ingester.                                 | `{ opportunity_id: string, source: string, source_id: string, content_hash: string }`                                                                       |
| `finder.opportunity.amended`        | single      | Exactly once per `opportunities` row update where `content_hash` changes.                        | `{ opportunity_id: string, old_hash: string, new_hash: string, diff_fields: string[] }`                                                                     |
| `finder.rfp.triage_claimed`         | single      | An admin atomically claims a `curated_solicitations` row from the triage queue.                   | `{ solicitation_id: string, claimed_by: string, claimed_at: string }`                                                                                       |
| `finder.rfp.triage_dismissed`       | single      | An admin dismisses a triaged row as not worth curating.                                           | `{ solicitation_id: string, dismissed_by: string, phase_classification: 'phase_1_like' \| 'phase_2_like' \| 'unknown', reason?: string }`                    |
| `finder.rfp.released_for_analysis`  | single      | A claimed row is released to the shredder pipeline for AI extraction.                             | `{ solicitation_id: string, released_by: string }`                                                                                                          |
| `finder.rfp.shredding.start`        | start       | The shredder worker dequeues a released solicitation and begins extraction.                       | `{ solicitation_id: string, document_count: number, total_bytes: number }`                                                                                  |
| `finder.rfp.shredding.end`          | end         | Shredder completes (success or failure). Paired to the start by `parent_event_id`.                | `{ sections_extracted: number, compliance_variables_extracted: number, similar_prior_cycles_found: number, duration_ms: number }`                           |
| `finder.rfp.curation_started`       | single      | An admin enters the curation workspace for a solicitation (first page view).                      | `{ solicitation_id: string, actor_id: string }`                                                                                                             |
| `finder.rfp.annotation_saved`       | single      | Exactly once per annotation persisted via `solicitation.save_annotation`.                         | `{ solicitation_id: string, annotation_id: string, kind: 'highlight' \| 'text' \| 'compliance_tag', actor_id: string }`                                     |
| `finder.rfp.review_requested`       | single      | An admin requests review of their curation from another admin.                                    | `{ solicitation_id: string, requested_by: string, requested_reviewer_id?: string }`                                                                         |
| `finder.rfp.review_approved`        | single      | A reviewer approves the curation.                                                                 | `{ solicitation_id: string, reviewed_by: string, notes?: string }`                                                                                          |
| `finder.rfp.review_rejected`        | single      | A reviewer rejects the curation back to the curator.                                              | `{ solicitation_id: string, reviewed_by: string, notes?: string }`                                                                                          |
| `finder.rfp.curated_and_pushed`     | single      | Canonical Phase 1 success marker — solicitation is published to the customer pipeline.            | `{ solicitation_id: string, opportunity_id: string, pushed_by: string, total_compliance_variables: number, phase_classification: string }`                  |

### Phase 1 event types — `system.*` additions

| Event type                            | Phase  | Fires when                                                                                      | Payload                                                                                            |
|---------------------------------------|--------|-------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|
| `system.ingester.rate_limited`        | single | An ingester receives a rate-limit response (HTTP 429 or documented throttle) from an upstream. | `{ source: 'sam_gov' \| 'sbir_gov' \| 'grants_gov', retry_after_seconds: number, limit_kind: 'daily' \| 'hourly' \| 'burst' }` |
| `system.shredder.budget_exceeded`     | single | The Claude token budget for a single shredding run is exhausted before completion.             | `{ solicitation_id: string, token_count: number, budget: number }`                                 |

### Phase 1 event types — `tool.*`

Every Phase 1 tool invocation (see "Tool namespaces" below) produces a
paired `tool.invoke.start` / `tool.invoke.end` event automatically via
`lib/tools/registry.ts::invoke()`. No new `tool.*` event types are
introduced in Phase 1 — the existing `tool.invoke.*` set is the full
surface. Tool authors MUST NOT emit `tool.*` events themselves; the
registry is the single emitter.

### Bus routing

Event types map to physical bus tables by their domain prefix:

| Prefix       | Table              | Notes                                                                 |
|--------------|--------------------|-----------------------------------------------------------------------|
| `finder.*`   | `opportunity_events` | Opportunity ID is required when the event is opportunity-scoped.      |
| `capture.*`  | `customer_events`    | Tenant ID required once the tenant exists.                            |
| `proposal.*` | `customer_events`    | Scoped to `tenant_id` + proposal ID in `metadata.refs.proposal_id`.   |
| `identity.*` | `customer_events`    | `tenant_id` may be null for master/rfp admin events.                  |
| `agent.*`    | `customer_events`    | Agent events MUST carry `tenant_id` (agents are always tenant-scoped).|
| `system.*`   | `content_events`     | Platform events without per-user scope.                               |
| `tool.*`     | `content_events`     | Until `system_events` exists, tool audit rides `content_events`.      |

### Mandatory metadata

Every event's `metadata` column MUST include:

- `actor`: `{ type: 'user' | 'system' | 'pipeline' | 'agent', id, email? }`
- `trigger?`: `{ eventId, eventType }` — set when this event is a
  consequence of another event (enables replay chains).
- `refs?`: `{ [key]: id }` — cross-references to other rows
  (e.g., `{ proposal_id, section_id }`).
- `payload?`: arbitrary event-specific data.

This shape matches `frontend/lib/events.ts` and MUST NOT be widened
without a migration to the event readers.

---

## Tool namespaces

Every tool registered with the tool registry (`lib/tools/`) has a
unique name of the form `<namespace>.<verb>`. The namespace governs
discoverability (agents enumerate by prefix) and RBAC defaults.

| Namespace        | Tools planned                                                                                                                                         | Phase   | Notes                                                                          |
|------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------|---------|--------------------------------------------------------------------------------|
| `memory.*`       | `memory.search`, `memory.write`, `memory.delete`, `memory.list`                                                                                       | 4       | Tenant-scoped. Backs episodic, semantic, procedural memory tables.             |
| `opportunity.*`  | `opportunity.get_by_id`, `opportunity.score`, `opportunity.full_text_search`, `opportunity.find_similar`                                              | 1       | Not tenant-scoped — opportunities are global.                                  |
| `compliance.*`   | `compliance.extract`, `compliance.verify`, `compliance.list_variables`                                                                                | 1       | Reads curated solicitations; writes to `solicitation_compliance`.              |
| `proposal.*`     | `proposal.create`, `proposal.update_section`, `proposal.advance_stage`, `proposal.package`                                                            | 3       | Tenant-scoped. Every call enforces `proposals.tenant_id = ctx.tenantId`.       |
| `library.*`      | `library.decompose_upload`, `library.search_units`, `library.write_unit`                                                                              | 3       | Tenant-scoped.                                                                 |
| `tenant.*`       | `tenant.invite_user`, `tenant.revoke_user`, `tenant.get_slug`, `tenant.update_profile`                                                                | 0.5     | Tenant-scoped except `tenant.get_slug` (admin only).                           |
| `solicitation.*` | `solicitation.claim`, `solicitation.release`, `solicitation.push`, `solicitation.dismiss`                                                             | 1       | Admin-only (`rfp_admin`+). Writes to `curated_solicitations`.                  |

### Phase 1 tools — `solicitation.*`

All tools in this namespace have `tenantScoped: false` (curation is an
admin workflow, not a tenant workflow) and `requiredRole: 'rfp_admin'`
at minimum. `master_admin` satisfies the role check transitively.

| Tool name                         | Description                                                                                                   | Input                                                                                                             | Output                                                                                |
|-----------------------------------|---------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------|
| `solicitation.list_triage`        | List `curated_solicitations` rows currently in triage-ready statuses (`new`, `ai_analyzed`).                  | `{ status?: 'new' \| 'ai_analyzed' \| 'all', limit?: number, cursor?: string }`                                   | `{ rows: TriageRow[], nextCursor?: string }`                                          |
| `solicitation.get_detail`         | Fetch a single solicitation with its compliance variables and annotations.                                    | `{ solicitation_id: string }`                                                                                     | `{ solicitation: CuratedSolicitation, compliance: ComplianceRow[], annotations: Annotation[] }` |
| `solicitation.claim`              | Atomic claim (`UPDATE ... WHERE status='new' AND claimed_by IS NULL`). Emits `finder.rfp.triage_claimed`.     | `{ solicitation_id: string }`                                                                                     | `{ solicitation_id: string, claimed_by: string, claimed_at: string }`                 |
| `solicitation.release`            | Release for AI analysis; triggers the shredder worker. Emits `finder.rfp.released_for_analysis`.             | `{ solicitation_id: string }`                                                                                     | `{ solicitation_id: string, released_by: string, shredder_job_id: string }`           |
| `solicitation.dismiss`            | Dismiss with phase classification. Emits `finder.rfp.triage_dismissed`.                                       | `{ solicitation_id: string, phase_classification: 'phase_1_like' \| 'phase_2_like' \| 'unknown', reason?: string }` | `{ solicitation_id: string, status: 'dismissed' }`                                    |
| `solicitation.request_review`     | Request peer review from another admin. Emits `finder.rfp.review_requested`.                                  | `{ solicitation_id: string, requested_reviewer_id?: string }`                                                     | `{ solicitation_id: string, status: 'review_requested' }`                             |
| `solicitation.approve`            | Reviewer approves after review. Emits `finder.rfp.review_approved`.                                           | `{ solicitation_id: string, notes?: string }`                                                                     | `{ solicitation_id: string, status: 'approved' }`                                     |
| `solicitation.reject_review`      | Reviewer rejects with notes; returns row to `curation_in_progress`. Emits `finder.rfp.review_rejected`.       | `{ solicitation_id: string, notes: string }`                                                                      | `{ solicitation_id: string, status: 'curation_in_progress' }`                         |
| `solicitation.push`               | Final push to the customer pipeline (marks opportunity visible). Emits `finder.rfp.curated_and_pushed`.       | `{ solicitation_id: string }`                                                                                     | `{ solicitation_id: string, opportunity_id: string, published_at: string }`           |
| `solicitation.save_annotation`    | Persist a single annotation row into `curated_solicitations.annotations`. Emits `finder.rfp.annotation_saved`. | `{ solicitation_id: string, kind: 'highlight' \| 'text' \| 'compliance_tag', anchor: AnnotationAnchor, body: string }` | `{ annotation_id: string }`                                                           |
| `solicitation.delete_annotation`  | Remove an annotation by id.                                                                                    | `{ solicitation_id: string, annotation_id: string }`                                                              | `{ deleted: true }`                                                                   |

### Phase 1 tools — `compliance.*`

All tools in this namespace have `tenantScoped: false` and
`requiredRole: 'rfp_admin'` at minimum.

| Tool name                          | Description                                                                                           | Input                                                                                               | Output                                                                |
|------------------------------------|-------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------|
| `compliance.list_variables`        | List the master `compliance_variables` catalog (system + admin-added).                                | `{ category?: string, limit?: number }`                                                             | `{ variables: ComplianceVariable[] }`                                 |
| `compliance.add_variable`          | Add a novel compliance variable discovered during curation (`is_system = false`).                    | `{ name: string, label: string, category: string, data_type: 'text' \| 'number' \| 'boolean' \| 'select' \| 'multiselect', options?: JsonValue }` | `{ variable_id: string }`                                             |
| `compliance.extract_from_text`     | Call the shredder model against a text fragment to suggest compliance variables. No side effects.     | `{ text: string, solicitation_id?: string }`                                                        | `{ suggestions: Array<{ variable_name: string, value: string, confidence: number }> }` |
| `compliance.save_variable_value`   | Save a confirmed compliance variable value for a specific solicitation.                               | `{ solicitation_id: string, variable_name: string, value: JsonValue }`                              | `{ solicitation_compliance_id: string }`                              |

### Phase 1 tools — `opportunity.*`

All tools in this namespace have `tenantScoped: false` because
opportunities are global. Admin tools require `rfp_admin`; portal read
tools require `tenant_user`. `master_admin` satisfies all role checks.

| Tool name                          | Description                                                                                | `requiredRole` | Input                                                        | Output                                                     |
|------------------------------------|--------------------------------------------------------------------------------------------|----------------|--------------------------------------------------------------|------------------------------------------------------------|
| `opportunity.get_by_id`            | Look up a single opportunity + its compliance matrix. (See TOOL_CONVENTIONS.md Example C.) | `rfp_admin`    | `{ opportunity_id: string }`                                 | `{ id, title, agency, source, sourceUrl, dueDate, compliance: ComplianceRow[] }` |
| `opportunity.list_recent_ingested` | List opportunities ingested in the last N hours, paginated.                                | `rfp_admin`    | `{ since_hours?: number, source?: string, limit?: number }`  | `{ rows: OpportunitySummary[], nextCursor?: string }`      |
| `opportunity.fetch_raw_document`   | Return the stored S3 path + metadata for a raw ingested document.                          | `rfp_admin`    | `{ opportunity_id: string, document_index?: number }`         | `{ s3_key: string, bytes: number, content_type: string, ingested_at: string }` |

### Phase 1 tools — `ingest.*`

All tools in this namespace have `tenantScoped: false` and
`requiredRole: 'master_admin'` (ingestion control is platform-level).

| Tool name                  | Description                                                                                      | Input                                                                          | Output                                                            |
|----------------------------|--------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------|-------------------------------------------------------------------|
| `ingest.trigger_manual`    | Enqueue a manual ingester run. Writes to `pipeline_jobs`; the worker dequeues normally.          | `{ source: 'sam_gov' \| 'sbir_gov' \| 'grants_gov', run_type: 'incremental' \| 'full', since?: string }` | `{ job_id: string, enqueued_at: string }`                        |
| `ingest.list_recent_runs`  | List recent ingester runs from `pipeline_runs`.                                                  | `{ source?: string, limit?: number }`                                          | `{ runs: PipelineRun[] }`                                         |
| `ingest.get_run_detail`    | Fetch a single run's row plus its start/end events.                                              | `{ run_id: string }`                                                           | `{ run: PipelineRun, events: SystemEvent[] }`                     |

### Phase 1 tools — `memory.*` additions

`memory.search` and `memory.write` are defined in Phase 0.5b and
unchanged. Phase 1 adds one new variant:

| Tool name                  | Description                                                                                        | `requiredRole` | `tenantScoped` | Input                                                  | Output                                                          |
|----------------------------|----------------------------------------------------------------------------------------------------|----------------|----------------|--------------------------------------------------------|-----------------------------------------------------------------|
| `memory.search_namespace`  | Search memories by namespace-key prefix for cross-cycle similarity matching during curation.      | `rfp_admin`    | `false`        | `{ namespace: string, memory_types?: string[], limit?: number }` | `{ results: Array<{ id, type, namespace, content, similarity_score }> }` |

The `namespace` input is the `{agency}:{program_office}:{type}:{phase}`
key defined in the next section. The search is a LIKE prefix match so
`USAF:AFWERX:SBIR:` returns both `Phase1` and `Phase2` cycles. This
tool is admin-scoped (`tenantScoped: false`) because it reads
cross-cycle knowledge accumulated by the curation workforce, not
tenant memories.

### Tool naming rules

- Namespaces are singular (`memory`, not `memories`).
- Verbs are lowercase imperative (`search`, `write`, `create`,
  `advance_stage`). Use underscores for multi-word verbs.
- A tool never reaches across namespaces: `proposal.*` tools never
  read from `library_units` except via `library.*` tools.

---

## Memory namespace keys

Phase 1 introduces a cross-cycle similarity scheme for the curation
workflow: when a new solicitation enters the triage queue, the
curation workspace finds prior curated cycles from the same program so
the admin can pre-fill compliance variables with high confidence.
Similarity matching is driven by a deterministic string key stored in
`curated_solicitations.namespace` and indexed by `idx_csol_namespace`.

### Format

```
{agency}:{program_office}:{type}:{phase}
```

The canonical separator is a single colon, no spaces. All four parts
are required; parts that cannot be classified use the reserved literal
`unknown` (see "Reserved values" below).

### Case rules

- `agency` — UPPERCASE (acronym preferred; spell out only when no
  canonical acronym exists). Examples: `USAF`, `ARMY`, `NAVY`, `NSF`,
  `NIH`, `DARPA`, `DOE`.
- `program_office` — UPPERCASE. This is the program-office acronym
  (e.g., `AFWERX`, `DEVCOM`, `SOCOM`). For agencies with no distinct
  program office (e.g., NSF runs SBIR directly), this segment is
  omitted and the key collapses to three parts — see "Three-part
  keys" below.
- `type` — Mixed case matching the source-data convention: `SBIR`,
  `STTR`, `BAA`, `OTA`, `RIF`, `CSO`. These are themselves acronyms
  so they render uppercase; the rule is "match what the source data
  uses" rather than forced uppercase.
- `phase` — Mixed case: `Phase1`, `Phase2`, `Phase3`, `Direct`,
  `Open`. No space between "Phase" and the numeral.

### Examples

| Key                              | Meaning                                                                            |
|----------------------------------|------------------------------------------------------------------------------------|
| `USAF:AFWERX:SBIR:Phase1`        | Air Force, AFWERX program office, SBIR, Phase I                                    |
| `USAF:AFWERX:SBIR:Phase2`        | Same program office, same program, Phase II                                       |
| `ARMY:DEVCOM:STTR:Phase2`        | Army, DEVCOM, STTR, Phase II                                                       |
| `NSF:SBIR:Phase1`                | NSF, no distinct program office segment, SBIR, Phase I (three-part key)           |
| `NIH:SBIR:Phase2`                | NIH, no distinct program office segment, SBIR, Phase II                            |
| `DARPA:unknown:BAA:Open`         | DARPA BAA where the originating program office could not be identified            |

### Three-part keys

When the agency runs the program directly without a distinct office
(NSF, NIH, DOE ARPA-E), the `program_office` segment is omitted and
the key becomes `{agency}:{type}:{phase}`. The `memory.search_namespace`
tool treats both forms as equivalent at search time by matching on
prefix; writers MUST use the three-part form for these agencies
rather than inserting `unknown` as a placeholder, because the prefix
scan would otherwise collide with "genuinely unknown office" rows.

### Reserved values

`unknown` is the only reserved placeholder. It is legal only in the
`program_office` or `phase` segment when a four-part key is required
but the classification step could not confidently populate that
segment. `unknown` MUST NOT appear in `agency` or `type` — a row
without an identifiable agency or program type cannot yet be
curated and should remain in `status = 'new'` until triage reclassifies it.

### Key derivation from `curated_solicitations`

The key is computed at ingest time from the joined
`opportunities` row and persisted to `curated_solicitations.namespace`.
Derivation rules (applied in order):

1. `agency` comes from `opportunities.agency`, uppercased, stripped
   of punctuation. A canonical mapping (`docs/AGENCY_MAP.md` — Phase 1)
   resolves aliases (`"Department of the Air Force"` → `USAF`).
2. `program_office` comes from `opportunities.office`, uppercased.
   If the office is null or matches the agency verbatim, the segment
   is omitted (three-part key).
3. `type` comes from `opportunities.program_type` (`SBIR`, `STTR`,
   `BAA`, `OTA`, `RIF`, `CSO`). If null, fall back to keyword
   detection on `opportunities.title`; if that fails, leave the row
   in triage and do not compute a key.
4. `phase` comes from a dedicated classifier inspecting the
   solicitation title and body (`Phase I` / `Phase II` / `Direct` /
   `Open`). If classification confidence is below threshold, write
   `unknown` and let the admin triage step fix it.

### Search via `memory.search_namespace`

The Phase 1 tool `memory.search_namespace` (documented above) accepts
a namespace string and performs a `LIKE '{key}%'` prefix scan against
`episodic_memories.refs->>'namespace'`, `semantic_memories.refs->>'namespace'`,
and `curated_solicitations.namespace`. Prefix semantics let a caller
pass `USAF:AFWERX:SBIR:` (no phase) to retrieve all historical
AFWERX SBIR cycles regardless of phase — the curation workspace uses
this form when pre-filling variables that are stable across phases
(e.g., page-limit conventions).

---

## DB table naming

Rules enforced at migration review:

1. **Case.** Table names are `snake_case`.
2. **Plurality.** Table names are plural (`users`, `opportunities`,
   `proposals`, `library_units`). The one exception is join tables,
   which read as nouns (`proposal_collaborators`).
3. **Tenant scoping.** Any table holding tenant data MUST include
   `tenant_id UUID NOT NULL REFERENCES tenants(id)`. If the tenant
   relationship is optional (e.g., an audit row that can be
   system-emitted), the column MUST still exist but may be nullable.
   An index on `tenant_id` is required.
4. **Memory tables.** Agent memory tables follow the
   `{type}_memories` pattern: `episodic_memories`,
   `semantic_memories`, `procedural_memories`. Adding a fourth memory
   type requires a decision entry in `docs/DECISIONS.md`.
5. **Event streams.** Event bus tables follow `{domain}_events`
   (`opportunity_events`, `customer_events`, `content_events`) or
   the reserved `system_events` (Phase 1+). Never suffix a
   non-event table with `_events`.
6. **Join tables.** `{owner}_{related}` in alphabetical order
   where practical (`proposal_collaborators`,
   `collaborator_stage_access`).
7. **Timestamps.** Every table has `created_at TIMESTAMPTZ NOT NULL
   DEFAULT now()`. Mutable rows also have `updated_at`.

### Tenant-scoped tables (baseline)

The tables below carry a `tenant_id` column. Every API handler and
tool touching these tables MUST include `WHERE tenant_id = $1` in
every query. The registry and `withHandler` helpers enforce this at
code-review time; we do not yet rely on Row-Level Security.

- `tenant_profiles`
- `tenant_pipeline_items`
- `tenant_actions`
- `proposals`
- `proposal_sections` (via `proposals.tenant_id`)
- `proposal_collaborators` (via `proposals.tenant_id`)
- `proposal_stage_history` (via `proposals.tenant_id`)
- `proposal_comments` (via `proposals.tenant_id`)
- `proposal_reviews` (via `proposals.tenant_id`)
- `proposal_compliance_matrix` (via `proposals.tenant_id`)
- `library_units`
- `library_harvest_log`
- `tenant_uploads`
- `episodic_memories`
- `semantic_memories`
- `procedural_memories`
- `agent_task_log`
- `agent_task_queue`
- `tenant_agent_config`
- `agent_performance`
- `invitations`
- `purchases`
- `spotlights`

Globally-scoped tables (no `tenant_id`): `tenants`, `users` (tenant_id
is nullable because admin users have no tenant), `opportunities`,
`curated_solicitations`, `solicitation_compliance`,
`solicitation_templates`, `solicitation_outlines`,
`compliance_variables`, `agent_archetypes`, `api_key_registry`,
`pipeline_jobs`, `pipeline_schedules`, `pipeline_runs`,
`source_health`, `system_config`, `waitlist`, `legal_document_versions`,
`visitor_sessions`, `page_views`, `audit_log`, `consent_records`,
`opportunity_events`, `content_events`.

---

## Role names

From `frontend/lib/rbac.ts`. These five strings are the only valid
values for `users.role`. Ranks are used by `hasRoleAtLeast` and
`requiredRoleForPath`.

| Role           | Rank | Description                                                      |
|----------------|------|------------------------------------------------------------------|
| `master_admin` | 100  | Full system access: migrations, Railway, tenants, every tool.    |
| `rfp_admin`    | 80   | RFP triage, curation, customer onboarding, customer service.    |
| `tenant_admin` | 60   | Manages their tenant: invites team, purchases proposals.        |
| `tenant_user`  | 40   | Access per admin grant (all proposals or per-proposal).         |
| `partner_user` | 20   | Stage-scoped access per proposal (view/comment/edit).           |

`hasRoleAtLeast(actorRole, requiredRole)` returns true iff
`ROLE_RANK[actorRole] >= ROLE_RANK[requiredRole]`. Thus
`master_admin` satisfies any required role, and `partner_user` only
satisfies `partner_user`.

Adding a role is a breaking change: it touches RBAC, middleware,
every API handler's authorization check, the NextAuth JWT encoding,
and the tool registry's `requiredRole` semantics. A new role
requires an entry in `docs/DECISIONS.md` before any code change.

---

## Log scope names

Every structured log entry MUST carry a `scope` field. Loggers are
constructed with `logger.child({ scope: '<name>' })`. The closed set:

| Scope         | Used by                                                          |
|---------------|------------------------------------------------------------------|
| `auth`        | `auth.ts`, `auth.config.ts`, NextAuth callbacks, sign-in/out.   |
| `api`         | Any `app/api/**/route.ts` handler not covered by a narrower scope. |
| `db`          | `lib/db.ts`, pool error handlers, migration runner.              |
| `storage`     | `lib/storage/*`, S3 client wrappers, path helpers.               |
| `events`      | `lib/events.ts`, event bus emitters.                             |
| `tools`       | `lib/tools/*`, tool registry, tool handler entry/exit.           |
| `middleware`  | `middleware.ts` only.                                            |
| `migration`   | Migration runners (`db/migrate.ts`, `pipeline/migrate.py`).      |
| `seed`        | Seed scripts (`db/seed.ts`, fixture loaders).                    |
| `agent`       | Agent workers, tool dispatchers, planner loops.                  |
| `pipeline`    | `pipeline/main.py`, job queue, LISTEN/NOTIFY loop.               |
| `ingest`      | `pipeline/src/ingest/*` (SAM, SBIR, Grants.gov fetchers).        |
| `ingest.sam-gov`   | SAM.gov ingester (`pipeline/src/ingest/sam_gov.py`).        |
| `ingest.sbir-gov`  | SBIR.gov ingester (`pipeline/src/ingest/sbir_gov.py`).      |
| `ingest.grants-gov`| Grants.gov ingester (`pipeline/src/ingest/grants_gov.py`).  |
| `shredder`    | AI PDF → structured data worker (`pipeline/src/workers/shredder.py`). |
| `curation`    | Admin curation workflow (`frontend/app/admin/rfp-curation/**`).  |
| `triage`      | Admin triage queue logic (`frontend/app/admin/triage/**`, `solicitation.list_triage`). |
| `compliance`  | Compliance variable extraction + matching (`compliance.*` tools, `pipeline/src/workers/compliance_*`). |
| `scoring`     | `pipeline/src/scoring/*`.                                        |
| `health`      | `/api/health`, `/api/system`, readiness probes.                  |
| `billing`     | Stripe checkout, webhook handler, subscription reconciliation.   |
| `email`       | `lib/email.ts`, transactional mail sender.                       |

Adding a new scope requires a PR that touches this file and
`lib/logger.ts` in the same commit. Scopes MUST NOT be improvised at
call sites.

---

## Storage namespaces

See `docs/STORAGE_LAYOUT.md` for full specifications. Listed here for
discoverability:

| Prefix         | Purpose                                         | Tenant-scoped?            |
|----------------|-------------------------------------------------|---------------------------|
| `rfp-admin/`   | Curation staging for `rfp_admin` triage.        | No                        |
| `rfp-pipeline/`| Published opportunity artifacts.                | No                        |
| `customers/`   | Per-tenant isolated storage under `{slug}/...`. | Yes (strictly enforced).  |

Application code MUST NOT construct S3 keys directly. Use
`frontend/lib/storage/paths.ts` (TS) or
`pipeline/src/storage/paths.py` (Python). The `customers/` prefix is
the single highest-impact invariant: any code path producing a
`customers/{slug}/...` key without validating `slug` against the
acting tenant is a security incident.

---

## Change control

| Change                                   | Required artifacts                                                              |
|------------------------------------------|---------------------------------------------------------------------------------|
| New event type                           | PR touches this file + the emitter + the readers.                               |
| New tool namespace                       | PR touches this file + `docs/TOOL_CONVENTIONS.md` if the spec changes.          |
| New log scope                            | PR touches this file + `lib/logger.ts`.                                         |
| New tenant-scoped table                  | PR touches this file (add to the list) + baseline migration + index on `tenant_id`. |
| New role                                 | `docs/DECISIONS.md` entry + this file + `lib/rbac.ts` + middleware + JWT.       |
| New `finder.*` event type (Phase 1)      | PR touches this file (add row to the Phase 1 event table) + emitter in `pipeline/src/ingest/*` or `frontend/app/api/admin/**` + the event reader in `/admin/events`. Owner: RFP platform team. |
| New `solicitation.*` / `compliance.*` / `opportunity.*` / `ingest.*` tool (Phase 1) | PR touches this file (add row to the relevant Phase 1 tool subsection) + `frontend/lib/tools/<name>.ts` + registration in `frontend/lib/tools/index.ts` + test in `frontend/__tests__/`. Owner: RFP platform team. |
| New `memory.*` variant (Phase 1+)        | PR touches this file + `frontend/lib/tools/memory-*.ts` + a decision entry in `docs/DECISIONS.md` if the new variant changes the memory model contract. Owner: Agent Fabric team. |
| New memory namespace-key segment or reserved value | PR touches this file (Memory namespace keys section) + `pipeline/src/ingest/namespace.py` + any derivation-rule change requires a `docs/DECISIONS.md` entry. Owner: RFP platform team. |
| New Phase 1 log scope (`ingest.*`, `shredder`, `curation`, `triage`, `compliance`) | PR touches this file + `lib/logger.ts` (scope enum) + `pipeline/src/logger.py` (Python mirror). Owner: RFP platform team. |
| New `system.ingester.*` or `system.shredder.*` event type | PR touches this file + the emitter in `pipeline/src/` + `/admin/system` panel if the event drives a visible metric. Owner: Platform team. |
