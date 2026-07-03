# CLAUDE.md — RFP Pipeline Portal Engineering Standards

## Project Overview
Multi-tenant SaaS platform for government contractors to discover, score, and build
proposals for federal opportunities (SBIR, STTR, BAA, OTA). Product AI (drafting / compliance /
review) is live via the frontend.

The **greenfield opportunity-card spine is now the canonical customer surface** (see
ARCHITECTURE_V10.md — the as-built successor to V9): admin approval → `solicitation.push`
fans EVERY activated opportunity (umbrella + all topics) onto the forward-only
`opportunity_bridge` → a denormalized `tenant_opportunity_cards` row per tenant, ranked by
`tenant_spotlight_buckets`/`tenant_bucket_scores` (auto-scored on arrival), and drafted from
the unified `library_atoms` library (visibility-enforced, taxonomy-tagged, upload→atomize→select).
The legacy Spotlight/Pipeline surface (`tenant_pipeline_items`) is RETIRED — `/spotlights` +
`/pipeline` redirect to `/cards`. The compliance matrix (`proposal_compliance_matrix`) populates
at provision and advances on section lock. Verified end-to-end (Playwright 17/17 + the live Python
workflow engine creating `process_instances` that carry `opportunity_id`).

The pipeline agent workforce (`AgentFabric`, 10 archetypes) is wired to the workflow engine:
`color_team_reviewer` runs on advance; `section_drafter` + `compliance_reviewer` run on portal
launch / review advance (gated on the pipeline `ANTHROPIC_API_KEY`) — the "strawman is callerless"
note in older docs is STALE (`draft_v0` → `publish_section_draft`, wired 2026-06-30). The remaining
~7 archetypes are dormant (registered, no producer). `opportunity_id` keys the spine (mig 088);
docs/V1_REFACTOR_DESIGN.md has the orchestration pattern.

## Services
1. **Frontend** (Next.js 15): Portal UI + API routes → `frontend/`
2. **Pipeline** (Python 3.12): Ingestion, scoring, workers, agents → `pipeline/`
3. **CMS/CRM** (FastAPI): Live — email automation, content pipeline, social, page-block editor; own `govtech_cms` DB → `services/cms/`

Frontend + Pipeline share one PostgreSQL database (govtech_intel); CMS/CRM has its own (govtech_cms)
and bridges via the shared `system_events` table. Object storage is S3-compatible (Cloudflare R2) —
there is no `/data` business-data volume (the `STORAGE_ROOT=/data` constant in pipeline config is dead;
the only local volume is CMS media).

## Roles
- `master_admin`: Full system access, migrations, Railway management
- `rfp_admin`: RFP triage/curation, customer onboarding, customer service
- `tenant_admin`: Manages their tenant, invites team, purchases proposals
- `tenant_user`: Access per admin grant (all proposals or per-proposal)
- `partner_user`: Stage-scoped access per proposal (view/comment/edit)

## SOP: Error Handling
- Server components: try-catch all DB queries, re-throw NEXT_REDIRECT, log with tagged prefix
- API routes: try-catch returning NextResponse.json with proper status codes, validate inputs first
- Client components: check res.ok, parse JSON safely, set error/loading states
- Database: validate DATABASE_URL at load, .on('error') handlers on pools
- Auth: try-catch around DB queries in authorize(), wrap non-critical updates separately

## SOP: Code Quality
- `npx tsc --noEmit` must pass — zero type errors
- No unhandled promises
- No console.log — use console.error for error logging only
- Return consistent shapes: `{ data: T }` success, `{ error: string, code: string }` failure
- Auth checks first, then input validation, then business logic
- Always verify tenant access before returning tenant-specific data
- Parameterize all SQL queries (postgres.js tagged templates)
- EVERY error response MUST include both `error` and `code` fields
- EVERY `await sql` call MUST be inside try/catch
- Portal routes MUST verify tenant access — never query by ID alone
- Before writing SQL, verify column names in CLAUDE_CLIFFNOTES.md section 1
- Escape ILIKE patterns: `input.replace(/[%_\\]/g, '\\$&')`

## SOP: Data Layer (postgres.js + constraints) — bug classes, see CLIFFNOTES §4b
- **jsonb writes:** write via `${sql.json(x)}`, NOT `${JSON.stringify(x)}::jsonb`, when the column
  is read back as an object/array. The latter reads back as a STRING (silent char-iteration bug).
  On READ, coerce with `coerceJsonb<T>(v, fallback)` (`lib/jsonb.ts`).
- **ON CONFLICT vs a PARTIAL unique index:** restate the index `WHERE` predicate in the ON CONFLICT
  or it throws on every call (`ON CONFLICT (a,b) WHERE b IS NOT NULL DO …`).
- **counts/bigint:** cast `::int` in SQL (or `Number()`); postgres.js returns int8 as a string.
- **CHECK columns:** confirm a literal is in the column's CHECK (`\d table`) before writing it.
- **Workflow status writes:** force-fail a paused instance only with `… WHERE id=$1 AND status='paused'`
  (compare-and-swap) and expire its sibling task; resume HITL only after entity correlation.

## SOP: Events
- Namespaces: finder (admin), capture (customer), identity (auth only),
  proposal (workspace), library (content), system (infra), tool (invocations)
- NEVER use: admin, cms, spotlight as namespaces
- Type format: entity.action_past_tense (snake_case)
- Admin events: tenantId = null
- Portal events: tenantId = actual tenant UUID

## Engineering Reference
See CLAUDE_CLIFFNOTES.md for:
- Complete DB schema quick reference (all column names)
- Canonical API route template
- Common mistakes caught in audits (with fixes)
- Event namespace rules
- Architecture quick reference

## SOP: Security
- Never trust client input — validate and sanitize
- Never expose internal error details to client
- Row-Level Security on all tenant-scoped agent memory tables
- Agent tools enforce tenant_id — agents never construct SQL directly
- User content clearly delimited in agent prompts (prompt injection defense)

## Project Structure
See ARCHITECTURE_V9.md for the full as-built system design and file tree.
