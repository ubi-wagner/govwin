# Event Namespace & Workflow Automation Contract

**Version:** 2.0
**Date:** 2026-04-29
**Status:** Binding — all code must conform

---

## 1. The Master Event Stream

Every event in the system flows through ONE table: `system_events`.

```sql
system_events (
  id            UUID PRIMARY KEY,
  namespace     TEXT NOT NULL,      -- which domain owns this event
  type          TEXT NOT NULL,      -- entity.verb_past_tense
  phase         TEXT NOT NULL,      -- 'start' | 'end' | 'single'
  actor_type    TEXT NOT NULL,      -- 'user' | 'system' | 'pipeline' | 'agent'
  actor_id      TEXT NOT NULL,      -- user UUID, 'system', worker ID, agent role
  actor_email   TEXT,               -- for user actors
  tenant_id     UUID,               -- NULL for admin/system events
  parent_event_id UUID,             -- links end→start (same operation)
  payload       JSONB NOT NULL,     -- operation-specific data
  created_at    TIMESTAMPTZ         -- auto-set
)
```

There are NO other event tables for new code. The legacy tables
(`opportunity_events`, `customer_events`, `content_events`) exist but
are deprecated — new code writes exclusively to `system_events`.

---

## 2. Namespaces (Closed Set — 7 Total)

| Namespace | Owner | Scope | Admin tenantId | Portal tenantId |
|-----------|-------|-------|----------------|-----------------|
| `finder` | Admin curation | RFP upload, triage, curation, topics, sources, SBIR ingest | `null` | n/a |
| `capture` | Customer lifecycle | Application, subscription, purchase, pin/unpin | `null` (app) | tenant UUID |
| `identity` | Auth only | Login, password change, role change | varies | varies |
| `proposal` | Proposal workspace | Create, section save, comment, stage, lock | n/a | tenant UUID |
| `library` | Content library | Upload, atomize, save atom, delete, bulk ops | n/a | tenant UUID |
| `system` | Infrastructure | Storage, health, errors, capacity, config | `null` | n/a |
| `tool` | Tool invocations | Registry dispatch start/end | varies | varies |

**NEVER create a new namespace without updating this document.**
**NEVER use:** `admin`, `cms`, `spotlight`, `pipeline` as namespaces.

---

## 3. Event Type Naming Convention

Format: `entity.verb_past_tense`

```
Good:  solicitation.claimed, proposal.created, section.saved
       subscription.started, topic.pinned, file.uploaded
       annotation.saved, comment.created, purchase.completed

Bad:   rfp.triage_claimed      (namespace leaking into type)
       admin.storage.uploaded   (double namespace)
       proposal.workspace_locked (noun phrase, not verb)
       manually_uploaded        (adverb clutter)
```

Rules:
- Entity is singular: `solicitation` not `solicitations`
- Verb is past tense: `created` not `create` or `creating`
- Max two segments: `entity.verb` — no `entity.sub.verb`
- Snake_case for multi-word: `review_requested` not `reviewRequested`

---

## 4. Phase: start / end / single

| Phase | When | Use Case |
|-------|------|----------|
| `start` | Before a multi-step operation begins | Enables: stuck detection, duration tracking |
| `end` | After the operation completes (success or failure) | Enables: retry on failure, chain next job |
| `single` | Atomic operations (one INSERT/UPDATE/DELETE) | Simple audit trail |

**Rule:** If a route does more than one DB write or one external call,
use `start`/`end`. If it does exactly one mutation, use `single`.

Start events return an `id`. End events reference it via `parent_event_id`.
Duration is computed automatically: `end.created_at - start.created_at`.

Error shape on failed end events:
```json
{ "error": { "message": "...", "code": "DB_ERROR", "details": {} } }
```

---

## 5. Payload Contract

Every event payload MUST include:

```json
{
  "correlationId": "uuid"
}
```

For `start` events, the payload contains the INPUT:
```json
{ "correlationId": "abc", "solicitationId": "...", "fileCount": 3 }
```

For `end` events, the result contains the OUTPUT:
```json
{ "documentIds": ["..."], "topicsExtracted": 12, "durationMs": 4200 }
```

For `single` events, the payload contains both:
```json
{ "correlationId": "abc", "proposalId": "...", "sectionId": "...", "version": 5 }
```

---

## 6. Canonical Event Registry

### finder namespace
| Type | Phase | Trigger | Payload |
|------|-------|---------|---------|
| `rfp.uploaded` | start/end | Admin uploads RFP | solicitationId, fileCount → documentIds, topicsExtracted |
| `rfp.attached` | start/end | Admin attaches docs to existing sol | solicitationId, fileCount → documentIds |
| `solicitation.claimed` | single | Admin claims for curation | solicitationId |
| `solicitation.released` | single | Admin releases for AI analysis | solicitationId |
| `solicitation.dismissed` | single | Admin dismisses | solicitationId, reason |
| `solicitation.review_requested` | single | Curator requests review | solicitationId, reviewerId |
| `solicitation.approved` | single | Reviewer approves | solicitationId |
| `solicitation.review_rejected` | single | Reviewer rejects | solicitationId, notes |
| `solicitation.pushed` | single | Admin pushes to Spotlight | solicitationId, topicCount |
| `annotation.saved` | single | Admin tags compliance var | solicitationId, variableName |
| `annotation.deleted` | single | Admin removes annotation | annotationId |
| `variable.added` | single | Admin creates compliance var | variableName |
| `compliance_value.saved` | single | Admin saves variable value | solicitationId, variableName |
| `topic.added` | single | Admin adds topic manually | topicId, solicitationId |
| `topic.imported` | start/end | Admin paste-imports topics | solicitationId → importedCount |
| `topic.updated` | single | Admin edits topic | topicId |
| `source.created` | single | Admin adds source profile | sourceId |
| `source.visited` | single | Admin logs a site visit | sourceId, profileId |
| `sbir_data.ingested` | start/end | Admin ingests SBIR CSV | filename → companiesInserted, awardsInserted |
| `ingest.triggered` | single | Admin triggers manual ingest | source, priority |

### capture namespace
| Type | Phase | Trigger | Payload |
|------|-------|---------|---------|
| `application.submitted` | single | Customer applies | email, companyName |
| `application.accepted` | start/end | Admin accepts app | applicationId → tenantId, userId |
| `application.rejected` | single | Admin rejects app | applicationId, reason |
| `application.status_changed` | single | Admin changes status | applicationId, status |
| `subscription.started` | single | Stripe checkout complete | tenantId, productType |
| `subscription.renewed` | single | Stripe invoice paid | tenantId |
| `subscription.canceled` | single | Stripe subscription deleted | tenantId |
| `purchase.completed` | single | Stripe one-time payment | tenantId, proposalId, productType |
| `topic.pinned` | single | Customer pins topic | tenantId, opportunityId |
| `topic.unpinned` | single | Customer unpins topic | tenantId, opportunityId |

### identity namespace
| Type | Phase | Trigger | Payload |
|------|-------|---------|---------|
| `user.password_changed` | start/end | User changes password | userId |
| `user.logged_in` | single | User signs in | userId |

### proposal namespace
| Type | Phase | Trigger | Payload |
|------|-------|---------|---------|
| `proposal.created` | start/end | Customer creates proposal | tenantId, opportunityId → proposalId, sectionCount |
| `section.saved` | single | User saves canvas content | proposalId, sectionId, version |
| `comment.created` | single | User adds comment | proposalId, nodeId |
| `comment.resolved` | single | User resolves comment | commentId |
| `proposal.advanced` | single | Admin advances stage | proposalId, fromStage, toStage |
| `proposal.locked` | single | Admin locks workspace | proposalId |
| `proposal.unlocked` | single | Admin unlocks workspace | proposalId |

### library namespace
| Type | Phase | Trigger | Payload |
|------|-------|---------|---------|
| `file.uploaded` | single | User uploads to library | tenantId, fileCount |
| `document.atomized` | start/end | System atomizes document | tenantId → atomsCreated |
| `atom.saved` | single | System saves library atom | tenantId, unitId |
| `unit.updated` | single | User edits library unit | tenantId, unitId |
| `unit.deleted` | single | User deletes library unit | tenantId, unitId |

### system namespace
| Type | Phase | Trigger | Payload |
|------|-------|---------|---------|
| `file.uploaded` | single | Admin uploads to S3 | key, size |
| `file.deleted` | single | Admin deletes from S3 | key |
| `sbir_data.ingested` | single | Auto-ingest on S3 upload | key, companiesInserted |
| `content.published` | single | Admin publishes CMS content | contentId |
| `content.updated` | single | Admin updates CMS content | contentId |
| `content.deleted` | single | Admin deletes CMS content | contentId |

### tool namespace
| Type | Phase | Trigger | Payload |
|------|-------|---------|---------|
| `{tool.name}` | start/end | Tool registry dispatch | toolName, actor → result/error |

---

## 7. Workflow Automation Architecture

### How Events Become Jobs

```
system_events (DB)
    │
    ├── Frontend emits via emitEventStart/End/Single
    │
    ├── Pipeline event_processor polls for unprocessed events
    │   └── Matches event (namespace, type, phase) against workflow triggers
    │       └── If match: instantiates workflow → creates process_instance
    │
    └── CRM event_listener polls for email/notification triggers
        └── Matches event against automation_rules
            └── If match: sends email or creates notification
```

### Workflow Definition Structure

Each workflow is a Python file in `pipeline/src/workflows/`. It defines:
- **trigger** — which event (namespace + type + phase) starts it
- **steps** — ordered actions with dependencies, timeouts, retries
- **actor_filter** — optional: only trigger for certain actor types

```python
# pipeline/src/workflows/on_rfp_uploaded.py

from workflows.base import Workflow, Step, EventTrigger

class OnRfpUploaded(Workflow):
    """After RFP upload completes, shred the document and notify admin."""

    trigger = EventTrigger(
        namespace='finder',
        type='rfp.uploaded',
        phase='end',
        condition=lambda payload: payload.get('error') is None,
    )

    steps = [
        Step(
            name='shred_document',
            action='pipeline.shredder.shred',
            input_map={'solicitation_id': 'payload.solicitationId'},
            timeout_minutes=10,
            retry_count=3,
            retry_delay_seconds=30,
        ),
        Step(
            name='extract_compliance',
            action='pipeline.shredder.extract_compliance',
            depends_on='shred_document',
            input_map={'solicitation_id': 'payload.solicitationId'},
            timeout_minutes=5,
        ),
        Step(
            name='notify_curator',
            action='system.notify',
            depends_on='extract_compliance',
            input_map={
                'channel': '"email"',
                'to_role': '"rfp_admin"',
                'template': '"rfp_ready_for_curation"',
            },
        ),
    ]
```

### Step Types

| Type | Description | Actor |
|------|-------------|-------|
| `action` | Call a registered pipeline function | `system` or `pipeline` |
| `api_call` | POST to a frontend API route | `system` |
| `ai_invoke` | Call Claude via the tool registry | `agent` |
| `hitl_wait` | Pause until a human takes an action | `user` (when they act) |
| `notify` | Send email/notification | `system` |
| `condition` | Branch based on payload data | n/a |

### HITL Wait Steps

A HITL step pauses the workflow until a specific event arrives:

```python
Step(
    name='wait_for_curation',
    action='hitl_wait',
    wait_for=EventTrigger(
        namespace='finder',
        type='solicitation.approved',
        condition=lambda p: p.get('solicitationId') == '{solicitationId}',
    ),
    timeout_hours=48,
    on_timeout='notify_admin_escalation',
)
```

### Process Instance (Runtime State)

```sql
process_instances (
  id              UUID PRIMARY KEY,
  workflow_name   TEXT NOT NULL,
  trigger_event_id UUID NOT NULL REFERENCES system_events(id),
  correlation_id  TEXT NOT NULL,
  current_step    TEXT,
  status          TEXT NOT NULL DEFAULT 'running',
  step_results    JSONB DEFAULT '{}',
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  deadline        TIMESTAMPTZ,
  retry_count     INT DEFAULT 0,
  tenant_id       UUID,
  created_at      TIMESTAMPTZ DEFAULT now()
)
```

---

## 8. Extending the Event Registry

To add a new event type:

1. Add it to the registry table in §6 above
2. Emit it using `emitEventSingle` or `emitEventStart`/`emitEventEnd`
3. If it should trigger automation, create a workflow in
   `pipeline/src/workflows/`
4. Update CLAUDE_CLIFFNOTES.md §3 if namespace rules change

To add a new workflow:

1. Create `pipeline/src/workflows/on_{trigger_type}.py`
2. Define the class extending `Workflow`
3. Set the trigger (namespace + type + phase + optional condition)
4. Define steps with dependencies, timeouts, retries
5. The event processor auto-discovers workflow files on boot

---

## 9. Event Processing Rules

1. **Idempotency:** Processors must handle duplicate events.
   Use event `id` as a dedup key.

2. **Ordering:** Events within a correlation chain are ordered by
   `created_at`. Cross-chain ordering is NOT guaranteed.

3. **Failure isolation:** A failed workflow step does NOT prevent
   other workflows from processing the same trigger.

4. **Retry semantics:** Retries re-execute the failed step only,
   not the entire workflow. Same input payload.

5. **Timeout escalation:** HITL waits that timeout fire the
   `on_timeout` action (notification). Workflow stays in `waiting`
   until the human acts or admin cancels.
