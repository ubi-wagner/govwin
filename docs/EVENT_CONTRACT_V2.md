# EVENT_CONTRACT_V2.md — Complete Event System Reference

**Generated:** 2026-05-21
**Source:** Actual codebase analysis of all emitEvent* calls, automation_rules seeds, and the CMS event_listener

---

## 1. Namespace Dictionary

All events flow through the `system_events` table. Legacy tables (`opportunity_events`, `customer_events`, `content_events`) exist but are deprecated.

| Namespace | Used By | Purpose | Example Event Types |
|-----------|---------|---------|---------------------|
| `finder` | Frontend (admin routes), Pipeline (ingesters, shredder) | Opportunity ingestion, RFP triage, curation, source monitoring, SBIR data ingest | `rfp.uploaded`, `solicitation.triaged`, `topic.imported`, `source.visited`, `sbir_data.ingested` |
| `capture` | Frontend (application, stripe, portal routes), Pipeline | Customer lifecycle: applications, subscriptions, purchases, topic pins | `application.submitted`, `application.accepted`, `subscription.started`, `purchase.completed`, `topic.pinned` |
| `identity` | Frontend (auth routes) | Authentication lifecycle: login, password changes, invite acceptance | `user.password_changed`, `identity.invite_accepted` |
| `proposal` | Frontend (admin + portal proposal routes) | Proposal workspace: creation, section saves, stage advances, locking, collaboration | `proposal.created`, `section.saved`, `proposal.advanced`, `proposal.locked` |
| `library` | Frontend (portal library routes) | Content library: uploads, atomization, unit CRUD | `file.uploaded`, `document.atomized`, `unit.updated`, `unit.deleted` |
| `system` | Frontend (admin storage, content routes), CMS service, Pipeline (workflow processor) | Infrastructure: file storage, CMS publishing, health, workflow lifecycle | `file.uploaded`, `content.published`, `notification.requested`, `workflow.completed` |
| `tool` | Tool registry (lib/tools/) | Tool invocation audit trail (start/end pairs) | `{tool.name}` start/end |

**Forbidden namespaces:** `admin`, `cms`, `spotlight`, `pipeline`

---

## 2. Event Type Catalog

All event types discovered from actual `emitEventSingle`, `emitEventStart`, `emitEventEnd`, and `emit_event` calls in the codebase.

### finder namespace

| Event Type | Phase | Emitted By | Payload Fields |
|------------|-------|------------|----------------|
| `rfp.uploaded` | start/end | `frontend/app/api/admin/rfp-upload/route.ts` | solicitationId, fileCount -> documentIds, topicsExtracted |
| `solicitation.triaged` | single | `frontend/app/api/admin/rfp-curation/[solId]/triage/route.ts` | solicitationId, action, fromStatus, toStatus |
| `annotation.saved` | single | `frontend/app/api/admin/rfp-curation/[solId]/annotations/route.ts` | solicitationId, annotationId, kind |
| `compliance_value.saved` | single | `frontend/app/api/admin/rfp-curation/[solId]/compliance/route.ts` | solicitationId, variableName |
| `compliance.topic_override_saved` | single | `frontend/app/api/admin/rfp-curation/[solId]/topics/[topicId]/compliance/route.ts` | solicitationId, topicId |
| `compliance.topic_override_cleared` | single | `frontend/app/api/admin/rfp-curation/[solId]/topics/[topicId]/compliance/route.ts` | solicitationId, topicId |
| `compliance.preset_applied` | single | `frontend/app/api/admin/rfp-curation/[solId]/apply-preset/route.ts` | solicitationId, presetId |
| `compliance_preset.created` | single | `frontend/app/api/admin/compliance-presets/route.ts` | presetId, name |
| `outline.saved` | single | `frontend/app/api/admin/rfp-curation/[solId]/outline/route.ts` | solicitationId |
| `document.primary_set` | single | `frontend/app/api/admin/rfp-document/[id]/set-primary/route.ts` | documentId, solicitationId |
| `topic.updated` | single | `frontend/app/api/admin/topics/[id]/route.ts` | topicId |
| `topic.imported` | start/end | `frontend/app/api/admin/sources/[profileId]/paste-import/route.ts` | solicitationId -> importedCount |
| `topic_file.uploaded` | single | `frontend/app/api/admin/upload-topic-files/route.ts` | topicId, fileCount |
| `source.created` | single | `frontend/app/api/admin/sources/route.ts` | sourceId, name |
| `source.updated` | single | `frontend/app/api/admin/sources/[profileId]/route.ts` | sourceId |
| `source.visited` | single | `frontend/app/api/admin/sources/[profileId]/visit/route.ts` | sourceId, profileId, action |
| `source.scout_triggered` | single | `frontend/app/api/admin/sources/[profileId]/scout/route.ts` | sourceId, jobId |
| `source_region.created` | single | `frontend/app/api/admin/sources/[profileId]/regions/route.ts` | regionId, profileId |
| `source_region.deleted` | single | `frontend/app/api/admin/sources/[profileId]/regions/[regionId]/route.ts` | regionId |
| `source_diff.reviewed` | single | `frontend/app/api/admin/sources/[profileId]/diffs/route.ts` | diffId |
| `sbir_data.ingested` | start/end | `frontend/app/api/admin/sbir-data/ingest/route.ts` | filename -> companiesInserted, awardsInserted |
| `ingest.run.start` | start | Pipeline ingester base class | source, run_type |
| `ingest.run.end` | end | Pipeline ingester base class | inserted, updated, skipped, failed |
| `opportunity.ingested` | single | Pipeline ingester base class | opportunity_id, source, source_id, content_hash |
| `opportunity.amended` | single | Pipeline ingester base class | opportunity_id, old_hash, new_hash |

### capture namespace

| Event Type | Phase | Emitted By | Payload Fields |
|------------|-------|------------|----------------|
| `application.submitted` | single | `frontend/app/api/applications/route.ts` | email, companyName |
| `application.accepted` | start/end | `frontend/app/api/admin/applications/[id]/accept/route.ts` | applicationId -> tenantId, userId |
| `application.rejected` | single | `frontend/app/api/admin/applications/[id]/reject/route.ts` | applicationId, reason |
| `application.status_changed` | single | `frontend/app/api/admin/applications/[id]/status/route.ts` | applicationId, status |
| `subscription.started` | single | `frontend/app/api/stripe/webhook/route.ts` | tenantId, productType |
| `subscription.renewed` | single | `frontend/app/api/stripe/webhook/route.ts` | tenantId |
| `subscription.canceled` | single | `frontend/app/api/stripe/webhook/route.ts` | tenantId |
| `purchase.completed` | single | `frontend/app/api/stripe/webhook/route.ts` | tenantId, proposalId, productType |
| `checkout.started` | single | `frontend/app/api/stripe/webhook/route.ts` | tenantId |
| `consulting.purchased` | single | `frontend/app/api/stripe/webhook/route.ts` | tenantId, amount |
| `billing.portal_opened` | single | `frontend/app/api/stripe/webhook/route.ts` | tenantId |
| `topic.pinned` | single | Portal routes | tenantId, opportunityId |
| `topic.unpinned` | single | Portal routes | tenantId, opportunityId |
| `saved_search.created` | single | Portal routes | tenantId |

### identity namespace

| Event Type | Phase | Emitted By | Payload Fields |
|------------|-------|------------|----------------|
| `user.password_changed` | start/end | `frontend/app/api/auth/change-password/route.ts` | userId |
| `identity.invite_accepted` | single | Portal routes | userId, tenantId |

### proposal namespace

| Event Type | Phase | Emitted By | Payload Fields |
|------------|-------|------------|----------------|
| `proposal.created` | start/end | Portal proposal routes | tenantId, opportunityId -> proposalId, sectionCount |
| `section.saved` | single | `frontend/app/api/admin/proposals/[proposalId]/sections/[sectionId]/route.ts`, Portal routes | proposalId, sectionId, version |
| `section.exported` | single | `frontend/app/api/admin/proposals/[proposalId]/sections/[sectionId]/export/route.ts` | proposalId, sectionId, format |
| `comment.created` | single | Portal routes | proposalId, nodeId |
| `comment.resolved` | single | Portal routes | commentId |
| `proposal.advanced` | single | Portal routes | proposalId, fromStage, toStage |
| `proposal.stage_advanced` | single | Portal routes | proposalId, fromStage, toStage |
| `proposal.locked` | single | Portal routes | proposalId |
| `proposal.unlocked` | single | Portal routes | proposalId |
| `proposal.review_requested` | single | Portal routes | proposalId |
| `proposal.draft_requested` | single | Portal routes | proposalId |
| `proposal.collaborator_invited` | single | Portal routes | proposalId, email |
| `proposal.team_member_invited` | single | Portal routes | proposalId, email |
| `proposal.dropbox_file_uploaded` | single | Portal routes | proposalId, filename |
| `proposal.dropbox_file_deleted` | single | Portal routes | proposalId, filename |
| `outcome.recorded` | single | Portal routes | proposalId, outcome |

### library namespace

| Event Type | Phase | Emitted By | Payload Fields |
|------------|-------|------------|----------------|
| `file.uploaded` | single | Portal library routes | tenantId, fileCount |
| `unit.uploaded` | single | Portal library routes | tenantId, unitId |
| `document.atomized` | start/end | `frontend/app/api/portal/[tenantSlug]/library/[unitId]/route.ts` | tenantId -> atomsCreated |
| `document.reatomized` | start/end | Portal library routes | tenantId, unitId |
| `unit.updated` | single | `frontend/app/api/portal/[tenantSlug]/library/[unitId]/route.ts` | tenantId, unitId |
| `unit.deleted` | single | `frontend/app/api/portal/[tenantSlug]/library/[unitId]/route.ts` | tenantId, unitId |

### system namespace

| Event Type | Phase | Emitted By | Payload Fields |
|------------|-------|------------|----------------|
| `file.uploaded` | single | `frontend/app/api/admin/storage/route.ts` | key, size |
| `file.deleted` | single | `frontend/app/api/admin/storage/route.ts` | key |
| `file.renamed` | single | `frontend/app/api/admin/storage/route.ts` | oldKey, newKey |
| `content.published` | single | `frontend/app/api/admin/content/route.ts` | contentId |
| `content.updated` | single | `frontend/app/api/admin/content/route.ts` | contentId |
| `content.deleted` | single | `frontend/app/api/admin/content/route.ts` | contentId |
| `sbir_data.ingested` | single | `frontend/app/api/admin/storage/route.ts` (auto-ingest on S3 upload) | key, companiesInserted |
| `notification.requested` | single | Pipeline workflow processor (NOTIFY step) | template, channel, to_role, tenant_id, user_id |
| `workflow.step_completed` | single | `pipeline/src/workflows/processor.py` | workflow_name, step_name |
| `workflow.step_failed` | single | `pipeline/src/workflows/processor.py` | workflow_name, step_name, error |
| `workflow.completed` | single | `pipeline/src/workflows/processor.py` | workflow_name, instance_id |
| `workflow.failed` | single | `pipeline/src/workflows/processor.py` | workflow_name, instance_id, error |

### CMS-bridged events

Events emitted by the CMS service (`services/cms/src/models/events.py`) bridge to `system_events` with `namespace='system'`:

| Event Type | Phase | Emitted By | Payload Fields |
|------------|-------|------------|----------------|
| `content_pipeline.post.created` | single | CMS content router | entity_type, entity_id, post_id |
| `content_pipeline.post.updated` | single | CMS content router | entity_type, entity_id, diff_summary |
| `content_pipeline.post.published` | single | CMS content router | entity_type, entity_id, post_id |
| `content_pipeline.post.publish` | single | CMS content router | post_id |

---

## 3. Event Processors

The CMS event_listener (`services/cms/src/event_listener.py`) polls `system_events` every 10 seconds and matches events against `automation_rules`.

### _action_send_email

**Trigger condition:** Any rule with `action_type = 'send_email'`

**Input:**
- `config.template` - Template name to render (from `services/cms/src/templates.py`)
- `config.subject` - Email subject line (falls back to template name)
- `config.to_field` - Dotted path to recipient in payload (e.g., `result.userId`, `payload.tenantId`)
- `config.to` - Fallback direct email address
- Event payload fields used as template context

**Processing steps:**
1. Render template from `config.template` using payload as context
2. If no HTML rendered, skip (log warning)
3. Resolve recipient: try `config.to_field` path traversal -> try `payload.contactEmail` -> try `config.to`
4. If `to_field` resolves to a UUID (not an email), look up in `users` table, then `tenants` (billing_email or tenant_admin email)
5. Check for DB email template with trigger_config -> build trigger_metadata if present
6. Send via Gmail API (`workers/gmail_client.py` with service account delegation)
7. If trigger_metadata exists and send succeeded, store on `email_sends.trigger_metadata`

**Output/side effects:**
- Gmail email sent
- `email_sends` record may be updated with trigger_metadata
- `automation_log` row written (success/failed)

**Error handling:** Logs error, writes `automation_log` with `status='failed'` and `error_message`. Does not retry.

### _action_notify_admin

**Trigger condition:** Any rule with `action_type = 'notify_admin'`

**Input:**
- `config.to` - Admin email (defaults to `ADMIN_NOTIFICATION_EMAIL` env var, typically `eric@rfppipeline.com`)
- `config.template` - Template name (falls back to `admin_notification`)
- `config.subject` - Subject prefix
- `config.include_payload` - Whether to include event payload in template context
- Event payload merged with `event_type` field

**Processing steps:**
1. Resolve admin email from `config.to` or env var
2. Render template (try specific template, fall back to `admin_notification`)
3. Send email with `[RFP Admin]` subject prefix

**Output/side effects:**
- Gmail email sent to admin
- `automation_log` row written

**Error handling:** Same as send_email.

### _action_create_todo

**Trigger condition:** Any rule with `action_type = 'create_todo'`

**Input:**
- `config.title_template` - Python format string template (e.g., `"Review application from {company_name}"`)
- `config.todo_type` - One of: `curation`, `support`, `content_review`, `campaign`, `general`
- `config.priority` - One of: `critical`, `high`, `medium`, `low`
- Event payload used to fill `title_template` placeholders

**Processing steps:**
1. Get CMS database pool
2. Format title from template using payload dict (safe fallback on KeyError)
3. INSERT into `admin_todos` in CMS Postgres with:
   - `title`: formatted title
   - `todo_type`: from config
   - `priority`: from config
   - `related_entity_type`: event namespace
   - `related_entity_id`: event id
   - `metadata`: full payload as JSON

**Output/side effects:**
- New row in CMS `admin_todos` table
- `automation_log` row written

**Error handling:** Logs warning if CMS database not connected. Logs error on INSERT failure.

**State changes:** Creates `admin_todos` row with `status='open'`.

### _action_enroll_drip

**Trigger condition:** Any rule with `action_type = 'enroll_drip'`

**Input:**
- `config.campaign` - Drip campaign name (looked up by ILIKE in `email_campaigns`)
- Event payload for recipient resolution

**Processing steps:**
1. Look up drip campaign by name in CMS DB (`campaign_type = 'drip'`)
2. If not found, log warning and return
3. Resolve recipient email from payload (`contactEmail`, `email`, `billing_email`) or by looking up `user_id`/`tenant_id` in shared DB
4. Check for existing active enrollment (dedup)
5. If already enrolled, skip
6. Compute `next_send_at` from first drip_sequence step's `delay_hours`
7. INSERT into `drip_enrollments`

**Output/side effects:**
- New row in CMS `drip_enrollments` table
- Drip engine worker will process the enrollment on schedule
- `automation_log` row written

**Error handling:** Logs warning on missing campaign, missing recipient. Logs error on DB failures.

**State changes:** Creates `drip_enrollments` row with `status='active'`, `current_step=0`.

### _action_distribute_social

**Trigger condition:** Any rule with `action_type = 'distribute_social'`

**Input:**
- `config.platforms` - Array of platforms (e.g., `["linkedin"]`)
- Event payload for content: `title`, `excerpt`/`body` (truncated to 280 chars), `url`/`link_url`, `entity_id`/`content_id`

**Processing steps:**
1. Get CMS database pool
2. Extract content from event payload
3. If no content body, skip
4. Set `scheduled_at` to now + 5 minutes (review window)
5. For each platform in config:
   - Find active `social_accounts` for that platform
   - INSERT into `social_posts` for each account with `status='scheduled'`

**Output/side effects:**
- New rows in CMS `social_posts` table (one per active account per platform)
- Posts scheduled for 5 minutes in the future
- `automation_log` row written

**Error handling:** Logs error per platform on failure. Continues to next platform.

**State changes:** Creates `social_posts` rows with `status='scheduled'`.

### _action_publish_content

**Trigger condition:** Any rule with `action_type = 'publish_content'`

**Input:**
- `config.post_id` or `payload.post_id` - CMS post UUID
- `config.content_type` - Content type for main DB (default: `blog_post`)

**Processing steps:**
1. Get both CMS pool and shared (main) DB pool
2. Fetch full post from CMS `cms_posts` table
3. If post not found or `status != 'published'`, skip
4. Determine `content_type` from post category or config
5. UPSERT into main DB `cms_content` by slug:
   - Maps: slug, title, body, excerpt, content_type, author, tags, status, published, published_at, featured_image, metadata
   - `ON CONFLICT (slug) DO UPDATE` to sync changes

**Output/side effects:**
- Row created or updated in main DB `cms_content`
- Bridges CMS content to the public-facing main database
- `automation_log` row written

**Error handling:** Logs warning on missing post/shared pool.

**State changes:** Creates or updates `cms_content` row with `status='published'`, `published=true`.

---

## 4. Event State Machine

### Lifecycle of an event from emission to completion

```
1. EMISSION
   ├─ Frontend: emitEventSingle/Start/End (lib/events.ts)
   │   → INSERT INTO system_events
   │   → pg_notify('events:{namespace}', ...) fires automatically via trigger
   │
   ├─ Pipeline: emit_event (pipeline/src/events.py)
   │   → INSERT INTO system_events
   │   → Same pg_notify trigger fires
   │
   └─ CMS: emit_event (services/cms/src/models/events.py)
       → INSERT INTO cms_events (local)
       → INSERT INTO system_events (bridged, namespace='system')
       → UPDATE cms_events SET bridged=TRUE

2. CMS EVENT LISTENER POLL (every 10 seconds)
   ├─ Query: SELECT * FROM system_events WHERE created_at > $last_processed_at
   │         ORDER BY created_at ASC LIMIT 50
   │
   ├─ On first run: only events from last 5 minutes
   │
   └─ Special handling: system:notification.requested → _handle_notification_requested()
      (bypasses automation_rules matching)

3. RULE MATCHING
   ├─ Fetch all rows from automation_rules
   ├─ For each event, check each rule:
   │   Schema v1 (019+): trigger_namespace == event.namespace AND trigger_type == event.type
   │   Schema v2 (001):  trigger_bus == namespace AND event_type IN trigger_events
   │
   └─ Multiple rules can match the same event

4. DEDUP CHECK
   ├─ For action types: send_email, notify_admin, create_todo, enroll_drip, distribute_social, publish_content
   ├─ Query automation_log WHERE trigger_event_id = $event_id AND action_type = $type
   │   AND status = 'success' AND executed_at > NOW() - 5 minutes
   └─ If found, skip (log "Skipping duplicate")

5. ACTION DISPATCH (_do_action)
   ├─ create_todo      → _action_create_todo
   ├─ enroll_drip       → _action_enroll_drip
   ├─ distribute_social → _action_distribute_social
   ├─ publish_content   → _action_publish_content
   ├─ send_email        → template render + gmail send
   ├─ notify_admin      → admin template render + gmail send
   └─ (fallback)        → infer send_email if config has template/to

6. LOGGING
   └─ INSERT INTO automation_log (
        rule_id, trigger_event_id, action_type, status, result, error_message, executed_at
      )
      status: 'success' | 'failed' | 'skipped'
```

### Error handling at each step

| Step | Error Behavior |
|------|----------------|
| Event emission (frontend) | Catches error, logs with tagged prefix, does NOT re-throw (fire-and-forget) |
| Event emission (pipeline) | Returns empty string on failure, logs error |
| Event emission (CMS bridge) | Local event succeeds even if bridge fails; logs bridge error |
| Poll loop | Catches all exceptions, logs, sleeps 10s, retries forever |
| Schema discovery | If automation_rules schema unreadable, returns (skip entire poll cycle) |
| Rule matching | Per-rule try/catch; one rule failure does not block others |
| Action execution | Per-action try/catch; failure logged to automation_log |
| Email send | Gmail client failure logged; returns error dict; no retry |

### Retry policy

**There is no automatic retry.** Failed actions are logged with `status='failed'` but not retried. The 5-minute dedup window prevents duplicate processing if the same event is re-polled. The poll loop itself runs indefinitely with 10-second intervals.

### Timeout behavior

**No per-action timeouts.** The event listener processes events synchronously within each poll cycle. Long-running actions (e.g., slow Gmail API calls) block the next poll cycle. The `POLL_INTERVAL` (default 10s, configurable via `EVENT_POLL_INTERVAL` env var) only applies between cycles.

---

## 5. Automation Rules Seed Reference

### From migration 019 (automation_and_content)

| Name | Trigger Namespace | Trigger Type | Action Type | Config |
|------|-------------------|--------------|-------------|--------|
| Welcome email on acceptance | `identity` | `tenant.created` | `send_email` | `{"template": "application_accepted"}` |
| Admin alert on new application | `identity` | `application.submitted` | `notify_admin` | `{"template": "admin_new_application", "to": "eric@rfppipeline.com"}` |
| Rejection email | `identity` | `application.rejected` | `send_email` | `{"template": "application_rejected"}` |

### From migration 028 (automation_rules_v2)

| Name | Trigger Namespace | Trigger Type | Action Type | Config |
|------|-------------------|--------------|-------------|--------|
| Welcome new customer | `capture` | `application.accepted` | `send_email` | `{"template": "welcome_accepted", "to_field": "result.userId", "subject": "Welcome to RFP Pipeline!"}` |
| Proposal workspace ready | `proposal` | `proposal.created` | `send_email` | `{"template": "proposal_workspace_ready", "to_field": "payload.tenantId", "subject": "Your proposal workspace is ready"}` |
| New RFP ready for curation | `finder` | `rfp.uploaded` | `notify_admin` | `{"subject": "New RFP uploaded -- ready for curation", "template": "new_rfp_uploaded", "include_payload": true}` |
| Source change detected | `finder` | `source.change_detected` | `notify_admin` | `{"subject": "Source Scout detected changes", "template": "source_change_detected", "include_payload": true}` |
| Proposal stage advanced | `proposal` | `proposal.advanced` | `send_email` | `{"template": "stage_advanced", "to_field": "payload.tenantId", "subject": "Proposal stage updated"}` |
| Topic pinned by customer | `capture` | `topic.pinned` | `notify_admin` | `{"subject": "Customer pinned a topic", "template": "admin_notification", "include_payload": true}` |

### From migration 030a (ensure_full_schema)

No new automation_rules seeds (schema reconciliation only).

### From migration 040 (crm_phase1)

| Name | Trigger Namespace | Trigger Type | Action Type | Config |
|------|-------------------|--------------|-------------|--------|
| Auto-todo on application | `capture` | `application.submitted` | `create_todo` | `{"title_template": "Review application from {company_name}", "todo_type": "general", "priority": "high"}` |
| Social distribute on publish | `system` | `content.published` | `distribute_social` | `{"platforms": ["linkedin"]}` |
| Auto-todo on source change | `finder` | `source.change_detected` | `create_todo` | `{"title_template": "Review scout changes: {source_name}", "todo_type": "curation", "priority": "medium"}` |
| Publish CMS content to site | `system` | `content_pipeline.post.publish` | `publish_content` | `{"content_type": "blog_post"}` |

### Complete active rules summary

| # | Name | Trigger | Action | Purpose |
|---|------|---------|--------|---------|
| 1 | Welcome email on acceptance | identity:tenant.created | send_email | Send welcome email with temp password |
| 2 | Admin alert on new application | identity:application.submitted | notify_admin | Alert admin on new applications |
| 3 | Rejection email | identity:application.rejected | send_email | Send rejection notification |
| 4 | Welcome new customer | capture:application.accepted | send_email | Welcome email to accepted applicant |
| 5 | Proposal workspace ready | proposal:proposal.created | send_email | Notify customer of new workspace |
| 6 | New RFP ready for curation | finder:rfp.uploaded | notify_admin | Alert admin when RFP uploaded |
| 7 | Source change detected | finder:source.change_detected | notify_admin | Alert admin on Source Scout changes |
| 8 | Proposal stage advanced | proposal:proposal.advanced | send_email | Notify customer of stage change |
| 9 | Topic pinned by customer | capture:topic.pinned | notify_admin | Alert admin when customer pins topic |
| 10 | Auto-todo on application | capture:application.submitted | create_todo | Create review task for new applications |
| 11 | Social distribute on publish | system:content.published | distribute_social | Post to LinkedIn on CMS publish |
| 12 | Auto-todo on source change | finder:source.change_detected | create_todo | Create curation task on scout changes |
| 13 | Publish CMS content to site | system:content_pipeline.post.publish | publish_content | Push CMS posts to main DB cms_content |

**Note:** Rules from 019 use `identity` namespace for application events while rules from 028/040 use `capture` namespace. Both sets are active (ON CONFLICT name DO NOTHING prevents duplicates). The event_listener matches against actual events emitted, so the effective trigger depends on which namespace the frontend actually uses when emitting. Currently, `application.submitted` is emitted under `capture` namespace, making the 019 rule (identity:application.submitted) a no-op while the 040 rule (capture:application.submitted) fires.
