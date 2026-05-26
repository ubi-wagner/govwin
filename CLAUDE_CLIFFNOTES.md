# CLAUDE_CLIFFNOTES.md — Engineering Reference for All Future Sessions

**Last updated:** 2026-05-09 (full-stack stability audit)
**Purpose:** Prevent recurring errors. Every future Claude session MUST read
this file before writing any code. This is not aspirational — it documents
the exact patterns that exist in the codebase TODAY and the exact mistakes
that have been caught and fixed.

---

## 1. Database Schema Quick Reference

The schema is defined across 36 migration files (000-035). These are the
tables most frequently queried and the exact column names. **Do NOT guess
column names. Look them up here.**

### Core Tables (001_baseline.sql)

```
tenants
  id, slug, name, legal_name, website, status, product_tier,
  billing_email, trial_ends_at, storage_root, created_at, updated_at
  + stripe_customer_id (022), subscription_status (022)

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
  + solicitation_type, solicitation_title, solicitation_number (013 on curated_solicitations)

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
  GOTCHA: stage CHECK changed in 029 to: draft, review, final, submitted, archived

proposal_sections
  id, proposal_id, section_number, title, content (TEXT), page_allocation,
  status, assigned_to, requirement_ids, ai_confidence, version,
  created_at, updated_at
  + completed_stage, completed_at, accepted_by, accepted_at (046)

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

proposal_comments
  id, proposal_id, section_id, user_id, content, resolved, created_at
  NOTE: column is "section_id" not "node_id", "user_id" not "actor_id",
        "content" not "text"

proposal_stage_history
  id, proposal_id, from_stage, to_stage, changed_by, notes, created_at
  NOTE: column is "changed_by" not "actor_id", no "gate_results" column

purchases
  id, tenant_id, opportunity_id, proposal_id, stripe_session_id,
  stripe_payment_intent, product_type, amount_cents, status, created_at
  + metadata (JSONB) (035)
  GOTCHA: product_type CHECK includes: finder_subscription, proposal_phase1,
          proposal_phase2, expert_consulting (035)
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
  GOTCHA: column is "item_number" NOT "item_order"
  GOTCHA: column is "item_name" NOT "label"
  GOTCHA: there is NO "description" column

solicitation_documents
  id, solicitation_id, document_type, original_filename, storage_key,
  file_size, content_type, page_count, extracted_text, extracted_at,
  uploaded_by, metadata, created_at, updated_at
  + content_hash (015)
  + is_primary, document_label (021)
  GOTCHA: document_type CHECK includes 'topic' (015+021 fix)
```

### Automation & CMS (019, 028, 031, 034)

```
automation_rules
  id, name, description, is_active, trigger_namespace, trigger_type,
  action_type, action_config, created_by, created_at, updated_at
  GOTCHA: action_type includes BOTH old (log_only, queue_notification,
          queue_job, emit_event) AND new (send_email, notify_admin,
          webhook, update_status) values

automation_log
  id, rule_id, trigger_event_id, action_type, status, result,
  error_message, executed_at

cms_content
  id, slug (UNIQUE), title, content_type, body, excerpt, author,
  tags, published, published_at, featured_image, external_url,
  display_order, metadata, created_by, created_at, updated_at
  + content_type expanded in 031: blog_post, resource, guide,
    announcement, faq, testimonial, team_member, social_post, page_block
```

### Source Scout (025)

```
source_profiles
  id, name, url, description, auto_crawl_enabled, crawl_cron,
  last_crawled_at, created_at, updated_at

source_regions
  id, profile_id, css_selector, label, guidance, created_at

source_snapshots
  id, profile_id, content_hash, storage_key, created_at

source_diffs
  id, profile_id, from_snapshot_id, to_snapshot_id, diff_summary,
  significance, storage_key, created_at
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

To query topics for a solicitation:
```sql
SELECT * FROM opportunities WHERE solicitation_id = ${solId}::uuid
```

NOT: `SELECT * FROM opportunity_topics` (does not exist)
NOT: `SELECT * FROM solicitation_topics` (dropped in 035)

---

## 2. API Route Pattern (The Canonical Template)

Every API route MUST follow this exact structure. No exceptions.

```typescript
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventSingle } from '@/lib/events';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  // 1. AUTH CHECK — always first
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'UNAUTHENTICATED' },
      { status: 401 },
    );
  }

  // 2. ROLE CHECK — admin routes need rfp_admin OR master_admin
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

    // 6. EVENT EMISSION — after successful mutation
    await emitEventSingle({
      namespace: 'finder',           // see namespace rules below
      type: 'entity.action_done',    // snake_case, past tense
      actor: { type: 'user', id: userId ?? 'unknown' },
      tenantId: null,                // null for admin, real ID for portal
      payload: { entityId: rows[0].id },
    });

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
filtering by tenant_id. This was the #1 critical bug found in the
pre-launch audit.

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

NEVER use: `admin.*`, `cms.*`, `spotlight.*` as namespaces.

Event type format: `entity.verb_past_tense` (snake_case)
Examples: `rfp.uploaded`, `subscription.started`, `section.saved`

### Phase: start / end / single
- `start` + `end` for multi-step operations (enables stuck detection, retry, chaining)
- `single` for atomic CRUD operations
- Every payload includes `correlationId: crypto.randomUUID()`

### Workflow Automation (pipeline/src/workflows/)
Events that match a workflow trigger automatically instantiate a job:
- `finder:rfp.uploaded:end` → OnRfpUploaded (shred → compliance → notify)
- `finder:solicitation.pushed:single` → OnSolicitationPushed (match tenants → digest)
- `capture:application.accepted:end` → OnApplicationAccepted (welcome → library → reminder)
- `proposal:proposal.created:end` → OnProposalCreated (AI draft → notify)
- `proposal:proposal.advanced:single` → OnProposalAdvanced (review → notify → HITL wait)

See docs/EVENT_CONTRACT.md for the full registry and workflow architecture.

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
NOT variable_name/value rows. Code that queries `SELECT variable_name,
value FROM solicitation_compliance` crashes.

**Rule:** Always verify the table structure in section 1 before writing
queries. solicitation_compliance uses per-variable columns.

### Mistake 12: proposal_compliance_matrix column names
The columns are `requirement_text` and `notes`, NOT `requirement` and
`details`. postgres.js camelCase transform means results use
`requirementText` and `notes`.

---

## 5. Project Architecture Quick Reference

### Services
- **Frontend** (Next.js 15): `frontend/` — UI + all API routes
- **Pipeline** (Python 3.12): `pipeline/` — ingestion, scoring, agents
- **CRM** (FastAPI): `services/cms/` — email automation, event listener

### Storage
- Single Railway S3 bucket: `rfp-pipeline-prod-r8t7tr6`
- Three head folders: `rfp-admin/`, `rfp-pipeline/`, `customers/`
- AWS SDK auto-reads `AWS_*` env vars — zero config needed

### Auth
- NextAuth v5 with Credentials provider + JWT
- 5-role hierarchy: master_admin > rfp_admin > tenant_admin > tenant_user > partner_user
- `temp_password` flow for first login
- Middleware enforces role gates on all routes

### Canvas Model
- `CanvasDocument` = version + canvas rules + nodes[] + metadata
- 12 node types: heading, text_block, bulleted_list, numbered_list,
  image, table, caption, footnote, toc, page_break, url, spacer
- `CanvasRules` = format, dimensions, margins, header/footer, fonts,
  line_spacing, max_pages/max_slides
- 4 presets: letter_standard, letter_sbir_phase1, letter_sbir_phase2, slide_cso
- Stored as JSON string in `proposal_sections.content` (TEXT column)

### Proposal Stages (updated in migration 029)
```
draft → review → final → submitted → archived
```
Workspace auto-locks on `final` and `submitted`.
Gate config is stored as JSONB array in `proposals.gate_config`.

### Deployment
- Single environment: `main` branch → Railway production auto-deploy
- Staging environment exists on Railway but is dormant until first paying customer
- Migration workflow supports both environments when needed
- DO NOT add staging ceremony (dual secrets, dual migrations) until explicitly asked

### Source Scout (Opportunity Monitoring)
- `source_profiles` table with `auto_crawl_enabled`, `crawl_cron`
- `source_regions` for admin-annotated page areas with Claude guidance
- `source_snapshots` + `source_diffs` for change tracking
- Scout tool: HTTP fetch + Claude classification (no Playwright)
- Workflow: `on_source_change_detected` → draft RFP → notify admin
- Active ingesters: SAM.gov (daily), SBIR.gov (weekly), DSIP (daily)

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
```

---

## 7. Testing Checklist (Before Every Commit)

```bash
cd frontend && npx tsc --noEmit     # zero type errors
cd frontend && npm run build         # build succeeds
```

Before touching any SQL: verify column names against section 1.
Before any API route: follow the template in section 2.
Before any event: check namespace rules in section 3.
Before any portal route: include tenant verification.
