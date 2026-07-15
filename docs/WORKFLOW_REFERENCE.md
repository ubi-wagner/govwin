# Workflow & Pipeline Reference

Complete reference for all automated workflows, pipeline job dispatch, and CMS email automation in the govwin platform.

---

## 1. Pipeline Workflows

### Architecture Overview

Workflows are declarative job templates defined as Python classes in `pipeline/src/workflows/`. They do not execute themselves -- the **workflow processor** (`processor.py`) polls `system_events` for new events, matches them against registered workflow triggers, and drives execution.

**Key classes** (from `pipeline/src/workflows/base.py`):

- `EventTrigger(namespace, type, phase, condition)` -- defines which `system_events` row activates a workflow
- `Step(name, action, step_type, depends_on, input_map, timeout_minutes, retry_count, ...)` -- one unit of work
- `Workflow` -- base class with `trigger` and `steps` class attributes

**Step types** (`StepType` enum):

| Type | Behavior |
|---|---|
| `ACTION` | Calls a Python function via dotted import path |
| `AI_INVOKE` | Calls an AI tool action via `AgentFabric.invoke_agent` (falls back to ACTION resolution) |
| `HITL_WAIT` | Parks the instance on a human gate, persisted in `process_instances` (mig 088); resumes on the `wait_for` event |
| `TODO` | A HITL_WAIT that also writes a row to the unified `tasks` ledger (assignee, nudge cadence, entity ref); resumes on task completion or the `wait_for` event |
| `NOTIFY` | Emits a `system:notification.requested` event for CRM delivery |
| `CONDITION` | Evaluates a callable; skips downstream if false |
| `API_CALL` | Not implemented in V1; skips |

**Workflow processor** (`processor.py`):

- Runs as a concurrent asyncio task alongside the ingester consumer loop
- Poll interval: **10 seconds**
- Seeds `last_processed_at` to current max `system_events.created_at` at startup (only processes new events)
- Queries up to 100 events per poll, skipping `namespace = 'system'` to avoid self-triggering
- On step failure: logs error, continues to next step (does not abort the workflow)
- On DB connection loss: attempts reconnect
- Emits `system:workflow.step_completed`, `system:workflow.step_failed`, and `system:workflow.completed` events
- **Durable instances (mig 088):** HITL_WAIT/TODO gates are no longer skipped — they persist as `process_instances` rows (which carry `opportunity_id` + `scope` ∈ opp/spotlight/project/contract, the spine discriminator) and are parked/resumed by the managed-instance layer (`manager.py`). A separate consumer (`AgentFabric.process_task_queue`, ~20s poll) drives `agent_task_queue` rows keyed on `agent_role`.

**Input resolution** supports dot-notation paths:

- `payload.<key>` -- reads from trigger event payload
- `result.<key>` -- alias for payload (end events store results in payload)
- `step.<name>.result.<key>` -- reads from a prior step's result
- `"<literal>"` -- quoted string literal

---

### Workflow: OnRfpUploaded

**File:** `pipeline/src/workflows/on_rfp_uploaded.py`
**Trigger:** `finder:rfp.uploaded:end` (condition: `payload.error is None`)
**Description:** Shred uploaded RFP document and notify curator

| # | Step | Type | Action | Timeout | Retry | Depends On |
|---|---|---|---|---|---|---|
| 1 | `shred_document` | ACTION | `pipeline.shredder.shred` | 10 min | 3x (30s delay) | -- |
| 2 | `extract_compliance` | ACTION | `pipeline.shredder.extract_compliance` | 5 min | 1x | shred_document |
| 3 | `notify_curator` | NOTIFY | `system.notify` | 30 min | 0 | extract_compliance |

**Step details:**

1. **shred_document** -- Delegates to `shredder.runner.shred_solicitation`. Reads `payload.solicitationId` and `payload.documentIds`. Instantiates an Anthropic client to call Claude for text extraction, structure parsing, and embeddings. Returns status, section count, compliance matches, token usage.
   - On success: passes solicitation_id to extract_compliance
   - On failure: step_failed event emitted, extract_compliance still runs but gets None inputs

2. **extract_compliance** -- Re-runs compliance variable extraction on shredded data. Reads from `curated_solicitations.ai_extracted` JSONB. Tries Claude-based extraction first (using `compliance_extraction` prompt against the master variable list from `compliance_variables` table), falls back to pattern-based extraction (page limits, font requirements, submission deadlines, margins, line spacing). Upserts results into `solicitation_compliance`.
   - On success: passes to notify_curator
   - On skip: if solicitation not found or not yet shredded

3. **notify_curator** -- Emits `system:notification.requested` event with template `rfp_ready_for_curation` to role `rfp_admin`.

---

### Workflow: OnSolicitationPushed

**File:** `pipeline/src/workflows/on_solicitation_pushed.py`
**Trigger:** `finder:solicitation.pushed:single` (no condition)
**Description:** Notify subscribed customers when new RFP hits Spotlight

> ⚠ Legacy surface: `find_matching_tenants` still upserts `tenant_pipeline_items` (see step 1), but that Spotlight/Pipeline surface is retired in favor of the opportunity-card spine (`opportunity_bridge` → `tenant_opportunity_cards`, auto-scored on arrival). The scoring→cards migration of this workflow is tracked separately — see `docs/MASTER_MIRROR_OPP_DESIGN.md`.

| # | Step | Type | Action | Timeout | Retry | Depends On |
|---|---|---|---|---|---|---|
| 1 | `find_matching_tenants` | ACTION | `pipeline.scoring.match_tenants` | 5 min | 0 | -- |
| 2 | `send_spotlight_digest` | NOTIFY | `system.notify` | 30 min | 0 | find_matching_tenants |

**Step details:**

1. **find_matching_tenants** -- Scores a newly pushed solicitation against all eligible tenants. For each tenant with `status='active'` and `subscription_status IN ('active', 'trialing')`:
   - Loads tenant profile (naics_codes, keywords, agency_priorities, set_aside_types, technology_focus, research_areas, target_agencies, min_surface_score)
   - Loads solicitation metadata via the joined opportunity
   - Computes multi-factor match score (max 100):
     - NAICS overlap: 0-30 points
     - Keyword/tech focus overlap: 0-25 points
     - Agency preference: 0-20 points
     - Set-aside match: 0-10 points
     - Program type match: 0 points (no profile data yet)
     - Timeline proximity: 0-5 points (closer deadlines score higher)
   - Upserts `tenant_pipeline_items` rows with individual and total scores
   - Returns `tenantIds` array (tenants scoring >= 50), `tenantsScored`, `tenantsNotified`, `avgScore`
   - Skips tenants below their configured `min_surface_score` (default 40)

2. **send_spotlight_digest** -- Emits notification with template `spotlight_new_topics` to the tenant IDs returned by step 1.

---

### Workflow: OnSourceChangeDetected

**File:** `pipeline/src/workflows/on_source_change_detected.py`
**Trigger:** `finder:source.change_detected:single` (condition: `payload.meaningfulChanges > 0`)
**Description:** Create draft solicitations from Source Scout findings and notify admin

| # | Step | Type | Action | Timeout | Retry | Depends On |
|---|---|---|---|---|---|---|
| 1 | `create_draft_solicitations` | ACTION | `finder.create_drafts_from_scout` | 10 min | 0 | -- |
| 2 | `notify_rfp_admin` | NOTIFY | `system.notify` | 30 min | 0 | create_draft_solicitations |
| 3 | `wait_for_admin_review` | HITL_WAIT | `hitl.wait` | 1440 min (24h) | 0 | notify_rfp_admin |

**Step details:**

1. **create_draft_solicitations** -- Parses `payload.regionResults` from the scout worker. For each extracted opportunity:
   - Deduplicates by title + agency against existing `opportunities` rows
   - If new: creates an `opportunities` row (source=`source_scout`) and a `curated_solicitations` row (status=`new`)
   - If existing but no solicitation: creates only the solicitation row
   - Returns `draftsCreated`, `draftsUpdated`, `duplicatesSkipped`

2. **notify_rfp_admin** -- Emits notification with template `source_scout_changes` including source name, change count, and drafts created.

3. **wait_for_admin_review** -- HITL_WAIT step waiting for `finder:source.changes_reviewed:single`. In V1 this is logged and skipped. On timeout (24h), would re-notify admin (not implemented in V1).

---

### Workflow: OnApplicationAccepted

**File:** `pipeline/src/workflows/on_application_accepted.py`
**Trigger:** `capture:application.accepted:end` (condition: `payload.error is None`)
**Description:** Onboard new tenant after application acceptance

| # | Step | Type | Action | Timeout | Retry | Depends On |
|---|---|---|---|---|---|---|
| 1 | `send_welcome_email` | NOTIFY | `system.notify` | 30 min | 0 | -- |
| 2 | `create_library_defaults` | ACTION | `pipeline.library.create_default_categories` | 2 min | 0 | send_welcome_email |
| 3 | `schedule_login_reminder` | HITL_WAIT | `hitl_wait` | 2880 min (48h) | 0 | create_library_defaults |

**Step details:**

1. **send_welcome_email** -- Emits notification with template `welcome_accepted` containing `tenant_id` and `user_id` from the event result.

2. **create_library_defaults** -- Creates 8 default library categories for the new tenant:
   - Technical Approach, Past Performance, Key Personnel, Management Plan
   - Cost & Pricing, Company Overview, Certifications & Compliance, Commercialization
   - Inserts seed `library_units` rows (source_type=`ai`, status=`approved`) as category markers
   - Idempotent: skips categories that already exist
   - Returns `categoriesCreated`, `categoriesSkipped`

3. **schedule_login_reminder** -- HITL_WAIT waiting for `identity:user.logged_in:single`. If tenant has not logged in within 48h, would send a login reminder. In V1 this is skipped.

---

### Workflow: OnProposalCreated

**File:** `pipeline/src/workflows/on_proposal_created.py`
**Trigger:** `proposal:proposal.created:end` (condition: `payload.proposalId` present)
**Description:** AI-draft the V0 strawman for every empty section, then notify the RFP admin for review

> Part of the opportunity→purchase→proposal flow — see `docs/MASTER_MIRROR_OPP_DESIGN.md` for the canonical spine (purchase → 72h curation gate → release → provision → this workflow).

| # | Step | Type | Action | Timeout | Retry | Depends On |
|---|---|---|---|---|---|---|
| 1 | `draft_sections` | ACTION | `workflows.actions.draft_v0.draft_v0` | 15 min | 0 | -- |
| 2 | `notify_admin_review` | NOTIFY | `system.notify` | 30 min | 0 | draft_sections |

**Step details:**

1. **draft_sections** -- Runs the 3-source V0 strawman (`draft_v0`). For every section still `empty`/`ai_drafted`, it drafts from the RFP excerpt + tenant library atoms + tenant profile via the `section_drafter` archetype, converts markdown→canvas, and lands each through `publish_section_draft` (whose empty/ai_drafted gate is the safe way to cross the advisory boundary — human-owned sections are never clobbered). Per-section try/except (one bad section never aborts the rest); idempotent (re-drafts only still-empty sections); **safe-skips with no DB write if the fabric / `ANTHROPIC_API_KEY` is unavailable**. Emits `proposal:v0_completed`.

2. **notify_admin_review** -- Emits notification with template `admin_proposal_review_required`. The proposal is created locked for admin review; the customer sees it only after release.

---

### Workflow: ProjectCollaboration (canonical HITL reaction)

**File:** `pipeline/src/workflows/project_collaboration.py`
**Trigger:** `proposal:project.collaboration_requested:single` (condition: overlay names a `proposalId` or `opportunityId`)
**Description:** The ONE generic, overlay-parameterized human-gate template — reuse it instead of writing another bespoke `On<Event>` class

> Part of the opportunity→purchase→proposal flow — see `docs/MASTER_MIRROR_OPP_DESIGN.md`.

Launched on demand via `launchProjectCollaboration` (`frontend/lib/process/project-collaboration.ts`); the comp-code purchase route fires it to open the 72h `proposal_setup` curation ToDo (`assignee_role='rfp_admin'`, `nudgeDays=[1,3]`, `dueMinutes=CURATION_SLA_HOURS*60`). It reads `scope` (opp/spotlight/project/contract) from the overlay and writes `process_instances.opportunity_id`/`scope` (mig 088), parks **one** `tasks` gate, then notifies on completion. It READS `proposals.stage` for context but NEVER writes it (`advanceProposalStage` stays the sole authority).

| # | Step | Type | Action | Notes |
|---|---|---|---|---|
| 1 | `collaborate` | TODO | `todo` | Parks one payload-parameterized `tasks` row (assignee_role, task_type, entity_ref, nudge cadence, due); resumes on task completion |
| 2 | `notify_done` | NOTIFY | `system.notify` | Emits the completion email if `completeTemplate` is set (degrades to a no-op otherwise) |

---

### Workflow: OnProposalAdvancedToReview

**File:** `pipeline/src/workflows/on_proposal_advanced.py`
**Trigger:** `proposal:proposal.advanced:end` (condition: `payload.targetStage == 'review'`)
**Description:** Run AI compliance review and park a customer review gate when a proposal enters the review stage

| # | Step | Type | Action | Timeout | Retry | Depends On |
|---|---|---|---|---|---|---|
| 1 | `ai_compliance_review` | AI_INVOKE | `tool.proposal.check_compliance` | 10 min | 0 | -- |
| 2 | `notify_reviewers` | NOTIFY | `system.notify` | 30 min | 0 | ai_compliance_review |
| 3 | `wait_for_review` | TODO | `todo` | 4320 min (72h) | 0 | notify_reviewers |

**Step details:**

1. **ai_compliance_review** -- Invokes the AI compliance-check tool (`tool.proposal.check_compliance`). Skipped if the tool is not resolvable locally.
2. **notify_reviewers** -- Emits notification with template `review_ready`.
3. **wait_for_review** -- TODO gate: writes a `proposal_review` task into the `tenant_admin` queue (the reviewer is the customer). Resumes when the task is completed OR the reviewer advances the proposal (`wait_for`: `proposal:proposal.advanced:end` where `previousStage == 'review'`), whichever fires first. On timeout (72h) the engine emits `system:workflow.wait_timed_out` (reminder escalation is ⚠ future — no `send_review_reminder` step exists).

---

### Workflow: OnProposalAdvancedToFinal

**File:** `pipeline/src/workflows/on_proposal_advanced.py`
**Trigger:** `proposal:proposal.advanced:end` (condition: `payload.targetStage == 'final'`)
**Description:** Lock workspace and generate export preview at final stage

| # | Step | Type | Action | Timeout | Retry | Depends On |
|---|---|---|---|---|---|---|
| 1 | `generate_export_preview` | ACTION | `workflows.actions.generate_preview.generate_preview` | 15 min | 0 | -- |
| 2 | `notify_all_collaborators` | NOTIFY | `system.notify` | 30 min | 0 | generate_export_preview |

**Step details:**

1. **generate_export_preview** -- Fetches all proposal sections, extracts readable markdown from canvas JSON, bundles into a ZIP, uploads to S3/R2 at `customers/{slug}/proposal-export/{proposalId}/preview.zip`. Returns `previewUrl`, `sectionsExported`, `totalBytes`. Exports as markdown; full DOCX export is ⚠ future.

2. **notify_all_collaborators** -- Emits notification with template `proposal_final_ready`.

---

## 2. Pipeline Job Dispatch

### Architecture

The pipeline worker (`pipeline/src/main.py`) runs three concurrent asyncio tasks:

1. **Consumer loop** (`ingest/dispatcher.py::run_consumer_loop`) -- ingestion cron + job consumer
2. **Workflow processor** (`workflows/processor.py::run_workflow_processor`) -- event-driven workflows
3. **Health server** (`health.py::run_health_server`) -- HTTP liveness probe

All connect to PostgreSQL independently and respect a shared `shutdown_event` (SIGINT/SIGTERM).

### Job Dispatch Flow

**Schedule ticking** (every 60 seconds):

1. Query `pipeline_schedules` for enabled schedules where `next_run_at <= now()`
2. For each due schedule with a known ingester source (`sam_gov`, `sbir_gov`, `grants_gov`, `dsip`):
   - Check for existing pending/running job for that source (skip if found)
   - Insert a `pipeline_jobs` row with `status='pending'`, `priority=5`
   - Advance `next_run_at` by 24h (daily) or 168h (weekly)

**Job consumption** (continuous, 5s sleep when idle):

1. Atomically claim next pending job via `UPDATE ... FOR UPDATE SKIP LOCKED`
2. Route by `pipeline_jobs.kind`:
   - `'ingest'` (default) -- route to ingester class by `source` field
   - `'shred_solicitation'` -- run `shredder.runner.shred_solicitation` with Anthropic client
   - `'scout_source'` -- run source scout (single source or all due)
3. On completion: update job `status='completed'`, store result JSON
4. On failure: update job `status='failed'`, store error JSON

**Ingester classes** (all extend `BaseIngester`):

| Source | Class | API |
|---|---|---|
| `sam_gov` | `SamGovIngester` | SAM.gov Opportunities API |
| `sbir_gov` | `SbirGovIngester` | SBIR.gov API |
| `grants_gov` | `GrantsGovIngester` | Grants.gov API |
| `dsip` | `DsipIngester` | DoD SBIR/STTR Innovation Portal |

**BaseIngester.run()** flow:

1. Emit `finder:ingest.run.start` event
2. Page through upstream API (up to `max_pages=50`)
3. For each item: `normalize()` to opportunities schema, compute `content_hash`
4. Upsert into `opportunities` (ON CONFLICT by source+source_id, skip if hash unchanged)
5. For new inserts: auto-create `curated_solicitations` triage row (status=`new`)
6. Emit `finder:opportunity.ingested` or `finder:opportunity.amended` per row
7. Emit `finder:ingest.run.end` with totals

**Error handling per job:**

- Per-item errors within an ingest run: caught, logged, counted in `result.failed`, run continues
- Job-level errors: caught by `consume_one_job`, job marked `failed` with error JSON
- Consumer loop errors: caught, logged, 10s sleep before retry
- DB connection loss in workflow processor: attempts reconnect

**Retry policy:**

- Pipeline jobs have no automatic retry at the job level -- a failed job stays failed
- Individual workflow steps have configurable `retry_count` and `retry_delay_seconds` (defined per step, but retry execution is not implemented in V1 processor)
- The ingester consumer loop itself retries on errors with a 10s backoff
- The workflow processor retries on DB connection loss

---

## 3. Email Automation Workflows (CMS Service)

All CMS workers live in `services/cms/src/workers/` and run as async background loops within the FastAPI service.

### Campaign Executor (`campaign_executor.py`)

**Poll interval:** 60 seconds
**Batch size:** 5 campaigns per poll

**Processing steps:**

1. Lock a batch of active campaigns (`status='active'`, type `one_time` or `recurring`) using `FOR UPDATE SKIP LOCKED`
2. Log execution start in `campaign_execution_log`
3. Dispatch by campaign type:

   **One-time campaigns:**
   - Enumerate audience based on `audience_type`: `all_active`, `tier_based`, `segment`, `lifecycle_stage`, `individual`
   - For each recipient, create an `email_sends` row
   - If `hitl_required=true`: set status=`pending_approval`, create `email_outbox` entry
   - If `hitl_required=false`: set status=`queued`, insert into `email_queue`
   - Mark campaign `status='completed'` after execution

   **Recurring campaigns:**
   - Check for recent execution (within 1 hour) to prevent double-execution
   - Same send creation flow as one-time
   - Campaign stays `active` (does not auto-complete)

4. Update `campaign_execution_log` with results
5. Emit `campaign.executed` event

**State machine:** `active` -> executes sends -> `completed` (one-time) or stays `active` (recurring)

**HITL gate:** Controlled by `email_campaigns.hitl_required`. When true, sends go to `email_outbox` for human review via the CMS outbox UI. When false, sends go directly to `email_queue` for immediate delivery.

**Error handling:** Per-campaign try/catch. Errors logged to `campaign_execution_log.metadata` as JSON. Failed campaigns do not block the batch.

---

### Drip Engine (`drip_engine.py`)

**Poll interval:** 60 seconds
**Batch size:** 20 enrollments per poll

**Processing steps:**

1. Lock due enrollments (`status='active'`, `next_send_at <= now()`) via `UPDATE ... FOR UPDATE SKIP LOCKED`
2. For each enrollment:
   - Look up next drip step (`drip_sequences` where `step_number = current_step + 1`)
   - If no more steps: mark enrollment `status='completed'`, emit `drip.enrollment.completed`
   - Resolve subject/body from step overrides or template
   - Apply variable substitution (`{{recipient_name}}`, `{{recipient_email}}`)
   - Create `email_sends` row (HITL-gated or direct to queue, per campaign setting)
   - Compute `next_send_at` from the following step's `delay_hours` and `delay_from` (previous_step or enrollment date)
   - Update enrollment: increment `current_step`, set `last_sent_at`, `next_send_at`
   - Log to `campaign_execution_log`
   - Emit `drip.step.sent` event

**State machine for enrollments:** `active` -> processing steps -> `completed` (or `failed` on persistent error)

**HITL gate:** Same as campaign executor -- controlled by `email_campaigns.hitl_required`.

**Error handling:** Per-enrollment try/catch. On error, enrollment is marked `status='failed'` with `last_error` in metadata JSONB. Other enrollments in the batch continue.

---

### Email Queue (`email_queue.py`)

**Poll interval:** 15 seconds (processes immediately if full batch returned)
**Batch size:** 10 emails per poll

**Processing steps:**

1. Lock a batch of ready queue items (`locked_at IS NULL`, `attempts < max_attempts`, `scheduled_for <= now()`) via `UPDATE ... FOR UPDATE SKIP LOCKED`
2. For each item:
   - Fetch the full `email_sends` record joined with `email_accounts`
   - HITL gate: skip if `status != 'queued'` (only approved sends are delivered)
   - Resolve delegate email account (fall back to default active account)
   - Check daily send limit per account (reset counter on new day, skip if at limit)
   - Mark send as `status='sending'`
   - Embed trigger flags in HTML body if `trigger_metadata` present
   - Send via Gmail API (`gmail_client.send_email`)
   - On success:
     - Update send with `status='sent'`, Gmail message/thread IDs, `sent_at`
     - Upsert `email_threads` record
     - Increment account `sends_today` counter
     - Increment campaign `total_sent` counter
     - Delete from queue
     - Emit `email.sent` event
   - On failure:
     - Increment `attempts`
     - If `attempts >= max_attempts`: mark send `status='failed'`, delete from queue
     - Otherwise: unlock queue item for retry on next poll

**State machine for sends:** `queued` -> `sending` -> `sent` (or `failed`)

**HITL gate:** The queue only processes sends with `status='queued'`. Sends that need approval enter at `status='pending_approval'` and must be approved via the outbox UI before they appear in the queue.

**Error handling:** Per-send try/catch with retry tracking. On permanent failure, `email_sends.error_message` is populated. On transient failure, the queue item is unlocked for retry.

---

### Email Sweep (`email_sweep.py`)

**Poll interval:** 300 seconds (5 minutes)

**Processing steps:**

1. Fetch all sweep-enabled, active email accounts
2. For each account:
   - Call Gmail History API for new messages since `sweep_history_id`
   - For each incoming message:
     - Skip messages sent by the account itself
     - Check if the message is a content generation request (sent to `content@rfppipeline.com` or `blog@rfppipeline.com`, or subject starts with `[CONTENT REQUEST]`). If so, create a `cms_generations` row and skip normal processing.
     - Match to existing `email_sends` via Gmail thread ID or `in-reply-to` header
     - Skip if no match or already recorded
     - Record reply engagement in `email_engagement`
     - Update `email_threads` (increment message_count, set `last_sender='them'`, `status='needs_attention'`)
     - Increment campaign `total_replied` counter
     - Emit `email.reply.received` event
   - Update account `last_sweep_at` and `sweep_history_id`
3. Interpret unprocessed replies (up to 20 per sweep):
   - Fetch uninterpreted replies (`reply_interpreted = FALSE`)
   - Classify each reply using Claude via `template_drafter.interpret_reply` (returns sentiment, intent, action_needed, summary)
   - Update `email_engagement` with classification
   - Emit `email.reply.interpreted` event
   - If original send has `trigger_metadata.auto_response_enabled`:
     - Look up original template's `response_map`
     - Map classification to response template slug
     - Resolve profile variables from shared DB
     - Render response template
     - Create new `email_sends` row with `status='pending_approval'`
     - Create `email_outbox` entry for HITL review (category=`auto_response`)
     - Emit namespace-specific reply event

**HITL gate:** Auto-drafted responses always go to the outbox for human approval -- they are never sent automatically.

**Error handling:** Per-message try/catch within sweep. Per-account try/catch wrapping the sweep. Failed accounts do not block other accounts.

---

### Social Poster (`social_poster.py`)

**Poll interval:** 60 seconds
**Batch size:** 10 posts per poll
**Max retries:** 3 (5-minute delay between retries)

**Processing steps:**

1. Lock scheduled posts (`status='scheduled'`, `scheduled_at <= now()`) via `UPDATE ... SET status='posting' ... FOR UPDATE SKIP LOCKED`
2. For each post:
   - Look up social account credentials
   - Validate account is active and token is not expired
   - Dispatch to platform adapter (`linkedin` or `twitter`)
   - On success: update `status='posted'`, store `platform_post_id`, emit `social.post.published`
   - On `NotImplementedError` (platform not wired): mark `status='failed'` immediately, no retry
   - On other error: increment `retry_count`, reschedule for retry (5 min delay), or mark `status='failed'` after 3 attempts

**State machine:** `scheduled` -> `posting` -> `posted` (or `failed`)
  - On transient failure: `posting` -> `scheduled` (rescheduled)

**Current platform status:**
- LinkedIn: request structure built but OAuth token exchange not wired (throws `NotImplementedError`)
- Twitter/X: not implemented (throws `NotImplementedError`)

**HITL gate:** No HITL gate on social posts -- they publish on schedule. Content review happens before scheduling.

---

### Content Generator (`content_generator.py`)

**Poll interval:** 30 seconds (configurable via `GENERATION_POLL_INTERVAL`)

**Processing steps:**

1. Dequeue one pending generation (`status='pending'`, FIFO, `FOR UPDATE SKIP LOCKED`)
2. Mark as `status='generating'`
3. Build Claude messages based on `source_type`:
   - `prompt`: standard text prompt
   - `url`: fetch URL content via httpx, extract title/description/body text, build enhanced prompt
   - `email`: fetch email content from `email_sends` or use provided `source_content`
   - `screenshot`: build Claude vision messages with base64-encoded image attachments from `cms_media`
   - `repackage`: rewrite existing content for the SBIR audience
4. Call Claude API (`claude-sonnet-4-20250514` default, configurable model/temperature)
5. Parse JSON response (title, excerpt, body, tags, meta_title, meta_description)
6. On success: update `status='completed'`, store generated fields, token usage, duration
7. On JSON parse error: mark `status='failed'` with error message
8. On other error: mark `status='failed'` with error details
9. Emit `content_pipeline.generation.completed` or `content_pipeline.generation.failed`

**State machine:** `pending` -> `generating` -> `completed` (or `failed`)

**HITL gate:** Generated content enters at `status='completed'` in `cms_generations`. It must be explicitly published via the content management UI -- generation does not auto-publish.

**Error handling:** Per-generation try/catch. URL fetch failures fall back to prompt-only generation. Failed generations do not retry automatically.

---

## 4. How to Build New Workflows

### Adding a New Workflow

1. Create a new file in `pipeline/src/workflows/` named `on_<trigger_description>.py`
2. Define a class extending `Workflow`:

```python
from workflows.base import Workflow, Step, StepType, EventTrigger

class OnMyEvent(Workflow):
    description = "What this workflow does"

    trigger = EventTrigger(
        namespace="finder",           # one of the 7 namespaces
        type="entity.verb_past_tense", # from EVENT_CONTRACT_V3.md
        phase="single",               # or "end" for paired events
        condition=lambda p: p.get("someField") is not None,  # optional
    )

    steps = [
        Step(
            name="step_one",
            action="module.path.function_name",
            input_map={
                "arg_name": "payload.fieldName",
                "literal": '"some_string"',
            },
            timeout_minutes=10,
            retry_count=2,
            retry_delay_seconds=60,
        ),
        Step(
            name="step_two",
            step_type=StepType.NOTIFY,
            action="system.notify",
            depends_on="step_one",
            input_map={
                "channel": '"email"',
                "template": '"template_name"',
                "data_from_step_one": "step.step_one.result.someKey",
            },
        ),
    ]
```

3. The workflow is auto-discovered at boot via `discover_workflows()` which iterates all modules in the `workflows` package. No explicit registration needed.

4. Validate your definition: `cls.validate()` checks for missing triggers, empty steps, broken `depends_on` references, and HITL_WAIT steps without `wait_for`.

### Adding a New Action

1. Create a file in `pipeline/src/workflows/actions/`
2. Implement an async function with signature:

```python
async def my_action(
    conn: asyncpg.Connection,
    *,
    param_one: str,
    param_two: int = 0,
) -> dict[str, Any]:
    """Docstring explaining what this does."""
    # Business logic using conn for DB access
    return {"result_key": "value"}
```

3. Add a re-export in `pipeline/src/workflows/actions/__init__.py`
4. Reference from a workflow step as the dotted import path (e.g., `"workflows.actions.my_module.my_action"`)

### Adding a New Automation Rule

Insert directly into `automation_rules` in the CMS database:

```sql
INSERT INTO automation_rules (trigger_event, action_type, action_config, is_active)
VALUES (
    'finder.rfp.curated_and_pushed',
    'send_email',
    '{"template": "new_rfp_notification", "audience": "subscribed_tenants"}'::jsonb,
    true
);
```

The CMS `event_listener.py` polls `system_events` and matches against active automation rules.

### Adding a New Event Type

1. Verify the namespace exists in ARCHITECTURE_V9.md §8 (7 total: finder, capture, identity, proposal, library, system, tool)
2. Follow the naming convention: `entity.verb_past_tense` (snake_case, past tense, max two segments)
3. Emit from service code:
   - Frontend: `emitEventSingle(conn, namespace, type, payload)` or `emitEventStart`/`emitEventEnd` pair
   - Pipeline: `emit_event(conn, namespace, type, payload)` or `BaseIngester._emit_event()`
   - CMS: `emit_event(event_type, entity_type, ...)` from `models/events.py`
4. See ARCHITECTURE_V9.md §8 for the canonical namespace registry
5. If a workflow should react to this event, create a workflow definition with matching trigger

### Retry/Timeout/Failure Patterns

- **Step-level retry:** Configure `retry_count` and `retry_delay_seconds` on the Step. Note: V1 processor does not execute retries -- this is a declaration for future implementation.
- **Step-level timeout:** Configure `timeout_minutes`. V1 processor does not enforce timeouts -- steps run to completion or failure.
- **Step failure:** Logged, `workflow.step_failed` event emitted, workflow continues to next step. Dependent steps still run but receive None for inputs from the failed step.
- **HITL_WAIT / TODO steps:** Park the instance on a durable human gate persisted in `process_instances` (mig 088); the managed-instance layer (`manager.py`) resumes them on the `wait_for` event or (TODO) on `tasks`-ledger completion. (The older "skipped in V1 — no process_instances table yet" behavior is superseded.)
- **Workflow-level failure:** If the entire `_run_workflow` call throws, `workflow.failed` event is emitted with the error. The event is still marked as processed (high-water mark advances).
- **Idempotency:** Workflows are not idempotent by default. The processor advances a timestamp-based high-water mark, so each event is processed at most once per processor lifetime. On restart, the mark is re-seeded to `MAX(created_at)`, so events emitted during downtime are skipped.
