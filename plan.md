# Event System Overhaul Plan

## Current State
- 3 event tables: `opportunity_events`, `customer_events`, `content_events`
- 15 emission points across frontend API routes + Python pipeline
- **Problems:**
  - Payloads are thin/inconsistent — most have static strings like "Draft saved by admin" instead of actual diffs
  - No actor attribution on system events (who/what triggered it)
  - No correlation between related events (can't trace `ingest.new` → `scoring.scored` → `finder.opp_presented`)
  - Content configure action reuses `content.draft_saved` type instead of its own
  - `content.unpublished` stores no snapshot (can't audit what was removed)
  - Many defined event types never emitted: all `account.*`, `binder.*`, `grinder.*`, `scoring.scored`
  - NOTIFY trigger payloads are minimal (no entity context for downstream workers)
  - No events for: tenant CRUD, user management, profile updates, auth (login/logout)

## Design: Standardized Event Payload

All events will use a consistent `metadata` JSONB structure:

```jsonc
{
  // WHO triggered this event
  "actor": {
    "type": "user" | "system" | "pipeline",
    "id": "user-uuid or worker-name",
    "email": "user@example.com"        // optional, for user actors
  },
  // WHAT upstream event caused this (for chaining/correlation)
  "trigger": {
    "event_id": "uuid of triggering event",
    "event_type": "ingest.updated"
  },
  // Entity references for the event viewer + future trigger routing
  "refs": {
    "tenant_id": "uuid",
    "opportunity_id": "uuid",
    "page_key": "home",
    "job_id": "uuid"
  },
  // Event-specific payload — everything a downstream trigger needs
  "payload": {
    // varies by event type, documented per-event below
  }
}
```

The top-level columns (opportunity_id, tenant_id, user_id, etc.) stay as-is for indexing/querying. The `metadata` JSONB becomes the rich payload for automation.

## Changes

### Phase 1: Shared event helper + migration

**1a. New file: `frontend/lib/events.ts`**
Server-side helper to build standardized event payloads and emit events. Centralizes the INSERT logic so all API routes use the same structure.

```typescript
export async function emitOpportunityEvent(params: {
  opportunityId: string
  eventType: OpportunityEventType
  source: string
  fieldChanged?: string
  oldValue?: string
  newValue?: string
  snapshotHash?: string
  actor: { type: 'user' | 'system' | 'pipeline'; id: string; email?: string }
  trigger?: { eventId: string; eventType: string }
  refs?: Record<string, string>
  payload?: Record<string, unknown>
})

export async function emitCustomerEvent(params: {
  tenantId: string
  eventType: CustomerEventType
  userId?: string
  opportunityId?: string
  entityType?: string
  entityId?: string
  description: string
  actor: { type: 'user' | 'system' | 'pipeline'; id: string; email?: string }
  trigger?: { eventId: string; eventType: string }
  refs?: Record<string, string>
  payload?: Record<string, unknown>
})

export async function emitContentEvent(params: {
  pageKey: string
  eventType: ContentEventType
  userId?: string
  source: string
  contentSnapshot?: Record<string, unknown>
  metadataSnapshot?: Record<string, unknown>
  diffSummary: string
  actor: { type: 'user' | 'system' | 'pipeline'; id: string; email?: string }
  payload?: Record<string, unknown>
})
```

Each function wraps in try-catch, logs on failure, never throws (events are non-blocking).

**1b. New file: `pipeline/src/events.py`**
Python equivalent for pipeline workers. Same payload structure.

**1c. Migration 016: Add `content.configured` event type support + NOTIFY payload enrichment**
- Update NOTIFY trigger functions to include richer payloads (entity label, actor type)
- Add `correlation_id` column to all 3 event tables (nullable UUID, for linking related events)

### Phase 2: Fix all existing event emissions (15 points)

**Opportunity Events (5 emissions):**

| # | File | Event Type | Fix |
|---|------|-----------|-----|
| 1 | `pipeline/src/ingest/sam_gov.py` | `ingest.new` | Add full opp snapshot to payload (title, agency, NAICS, set_aside, close_date, estimated_value). Add `actor: {type: 'pipeline', id: 'sam_gov_ingestor'}` |
| 2 | `pipeline/src/ingest/sam_gov.py` | `ingest.updated` | Add field-level diff (not just hash). List changed fields in payload. Add actor |
| 3 | `pipeline/src/workers/finder.py` | `scoring.rescored` | Add correlation_id pointing to triggering ingest.updated event. Include score breakdown in payload |
| 4 | `pipeline/src/workers/finder.py` | `drive.archived` | Add opp title, tenant context, actual file path in payload. Add actor |
| 5 | `frontend/api/opportunities/[id]/actions` | `ingest.document_added` | Add document URLs/filenames to payload. Include actor (user who pinned) |

**Customer Events (5 emissions):**

| # | File | Event Type | Fix |
|---|------|-----------|-----|
| 6 | `pipeline/src/workers/finder.py` | `finder.opp_presented` | Add opp title, agency, NAICS match reason, score breakdown to payload. Add tenant context |
| 7 | `frontend/api/opportunities/[id]/actions` | `finder.opp_attached` / `finder.opp_dismissed` | Add opp title, score, reason/note field in payload. Include full actor |
| 8 | `pipeline/src/workers/reminder.py` | `reminder.nudge_sent` | Add opp title, close_date, notification channel in payload. Add tenant name |
| 9 | `pipeline/src/workers/reminder.py` | `reminder.amendment_alert` | Add detailed diff (old vs new for changed field). Include opp title, impact description |
| 10 | `frontend/api/portal/[tenantSlug]/drive` | `account.drive_provisioned` | Simplify structure metadata, add tenant name and tier context |

**Content Events (5 emissions):**

| # | File | Event Type | Fix |
|---|------|-----------|-----|
| 11 | `frontend/api/content` PATCH | `content.draft_saved` | Compute actual diff (changed sections list). Add actor email. Include page display_name |
| 12 | `frontend/api/content` POST publish | `content.published` | Add sections_published list, previous_published_at for comparison. Full actor |
| 13 | `frontend/api/content` POST rollback | `content.rolled_back` | Add rolled_back_from_date, restored_to_date in payload |
| 14 | `frontend/api/content` POST unpublish | `content.unpublished` | **FIX: Add content_snapshot and metadata_snapshot** (currently missing). Add actor |
| 15 | `frontend/api/content` POST configure | **Change to `content.configured`** | New event type. Add old/new config values in payload |

### Phase 3: Add missing event emissions

**Tenant management (in `/api/tenants`):**
- `account.tenant_created` — when admin creates a tenant (POST)
- `account.tenant_updated` — when admin updates tenant details (PATCH)

**User management (in `/api/tenants/[id]/users`):**
- `account.user_added` — when admin creates a user for a tenant

**Profile updates (in `/api/portal/[tenantSlug]/profile`):**
- `account.profile_updated` — when tenant updates NAICS/keywords/agencies/set-asides

**Auth events (in `lib/auth.ts`):**
- `account.login` — successful login (in authorize callback)
- `account.login_failed` — failed login attempt

**Scoring (in `pipeline/src/scoring/engine.py`):**
- `scoring.scored` — when a tenant-opportunity pair gets its initial score
- `scoring.llm_adjusted` — when Claude adjusts a score (currently invisible)

### Phase 4: Update event types + viewer

**Update `types/index.ts`:**
- Add `content.configured` to `ContentEventType`
- Add `account.login`, `account.login_failed`, `account.tenant_created`, `account.tenant_updated` to `CustomerEventType`
- Add `scoring.llm_adjusted` to `OpportunityEventType`

**Update `/api/events` route:**
- Include correlation_id in query results
- Add `?event_type=` filter parameter for testing specific events
- Add `?since=` ISO timestamp filter for recent events

**Update admin events page:**
- Show rich payload in expandable detail panel
- Show correlation chain (linked events)
- Add event_type filter dropdown
- Color-code by actor type (user=blue, system=gray, pipeline=purple)

### Phase 5: Update NOTIFY triggers

Update all 3 trigger functions to emit richer payloads:
```sql
-- Before:
PERFORM pg_notify('opportunity_events', json_build_object(
    'event_id', NEW.id,
    'opportunity_id', NEW.opportunity_id,
    'event_type', NEW.event_type,
    'source', NEW.source
)::text);

-- After:
PERFORM pg_notify('opportunity_events', json_build_object(
    'event_id', NEW.id,
    'opportunity_id', NEW.opportunity_id,
    'event_type', NEW.event_type,
    'source', NEW.source,
    'correlation_id', NEW.correlation_id,
    'metadata', NEW.metadata
)::text);
```

This gives downstream Python workers the full context without a re-query.

## File Change Summary

| File | Action |
|------|--------|
| `frontend/lib/events.ts` | **NEW** — shared event emitters |
| `pipeline/src/events.py` | **NEW** — Python event emitters |
| `db/migrations/016_event_enhancements.sql` | **NEW** — correlation_id, trigger updates |
| `frontend/types/index.ts` | EDIT — new event types |
| `frontend/app/api/content/route.ts` | EDIT — 5 event fixes |
| `frontend/app/api/opportunities/[id]/actions/route.ts` | EDIT — 2 event fixes |
| `frontend/app/api/portal/[tenantSlug]/drive/route.ts` | EDIT — 1 event fix |
| `frontend/app/api/tenants/route.ts` | EDIT — add tenant created event |
| `frontend/app/api/tenants/[id]/route.ts` | EDIT — add tenant updated event |
| `frontend/app/api/tenants/[id]/users/route.ts` | EDIT — add user added event |
| `frontend/app/api/portal/[tenantSlug]/profile/route.ts` | EDIT — add profile updated event |
| `frontend/lib/auth.ts` | EDIT — add login events |
| `frontend/app/api/events/route.ts` | EDIT — richer queries, new filters |
| `frontend/app/admin/events/page.tsx` | EDIT — payload viewer, filters |
| `pipeline/src/ingest/sam_gov.py` | EDIT — 2 event fixes |
| `pipeline/src/workers/finder.py` | EDIT — 3 event fixes |
| `pipeline/src/workers/reminder.py` | EDIT — 2 event fixes |
| `pipeline/src/scoring/engine.py` | EDIT — add scoring events |
