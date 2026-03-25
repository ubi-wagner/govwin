# Automation Framework — Developer Guide

How to add new event-driven automations to the GovWin pipeline.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│  Event Sources                                               │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ Next.js API │  │ Python       │  │ Cron / Scheduled   │  │
│  │ (user acts) │  │ Pipeline     │  │ Jobs               │  │
│  └──────┬──────┘  └──────┬───────┘  └────────┬───────────┘  │
│         │                │                    │              │
│         ▼                ▼                    ▼              │
│  ┌────────────────────────────────────────────────────┐      │
│  │           PostgreSQL Event Tables                  │      │
│  │  opportunity_events │ customer_events │ content_   │      │
│  │  (NOTIFY channel)   │ (NOTIFY channel)│ events     │      │
│  └───────────┬─────────┴────────┬────────┘           │      │
│              │                  │                     │      │
│              ▼                  ▼                     │      │
│  ┌──────────────────────────────────────────┐        │      │
│  │  AutomationWorkers (Python)              │        │      │
│  │  • AutomationCustomerWorker              │        │      │
│  │  • AutomationOpportunityWorker           │        │      │
│  └───────────┬──────────────────────────────┘        │      │
│              │                                       │      │
│              ▼                                       │      │
│  ┌──────────────────────────────────────────┐        │      │
│  │  Automation Engine                       │        │      │
│  │  1. Load rules from automation_rules     │        │      │
│  │  2. Match trigger_bus + trigger_events   │        │      │
│  │  3. Evaluate conditions                  │        │      │
│  │  4. Execute action                       │        │      │
│  │  5. Log to automation_log                │        │      │
│  └───────────┬──────────────────────────────┘        │      │
│              │                                       │      │
│              ▼                                       │      │
│  ┌──────────────────────────────────────────┐        │      │
│  │  Actions                                 │        │      │
│  │  • emit_event → insert new event         │        │      │
│  │  • queue_notification → email queue       │        │      │
│  │  • queue_job → pipeline_jobs              │        │      │
│  │  • log_only → automation_log              │        │      │
│  └──────────────────────────────────────────┘        │      │
└──────────────────────────────────────────────────────────────┘
```

---

## Quick Start: Add a New Rule (SQL Only)

Most automations require **zero code changes**. Insert a row into `automation_rules`:

```sql
INSERT INTO automation_rules (
    name, description, trigger_bus, trigger_events,
    conditions, action_type, action_config, priority
) VALUES (
    'my_new_rule',
    'Description of what this rule does',
    'customer_events',                    -- which bus to listen on
    '{account.login, account.user_added}', -- which event types trigger it
    '{"actor.type": "user"}',             -- conditions (optional)
    'queue_notification',                 -- action type
    '{"notification_type": "my_alert", "subject_template": "Hello {actor.email}", "priority": 3}',
    50                                    -- priority (lower = evaluated first)
);
```

That's it. The automation workers pick up rule changes within 60 seconds (cache TTL).

---

## Step-by-Step: Complex Automation

### Step 1: Define the Trigger

Decide which event(s) should activate your rule.

**Available buses and event types:**

| Bus | Event Types | Source |
|-----|------------|--------|
| `opportunity_events` | `ingest.new`, `ingest.updated`, `ingest.field_changed`, `scoring.scored`, `scoring.rescored`, `scoring.llm_adjusted`, `drive.archived` | Pipeline workers, SAM.gov ingester |
| `customer_events` | `account.login`, `account.tenant_created`, `account.tenant_updated`, `account.profile_updated`, `account.user_added`, `account.drive_provisioned`, `finder.opp_presented`, `reminder.nudge_sent`, `reminder.amendment_alert`, `opportunity.pinned`, `opportunity.status_changed` | API routes, pipeline workers |
| `content_events` | `content.draft_saved`, `content.published`, `content.rolled_back`, `content.unpublished`, `content.configured` | CMS API (not yet wired to automation workers — see "Adding a New Bus" below) |

### Step 2: Define Conditions

Conditions are evaluated against a **context object** built from the event:

```
context = {
    event_type: "account.login",
    bus: "customer_events",
    actor: { type: "user", id: "usr_123", email: "jane@acme.com" },
    trigger: { eventId: "evt_456", eventType: "ingest.new" },
    refs: { tenant_id: "ten_789", opportunity_id: "opp_012" },
    payload: { total_score: 82, recommendation: "pursue", ... },
    event: { id, tenant_id, user_id, opportunity_id, description, correlation_id },
    trigger_event_type: "account.login"
}
```

**Condition operators:**

| Operator | Example | Meaning |
|----------|---------|---------|
| Simple equality | `{"actor.type": "user"}` | Exact match |
| `$gte` | `{"payload.total_score": {"$gte": 75}}` | Greater than or equal |
| `$lte` | `{"payload.days_remaining": {"$lte": 1}}` | Less than or equal |
| `$gt` / `$lt` | `{"payload.llm_adjustment": {"$gt": 0}}` | Strict comparison |
| `$eq` / `$ne` | `{"payload.recommendation": {"$ne": "pass"}}` | Explicit equal / not-equal |
| `$contains_any` | `{"payload.fields_changed": {"$contains_any": ["primary_naics"]}}` | List contains at least one |
| `$first_occurrence` | `{"$first_occurrence": true, "$entity_key": "actor.id"}` | Fire only once per entity |

Conditions use **dotted paths** into the context: `payload.total_score`, `actor.email`, `refs.tenant_id`.

### Step 3: Choose an Action Type

#### `log_only` — Audit trail, no side effects

```json
{
    "action_type": "log_only",
    "action_config": {
        "message_template": "User {actor.email} scored {payload.total_score} on opp"
    }
}
```

Start here when prototyping. Watch the automation log at `/admin/automation` to verify your rule triggers correctly, then upgrade to a real action.

#### `emit_event` — Chain events across buses

```json
{
    "action_type": "emit_event",
    "action_config": {
        "bus": "customer_events",
        "event_type": "finder.high_score_alert",
        "description_template": "High-scoring opportunity ({payload.total_score}/100)"
    }
}
```

Use this to create event chains: `scoring.scored` → `finder.high_score_alert` → (another rule listens and sends email).

#### `queue_notification` — Email via Gmail

```json
{
    "action_type": "queue_notification",
    "action_config": {
        "notification_type": "welcome",
        "subject_template": "Welcome to GovWin, {actor.email}!",
        "priority": 3
    }
}
```

Inserts into `notifications_queue`. The `EmailTriggerWorker` or scheduled `email_delivery` job picks it up and sends via Gmail API.

Priority: 1 = urgent (immediate), 3 = normal, 5 = low (batch digest).

To add a new email template, edit `pipeline/src/workers/emailer.py` → `_generate_notification_html()`.

#### `queue_job` — Trigger pipeline work

```json
{
    "action_type": "queue_job",
    "action_config": {
        "source": "scoring",
        "run_type": "score",
        "priority": 3
    }
}
```

Inserts into `pipeline_jobs` and sends `pg_notify('pipeline_worker', ...)`. The main pipeline process dequeues and executes. Automatically skips if a pending/running job already exists for the same source.

### Step 4: Set Execution Controls (Optional)

```sql
cooldown_seconds   = 300,    -- Min 5 minutes between firings
max_fires_per_hour = 10,     -- Rate limit
priority           = 30      -- Lower = evaluated first (use 10-90 range)
```

### Step 5: Insert the Rule

```sql
INSERT INTO automation_rules (
    name, description, trigger_bus, trigger_events,
    conditions, action_type, action_config, priority
) VALUES (
    'my_rule_name',    -- unique identifier, snake_case
    'What this does',
    'opportunity_events',
    '{scoring.scored}',
    '{"payload.total_score": {"$gte": 80}}',
    'queue_notification',
    '{"notification_type": "high_score", "subject_template": "New high-scoring opp!", "priority": 3}',
    40
);
```

### Step 6: Verify

1. Go to `/admin/automation` → **Rules** tab — confirm your rule appears and is enabled
2. Trigger the event (login, update a profile, etc.)
3. Go to **Execution Log** tab — confirm the rule fired (green bolt) or check skip reason
4. If using `queue_notification`, check `/admin/events` → **User Events** for the notification event

---

## Adding a New Event Type

When you add new functionality that should be observable/automatable:

### From TypeScript (API routes)

1. Add the event type to `frontend/types/index.ts`:
   ```typescript
   export type CustomerEventType = ... | 'binder.project_created'
   ```

2. Emit the event using the shared helper:
   ```typescript
   import { emitCustomerEvent, userActor } from '@/lib/events'

   await emitCustomerEvent({
     tenantId: tenant.id,
     eventType: 'binder.project_created',
     userId: session.user.id,
     entityType: 'project',
     entityId: project.id,
     description: `Project created: ${project.name}`,
     actor: userActor(session.user.id, session.user.email),
     refs: { tenant_id: tenant.id },
     payload: {
       project_name: project.name,
       opportunity_id: opp.id,
     },
   })
   ```

3. Add the event type to `pipeline/src/automation/worker.py` → `AutomationCustomerWorker.event_types` list so the automation engine can consume it.

### From Python (pipeline workers)

```python
from events import emit_opportunity_event, pipeline_actor

await emit_opportunity_event(
    conn,
    opportunity_id=str(opp_id),
    event_type="binder.doc_analyzed",
    source="binder_worker",
    actor=pipeline_actor("binder_doc_analyzer"),
    refs={"tenant_id": str(tenant_id)},
    payload={
        "document_name": doc["name"],
        "page_count": doc["pages"],
        "analysis_type": "requirements_extraction",
    },
)
```

### Metadata Payload Convention

Every event's `metadata` field should follow this structure:

```json
{
    "actor":   { "type": "user|pipeline|system", "id": "...", "email": "..." },
    "trigger": { "eventId": "...", "eventType": "..." },
    "refs":    { "tenant_id": "...", "opportunity_id": "...", ... },
    "payload": { ... event-specific data ... }
}
```

The `payload` is what automation conditions evaluate against. Include everything a downstream rule or email template might need.

---

## Adding a New Action Type

1. Add the type to the CHECK constraint in `automation_rules` (new migration):
   ```sql
   ALTER TABLE automation_rules DROP CONSTRAINT automation_rules_action_type_check;
   ALTER TABLE automation_rules ADD CONSTRAINT automation_rules_action_type_check
       CHECK (action_type IN ('emit_event', 'queue_notification', 'queue_job', 'log_only', 'webhook'));
   ```

2. Add the handler in `pipeline/src/automation/actions.py`:
   ```python
   async def _action_webhook(conn, rule, event, context, config, resolve_template):
       url = config.get("url")
       # ... make HTTP request ...
       return {"status_code": response.status, "url": url}
   ```

3. Add the dispatch in `execute_action()`:
   ```python
   elif action_type == "webhook":
       return await _action_webhook(conn, rule, event, context, config, resolve_template)
   ```

---

## Adding a New Event Bus to Automation

Currently `content_events` doesn't have a dequeue function, so automation rules on the `content_events` bus are not processed by the Python workers. To enable:

1. Create a `dequeue_content_events()` function in a new migration, mirroring `dequeue_opportunity_events` from `007_event_bus_and_drive_architecture.sql`.

2. Uncomment / add `AutomationContentWorker` in `pipeline/src/automation/worker.py`.

3. Register it in `pipeline/src/workers/runner.py` under the `"automation"` namespace.

---

## Adding a New Email Template

When a `queue_notification` rule fires, the emailer renders HTML from the `notification_type`. To add a new template:

1. Edit `pipeline/src/workers/emailer.py`

2. Add a renderer in `_generate_notification_html()`:
   ```python
   elif ntype == "high_score":
       return _render_high_score_alert(notification, opp_details)
   ```

3. Create the render function:
   ```python
   def _render_high_score_alert(notification: dict, opp: dict | None) -> str:
       title = _esc(opp.get("title", "Unknown") if opp else "Unknown")
       return f"""
       <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
           <h2>High-Scoring Opportunity</h2>
           <p><strong>{title}</strong> scored above your threshold.</p>
       </div>
       """
   ```

---

## File Reference

| File | Purpose |
|------|---------|
| `db/migrations/017_automation_framework.sql` | Schema + seeded rules |
| `pipeline/src/automation/engine.py` | Rule evaluation, condition matching, caching |
| `pipeline/src/automation/actions.py` | Action handlers (emit, notify, job, log) |
| `pipeline/src/automation/worker.py` | Event bus consumers that feed the engine |
| `pipeline/src/workers/runner.py` | Worker registry (automation workers registered here) |
| `pipeline/src/events.py` | Python event emitter helpers |
| `frontend/lib/events.ts` | TypeScript event emitter helpers |
| `frontend/types/index.ts` | Event type definitions |
| `frontend/app/api/automation/route.ts` | Admin API for rules + log |
| `frontend/app/admin/automation/page.tsx` | Admin UI for monitoring |
| `pipeline/src/workers/emailer.py` | Gmail send + HTML templates |

---

## Debugging

**Rule not firing?**
1. Check `/admin/automation` → Execution Log → look for your rule name
2. If it shows "skipped", the `skip_reason` tells you which condition failed
3. If it doesn't appear at all, the event type isn't in the worker's `event_types` list
4. Force cache refresh: the engine reloads rules every 60 seconds, or restart the worker

**Rule firing too much?**
- Add `cooldown_seconds` or `max_fires_per_hour`
- Use `$first_occurrence` with `$entity_key` for once-per-entity rules

**Template not resolving?**
- Check dotted path matches the metadata structure: `{payload.total_score}` not `{total_score}`
- Missing paths resolve to `?` — check the event metadata in the log's expandable detail panel

**Toggle a rule off immediately:**
- `/admin/automation` → flip the toggle, or:
  ```sql
  UPDATE automation_rules SET enabled = FALSE WHERE name = 'rule_name';
  ```

---

## Current Rules (v1)

| # | Rule | Trigger | Action | Purpose |
|---|------|---------|--------|---------|
| 1 | `login_activity_log` | `account.login` | log | Audit every login |
| 2 | `first_login_welcome` | `account.login` | email | Welcome email, once per user |
| 3 | `profile_update_rescore` | `account.tenant_updated`, `account.profile_updated` | job | Re-score when search params change |
| 4 | `tenant_created_onboarding` | `account.tenant_created` | email | Onboarding email |
| 5 | `ingest_new_monitor` | `ingest.new` | log | Track new opps |
| 6 | `high_score_notify` | `scoring.scored` (>= 75, pursue) | event | Alert tenant of high-score opp |
| 7 | `llm_adjustment_log` | `scoring.llm_adjusted` | log | Track LLM adjustments |
| 8 | `amendment_ensure_email` | `reminder.amendment_alert` | log | Audit amendment alerts |
| 9 | `urgent_nudge_escalation` | `reminder.nudge_sent` (urgent) | log | SLA tracking |
| 10 | `content_publish_log` | `content.published`, `content.rolled_back`, `content.unpublished` | log | CMS change tracking |
| 11 | `drive_archive_notify` | `drive.archived` | log | Drive archival tracking |
| 12 | `user_added_welcome` | `account.user_added` | email | Welcome new team members |
