# CLAUDE_CLIFFNOTES.md — Engineering Reference for All Future Sessions

**Last updated:** 2026-04-29 (post pre-launch audit)
**Purpose:** Prevent recurring errors. Every future Claude session MUST read
this file before writing any code. This is not aspirational — it documents
the exact patterns that exist in the codebase TODAY and the exact mistakes
that have been caught and fixed.

---

## 1. Database Schema Quick Reference

The schema is defined across 24 migration files (000-023). These are the
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
  + review_requested_for (009), priority (009), metadata (009)
  + solicitation_type, solicitation_title, solicitation_number (013)

proposals
  id, tenant_id, opportunity_id, solicitation_id, title, stage,
  stripe_payment_id, is_locked, created_at, updated_at

proposal_sections
  id, proposal_id, section_number, title, content (TEXT), page_allocation,
  status, assigned_to, requirement_ids, ai_confidence, version,
  created_at, updated_at

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
  + content_hash, round_number, round_label (015)
  + is_primary, document_label (021)
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
NOT: `SELECT * FROM solicitation_topics` (exists in baseline but unused)

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

Event type format: `entity.action_past_tense` (snake_case)
Examples: `rfp.manually_uploaded`, `subscription.created`, `section.saved`

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

### Proposal Stages
```
outline → draft → pink_team → red_team → gold_team → final → submitted
```
Workspace auto-locks on `final` and `submitted`.

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
