# Automation Workflows Reference

Complete reference for the event-driven workflow automation system. This is the authoritative document for understanding how workflows are defined, triggered, executed, persisted, and monitored.

**Last updated:** 2026-05-22

---

## 1. Architecture Overview

### How Workflows Work

The workflow system is event-driven. Every significant action in the platform emits a row into the `system_events` table. The workflow processor polls that table, matches events against registered workflow triggers, and executes the matched workflow's steps sequentially.

```
  system_events row created
         |
         v
  Processor polls (every 10s)
         |
         v
  Match trigger (namespace + type + phase + condition)
         |
         v
  Create process_instance (persistent state)
         |
         v
  Execute steps in topological order
  (ACTION -> AI_INVOKE -> NOTIFY -> HITL_WAIT -> ...)
         |
         v
  Emit lifecycle events (started, step_completed, completed)
```

**Key design decisions:**

- Workflows are **declarative** -- Python classes define triggers and steps; the processor drives execution
- Steps execute **sequentially** respecting `depends_on` (parallel execution is V2)
- The processor **skips** `namespace='system'` events to avoid self-triggering loops
- Each poll fetches up to **100 events** ordered by `created_at ASC`
- **Duplicate detection**: in-memory set of processed event IDs (capped at 50,000 entries)

### WorkflowManager (Persistent State)

Every workflow execution is persisted as a row in the `process_instances` table (migration 043):

- **Instance creation**: When a trigger matches, a `process_instances` row is created with `status='pending'`
- **Step tracking**: `step_results` (JSONB) accumulates results; `step_status` tracks per-step state
- **Heartbeat monitoring**: Running instances update `last_heartbeat_at` every 30 seconds. Instances with no heartbeat for 5 minutes are flagged as stuck.
- **Crash recovery**: On restart, the processor can resume from the last completed step using `current_step_index`
- **Admin actions**: Retry (creates new instance with `recovered_from` pointing to failed instance), cancel, force-complete
- **Audit trail**: Every status change is logged in `process_instance_transitions` with actor, reason, and metadata

### Two Execution Contexts

| Context | Source | Workflows | Description |
|---------|--------|-----------|-------------|
| **Pipeline** (RFP Admin) | `pipeline` | OnRfpUploaded, OnSolicitationPushed, OnSourceChangeDetected | Admin-initiated: document processing, curation, scoring |
| **Customer Portal** | `pipeline` | OnProposalCreated, OnProposalAdvancedToPinkTeam, OnProposalAdvancedToFinal | Customer-initiated: proposal lifecycle |
| **CMS** (Email/Content) | `cms` | Automation rules (welcome emails, drip campaigns, social distribution) | Event-reactive: notifications, onboarding, content distribution |

The Pipeline and Portal workflows run inside the pipeline service (`pipeline/src/workflows/processor.py`). CMS automation rules run inside the CMS service (`services/cms/src/event_listener.py`). Both poll `system_events` independently.

### Step Types

| Type | V1 Status | Behavior |
|------|-----------|----------|
| `ACTION` | Implemented | Calls a Python function via dotted import path |
| `AI_INVOKE` | Partial | Falls back to ACTION resolution; skips if not resolvable |
| `HITL_WAIT` | Logged + skipped | Pauses workflow; no persistence in V1 (process_instances enables V2) |
| `NOTIFY` | Implemented | Emits `system:notification.requested` event for CMS delivery |
| `CONDITION` | Implemented | Evaluates a callable; skips step (and dependents) if false |
| `API_CALL` | Logged + skipped | HTTP call to external/internal API; not implemented in V1 |

---

## 2. All Workflows

### 2.1 OnRfpUploaded

**File:** `pipeline/src/workflows/on_rfp_uploaded.py`
**Trigger:** `finder:rfp.uploaded:end` where `payload.error is None`
**Description:** When an RFP document is uploaded by an admin, shred it into sections, extract compliance variables, and notify the curator that it is ready for review.

| # | Step | Type | Action | Timeout | Retries | Delay | Depends On | On Failure |
|---|------|------|--------|---------|---------|-------|------------|------------|
| 1 | `shred_document` | ACTION | `pipeline.shredder.shred` | 10 min | 3 | 30s (exponential: 30s, 60s, 120s) | -- | Log error, continue to next step |
| 2 | `extract_compliance` | ACTION | `pipeline.shredder.extract_compliance` | 5 min | 1 | 60s | `shred_document` | Log error, continue to notify |
| 3 | `notify_curator` | NOTIFY | `system.notify` | 30 min | 0 | -- | `extract_compliance` | Log warning |

**Input map:**

| Step | Input Key | Source |
|------|-----------|--------|
| `shred_document` | `solicitation_id` | `payload.solicitationId` |
| `shred_document` | `document_ids` | `payload.documentIds` |
| `extract_compliance` | `solicitation_id` | `payload.solicitationId` |
| `notify_curator` | `channel` | `"email"` (literal) |
| `notify_curator` | `to_role` | `"rfp_admin"` (literal) |
| `notify_curator` | `template` | `"rfp_ready_for_curation"` (literal) |
| `notify_curator` | `solicitation_id` | `payload.solicitationId` |

**HITL Gates:** None (fully automated pipeline)

**Idempotent:** Yes -- shredder checks if `ai_extracted` already exists for the solicitation and skips re-processing. Compliance extraction upserts rather than inserts.

**Events Emitted:**
- `system:workflow.started` (1x)
- `system:workflow.step_completed` (up to 3x)
- `system:workflow.step_failed` (on step failure)
- `system:workflow.completed` (1x)
- `system:notification.requested` (from notify_curator step)

**Cost:** ~50K-200K AI tokens per document (Claude for text extraction, structure parsing, compliance extraction). 2-10 minutes compute.

**Instance Context:** Admin Pipeline -- fires when rfp_admin uploads via `/admin/rfp-upload`

---

### 2.2 OnSolicitationPushed

**File:** `pipeline/src/workflows/on_solicitation_pushed.py`
**Trigger:** `finder:solicitation.pushed:single` (no condition)
**Description:** After an admin pushes a curated solicitation to Spotlight, score it against all tenants and notify matching customers.

| # | Step | Type | Action | Timeout | Retries | Delay | Depends On | On Failure |
|---|------|------|--------|---------|---------|-------|------------|------------|
| 1 | `find_matching_tenants` | ACTION | `pipeline.scoring.match_tenants` | 5 min | 0 | -- | -- | Log error, skip notification |
| 2 | `send_spotlight_digest` | NOTIFY | `system.notify` | 30 min | 0 | -- | `find_matching_tenants` | Log error |

**Input map:**

| Step | Input Key | Source |
|------|-----------|--------|
| `find_matching_tenants` | `solicitation_id` | `payload.solicitationId` |
| `find_matching_tenants` | `topic_count` | `payload.topicCount` |
| `send_spotlight_digest` | `channel` | `"email"` (literal) |
| `send_spotlight_digest` | `template` | `"spotlight_new_topics"` (literal) |
| `send_spotlight_digest` | `tenant_ids` | `step.find_matching_tenants.result.tenantIds` |

**Scoring algorithm** (max 100 points):

| Factor | Max Points | Method |
|--------|-----------|--------|
| NAICS overlap | 30 | Set intersection of sol vs. profile NAICS codes |
| Keyword/tech focus | 25 | Match sol tech_focus_areas against profile keywords, technology_focus, research_areas |
| Agency preference | 20 | Exact match of sol agency against profile agency_priorities + target_agencies |
| Set-aside match | 10 | Exact match of sol set_aside_type against profile set_aside_types |
| Program type | 10 | Not implemented (no profile data yet) |
| Timeline proximity | 5 | 0-30 days: 5pts, 31-60 days: 3pts, 61-90 days: 1pt |

Notification threshold: tenants scoring >= 50 receive email. Tenants below their configured `min_surface_score` (default 40) are excluded entirely.

**HITL Gates:** None

**Idempotent:** Yes -- `tenant_pipeline_items` uses `ON CONFLICT (tenant_id, opportunity_id) DO UPDATE`

**Cost:** 0 AI tokens (scoring is algorithmic). 1-30 seconds compute.

**Instance Context:** Admin Pipeline -- fires when rfp_admin pushes from curation workspace

---

### 2.3 OnSourceChangeDetected

**File:** `pipeline/src/workflows/on_source_change_detected.py`
**Trigger:** `finder:source.change_detected:single` where `payload.meaningfulChanges > 0`
**Description:** When Source Scout detects meaningful changes on a monitored government website, create draft solicitations and notify the RFP admin for review.

| # | Step | Type | Action | Timeout | Retries | Delay | Depends On | On Failure |
|---|------|------|--------|---------|---------|-------|------------|------------|
| 1 | `create_draft_solicitations` | ACTION | `finder.create_drafts_from_scout` | 10 min | 0 | -- | -- | Log error, still notify |
| 2 | `notify_rfp_admin` | NOTIFY | `system.notify` | 30 min | 0 | -- | `create_draft_solicitations` | Log error |
| 3 | `wait_for_admin_review` | HITL_WAIT | `hitl.wait` | 1440 min (24h) | 0 | -- | `notify_rfp_admin` | Re-notify admin (V2) |

**Input map:**

| Step | Input Key | Source |
|------|-----------|--------|
| `create_draft_solicitations` | `source_id` | `payload.sourceId` |
| `create_draft_solicitations` | `source_name` | `payload.sourceName` |
| `create_draft_solicitations` | `region_results` | `payload.regionResults` |
| `notify_rfp_admin` | `channel` | `"email"` (literal) |
| `notify_rfp_admin` | `template` | `"source_scout_changes"` (literal) |
| `notify_rfp_admin` | `source_name` | `payload.sourceName` |
| `notify_rfp_admin` | `meaningful_changes` | `payload.meaningfulChanges` |
| `notify_rfp_admin` | `drafts_created` | `step.create_draft_solicitations.result.draftsCreated` |

**HITL Gates:**
- Step 3 (`wait_for_admin_review`): Admin must review draft solicitations in the triage queue
- **Resume event:** `finder:source.changes_reviewed:single`
- **Timeout:** 24 hours, then re-notify rfp_admin (not implemented in V1)

**Idempotent:** Yes -- dedup by title+agency prevents duplicate opportunity creation

**Cost:** 0 AI tokens. 1-60 seconds compute.

**Instance Context:** Admin Pipeline -- fires when Source Scout worker detects changes

---

### 2.4 OnApplicationAccepted

**File:** `pipeline/src/workflows/on_application_accepted.py`
**Trigger:** `capture:application.accepted:end` where `payload.error is None`
**Description:** After an admin accepts a customer application, send a welcome email, create default library categories, and schedule a login reminder.

| # | Step | Type | Action | Timeout | Retries | Delay | Depends On | On Failure |
|---|------|------|--------|---------|---------|-------|------------|------------|
| 1 | `send_welcome_email` | NOTIFY | `system.notify` | 30 min | 0 | -- | -- | Log error, continue to library |
| 2 | `create_library_defaults` | ACTION | `pipeline.library.create_default_categories` | 2 min | 0 | -- | `send_welcome_email` | Log error, tenant usable without categories |
| 3 | `schedule_login_reminder` | HITL_WAIT | `hitl_wait` | 2880 min (48h) | 0 | -- | `create_library_defaults` | Send login reminder (V2) |

**Input map:**

| Step | Input Key | Source |
|------|-----------|--------|
| `send_welcome_email` | `channel` | `"email"` (literal) |
| `send_welcome_email` | `template` | `"welcome_accepted"` (literal) |
| `send_welcome_email` | `tenant_id` | `result.tenantId` |
| `send_welcome_email` | `user_id` | `result.userId` |
| `create_library_defaults` | `tenant_id` | `result.tenantId` |

**Default library categories created** (8 total):

1. Technical Approach
2. Past Performance
3. Key Personnel
4. Management Plan
5. Cost & Pricing
6. Company Overview
7. Certifications & Compliance
8. Commercialization

Each is a seed `library_units` row (source_type=`ai`, status=`approved`) acting as a category marker.

**HITL Gates:**
- Step 3 (`schedule_login_reminder`): Waits for new tenant_admin to log in
- **Resume event:** `identity:user.logged_in:single`
- **Timeout:** 48 hours, then send login reminder email (not implemented in V1)

**Idempotent:** Yes -- `create_default_categories` checks for existing categories per tenant

**Cost:** 0 AI tokens. < 5 seconds compute.

**Instance Context:** CMS/Onboarding -- fires when rfp_admin accepts an application via `/admin/applications/[id]/accept`

---

### 2.5 OnProposalCreated

**File:** `pipeline/src/workflows/on_proposal_created.py`
**Trigger:** `proposal:proposal.created:end` where `payload.error is None`
**Description:** After a customer creates a proposal workspace, invoke the AI drafting agent to generate initial content for all empty sections, then notify the customer.

| # | Step | Type | Action | Timeout | Retries | Delay | Depends On | On Failure |
|---|------|------|--------|---------|---------|-------|------------|------------|
| 1 | `draft_sections` | AI_INVOKE | `tool.proposal.draft_all_sections` | 15 min | 1 | 60s | -- | Continue to notify (workspace ready without AI content) |
| 2 | `notify_customer` | NOTIFY | `system.notify` | 30 min | 0 | -- | `draft_sections` | Log error, customer can access workspace directly |

**Input map:**

| Step | Input Key | Source |
|------|-----------|--------|
| `draft_sections` | `proposal_id` | `payload.proposalId` |
| `draft_sections` | `tenant_id` | `payload.tenantId` |
| `notify_customer` | `channel` | `"email"` (literal) |
| `notify_customer` | `template` | `"proposal_workspace_ready"` (literal) |
| `notify_customer` | `tenant_id` | `payload.tenantId` |
| `notify_customer` | `proposal_id` | `payload.proposalId` |

**HITL Gates:** None

**Idempotent:** Partial -- AI drafting checks for existing section content and only drafts empty sections, but re-runs may produce different content.

**Cost:** ~20K-100K AI tokens per proposal (skipped in V1 if tool not resolvable locally). 2-15 minutes for AI drafting.

**Instance Context:** Customer Portal -- fires when tenant_admin creates a proposal

---

### 2.6 OnProposalAdvancedToPinkTeam

**File:** `pipeline/src/workflows/on_proposal_advanced.py`
**Trigger:** `proposal:proposal.advanced:single` where `payload.toStage == "pink_team"`
**Description:** When a proposal advances to pink team review, run an AI compliance review and notify designated reviewers.

| # | Step | Type | Action | Timeout | Retries | Delay | Depends On | On Failure |
|---|------|------|--------|---------|---------|-------|------------|------------|
| 1 | `ai_compliance_review` | AI_INVOKE | `tool.proposal.check_compliance` | 10 min | 0 | -- | -- | Reviewers notified for manual review |
| 2 | `notify_reviewers` | NOTIFY | `system.notify` | 30 min | 0 | -- | `ai_compliance_review` | Reviewers see proposal in review queue |
| 3 | `wait_for_review` | HITL_WAIT | `hitl_wait` | 4320 min (72h) | 0 | -- | `notify_reviewers` | Send review reminder (V2) |

**Input map:**

| Step | Input Key | Source |
|------|-----------|--------|
| `ai_compliance_review` | `proposal_id` | `payload.proposalId` |
| `notify_reviewers` | `channel` | `"email"` (literal) |
| `notify_reviewers` | `template` | `"pink_team_review_ready"` (literal) |
| `notify_reviewers` | `proposal_id` | `payload.proposalId` |

**HITL Gates:**
- Step 3 (`wait_for_review`): Reviewer must complete pink team review and advance proposal
- **Resume event:** `proposal:proposal.advanced:single` where `payload.fromStage == "pink_team"`
- **Timeout:** 72 hours, then send review reminder (not implemented in V1)

**Idempotent:** Partial -- AI review may produce different results on re-run

**Cost:** ~10K-50K AI tokens (skipped in V1). Seconds for notification.

**Instance Context:** Customer Portal -- fires when tenant_admin advances proposal to pink_team

---

### 2.7 OnProposalAdvancedToFinal

**File:** `pipeline/src/workflows/on_proposal_advanced.py`
**Trigger:** `proposal:proposal.advanced:single` where `payload.toStage == "final"`
**Description:** When a proposal advances to the final stage, generate an export preview ZIP and notify all collaborators.

| # | Step | Type | Action | Timeout | Retries | Delay | Depends On | On Failure |
|---|------|------|--------|---------|---------|-------|------------|------------|
| 1 | `generate_export_preview` | ACTION | `pipeline.export.generate_preview` | 15 min | 0 | -- | -- | Notify without preview link |
| 2 | `notify_all_collaborators` | NOTIFY | `system.notify` | 30 min | 0 | -- | `generate_export_preview` | Collaborators see final status in portal |

**Input map:**

| Step | Input Key | Source |
|------|-----------|--------|
| `generate_export_preview` | `proposal_id` | `payload.proposalId` |
| `notify_all_collaborators` | `channel` | `"email"` (literal) |
| `notify_all_collaborators` | `template` | `"proposal_final_ready"` (literal) |
| `notify_all_collaborators` | `proposal_id` | `payload.proposalId` |

**HITL Gates:** None

**Idempotent:** Yes -- preview generation overwrites existing preview at the same S3 key

**Cost:** 0 AI tokens. 5-30 seconds compute for ZIP generation.

**Instance Context:** Customer Portal -- fires when tenant_admin advances proposal to final

---

## 3. Workflow Actions

### 3.1 shred.py

**File:** `pipeline/src/workflows/actions/shred.py`
**Functions:** `shred()`, `extract_compliance()`

#### shred()

**What it does:** Wrapper around `shredder.runner.shred_solicitation`. Validates the solicitation_id, instantiates an Anthropic client, and delegates to the shredder runner which extracts text, structure, and embeddings from uploaded RFP documents via Claude.

**Inputs:**
- `solicitation_id: str` -- `curated_solicitations.id` (UUID)
- `document_ids: Optional[list[str]]` -- specific document IDs to shred (None = all linked documents)

**Outputs:**
```python
{
    "status": "completed" | "shredder_failed",
    "reason": "...",                    # on failure
    "sections_extracted": 12,           # on success
    "token_usage": {"input": N, "output": M},  # on success
}
```

**Error handling:**
- Invalid UUID: returns `status="shredder_failed"`, `reason="invalid_solicitation_id"`
- Missing Anthropic SDK: returns `status="shredder_failed"`, `reason="anthropic_sdk_not_installed"`
- Missing API key: SDK fails on first call, caught by runner
- `ShredderBudgetError`: intentionally NOT caught -- propagates to processor as step failure

**AI cost:** ~50K-200K tokens per document

#### extract_compliance()

**What it does:** Re-runs compliance variable extraction on already-shredded solicitation data. Reads `ai_extracted.sections` from `curated_solicitations`, then attempts Claude-based extraction against the master variable list from `compliance_variables`. Falls back to pattern-based extraction if Anthropic SDK is unavailable.

**Inputs:**
- `solicitation_id: str` -- `curated_solicitations.id` (UUID)

**Outputs:**
```python
{
    "status": "completed" | "skipped",
    "reason": "...",                      # if skipped
    "compliance_matches": 5,
    "extraction_method": "claude" | "pattern_based",
    "column_updates": 3,                  # Claude method
    "custom_variables": 2,                # Claude method
}
```

**Pattern-based extraction detects:** page limits, font requirements, submission deadlines, margin requirements, line spacing requirements.

**Error handling:** Per-section extraction errors logged and skipped; remaining sections continue processing.

---

### 3.2 score_tenants.py

**File:** `pipeline/src/workflows/actions/score_tenants.py`
**Function:** `match_tenants()`

**What it does:** Scores a newly pushed solicitation against all tenants with active subscriptions. Computes a multi-factor match score, upserts `tenant_pipeline_items` rows, and returns tenant IDs above the notification threshold.

**Inputs:**
- `solicitation_id: str` -- `curated_solicitations.id` (UUID)
- `topic_count: Optional[int]` -- informational only

**Outputs:**
```python
{
    "tenantIds": ["uuid1", "uuid2"],   # tenants scoring >= 50
    "tenantsScored": 5,                 # above min_surface_score
    "tenantsNotified": 2,               # above notification threshold
    "avgScore": 73.5,
}
```

**Error handling:** Per-tenant scoring failures are caught and logged; one tenant's failure does not block scoring for others. Errors counted and logged as a warning at the end.

**AI cost:** 0 (scoring is algorithmic)

---

### 3.3 create_drafts_from_scout.py

**File:** `pipeline/src/workflows/actions/create_drafts_from_scout.py`
**Function:** `create_drafts_from_scout()`

**What it does:** Parses Source Scout region results and creates draft `curated_solicitations` rows for admin review. Deduplicates by title+agency against existing `opportunities`.

**Inputs:**
- `source_id: str` -- `source_profiles.id` (UUID)
- `source_name: Optional[str]` -- human-readable source name
- `region_results: Optional[list[dict]]` -- dicts from scout worker containing `region_id`, `region_name`, `content_hash`, `extracted_text`, `opportunities`

**Outputs:**
```python
{
    "draftsCreated": 3,
    "draftsUpdated": 0,
    "duplicatesSkipped": 2,
    "sourceId": "uuid",
    "sourceName": "Air Force CSO Portal",
}
```

**Error handling:** Per-opportunity DB errors caught and logged; continues with remaining opportunities. Empty titles are skipped. Close date parse errors result in `close_date=None`.

**AI cost:** 0

---

### 3.4 create_library_defaults.py

**File:** `pipeline/src/workflows/actions/create_library_defaults.py`
**Function:** `create_default_categories()`

**What it does:** Creates 8 default library categories for a newly accepted tenant. Inserts seed `library_units` rows (source_type=`ai`, status=`approved`) as category markers.

**Inputs:**
- `tenant_id: str` -- `tenants.id` (UUID)

**Outputs:**
```python
{
    "categoriesCreated": 6,
    "categoriesSkipped": 2,    # already existed
}
```

**Error handling:** Per-category INSERT failure caught and logged; continues with remaining categories. Returns `status="skipped"` if tenant not found.

**AI cost:** 0

---

### 3.5 generate_preview.py

**File:** `pipeline/src/workflows/actions/generate_preview.py`
**Function:** `generate_preview()`

**What it does:** Generates a preview document for a proposal entering the final stage. Fetches all proposal sections, extracts readable markdown from canvas JSON content, bundles into a ZIP, and uploads to S3 at `customers/{slug}/proposal-export/{proposalId}/preview.zip`.

**Inputs:**
- `proposal_id: str` -- `proposals.id` (UUID)

**Outputs:**
```python
{
    "previewUrl": "customers/acme/proposal-export/.../preview.zip",  # or None
    "sectionsExported": 5,
    "totalBytes": 123456,
}
```

**Error handling:**
- Proposal not found: returns `status="skipped"`
- No sections: returns `status="skipped"`
- Canvas JSON parse failure: falls back to raw content per section
- S3 upload failure: caught and logged; returns `previewUrl=None`
- Storage module unavailable: ZIP generated in memory but not uploaded

**AI cost:** 0

---

### 3.6 extract_compliance (see 3.1)

The `extract_compliance` function lives in `shred.py` alongside `shred()`. See section 3.1 above for full documentation.

---

## 4. Step Types

### 4.1 ACTION

Calls a Python function via a dotted import path (e.g., `pipeline.shredder.shred`).

**Resolution:** The processor splits the action string at the last `.` into `(module_path, function_name)`, imports the module via `importlib.import_module()`, and calls `getattr(mod, func_name)`.

**Signature:** `async def action(conn: asyncpg.Connection, **kwargs) -> dict[str, Any]`

**Input resolution:** Step `input_map` entries are resolved using dot-notation against the trigger event payload and prior step results:
- `payload.<key>` -- reads from trigger event payload
- `result.<key>` -- alias for payload (end events store results in payload)
- `step.<name>.result.<key>` -- reads from a prior step's result dict
- `"<literal>"` -- quoted string literal (quotes stripped)

**Retry:** Configurable `retry_count` and `retry_delay_seconds`. Uses exponential backoff: delay = `retry_delay_seconds * (2 ^ attempt)`.

**Timeout:** Enforced via `asyncio.wait_for(step, timeout=timeout_minutes * 60)`. TimeoutError triggers retry if attempts remain.

### 4.2 AI_INVOKE

Invokes an AI agent tool action. In V1, falls back to ACTION resolution -- attempts to import and call the action as a Python function. If the function cannot be found locally, the step is skipped with `reason="ai_invoke_v1"`.

**V2 plan:** Will invoke agent archetypes via the AgentFabric with token budget and model selection. Tool-use loop handling for multi-turn agent conversations.

### 4.3 HITL_WAIT

Pauses the workflow and waits for a specific resume event.

**V1 behavior:** Logged and skipped (`result=None, skipped=True, reason="hitl_wait_v1"`). Steps depending on a HITL_WAIT step are also skipped with `reason="dependency_hitl_wait"`.

**V2 behavior (with process_instances):**
1. Workflow status set to `paused` in `process_instances`
2. State persisted: `current_step`, `step_results`, `step_status`
3. `wait_for` EventTrigger defines the resume condition
4. `timeout_minutes` defines how long to wait before `on_timeout` fires
5. `on_timeout` can be: a step name to re-execute, a notification, or an escalation

**Configuration:**
- `wait_for: EventTrigger` -- required; defines which event resumes the workflow
- `timeout_minutes: int` -- how long to wait (default 30)
- `on_timeout: Optional[str]` -- step name or action to execute on timeout

### 4.4 NOTIFY

Emits a `system:notification.requested` event into `system_events`. The CMS event_listener polls for these events and delivers email via the Gmail API.

**Payload fields:**
- `channel` -- delivery channel (only `"email"` in V1)
- `template` -- template name (e.g., `"welcome_accepted"`, `"rfp_ready_for_curation"`)
- `tenant_id`, `user_id`, `to_role` -- recipient identifiers
- Additional context fields forwarded as template variables
- `trigger_event_id` -- for downstream dedup

**Returns:** `{"result": {"notified": True/False, "channel": "email", "template": "..."}}`

### 4.5 CONDITION

Evaluates a callable against the resolved step inputs. If the condition returns false, the step is skipped with `reason="condition_false"`.

**Configuration:**
- `condition: Callable[[dict], bool]` -- function receiving resolved inputs dict
- Supports equals, contains, exists checks via the callable
- Downstream steps depending on a false condition still execute (they just get None from this step)

### 4.6 API_CALL

HTTP call to an external or internal API. Not implemented in V1 -- logged and skipped.

**V2 plan:** Will support configurable HTTP method, URL, headers, body template, and response parsing. Response becomes the step result for downstream resolution.

---

## 5. Process Instance Lifecycle

### State Machine

```
pending ──> running ──> completed
                   ├──> failed ──> retrying ──> running ──> ...
                   └──> cancelled
        ──> paused ──> running (on HITL resume)
                  └──> cancelled
```

| Status | Meaning |
|--------|---------|
| `pending` | Instance created, not yet started |
| `running` | Actively executing steps |
| `paused` | Waiting at a HITL_WAIT step |
| `completed` | All steps finished |
| `failed` | A step failed fatally or max retries exhausted |
| `cancelled` | Admin cancelled the instance |
| `retrying` | Failed instance being retried |

### Crash Recovery

1. Process crashes mid-execution
2. `last_heartbeat_at` stops updating (no update for 5 minutes)
3. Monitoring cron detects stuck instance (running + heartbeat stale)
4. Instance marked as `failed` with `last_error="stuck_detected"`
5. Admin retries via dashboard:
   - New `process_instances` row created with `recovered_from` = failed instance ID
   - New instance status set to `retrying`, then `running`
   - Reads `step_status` from failed instance
   - Skips steps with status `completed` or `skipped`
   - Resumes from the first `pending` or `failed` step
6. Transition logged in `process_instance_transitions` with `actor='admin:{email}'`

### Audit Trail

Every status change is recorded in `process_instance_transitions`:

| Column | Description |
|--------|-------------|
| `instance_id` | FK to `process_instances.id` |
| `from_status` | Previous status (NULL for initial creation) |
| `to_status` | New status |
| `step_name` | Which step caused the transition (if applicable) |
| `actor` | Who caused it: `'system'`, `'admin:{email}'`, `'cron'` |
| `reason` | Human-readable reason code |
| `metadata` | Additional JSONB context (error details, duration, etc.) |
| `created_at` | Timestamp of the transition |

---

## 6. CMS Automation Rules

The CMS event_listener (`services/cms/src/event_listener.py`) polls `system_events` every 10 seconds and matches against active rows in `automation_rules`. Multiple rules can match the same event. A 5-minute dedup window via `automation_log` prevents double-processing.

### Active Rules (from migration 028)

| # | Name | Trigger | Action Type | Config |
|---|------|---------|-------------|--------|
| 1 | Welcome new customer | `capture:application.accepted` | `send_email` | template=`welcome_accepted`, to_field=`result.userId` |
| 2 | Proposal workspace ready | `proposal:proposal.created` | `send_email` | template=`proposal_workspace_ready`, to_field=`payload.tenantId` |
| 3 | New RFP ready for curation | `finder:rfp.uploaded` | `notify_admin` | template=`new_rfp_uploaded`, include_payload=true |
| 4 | Source change detected | `finder:source.change_detected` | `notify_admin` | template=`source_change_detected`, include_payload=true |
| 5 | Proposal stage advanced | `proposal:proposal.advanced` | `send_email` | template=`stage_advanced`, to_field=`payload.tenantId` |
| 6 | Topic pinned by customer | `capture:topic.pinned` | `notify_admin` | template=`admin_notification`, include_payload=true |

### Additional Rules (from migration 040)

| # | Name | Trigger | Action Type | Config |
|---|------|---------|-------------|--------|
| 7 | Auto-todo on application | `capture:application.submitted` | `create_todo` | title_template=`Review application from {company_name}`, priority=`high` |
| 8 | Social distribute on publish | `system:content.published` | `distribute_social` | platforms=`["linkedin"]` |
| 9 | Auto-todo on source change | `finder:source.change_detected` | `create_todo` | title_template=`Review scout changes: {source_name}`, priority=`medium` |
| 10 | Publish CMS content to site | `system:content_pipeline.post.publish` | `publish_content` | content_type=`blog_post` |

### Action Types

| Action Type | Handler | Description |
|-------------|---------|-------------|
| `send_email` | `_action_send_email` | Render template, resolve recipient (UUID lookup to email), send via Gmail API |
| `notify_admin` | `_action_notify_admin` | Render template, send to admin email with `[RFP Admin]` prefix |
| `create_todo` | `_action_create_todo` | Create `admin_todos` row in CMS DB |
| `enroll_drip` | `_action_enroll_drip` | Enroll recipient in a drip campaign sequence |
| `distribute_social` | `_action_distribute_social` | Schedule social media posts for active accounts |
| `publish_content` | `_action_publish_content` | Push CMS post to main DB `cms_content` table |

---

## 7. How to Build a New Workflow

### Step-by-step

1. **Create file** in `pipeline/src/workflows/` named `on_<trigger_description>.py`

2. **Define trigger** matching the event that should start the workflow:
   - `namespace`: one of `finder`, `capture`, `identity`, `proposal`, `library`, `system`, `tool`
   - `type`: `entity.verb_past_tense` (snake_case)
   - `phase`: `"single"` for standalone events, `"end"` for paired start/end events
   - `condition`: optional lambda on payload dict for filtering

3. **Define steps** with dependencies:
   - Each step has a unique `name`
   - Use `depends_on` to create execution order
   - Map inputs from event payload or prior step results

4. **Implement action functions** in `pipeline/src/workflows/actions/`

5. **Register** -- automatic! `discover_workflows()` auto-imports all modules in the `workflows` package at boot time. No explicit registration needed.

6. **Test** with golden fixture events by inserting a matching `system_events` row

### Template

```python
"""
Workflow: OnNewEvent
Trigger: namespace:entity.verb_past_tense:phase
Purpose: What this workflow does and why
"""
from workflows.base import Workflow, Step, StepType, EventTrigger


class OnNewEvent(Workflow):
    description = "Short description of what this workflow does"

    trigger = EventTrigger(
        namespace="finder",
        type="entity.verb_past_tense",
        phase="single",
        condition=lambda p: p.get("someField") is not None,  # optional
    )

    steps = [
        Step(
            name="do_work",
            action="module.path.function_name",
            input_map={
                "entity_id": "payload.entityId",
                "context": "payload.context",
            },
            timeout_minutes=10,
            retry_count=2,
            retry_delay_seconds=60,
        ),
        Step(
            name="notify_someone",
            step_type=StepType.NOTIFY,
            action="system.notify",
            depends_on="do_work",
            input_map={
                "channel": '"email"',
                "template": '"template_name"',
                "result_data": "step.do_work.result.someKey",
            },
        ),
    ]
```

### Validation

`Workflow.validate()` checks for:
- Missing or None trigger
- Empty steps list
- Broken `depends_on` references (step name not found)
- `HITL_WAIT` steps without `wait_for` trigger
- Validation runs at registration time; invalid workflows are rejected with logged errors

---

## 8. How to Build a New Action

### Step-by-step

1. **Create file** in `pipeline/src/workflows/actions/` (e.g., `my_action.py`)

2. **Define async function** with the standard signature:

```python
async def my_action(
    conn: asyncpg.Connection,
    *,
    required_param: str,
    optional_param: int = 0,
) -> dict[str, Any]:
    """What this action does.

    Args:
        conn: Active asyncpg connection from the workflow processor.
        required_param: Description.
        optional_param: Description.

    Returns:
        Dict with result keys accessible via step.<name>.result.<key>.
    """
    # 1. Validate inputs
    try:
        validated_id = uuid.UUID(required_param)
    except (ValueError, TypeError):
        return {"status": "skipped", "reason": "invalid_id"}

    # 2. Business logic (all DB access via conn)
    try:
        row = await conn.fetchrow("SELECT ... WHERE id = $1", validated_id)
    except Exception as exc:
        return {"status": "error", "reason": f"db_error: {exc}"}

    if row is None:
        return {"status": "skipped", "reason": "not_found"}

    # 3. Return structured result
    return {
        "status": "completed",
        "itemsProcessed": 5,
        "someKey": "value",  # accessible as step.<name>.result.someKey
    }
```

3. **Add re-export** in `pipeline/src/workflows/actions/__init__.py`:

```python
from workflows.actions.my_action import my_action
```

4. **Reference from workflow step** using the dotted import path:

```python
Step(
    name="my_step",
    action="workflows.actions.my_action.my_action",
    input_map={"required_param": "payload.entityId"},
)
```

### Key conventions

- First positional arg is always `conn: asyncpg.Connection`
- All other args are keyword-only (`*` separator)
- Return a dict -- it becomes the step's `result` (accessible downstream as `step.<name>.result.<key>`)
- Handle per-item errors internally (try/catch inside loops); let fatal errors propagate
- Validate UUID inputs early and return `status="skipped"` for invalid data
- Log with `logging.getLogger("pipeline.workflows.actions.<module>")`

---

## 9. Event Emissions

All events emitted by the workflow system itself. These all use `namespace='system'`.

### Workflow Lifecycle Events

| Event Type | Emitted When | Key Payload Fields |
|------------|-------------|-------------------|
| `workflow.started` | Workflow begins processing | `workflow`, `triggerEventId`, `tenant_id` |
| `workflow.step_completed` | A step succeeds (or is skipped) | `workflow`, `step`, `stepType`, `skipped`, `triggerEventId`, `tenant_id`, `duration_ms` |
| `workflow.step_failed` | A step fails after all retries | `workflow`, `step`, `stepType`, `error` (truncated to 500 chars), `triggerEventId`, `tenant_id`, `duration_ms` |
| `workflow.completed` | All steps finished | `workflow`, `triggerEventId`, `tenant_id`, `stepsExecuted`, `stepsSkipped`, `stepsFailed`, `duration_ms` |
| `workflow.failed` | Entire `_run_workflow` call throws | `workflow`, `triggerEventId`, `tenant_id`, `error` (truncated to 500 chars) |

### Notification Events

| Event Type | Emitted When | Key Payload Fields |
|------------|-------------|-------------------|
| `notification.requested` | NOTIFY step executes | `channel`, `template`, `tenant_id`, `user_id`, `to_role`, `trigger_event_id`, additional context fields |

### Process Instance Events (V2, with WorkflowManager)

| Event Type | Emitted When | Key Payload Fields |
|------------|-------------|-------------------|
| `workflow.instance_created` | New process_instances row | `instanceId`, `workflow`, `triggerEventId` |
| `workflow.instance_started` | Instance status -> running | `instanceId`, `workflow` |
| `workflow.instance_completed` | Instance status -> completed | `instanceId`, `duration_ms` |
| `workflow.instance_failed` | Instance status -> failed | `instanceId`, `error` |
| `workflow.instance_cancelled` | Admin cancels instance | `instanceId`, `actor` |
| `workflow.instance_recovered` | Failed instance retried | `instanceId`, `recoveredFrom` |
| `workflow.stuck_detected` | Heartbeat stale > 5 minutes | `instanceId`, `lastHeartbeat` |

---

## 10. Admin Dashboard

The `/admin/workflows` page (`frontend/app/admin/workflows/page.tsx`) provides real-time monitoring of workflow instances.

### Access Control

Restricted to `rfp_admin` and `master_admin` roles. Other roles are redirected to `/login`.

### Stats Bar

Four counters at the top of the page:
- **Running**: Count of instances with `status='running'`
- **Paused**: Count of instances with `status='paused'`
- **Completed 24h**: Instances completed in the last 24 hours
- **Failed 24h**: Instances failed in the last 24 hours

### Active Workflows Panel

Shows up to 50 instances with status `running`, `paused`, `pending`, or `retrying`, ordered by `started_at DESC`.

Each card displays:
- Workflow name (formatted: `OnRfpUploaded` -> `Rfp Uploaded`)
- Status with color-coded indicator:
  - Blue: running
  - Yellow: paused
  - Gray: pending
  - Orange: retrying
  - Green: completed
  - Red: failed
- Current step and step index / total steps
- Elapsed time since started
- Tenant ID (if applicable)
- Source system (pipeline/cms)
- Retry count and last error (if any)

### Recent History Panel

Shows up to 100 instances from the last 24 hours with status `completed`, `failed`, or `cancelled`, ordered by `completed_at DESC`.

Each entry shows:
- Workflow name and final status
- Duration (computed from `started_at` to `completed_at`)
- Error details for failed instances (`last_error`, `last_error_step`)
- Recovery lineage (`recovered_from` link)

### Auto-Refresh

The client component (`workflow-monitor-client.tsx`) auto-refreshes via Next.js router refresh on a 10-second interval.

### Migration Fallback

If the `process_instances` table does not exist (migration 043 not yet applied), the page shows a "Migration Required" banner instead of erroring.

---

## 11. V2 Roadmap

| Feature | Description | Status |
|---------|-------------|--------|
| **Parallel step execution** | Steps without `depends_on` relationships run concurrently via `asyncio.gather` | Planned |
| **Workflow composition** | One workflow triggers another (parent-child instances with `correlation_id`) | Planned |
| **Scheduled workflows** | Cron-triggered workflows (not just event-triggered) using `pipeline_schedules` | Planned |
| **Workflow versioning** | Run old version of a workflow while new version is deployed; `workflow_version` column | Planned |
| **Visual workflow editor** | Admin UI for defining workflows without code; YAML intermediate format | Planned |
| **SLA monitoring** | Deadline enforcement with escalation chains; `deadline` column in `process_instances` | Schema ready |
| **Full HITL_WAIT** | Process state persisted to DB; resume on matching event; timeout escalation | Schema ready |
| **Full AI_INVOKE** | Agent invocation via AgentFabric with token budgets and tool-use loops | Planned |
| **API_CALL implementation** | HTTP calls to external/internal APIs with response parsing | Planned |
| **Step-level retry execution** | Retry config is declared but V1 processor now executes it; full backoff patterns | Implemented |
| **Timeout enforcement** | Timeout config enforced via `asyncio.wait_for` | Implemented |

---

## 12. File Map

```
pipeline/src/workflows/
  __init__.py                           # Package docstring
  base.py                               # EventTrigger, StepType, Step, Workflow, registry, auto-discovery
  processor.py                          # Polling loop, step dispatch, input resolution, event emission
  on_rfp_uploaded.py                    # OnRfpUploaded workflow definition
  on_solicitation_pushed.py             # OnSolicitationPushed workflow definition
  on_source_change_detected.py          # OnSourceChangeDetected workflow definition
  on_application_accepted.py            # OnApplicationAccepted workflow definition
  on_proposal_created.py                # OnProposalCreated workflow definition
  on_proposal_advanced.py               # OnProposalAdvancedToPinkTeam + OnProposalAdvancedToFinal
  actions/
    __init__.py                         # Re-exports all action functions
    shred.py                            # shred() + extract_compliance()
    score_tenants.py                    # match_tenants()
    create_drafts_from_scout.py         # create_drafts_from_scout()
    create_library_defaults.py          # create_default_categories()
    generate_preview.py                 # generate_preview()

frontend/app/admin/workflows/
  page.tsx                              # Server component: queries process_instances, renders dashboard
  workflow-monitor-client.tsx           # Client component: auto-refresh, status cards, actions

db/migrations/
  007_system_events.sql                 # system_events table + pg_notify trigger
  019_automation_and_content.sql        # automation_rules table + automation_log + initial seeds
  028_automation_rules_v2.sql           # V2 automation rules seeds (6 rules)
  040_crm_phase1.sql                    # CRM action types + 4 additional rules
  043_process_instances.sql             # process_instances + process_instance_transitions tables

services/cms/src/
  event_listener.py                     # CMS event polling, rule matching, action dispatch
  workers/
    gmail_client.py                     # Gmail API integration for email delivery
```

---

## 13. Database Schema

### process_instances

Persistent state for every workflow execution.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | UUID | `gen_random_uuid()` | Primary key |
| `workflow_name` | TEXT | NOT NULL | Class name (e.g., `OnRfpUploaded`) |
| `trigger_event_id` | UUID | FK -> system_events | The event that triggered this instance |
| `correlation_id` | UUID | `gen_random_uuid()` | Groups related instances (parent-child) |
| `status` | TEXT | `'pending'` | One of: `pending`, `running`, `paused`, `completed`, `failed`, `cancelled`, `retrying` |
| `current_step` | TEXT | NULL | Name of the step currently executing |
| `current_step_index` | INTEGER | 0 | Ordinal position in step list |
| `step_results` | JSONB | `'{}'` | Accumulated results: `{step_name: {result: {...}}}` |
| `step_status` | JSONB | `'{}'` | Per-step status: `{step_name: "completed"\|"failed"\|"skipped"\|"running"\|"pending"}` |
| `started_at` | TIMESTAMPTZ | NULL | When execution began |
| `completed_at` | TIMESTAMPTZ | NULL | When execution finished |
| `last_heartbeat_at` | TIMESTAMPTZ | `now()` | Last heartbeat update (for stuck detection) |
| `deadline` | TIMESTAMPTZ | NULL | SLA deadline (V2 feature) |
| `retry_count` | INTEGER | 0 | Number of retries attempted |
| `max_retries` | INTEGER | 3 | Maximum retries before permanent failure |
| `last_error` | TEXT | NULL | Error message from last failure |
| `last_error_step` | TEXT | NULL | Which step failed |
| `recovered_from` | UUID | NULL | ID of the failed instance this was recovered from |
| `tenant_id` | UUID | FK -> tenants | Tenant scope (NULL for admin workflows) |
| `actor_id` | UUID | NULL | User who triggered the workflow |
| `actor_email` | TEXT | NULL | Email of the triggering user |
| `payload` | JSONB | `'{}'` | Original trigger event payload |
| `source` | TEXT | `'pipeline'` | One of: `pipeline`, `cms` |
| `created_at` | TIMESTAMPTZ | `now()` | Row creation time |
| `updated_at` | TIMESTAMPTZ | `now()` | Last modification (auto-updated via trigger) |

**Indexes:**
- `idx_process_instances_status` -- active statuses (`pending`, `running`, `paused`, `retrying`)
- `idx_process_instances_workflow` -- `(workflow_name, status)` for dashboard queries
- `idx_process_instances_tenant` -- `(tenant_id)` where not null
- `idx_process_instances_heartbeat` -- `(last_heartbeat_at)` where running (stuck detection)
- `idx_process_instances_created` -- `(created_at DESC)` for recent history
- `idx_process_instances_trigger` -- `(trigger_event_id)` for dedup

### process_instance_transitions

Audit log for every status change on a process instance.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | UUID | `gen_random_uuid()` | Primary key |
| `instance_id` | UUID | FK -> process_instances (CASCADE) | Which instance transitioned |
| `from_status` | TEXT | NULL | Previous status (NULL for initial creation) |
| `to_status` | TEXT | NOT NULL | New status |
| `step_name` | TEXT | NULL | Which step caused the transition |
| `actor` | TEXT | NULL | Who caused it: `'system'`, `'admin:{email}'`, `'cron'` |
| `reason` | TEXT | NULL | Human-readable reason |
| `metadata` | JSONB | `'{}'` | Additional context (error details, duration, etc.) |
| `created_at` | TIMESTAMPTZ | `now()` | Timestamp of transition |

**Indexes:**
- `idx_pit_instance` -- `(instance_id, created_at DESC)` for instance history queries

### system_events (workflow-relevant)

The shared event bus. Workflows are triggered by events in this table.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | UUID | `gen_random_uuid()` | Primary key |
| `namespace` | TEXT | NOT NULL | Event namespace (e.g., `finder`, `capture`, `proposal`, `system`) |
| `type` | TEXT | NOT NULL | Event type (e.g., `rfp.uploaded`, `proposal.created`) |
| `phase` | TEXT | NOT NULL | One of: `start`, `end`, `single` |
| `actor_type` | TEXT | NOT NULL | One of: `user`, `system`, `pipeline`, `agent` |
| `actor_id` | TEXT | NOT NULL | ID of the actor |
| `actor_email` | TEXT | NULL | Email of the actor |
| `tenant_id` | UUID | FK -> tenants | Tenant scope (NULL for admin events) |
| `parent_event_id` | UUID | FK -> system_events | For correlating start/end pairs |
| `payload` | JSONB | `'{}'` | Event-specific data |
| `error` | JSONB | NULL | Error details (for `phase='end'` with errors) |
| `duration_ms` | INTEGER | NULL | Duration for paired events |
| `created_at` | TIMESTAMPTZ | `now()` | Event timestamp |

**Trigger events that activate workflows:**

| Event | Phase | Activates |
|-------|-------|-----------|
| `finder:rfp.uploaded` | `end` | OnRfpUploaded |
| `finder:solicitation.pushed` | `single` | OnSolicitationPushed |
| `finder:source.change_detected` | `single` | OnSourceChangeDetected |
| `capture:application.accepted` | `end` | OnApplicationAccepted |
| `proposal:proposal.created` | `end` | OnProposalCreated |
| `proposal:proposal.advanced` | `single` | OnProposalAdvancedToPinkTeam (toStage=pink_team) |
| `proposal:proposal.advanced` | `single` | OnProposalAdvancedToFinal (toStage=final) |

### automation_rules

CMS automation rules that react to events independently of pipeline workflows.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | UUID | `gen_random_uuid()` | Primary key |
| `name` | TEXT | NOT NULL | Unique rule name |
| `description` | TEXT | NULL | Human-readable description |
| `is_active` | BOOLEAN | `true` | Whether rule is active |
| `trigger_namespace` | TEXT | NOT NULL | Event namespace to match |
| `trigger_type` | TEXT | NOT NULL | Event type to match |
| `action_type` | TEXT | NOT NULL | One of: `send_email`, `notify_admin`, `create_todo`, `enroll_drip`, `distribute_social`, `publish_content`, `webhook`, `update_status`, `log_only`, `queue_notification`, `queue_job`, `emit_event` |
| `action_config` | JSONB | `'{}'` | Action-specific configuration (template, to_field, subject, etc.) |
| `created_by` | UUID | FK -> users | Who created the rule |
| `created_at` | TIMESTAMPTZ | `now()` | Rule creation time |
| `updated_at` | TIMESTAMPTZ | `now()` | Last modification |

**Indexes:**
- `idx_automation_rules_trigger` -- `(trigger_namespace, trigger_type)` where `is_active = true`
- `idx_automation_rules_name` -- unique on `name`

### automation_log

Execution log for automation rule actions.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | UUID | `gen_random_uuid()` | Primary key |
| `rule_id` | UUID | FK -> automation_rules | Which rule fired |
| `trigger_event_id` | UUID | NULL | The system_events row that triggered this |
| `action_type` | TEXT | NOT NULL | Action that was executed |
| `status` | TEXT | NOT NULL | One of: `success`, `failed`, `skipped` |
| `result` | JSONB | `'{}'` | Action result data |
| `error_message` | TEXT | NULL | Error details on failure |
| `executed_at` | TIMESTAMPTZ | `now()` | Execution timestamp |

Used for the 5-minute dedup window: the event_listener checks `automation_log` before re-executing an action for the same event.
