# CLAUDE_CLIFFNOTES.md — Engineering Reference for All Future Sessions

**Last updated:** 2026-06-23 (Phase 4 reconcile — as-built baseline from ARCHITECTURE_V9.md)
**Architecture reference:** `ARCHITECTURE_V9.md` is the authoritative as-built master (supersedes V5–V8).
**Purpose:** Prevent recurring errors. Every future Claude session MUST read
this file before writing any code. This is not aspirational — it documents
the exact patterns that exist in the codebase TODAY and the exact mistakes
that have been caught and fixed.

---

## 1. Database Schema Quick Reference

The schema is defined across **69 migrations (000–067, plus the interleaved
`030a_ensure_full_schema.sql`)** — highest numbered file is `067`. This
produces **72 live tables across 14 domains**. Full per-table detail:
`docs/baseline/inventory/DB_SCHEMA_CURRENT.md`.
(Prior docs said "53 / 051" or "40 / 039" — both stale/wrong.)
These are the tables most frequently queried and the exact column names.
**Do NOT guess column names. Look them up here.**

### Core Tables (001_baseline.sql)

```
tenants
  id, slug, name, legal_name, website, status, product_tier,
  billing_email, trial_ends_at, storage_root, created_at, updated_at
  + stripe_customer_id, subscription_status (022)
  + lifecycle_stage (040) CHECK IN ('lead','target','customer','at_risk','churned')

users
  id, email, name, role, tenant_id, password_hash, is_active,
  temp_password, last_login_at, terms_accepted_at, created_at, updated_at

opportunities
  id, source, source_id, title, agency, office, solicitation_number,
  naics_codes, classification_code, set_aside_type, program_type,
  close_date, posted_date, estimated_value_min, estimated_value_max,
  description, content_hash, full_text_tsv, award_date, award_amount,
  awardee, is_active, created_at, updated_at
  + solicitation_id, topic_number, topic_branch, topic_status,
    tech_focus_areas, poc_name, poc_email, topic_metadata (013)

curated_solicitations
  id, opportunity_id, namespace, status, claimed_by, claimed_at,
  curated_by, approved_by, pushed_at, dismissed_reason, phase_like,
  ai_extracted, ai_confidence, ai_similar_to, ai_similarity_score,
  full_text, full_text_tsv, annotations, created_at, updated_at
  + review_requested_for (009)
  + solicitation_type, solicitation_title, solicitation_number (013)
  + round_number, round_label (015)
  GOTCHA: NO "priority" or "metadata" columns (those are on pipeline_jobs)

proposals
  id, tenant_id, opportunity_id, solicitation_id, title, stage,
  stripe_payment_id, is_locked, created_at, updated_at
  + gate_config (JSONB), lock_count, download_count,
    last_locked_at, last_unlocked_at, unlock_deadline (029)
  + version, last_modified_by (044)
  CHECK stage IN ('draft', 'review', 'final', 'submitted', 'archived')

proposal_sections
  id, proposal_id, section_number, title, content (TEXT), page_allocation,
  status, assigned_to, requirement_ids, ai_confidence, version,
  created_at, updated_at
  + last_modified_by, editing_by, editing_since (044)
  + completed_stage, completed_at, accepted_by, accepted_at (046)

proposal_comments
  id, proposal_id, section_id, user_id, content, resolved, created_at
  GOTCHA: "section_id" not "node_id", "user_id" not "actor_id",
          "content" not "text"

proposal_stage_history
  id, proposal_id, from_stage, to_stage, changed_by, notes, created_at
  GOTCHA: "changed_by" not "actor_id", no "gate_results" column

purchases
  id, tenant_id, opportunity_id, proposal_id, stripe_session_id,
  stripe_payment_intent, product_type, amount_cents, status, created_at
  + metadata (JSONB) (035)
  CHECK product_type IN ('finder_subscription', 'proposal_phase1',
        'proposal_phase2', 'expert_consulting')
```

### Proposal Workspace Extensions (044-047)

```
proposal_activity_log (044)
  id, proposal_id, tenant_id, actor_id, actor_email, actor_role,
  activity_type, section_id, section_title, details (JSONB),
  entity_version, created_at
  CHECK activity_type IN (
    'section_edited', 'section_saved', 'section_reverted',
    'section_assigned', 'section_unassigned',
    'stage_advanced', 'stage_reverted',
    'proposal_locked', 'proposal_unlocked',
    'collaborator_invited', 'collaborator_removed',
    'collaborator_access_changed',
    'comment_added', 'comment_resolved',
    'ai_draft_requested', 'ai_review_requested',
    'compliance_checked', 'outcome_recorded',
    'document_uploaded', 'document_deleted',
    'proposal_created', 'proposal_exported'
  )

stage_gate_requirements (044)
  id, proposal_id, stage, requirement_type, label, description,
  is_met, met_by, met_at, evidence (JSONB), created_at, updated_at
  CHECK requirement_type IN ('all_sections_complete',
    'compliance_check_passed', 'min_sections_approved',
    'admin_review_complete', 'collaborator_signoff', 'custom')

stage_completion_snapshots (046)
  id, proposal_id, stage, completed_by, completed_at,
  sections_snapshot (JSONB), total_sections, sections_complete,
  sections_approved, notes, created_at

proposal_supporting_docs (047)
  id, proposal_id, tenant_id, requirement_label, requirement_source,
  category, is_required, storage_key, original_filename, file_size,
  content_type, status, uploaded_by, uploaded_at, reviewed_by,
  reviewed_at, notes, library_unit_id, created_at, updated_at
  CHECK category IN ('supporting_document', 'proposal_input', 'other')
  CHECK status IN ('missing', 'uploaded', 'reviewed', 'approved', 'waived')

canvas_versions (045 additions)
  Base: id, section_id, version_number, document (JSONB), created_at, created_by
  + source, ai_instruction, ai_model, parent_version_id,
    char_count, word_count, edit_summary (045)
  CHECK source IN ('ai_draft', 'human_edit', 'ai_revision',
                   'library_import', 'template', 'system')

curation_revisions (045)
  id, solicitation_id, actor_id, actor_email, revision_type,
  field_name, old_value, new_value, metadata (JSONB), created_at
  CHECK revision_type IN ('compliance_updated', 'annotation_added',
    'annotation_removed', 'outline_updated', 'volume_added',
    'volume_removed', 'item_added', 'item_updated', 'item_removed',
    'document_uploaded', 'ai_extracted', 'review_requested',
    'review_approved', 'review_rejected', 'status_changed',
    'namespace_set')
```

### Solicitation Structure (012_volumes_documents.sql)

```
solicitation_volumes
  id, solicitation_id, volume_number, volume_name, volume_format,
  description, special_requirements, metadata, created_by,
  created_at, updated_at
  + applies_to_phase (014)
  GOTCHA: column is "volume_number" NOT "volume_order"

volume_required_items
  id, volume_id, item_number, item_name, item_type, required,
  page_limit, slide_limit, font_family, font_size, margins,
  line_spacing, header_format, footer_format, required_sections,
  format_rules, custom_fields, source_excerpts, metadata,
  verified_by, verified_at, created_at, updated_at
  + applies_to_phase (014)
  GOTCHA: "item_number" NOT "item_order"
  GOTCHA: "item_name" NOT "label"
  GOTCHA: there is NO "description" column

solicitation_documents
  id, solicitation_id, document_type, original_filename, storage_key,
  file_size, content_type, page_count, extracted_text, extracted_at,
  uploaded_by, metadata, created_at, updated_at
  + content_hash (015)
  + is_primary, document_label (021)
  GOTCHA: document_type CHECK includes 'topic' (015+021 fix)
```

### Automation & CMS (019, 028, 040, 050)

```
automation_rules
  id, name (UNIQUE), description, is_active, trigger_namespace, trigger_type,
  action_type, action_config, created_by (UUID, nullable), created_at, updated_at
  Also has legacy columns: trigger_bus (nullable), trigger_events (nullable), enabled
  CHECK action_type IN ('log_only', 'queue_notification', 'queue_job', 'emit_event',
    'send_email', 'notify_admin', 'webhook', 'update_status',
    'create_todo', 'distribute_social', 'publish_content',
    'unpublish_content', 'enroll_drip')
  GOTCHA: created_by is UUID REFERENCES users(id) — NOT a string

automation_log
  id, rule_id, trigger_event_id, action_type, status, result,
  error_message, executed_at
  Also has legacy columns: action_taken
  CHECK status IN ('success', 'failed', 'skipped')

cms_content
  id, slug (UNIQUE), title, content_type, body, excerpt, author,
  tags, published, published_at, featured_image, external_url,
  display_order, metadata, status, created_by, created_at, updated_at
  CHECK content_type IN ('blog_post', 'resource', 'guide', 'announcement',
    'faq', 'testimonial', 'team_member', 'social_post', 'page_block')
  CHECK status IN ('draft', 'pending', 'published', 'private', 'archived')
```

### Source Scout (020 + 025)

```
source_profiles (020)
  id, name (UNIQUE), site_type, base_url, bookmark_url, agency,
  program_type, admin_notes, visit_instructions, topic_url_pattern,
  pdf_url_pattern, is_active, last_visited_at, last_visited_by,
  created_by, created_at, updated_at
  + auto_crawl_enabled, crawl_cron, last_crawl_at, crawl_config (025)
  CHECK site_type IN ('dsip', 'sam_gov', 'sbir_gov', 'grants_gov',
                      'afwerx', 'xtech', 'nsf', 'custom')
  GOTCHA: "base_url" NOT "url"
  GOTCHA: "admin_notes" NOT "description"
  GOTCHA: "last_crawl_at" NOT "last_crawled_at"

source_regions (025)
  id, profile_id, name, selector_hint, content_context, region_type,
  sample_html, sample_text, is_active, created_at, updated_at
  GOTCHA: "name" NOT "label"
  GOTCHA: "selector_hint" NOT "css_selector"

source_snapshots (025)
  id, profile_id, region_id, content_hash, content_text,
  raw_html_s3_key, captured_at
  GOTCHA: "raw_html_s3_key" NOT "storage_key"

source_diffs (025)
  id, profile_id, region_id, prev_snapshot_id, next_snapshot_id,
  is_meaningful, summary, extracted_opportunities, severity,
  claude_model, claude_tokens_used, reviewed_by, reviewed_at, created_at
  GOTCHA: "prev_snapshot_id" NOT "from_snapshot_id"
  GOTCHA: "next_snapshot_id" NOT "to_snapshot_id"
  GOTCHA: "summary" NOT "diff_summary"
  GOTCHA: "severity" NOT "significance"
```

### Workflow Engine (043)

```
process_instances (043)
  id, workflow_name, trigger_event_id, correlation_id,
  status, current_step, current_step_index,
  step_results (JSONB), step_status (JSONB),
  started_at, completed_at, last_heartbeat_at, deadline,
  retry_count, max_retries, last_error, last_error_step, recovered_from,
  tenant_id, actor_id, actor_email, payload (JSONB),
  source, created_at, updated_at
  CHECK status IN ('pending', 'running', 'paused', 'completed',
                   'failed', 'cancelled', 'retrying')
  CHECK source IN ('pipeline', 'cms')
  UNIQUE(workflow_name, trigger_event_id)

process_instance_transitions (043 + 045)
  id, instance_id, from_status, to_status, step_name,
  actor, reason, metadata (JSONB), created_at
  + affected_entity_type, affected_entity_id,
    content_version_before, content_version_after (045)
```

### Compliance Presets (027)

```
compliance_presets
  id, name, phase_type, agency, program_type, compliance_data (JSONB),
  volumes_data (JSONB), is_system, created_by, created_at
  GOTCHA: solicitation_compliance and solicitation_volumes both got
          + topic_id (027) for topic-level compliance
```

### Proposal Portal Extensions (029)

```
proposal_collaborators
  + assigned_sections UUID[], dropbox_enabled BOOLEAN (029)

collaborator_stage_access
  id, collaborator_id, proposal_id, stage, permission, created_at
```

### Topics Are Opportunities

There is NO table called `opportunity_topics` or `solicitation_topics`.
Topics are stored in the `opportunities` table with a non-null
`solicitation_id` pointing to the parent `curated_solicitations.id`.

```sql
SELECT * FROM opportunities WHERE solicitation_id = ${solId}::uuid
```

NOT: `SELECT * FROM opportunity_topics` (does not exist)
NOT: `SELECT * FROM solicitation_topics` (dropped in migration 035/030a)

### pipeline_jobs.kind (migration 067 — current CHECK set)

```
'ingest', 'shred_solicitation', 'scout_source',
'draft_section', 'review_section', 'expand_topics'
```

`expand_topics` was added in migration 067. `draft_section` and `review_section`
are in the CHECK enum but have no dispatcher handler — do NOT insert them (see Mistake 15).

### automation_rules — Dual-Schema Warning

The table has TWO parallel trigger-column sets due to migration history:

| Era | Columns | Status |
|-----|---------|--------|
| Legacy (001) | `trigger_bus TEXT`, `trigger_events TEXT[]` | Nullable, no active callers |
| Current (019/028/030a) | `trigger_namespace TEXT`, `trigger_type TEXT` | **USE THESE** |

Always use `trigger_namespace` + `trigger_type` when reading or writing `automation_rules`.
The CMS event listener introspects `information_schema.columns` to handle both; all seeded
rules use the current columns. Do NOT use `trigger_bus` or `trigger_events` in new code.

---

## 2. API Route Pattern (The Canonical Template)

### Pattern A — `withHandler()` (CANONICAL — use for all new routes)

`API_CONVENTIONS.md` mandates `withHandler()` from `lib/api-helpers.ts` as the
standard going forward. It handles auth resolution, error mapping, and response
wrapping automatically. Throw typed errors from `lib/errors.ts`; return `data`
directly (wrapper wraps in `{ data: ... }`).

```typescript
import { withHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/api-helpers';
import { sql } from '@/lib/db';
import { emitEventSingle } from '@/lib/events';
import { ForbiddenError, NotFoundError } from '@/lib/errors';

export const POST = withHandler(async (ctx) => {
  requireAdmin(ctx);  // throws ForbiddenError if not rfp_admin+
  // ctx.actor has { id, role, tenantId, tenantSlug }

  const { id } = await ctx.params;
  const body = ctx.body;  // pre-parsed by withHandler

  // Every await sql must be inside try/catch
  try {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO ... RETURNING id
    `;

    // Event emission — wrap in try/catch; event failure must not 500 the op
    try {
      await emitEventSingle({
        namespace: 'finder',
        type: 'entity.action_done',
        actor: { type: 'user', id: ctx.actor.id },
        tenantId: null,
        payload: { entityId: rows[0].id },
      });
    } catch (emitErr) {
      console.error('[route-name] event emit failed', emitErr);
    }

    return { id: rows[0].id };  // withHandler wraps in { data: ... }
  } catch (err) {
    console.error('[route-name] operation failed', err);
    throw new InternalError('Operation failed');
  }
});
```

### Pattern B — Raw `NextResponse.json` (LEGACY — present in many existing routes)

Many existing routes use raw `NextResponse.json` with manual try/catch. Both
patterns are valid in the codebase today. BOTH must return `{ data }` on success
and `{ error, code }` on failure. EVERY `await sql` must be inside try/catch
regardless of which pattern is used.

```typescript
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventSingle } from '@/lib/events';

export async function POST(request: Request, ctx: RouteContext) {
  // 1. AUTH CHECK — always first
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'UNAUTHENTICATED' },
      { status: 401 },
    );
  }

  // 2. ROLE CHECK
  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    return NextResponse.json(
      { error: 'Admin role required', code: 'FORBIDDEN' },
      { status: 403 },
    );
  }
  const userId = (session.user as { id?: string }).id;

  // 3. PARSE PARAMS + BODY
  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'INVALID_BODY' },
      { status: 400 },
    );
  }

  // 4. INPUT VALIDATION — before any DB access
  if (!body.title || typeof body.title !== 'string') {
    return NextResponse.json(
      { error: 'title is required', code: 'VALIDATION_ERROR' },
      { status: 422 },
    );
  }

  // 5. BUSINESS LOGIC — wrapped in try/catch
  try {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO ... RETURNING id
    `;

    // 6. EVENT EMISSION — inside its own try/catch (event failure ≠ op failure)
    try {
      await emitEventSingle({
        namespace: 'finder',
        type: 'entity.action_done',
        actor: { type: 'user', id: userId ?? 'unknown' },
        tenantId: null,
        payload: { entityId: rows[0].id },
      });
    } catch (emitErr) {
      console.error('[route-name] event emit failed', emitErr);
    }

    // 7. SUCCESS RESPONSE — always { data: ... }
    return NextResponse.json({ data: { id: rows[0].id } }, { status: 201 });
  } catch (err) {
    console.error('[route-name] operation failed', err);
    return NextResponse.json(
      { error: 'Operation failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
```

### Error Response Shape — ALWAYS include `code`

```typescript
{ error: string, code: string }                    // minimum
{ error: string, code: string, details: unknown }  // with validation details
```

Standard codes: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`,
`VALIDATION_ERROR`, `INVALID_BODY`, `DB_ERROR`, `STORAGE_ERROR`,
`DUPLICATE_FILE`, `TOO_LARGE`, `CONFLICT`

### Portal Route Extra Step — Tenant Verification

Portal routes (`/api/portal/[tenantSlug]/...`) MUST verify tenant access:

```typescript
const tenant = await getTenantBySlug(tenantSlug);
if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
const hasAccess = await verifyTenantAccess(userId, role, tenant.id);
if (!hasAccess) return NextResponse.json({ error: 'Access denied', code: 'FORBIDDEN' }, { status: 403 });
```

NEVER let a portal route query by proposalId alone without also
filtering by tenant_id.

---

## 3. Event Namespace Rules

```
finder.*     — Admin/curation operations (RFP upload, triage, curation)
capture.*    — Customer lifecycle (application, subscription, purchase, pin)
identity.*   — Auth ONLY (login, password_change, role_change)
proposal.*   — Proposal workspace (section save, comment, stage, lock)
library.*    — Content library (atom save, search, harvest, delete)
system.*     — Infrastructure (storage, health, errors, capacity)
tool.*       — Tool invocations (start, end, error)
```

NEVER use: `admin.*`, `cms.*`, `spotlight.*`, `pipeline.*` as event namespaces.
(NOTE: `solicitation`/`volume`/`compliance`/`opportunity`/`memory`/`ingest` are
TOOL names, not event namespaces — never emit events under them.)

`agent` namespace: appears in `system_events.namespace` column comment and older
docs (now archived) but is **never emitted at runtime**
(confirmed by grep across all 3 services). It is a stale schema/doc artifact.
Agent/tool activity emits under `tool` (e.g. `tool:tool.invoked`). The canonical
set is the 7 listed above — do NOT emit `agent.*` events.

Event type format: `entity.verb_past_tense` (snake_case)
Examples: `rfp.uploaded`, `subscription.started`, `section.saved`

### Phase: start / end / single
- `start` + `end` for multi-step operations (enables stuck detection, retry, chaining)
- `single` for atomic CRUD operations
- Every payload includes `correlationId: crypto.randomUUID()`
- **Match on `namespace:type:PHASE`** — matching on namespace+type alone makes a
  rule fire on BOTH the `start` and `end` rows (double-fire). See Mistake 19.

### Unified Automation Model (Jobs + Process Templates) — see docs/EVENT_CONTRACT_V3.md
The canonical vocabulary (retires "workflow" as a design term):
- **Job** = one discrete, independently testable action (typed I/O, idempotent,
  posts its own events, **carries its OWN default timeout + retry**). Today: `Step`
  + `workflows/actions/*.py` + tool-registry tools.
- **Process Template** = declarative composition citing Jobs by reference (no
  business logic). Today: `Workflow` subclass in `pipeline/src/workflows/base.py`.
- **Process Instance** = durable execution row (`process_instances` ledger).
- Forward-posting: `system_events`=journal, `process_instances`=ledger,
  `process_instance_transitions`=posting log. A Job posts its outcome; the next Job
  is triggered by that posting (never a direct call).

**Engine of record = `WorkflowManager` (`manager.py`)**, driven by the poll loop in
`processor.py` (wired at `main.py:87` — it IS running; older docs saying "not wired"
are wrong). Transport is **polling, not pg_notify** (no `add_listener` exists).

Process Templates (`pipeline/src/workflows/on_*.py`):
- `finder:rfp.uploaded:end` → OnRfpUploaded (shred → compliance → notify)
- `finder:solicitation.pushed:single` → OnSolicitationPushed (match tenants → digest)
- `capture:application.accepted:end` → OnApplicationAccepted (library defaults → HITL reminder)
- `proposal:proposal.created:end` → OnProposalCreated (notify admin — NOT AI-draft; docstring is stale)
- `proposal:proposal.advanced:end` → OnProposalAdvanced (AI review → notify → HITL wait)
- `finder:source.change_detected:single` → OnSourceChangeDetected (draft → notify → HITL)

**HITL resume is implemented** in `WorkflowManager.resume_instance()` (`manager.py:1000+`);
the old fire-and-forget path that skipped `HITL_WAIT` is the legacy path (now dead).
AI_INVOKE / API_CALL are stubbed skips. Agents are written but dormant (V2).
`EVENT_CONTRACT_V3.md` documents the OLD pre-baseline state and is now STALE — use
`ARCHITECTURE_V9.md §8` for the current engine truth.

### CMS Event Listener — a SECOND, PARALLEL engine (services/cms/src/event_listener.py)
The CMS listener is NOT the Jobs/Templates engine — it is a separate polling engine
matching `automation_rules` and running a flat action ladder (send_email, notify_admin,
create_todo, enroll_drip, distribute_social, publish_content). It is **fire-and-forget:
no per-action timeout, no retry, no heartbeat, not auto-restarted.**
- `publish_content` and `unpublish_content`: both handlers are LIVE (unpublish was a no-op before the baseline; now fixed with regression tests).
- `distribute_social`: rows created but `social_poster` always `raise NotImplementedError` → all posts fail.
- ⚠️ Phase guard fixed: `_rule_matches` now fires only on terminal phases (`end`, `single`) — double-fire on `start` is no longer an issue (regression tested).

### CMS SPA Event Types (emitted by page_blocks.py)
All use namespace `system`, phase `single`:

| Event Type | Trigger |
|------------|---------|
| `content.page_blocks_updated` | Block content saved |
| `content.page_blocks_published` | Page published + ISR revalidated |
| `content.page_blocks_submitted` | Page submitted for review |
| `content.page_blocks_approved` | Page approved by reviewer |
| `content.page_blocks_rejected` | Page rejected by reviewer |
| `content.page_blocks_reordered` | Blocks reordered on a page |
| `content.page_block_created` | New block created |
| `content.page_block_deleted` | Block deleted |
| `content.ai_revision_started` | AI revision request initiated |
| `content.ai_revision_completed` | AI revision finished |

NOTE: The admin dashboard queries BOTH legacy event name (`content.drafts_saved`)
and new event name (`content.page_blocks_updated`) for backward compatibility.

### V1 E2E Events (2026-05-31)
New proposal lifecycle events added:

| Namespace | Event Type | Trigger | Phase |
|-----------|------------|---------|-------|
| `proposal` | `proposal.ready_for_customer` | Admin unlocks proposal | single |
| `proposal` | `collaborator.access_revoked` | Collaborator removed from proposal | single |
| `finder` | `solicitation.force_released` | Master admin force-releases stale claim | single |

New workflow tracking:
- `process_instances` row with `workflow_name='AdminProposalSetup'` created on proposal creation (72h deadline)
- Completed (status→'completed') when admin unlocks the proposal

---

## 4. Common Mistakes We've Fixed (Do NOT Repeat)

### Mistake 1: Wrong column names in SQL
The #1 source of runtime crashes. Column names in the DB are snake_case.
postgres.js auto-converts results to camelCase, but the QUERY must use
the DB column name.

```typescript
// WRONG — will crash at runtime
await sql`SELECT item_order FROM volume_required_items`  // no such column
// RIGHT
await sql`SELECT item_number FROM volume_required_items`
```

**Rule:** Before writing any SQL, look up the table in section 1 above.

### Mistake 2: Portal route calling admin endpoint
The canvas editor page was hard-coded to call `/api/admin/proposals/...`
even when rendered in the portal context. This bypassed tenant isolation.

**Rule:** Client components that call APIs must accept the base URL as a
prop (or derive it from context). Never hard-code `/api/admin/...` in a
component used by both admin and portal.

### Mistake 3: Missing try/catch on SQL queries
Several routes had SQL queries outside try/catch. An unexpected DB error
(constraint violation, timeout, connection loss) crashes the route with
an unhandled 500 and exposes internal error details.

**Rule:** EVERY `await sql` call must be inside a try/catch that returns
a clean error response.

### Mistake 4: ILIKE without escaping
`ILIKE '%${userInput}%'` lets users inject `%` and `_` wildcards.

**Rule:** Always escape ILIKE patterns:
```typescript
const escaped = input.replace(/[%_\\]/g, '\\$&');
const pattern = `%${escaped}%`;
```

### Mistake 5: Missing error code in responses
Several routes returned `{ error: 'message' }` without a `code` field.
Client code relies on `code` for programmatic error handling.

**Rule:** Every error response MUST include both `error` and `code`.

### Mistake 6: Referencing non-existent tables
The old codebase had a `solicitation_topics` table but the V2 design
stores topics as `opportunities` with `solicitation_id`. Code that
referenced the old table name crashed.

**Rule:** Always verify table existence in the migrations before querying.

### Mistake 7: Template key mismatch
`resolveTemplateKey()` returned keys for templates that didn't exist in
`TEMPLATE_MAP`, causing null results that weren't handled.

**Rule:** Any function that maps to a registry must validate the key
exists before returning it.

### Mistake 8: Event namespace confusion
Portal proposal events used `capture.*` namespace but should use
`proposal.*`. Stripe events used `identity.*` but should use `capture.*`.

**Rule:** Check the namespace rules in section 3 above before emitting.

### Mistake 9: Migration schema conflicts (12-hour outage, May 2026)
Migration 001 created `automation_rules` with one schema. Migration 019
created it again with a completely different schema using IF NOT EXISTS
(no-op). Then 019 tried to CREATE INDEX on columns that didn't exist →
crash. Container restart-looped for 12 hours.

**Rule:** NEVER use CREATE TABLE IF NOT EXISTS to "redefine" a table.
Use ALTER TABLE ADD COLUMN IF NOT EXISTS to evolve existing tables.

### Mistake 10: CHECK constraint drift
Migration 021 dropped `'topic'` from `document_type` CHECK. Upload code
still inserted `'topic'` → constraint violation crash.

**Rule:** When modifying a CHECK constraint, grep the codebase for all
values being inserted into that column before removing any.

### Mistake 11: solicitation_compliance is NOT an EAV table
The table has individual columns (page_limit_technical, font_family, etc.),
NOT variable_name/value rows.

**Rule:** Always verify the table structure in section 1 before writing
queries. solicitation_compliance uses per-variable columns.

### Mistake 12: proposal_compliance_matrix column names
The columns are `requirement_text` and `notes`, NOT `requirement` and
`details`. postgres.js camelCase transform means results use
`requirementText` and `notes`.

### Mistake 13: Migration INSERT type mismatches (May 28 deploy failure)
Migration 050 inserted `created_by = 'system'` into a UUID column,
and `action_type = 'unpublish_content'` before widening the CHECK.

**Rule:** Before writing migration INSERTs:
1. Check column types — UUID columns need UUIDs or NULL, not strings
2. Check all CHECK constraints on the target table
3. Use explicit `ON CONFLICT (column_name)` — never bare `ON CONFLICT DO NOTHING`
4. If inserting a new value, widen the CHECK constraint FIRST

### Mistake 14: Source Scout column name drift
CLAUDE_CLIFFNOTES had wrong column names for 4 tables. See section 1
for the corrected names with GOTCHA annotations.

### Mistake 15: Dead-end pipeline_jobs for AI drafting/review
Do NOT insert `pipeline_jobs` with `kind='draft_section'` or
`kind='review_section'`. These are dead-end jobs never consumed by the
Pipeline dispatcher. The AI draft and review routes use `invoke()` from
the tool registry (`frontend/lib/tools/registry.ts`) instead.

**Rule:** Proposal AI drafting and review go through the `invoke()` tool
registry. Never create `pipeline_jobs` rows for these operations.

### Mistake 17: Filtering sections for partner_user
The sections GET route uses `role` from the session (system role `partner_user`),
NOT `access.role` from `resolveUserAccess()` (which maps to `'contributor'` or
`'external'`). Always compare `role === 'partner_user'` to distinguish section
visibility rules.

**Rule:** For partner_user, return ONLY sections with `permission !== 'none'`
(filter out completely). For tenant_user/tenant_admin, keep hidden sections
in the list (tagged `status: 'hidden'`) so admins can see the full structure.

### Mistake 16: Recomputing scores in the frontend
The Spotlights page uses `tenant_pipeline_items.total_score` as the
authoritative score when available. It falls back to lightweight estimation
(labeled "Est." in the UI) only for items not yet scored by the pipeline.

**Rule:** Do NOT recompute opportunity scores from scratch in the frontend.
Use `tenant_pipeline_items.total_score` when present. Only the pipeline
scoring engine should compute full scores.

### Mistake 17: Hardcoded instance deadline kills HITL (RESOLVED as of baseline)
This was a live bug: `manager.create_instance` had a hardcoded 1h deadline. As of the
Phase 1 baseline, `WorkflowManager.resume_instance()` is implemented (`manager.py:1000+`)
and `HITL_WAIT` resume is functional. The old fire-and-forget path that skipped `HITL_WAIT`
is now the legacy dead path.

**Rule (still applies):** A park-and-wait's `wait_deadline` MUST be derived from the
binding's declared `timeout_minutes`, never a global default. Parked instances are exempt
from the running-heartbeat sweep but subject to a deadline sweep that routes to `on_timeout`
(escalate), not to silent failure. Always verify the deadline derivation when adding new
HITL_WAIT steps.

### Mistake 18: HITL resume had no callers (RESOLVED as of baseline)
This was a live bug: `resume_instance` had zero callers. As of the Phase 1 baseline, the
resume path is wired. `EVENT_CONTRACT_V3.md`'s description of this as a current bug is STALE.

**Rule (still applies):** Any new HITL_WAIT step must have a documented resume trigger —
the awaited event, matched against `wait_for`, must transition the instance `paused → running`.
Wire `on_timeout`/`on_failure` to real escalation Jobs before shipping the step.

### Mistake 19: Matching on namespace+type without PHASE → double-fire (LIVE BUG)
The CMS `event_listener._rule_matches` ignores `phase`, so a rule on `rfp.uploaded`
fires on BOTH the `start` and `end` rows (distinct event IDs → `automation_log` dedup
misses). Plus the pipeline template AND a CMS rule can both fire on the same event
(`finder:rfp.uploaded` → OnRfpUploaded + "New RFP ready" rule).

**Rule:** Always match on `namespace:type:phase`. Each trigger has a SINGLE owner —
templates own multi-step chains; `automation_rules` own simple single-hop reactions.
Never both on the same trigger.

### Mistake 20: No timeout/retry on invoke() and CMS actions (LIVE GAP)
`registry.invoke()` (`registry.ts:196`) imposes NO timeout and NO retry — a hung
Anthropic call in `proposal-draft-section.ts` has no application deadline anywhere.
CMS actions are fire-and-forget (no timeout, no retry).

**Rule:** Every Job carries its OWN default timeout + retry (the Job Contract,
EVENT_CONTRACT_V3 §3.1). `invoke()` must enforce a deadline (`AbortSignal.timeout`)
and a bounded retry. Do not rely on per-handler ad-hoc timeouts.

### Mistake 21: Duplicated Job logic + a silent field-name break (LIVE BUG)
SHRED has 1 canonical core (`shredder/runner.py`) wrapped 3×; `workers/rfp_shredder.py`
is a DEAD duplicate. SCOUT is reimplemented in BOTH `source-scout.ts` and
`workers/source_scout.py`. The scouts emit `extractedOpportunities` but
`create_drafts_from_scout.py:163` reads `opportunities` → draftsCreated ALWAYS 0.

**Rule:** One canonical implementation per Job. When porting across TS/Python, the
emitted payload key contract MUST match the consumer's read key.

### Mistake 22: Phantom executors / soft-success outliers (LIVE BUG)
The `ai/review` route invokes `proposal.review_section`, which is NOT a registered
tool (no caller) — "review" reviews nothing. `proposal.draft_section` with no API key
returns a SUCCESS envelope carrying an in-band `error`, so metrics log a failure as
success. Dead mechanisms: `agent_task_queue` dispatcher (NotImplementedError),
`AutomationEngine` (orphan), 5 empty stub workers.

**Rule:** A named executor must exist and be registered before a route references it.
Jobs signal failure by raising, never by returning a success envelope with an error
field. RLS is ENABLED with ZERO policies — tenant isolation rests entirely on explicit
`WHERE tenant_id = $1` in every query (NOT on RLS, despite CLAUDE.md's claim).

### Mistake 23: Re-editing an applied migration won't re-run (prod icons missing, Jun 2026)
`db/migrations/migrate.mjs` keys applied migrations by **filename** in `_migration_history`
and runs each **once** — it records a checksum but never re-runs on change. Migration `063`
(publish the `content_pages` baseline from the in-code registry) ran on the PR #172 deploy
with the pre-icon registry. Re-editing `063` to add `metadata.icon` (PR #173) was then
**silently skipped** on the next deploy, so the live `content_pages` rows kept the old
content and the new icons never appeared — the deployed code renders registry icons only on
pages with NO db row. Fixed by adding migration `064` (fresh filename) to re-publish the
current registry.

**Rule:** Never edit a migration that may already be applied — the runner skips it by
filename. Any **bulk content baseline** that must auto-apply on deploy needs a **NEW
migration number each time** (`063` → `064` → …). For ordinary content changes use the admin
editor's per-page **Publish** (`publishPage` in `lib/content-admin.ts`), which versions
content in the DB and needs no migration.

### Mistake 24: Push/scoring operated on the primary opp only (topics never reached customers)
`solicitation.push` flipped `is_active` on **only** `cs.opportunity_id`, and
`score_tenants.match_tenants` scored only that one opportunity. So a multi-topic DoD
BAA (e.g. 65 DSIP topics, each its own `opportunities` row with `solicitation_id`)
got pushed once and **zero topics reached customers' Spotlight**. Fixed (M1): push
activates, and scoring scores, the whole **topic SET** = `opportunities WHERE
solicitation_id = cs.id OR id = cs.opportunity_id` (scoring additionally filters
`is_active AND close_date future`); one `tenant_pipeline_items` upsert per
(tenant, opportunity).

**Rule:** anything that "acts on a solicitation's opportunities" (activation,
scoring, spotlight reads, counts) must operate on the topic SET, never just
`cs.opportunity_id`. Also: `finder:topic.updated` has two emitters with different
payloads (`app/api/admin/topics/[id]/route.ts` → `topicId`/`changes`;
`opportunity.update_topic` → `opportunityId`/`changedFields`) — reconcile to one
canonical shape.

### ✅ RESOLVED (fix pass): Mistake 25: Double-emit of `finder:topics.expanded`
Both `topic_expander._emit_topics_expanded` AND `dispatcher._run_expand_topics_job`
emit `finder:topics.expanded` for one job — two events are written per expansion.

**Rule:** Emit once, from one owner. Pick the expander (close to the work) and remove
the dispatcher's redundant emit.

### ⚠️ FALSE POSITIVE — not a real bug: Mistake 26: Unescaped ILIKE on user input (confirmed in two files)
`lib/tools/memory-search.ts` and `lib/tools/library-search-atoms.ts` — these files ALREADY escape ILIKE via `.replace(/[%_\\]/g, '\\$&')`. The baseline incorrectly flagged them as violators; code inspection confirmed escaping was already present.

**Rule:** Always apply `.replace(/[%_\\]/g, '\\$&')` before building ILIKE patterns
(already in Mistake 4 — these two files were confirmed violators as of the baseline).

### ✅ RESOLVED (fix pass): Mistake 27: `await sql` with no inner try/catch (~4 routes needed it; 16 of the listed 20 were already compliant — fixed the 4)
~4 routes ran `await sql` inside the outer handler try/catch but with no per-query
try/catch — a DB error produced a generic 500 and exposed no diagnostics. 16 of the
originally listed 20 routes were already compliant on inspection; the 4 that genuinely
needed fixes were corrected. Confirmed in: `admin/analytics`, `admin/pipeline`,
`admin/tenants`, `admin/workflows/*`, `portal/dashboard`,
`portal/proposals/[id]/{sections,compliance,dropbox,collaborators}`.

**Rule:** EVERY `await sql` call must be inside its own try/catch returning a clean
error response. The outer catch is a last resort, not a substitute.

### Mistake 28: Event emits outside try/catch (7 routes)
7 routes call `emitEventSingle` / `emitEventStart` / `emitEventEnd` outside a
try/catch. If the event write fails, the route returns a false 500 even though the
business operation succeeded — the client retries and the op double-executes.

**Rule:** Wrap every event emit in its own try/catch. Log the emit failure; do NOT
propagate it as a 500. The business operation already committed.

### ✅ RESOLVED (fix pass): Mistake 29: `invite` route double-prefixed event type + no transaction
`POST /api/invite/route.ts` emits type `identity.identity.invite_accepted` (should be
`invite.accepted`) and writes to multiple tables with no `sql.begin()` transaction.

**Rule:** Event type = `entity.action_past_tense` with no namespace prefix in the
`type` field. Multi-table writes that must be atomic require `sql.begin()`.

### ⚠️ FALSE POSITIVE — not a real bug: Mistake 30: `pdf-reader.ts` named import from default-export package
`frontend/lib/import/pdf-reader.ts` does `import { PDFParse } from 'pdf-parse'` — pdf-parse is v2.4.5 which exports `PDFParse` as a NAMED export (class); `tsc` resolves the named import correctly. The baseline assumed v1.x default-only export behavior. The named import is CORRECT and no change is needed.

**Rule:** Check the export style of third-party packages before importing. Verify against the installed version, not assumed defaults.

### ✅ RESOLVED (fix pass): Mistake 31: `portal/[tenantSlug]/profile` GET has no role floor
A `partner_user` can call `GET /api/portal/[tenantSlug]/profile` and read
`billing_email` plus full company profile — no role minimum is enforced.

**Rule:** Add `hasRoleAtLeast('tenant_user')` check before returning billing fields;
or strip `billing_email` from the response for `partner_user` callers.

### ✅ RESOLVED (fix pass): Mistake 32: `admin/sbir-data/ingest` leaks internal error text to client
The route returns raw error details (including SQL error messages) in the response
body, and uses `sql.unsafe` batch inserts with no `ON CONFLICT` clause.

**Rule:** Never expose internal error details to clients. Use a generic message for
500s. Use explicit `ON CONFLICT (column)` on all upserts.

### ✅ RESOLVED (fix pass): Mistake 33: `scoring/engine.py::ScoringEngine` is dead code — removed
`pipeline/src/scoring/engine.py::ScoringEngine` has no caller anywhere in the
codebase. The live scoring path is `workflows/actions/score_tenants.py::match_tenants`
(invoked by `OnSolicitationPushed`). `ScoringEngine` was a vestige and has been removed.

**Rule:** Do not reference or extend `ScoringEngine`. Use `match_tenants` for all
scoring work.

### ✅ WIRED + HARDENED (fix pass): Mistake 34: fabric→processor + AI_INVOKE + task-queue consumer + 2 learning workflows wired (PIPE-12–16); agents are context-bound (ContextAssembler pre-loads proposal/RFP/atoms), injection-delimited (<untrusted_data>), tenant-isolated (all tools), and advisory-only. Real Claude invocation + embeddings activate on deploy (no SDK in CI). No longer dormant.

**Rule:** Do NOT surface UI that promises agent output from the pipeline agent
workforce. Product AI works via the frontend calling Anthropic directly
(`portal/.../ai/draft|review|compliance`, `claude-sonnet-4-20250514`). The pipeline
agent workforce now wired but activate on-deploy requires ANTHROPIC_API_KEY (real Claude) and EMBEDDINGS_PROVIDER=openai + OPENAI_API_KEY (vector search). See ARCHITECTURE_V9.md §9.4.

### ✅ RESOLVED (fix pass): Mistake 35: `config.STORAGE_ROOT="/data"` is a dead constant — removed
`pipeline/src/config.py::STORAGE_ROOT` was set but never imported by any storage code.
All pipeline storage goes through `storage/s3_client.py` (boto3 / Cloudflare R2).
The `/data` Railway volume is used ONLY by the CMS service for its own media files.
The constant has been removed from `config.py`.

**Rule:** Never use `config.STORAGE_ROOT` for pipeline file paths. Use the S3 key
scheme (see ARCHITECTURE_V9.md §11).

---

## 5. Project Architecture Quick Reference

### Services
- **Frontend** (Next.js 15): `frontend/` — UI + all API routes
- **Pipeline** (Python 3.12): `pipeline/` — ingestion, scoring, agents, workflows
- **CMS** (FastAPI): `services/cms/` — email automation, CMS SPA (Vite/React/TipTap), event listener

### Storage
- **S3-compatible object storage: Cloudflare R2** (`forcePathStyle: true`)
- Single bucket (name from `AWS_S3_BUCKET_NAME` env — `rfp-pipeline-prod-r8t7tr6` in prod)
- Three head folders: `rfp-admin/`, `rfp-pipeline/`, `customers/`
- AWS SDK auto-reads `AWS_*` env vars — zero config needed
- **`config.STORAGE_ROOT="/data"` is a DEAD constant** in `pipeline/src/config.py`.
  No storage code imports it. Do NOT use it. The live store is S3/R2 accessed via
  `pipeline/src/storage/s3_client.py` (boto3) and `frontend/lib/storage/s3-client.ts`.
  (The CMS service uses `/data/cms` Railway volume only for its own media uploads.)

### Auth
- NextAuth v5 with Credentials provider + JWT
- 5-role hierarchy: master_admin(100) > rfp_admin(80) > tenant_admin(60) > tenant_user(40) > partner_user(20)
- `temp_password` flow for first login
- Middleware enforces role gates on all routes
- CMS SPA: separate HTTP Basic Auth (CMS_BASIC_USER/CMS_BASIC_PASS)

### Canvas Model
- `CanvasDocument` = version + canvas rules + nodes[] + metadata
- 12 node types: heading, text_block, bulleted_list, numbered_list,
  image, table, caption, footnote, toc, page_break, url, spacer
- `CanvasRules` = format, dimensions, margins, header/footer, fonts,
  line_spacing, max_pages/max_slides
- 4 presets: letter_standard, letter_sbir_phase1, letter_sbir_phase2, slide_cso
- Stored as JSON string in `proposal_sections.content` (TEXT column)

### Proposal Stages (migration 029)
```
draft → review → final → submitted → archived
```
Workspace auto-locks on `final` and `submitted`.
Gate config is stored as JSONB array in `proposals.gate_config`.
Proposals created locked (`is_locked=true`) for 72-hour admin review.

### CMS Architecture
- CMS SPA: Separate Vite/React app at its own Railway URL
- Event bridge: CMS publishes → system_events → automation_rules → upsert cms_content
- Marketing pages use `getPageBlocks(page)` + ISR (60s revalidation)
- Content types: blog_post, resource, guide, page_block, etc.
- Workflow: draft → pending (submitted) → approved → published (in CMS SPA)
- Rejected pages return to draft. Revert restores last published state.

### CMS Page Blocks API (services/cms/src/routers/page_blocks.py)
13 endpoints registered at `/api` prefix via `page_blocks_router`:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/page-blocks/{page}` | GET | List all blocks for a page |
| `/api/page-blocks/{page}` | POST | Create a new block |
| `/api/page-blocks/{page}/{blockId}` | GET | Get single block |
| `/api/page-blocks/{page}/{blockId}` | PUT | Update block content |
| `/api/page-blocks/{page}/{blockId}` | DELETE | Delete block |
| `/api/page-blocks/{page}/reorder` | PUT | Reorder blocks on a page |
| `/api/page-blocks/{page}/submit` | POST | Submit page for review |
| `/api/page-blocks/{page}/approve` | POST | Approve submitted page |
| `/api/page-blocks/{page}/reject` | POST | Reject submitted page |
| `/api/page-blocks/{page}/publish` | POST | Publish + ISR revalidation |
| `/api/page-blocks/{page}/revert` | POST | Revert to last published state |
| `/api/page-blocks/{page}/{blockId}/ai-revise` | POST | AI content generation for block |
| `/api/page-blocks/{page}/status` | GET | Get workflow status |

ISR revalidation path mapping: security→/infosec, get-started→/pricing (see page_blocks.py).

### CMS SPA Pages
- **PageEditor** (`services/cms/frontend/src/pages/PageEditor.tsx`): Split-pane visual editor (1104 lines). Routes: `/pages`, `/pages/:page`.
- **MetadataEditor** (`services/cms/frontend/src/components/MetadataEditor.tsx`): Structured metadata editing for steps, features, stats (690 lines). Uses standardized `num` field for steps.

### Dual-Editor Architecture
Two valid editors exist for marketing page content:
1. **Legacy Next.js Editor** at `/admin/content/editor` — quick edits from admin dashboard
2. **CMS SPA PageEditor** at CMS Portal `/pages/:page` — full visual editing with AI revision, workflow
Both read/write the same `cms_content` rows (content_type='page_block'). `/admin/content` now redirects to `/admin/content/editor`.

### Admin Sidebar
- Content → links to `/admin/content/editor`
- CMS Portal → external link to CMS SPA
- Automation → `/admin/automation` (automation rules)
- Email Outbox → `/admin/email-outbox` (sent email archive)

### Deployment
- Single environment: `main` branch → Railway production auto-deploy
- Migration runner: `db/migrations/migrate.mjs` — runs in transaction per migration
- Tracks applied migrations in `_migration_history` table (filename + SHA-256)
- CAUTION: `scripts/migrate.sh` has NO tracking — never use it

### Source Scout (Opportunity Monitoring)
- `source_profiles` table with `auto_crawl_enabled`, `crawl_cron`
- `source_regions` for admin-annotated page areas with Claude guidance
- `source_snapshots` + `source_diffs` for change tracking
- Scout tool: HTTP fetch + Claude classification (no Playwright)
- Workflow: `on_source_change_detected` → draft RFP → notify admin
- Active ingesters: SAM.gov (daily), SBIR.gov (weekly), DSIP (daily)

### Agent Fabric (pipeline/src/agents/) — WIRED + context-bound + injection-hardened + tenant-isolated (PIPE-12–16); advisory output; real Claude + embeddings activate on-deploy
- 10 archetypes auto-register; fabric is now passed to `run_workflow_processor()`; AI_INVOKE routes via `fabric.invoke_agent()`; `process_task_queue()` is scheduled as a 5th asyncio task. Two learning workflows wired: `OnProposalSectionEdited` → DiffAnalyzer; `OnProposalOutcomeRecorded` → OutcomeAttributor.
- Context-binding: ContextAssembler pre-loads proposal sections + RFP compliance + tenant library atoms before each agent call. User content is delimited by `<untrusted_data>` tags (prompt injection defense). All agent tools enforce `tenant_id`.
- Output is advisory only — agent output is surfaced via NOTIFY/agent_task_log; never auto-applied to proposals.
- Guardrails (120s timeout, 20-round cap, $0.50/call, 50/hr, $50/mo) are coded in `fabric.invoke_agent`. Budget column is `monthly_budget` (dollars), NOT `max_cost_per_month_cents`. `human_gate` enforced.
- Activation on deploy: set ANTHROPIC_API_KEY for real Claude calls; set EMBEDDINGS_PROVIDER=openai + OPENAI_API_KEY and run `MemoryStore.backfill_embeddings` per table for vector search. (Voyage needs a vector(1536)→1024 migration first.)
- What runs LIVE: the memory-lifecycle/learning scheduler (`lifecycle_scheduler.py`) — decay, GC, compaction, calibration on existing rows.
- Memory: episodic/semantic/procedural read/write wired. RLS is ENABLED with ZERO `CREATE POLICY` — isolation = explicit `WHERE tenant_id`.

### Execution Engine of Record: WorkflowManager (pipeline/src/workflows/manager.py)
- Crash recovery, heartbeat (30s), stuck detection (5min stale), orphan recovery.
- Driven by the `processor.py` poll loop (every 10s, `main.py:87`). Transport is
  POLLING — there is no pg_notify/add_listener anywhere despite schema triggers.
- HITL resume is implemented (Mistakes 17–18 are resolved). ACTION/NOTIFY enforce
  timeout+retry; AI_INVOKE/API_CALL are stubbed skips; CONDITION works but no template
  uses it.

---

## 6. File Naming & Location Conventions

```
API routes:     frontend/app/api/{context}/{resource}/route.ts
  Admin:        frontend/app/api/admin/{resource}/route.ts
  Portal:       frontend/app/api/portal/[tenantSlug]/{resource}/route.ts

Pages:          frontend/app/{context}/{resource}/page.tsx
Components:     frontend/components/{domain}/{component-name}.tsx
Libraries:      frontend/lib/{module}.ts
Types:          frontend/lib/types/{type-name}.ts
Tools:          frontend/lib/tools/{tool-name}.ts
Templates:      frontend/lib/templates/{template-name}.ts

Migrations:     db/migrations/{NNN}_{description}.sql
Pipeline:       pipeline/src/{module}/{file}.py
CMS:            services/cms/src/{module}.py
CMS SPA:        services/cms/frontend/src/
```

---

## 7. Migration Writing Rules

```
1. Always use IF NOT EXISTS / IF EXISTS guards on CREATE/DROP
2. Widen CHECK constraints BEFORE inserting new values
3. Use explicit ON CONFLICT (column) targets — never bare ON CONFLICT DO NOTHING
4. UUID columns need UUIDs or NULL — never insert strings
5. Verify FK target rows exist before inserting references
6. Test migrations on fresh DB (all 69, 000–067 + 030a, in sequence), not just incremental
7. The production runner (migrate.mjs) wraps each migration in a transaction
   — partial failures roll back cleanly
```

---

## 8. Testing Checklist (Before Every Commit)

```bash
cd frontend && npx tsc --noEmit     # zero type errors
cd frontend && npm run build         # build succeeds
```

Before touching any SQL: verify column names against section 1.
Before any API route: follow the template in section 2.
Before any event: check namespace rules in section 3.
Before any portal route: include tenant verification.
Before any migration: follow rules in section 7.

## 11. Launch Readiness Review — Wiring Truths & Gotchas (2026-05-31)

A full end-to-end review (event wiring + runtime + UX) found the engine is sound but
the **human edge** was broken in several places. The durable truths:

- **Phase is exact.** `EventTrigger.matches()` requires `namespace AND type AND phase`
  to be equal. Producers: `emitEventStart`→`start`, `emitEventEnd`→`end`,
  `emitEventSingle`→`single` (frontend `lib/events.ts`). A `trigger`/`wait_for` MUST
  match the producer's ACTUAL phase. Start/end-pair domain events are consumed on
  `end`; point events on `single`.
- **`emitEventEnd` payload == the `result` arg only** (not merged with the start
  payload). The `end` event must itself carry every field the workflow steps and the
  trigger `condition` need (e.g. `previousStage`). Verify the success-path `result`.
- **Failed ops still emit `phase:'end'`** (with `error` set, empty `result`).
  Consumers MUST error-gate. FIX: `EventTrigger.matches()` and the CMS event loop now
  skip events whose `error` is set. Never trigger automation on a failed operation.
- **NOTIFY template must exist** in `services/cms/src/templates.py` `TEMPLATES` (or be
  inline `{{...}}`), or `render_template` returns `None` → **silent no-send**. Keep
  every workflow NOTIFY-step template name in that dict. (6 were missing → added.)
- **Single-owner regression lesson (my 052):** do NOT deactivate a *working*
  `automation_rule` in favor of a NOTIFY step unless that step's template actually
  renders. 052 deactivated the rules whose templates rendered and left NOTIFY steps
  whose templates were missing → admin notifications went dark. Verify delivery, not
  just ownership.
- **Agent archetypes are now WIRED (PIPE-12–16).** `AgentFabric` is passed to `run_workflow_processor()`; AI_INVOKE routes via fabric; `process_task_queue()` is scheduled. Context-assembled, injection-hardened, tenant-isolated, advisory-only. Real Claude calls + embeddings activate on-deploy (ANTHROPIC_API_KEY required; EMBEDDINGS_PROVIDER=openai for vector search). Do NOT surface UI that promises agent output until the deploy-time env vars are confirmed live.
- **HITL resume is implemented** in `WorkflowManager.resume_instance()`. The producer
  whose event matches the parked step's `wait_for` must be verified for any new HITL_WAIT
  step. Proposal gate: `proposal.advanced:end` (carries `previousStage`). Source-change
  gate: `source_diff.reviewed:end` (the diffs route PATCH emits it).
- **Ops:** the CMS automation listener silently disables ALL CMS automation if
  `SHARED_DATABASE_URL` is unset. Source Scout has no scheduler (manual-only).
- **Verify against the actual file, not a truncated read or a subagent summary.** A
  review agent AND a truncated read both wrongly called the diffs route GET-only; it
  actually has a PATCH that emits `source_diff.reviewed`. Read the whole target before
  acting — and re-run a test before committing it (a batched commit shipped a red test
  and 6 broken templates once this session before being corrected).
