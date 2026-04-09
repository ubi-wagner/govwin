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

### Tool naming rules

- Namespaces are singular (`memory`, not `memories`).
- Verbs are lowercase imperative (`search`, `write`, `create`,
  `advance_stage`). Use underscores for multi-word verbs.
- A tool never reaches across namespaces: `proposal.*` tools never
  read from `library_units` except via `library.*` tools.

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
