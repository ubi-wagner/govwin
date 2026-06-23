# CMS/CRM Service — Complete File Inventory

> Generated 2026-06-23 by automated analysis of every tracked `.py`, `.ts`, `.tsx` file.
> Verdict: **THE SERVICE IS FULLY IMPLEMENTED AND OPERATIONAL** — not dormant. CLAUDE.md is wrong.

---

## 1. Service Entry Point

### `services/cms/src/main.py`

**Use:** FastAPI application factory. Registers all routers, mounts the SPA static files, and launches six background worker loops as asyncio tasks via the `lifespan` async context manager.

**App startup sequence (main.py:64–91):**
1. `init_db()` — connects to **CMS-own** `govtech_cms` DB via `CMS_DATABASE_URL`
2. `init_event_bridge()` — connects to **shared** `govtech_intel` DB via `SHARED_DATABASE_URL`
3. `start_event_listener()` — starts polling `system_events` in the shared DB
4. Six `asyncio.create_task(_run_worker(...))` calls launch all six worker loops concurrently with automatic crash-restart / exponential backoff (1 s → 300 s cap)

**Worker tasks launched:**
- `content_generator.generation_loop`
- `email_queue.queue_loop`
- `email_sweep.sweep_loop`
- `campaign_executor.executor_loop`
- `drip_engine.drip_loop`
- `social_poster.social_loop`

**Routers included:**
- `/health` — `routers/health`
- `/api/auth/*` — `routers/auth`
- `/api/email/*` — `routers/email`
- `/api/content/*` — `routers/content`
- `/api/media/*` — `routers/media`
- `/api/social/*` — `routers/social`
- `/api/drip/*` — `routers/drip`
- `/api/todos` — `routers/todos`
- `/api/page-blocks/*` — `routers/page_blocks`

**SPA mount:** `/cms` and `/cms/{rest}` served from `static/index.html` (built Vite bundle). The static dir is checked at runtime; missing it returns a 404 JSON — not a crash.

**Runtime:** ACTIVE

---

## 2. Database Layer

### `services/cms/src/models/database.py`

**Use:** Two asyncpg connection pools.

| Pool | Env var | Database | Purpose |
|------|---------|----------|---------|
| `_pool` (CMS-own) | `CMS_DATABASE_URL` | `govtech_cms` (own DB) | All CMS-local tables |
| `_event_pool` (shared bridge) | `SHARED_DATABASE_URL` | `govtech_intel` (shared) | Reads `system_events`, `automation_rules`, `users`, `tenants`; writes `system_events`, `cms_content` |

`CMS_DATABASE_URL` **must** be set or startup fails with `RuntimeError`. `SHARED_DATABASE_URL` is optional; the event listener warns and disables itself if absent.

**Runtime:** ACTIVE

---

## 3. Event Listener

### `services/cms/src/event_listener.py`

**Use:** Polls `system_events` in the shared DB every 10 s (configurable via `EVENT_POLL_INTERVAL`). Matches events against `automation_rules`. Executes automation actions.

**DB reads (shared pool):**
- `information_schema.columns` — introspects `automation_rules` schema dynamically (handles two column variants)
- `automation_rules` — fetches all rules
- `system_events` — fetches new events since `_last_processed_at`; first poll = last 5 minutes
- `users` — `_resolve_recipient_email` resolves user IDs to emails
- `tenants` — `_resolve_recipient_email` resolves tenant IDs to billing emails

**DB writes (shared pool):**
- `system_events` — `_emit_action_event` writes `action.*` start/end pairs and `notification.failed` events
- `automation_log` — every rule execution is logged

**DB writes (CMS pool):**
- `admin_todos` — `_action_create_todo`
- `email_campaigns` / `drip_enrollments` / `drip_sequences` — `_action_enroll_drip`
- `social_posts` / `social_accounts` — `_action_distribute_social`
- `cms_posts` — `_action_publish_content` reads from here
- `email_sends` — stores trigger_metadata for send_email action

**DB writes (shared pool via publish/unpublish):**
- `cms_content` — `_action_publish_content` and `_action_unpublish_content` upsert/update here

**Actions dispatched by `_do_action_inner`:**
| Action type | Handler | Status |
|-------------|---------|--------|
| `send_email` | inline | ACTIVE |
| `notify_admin` | inline | ACTIVE |
| `create_todo` | `_action_create_todo` | ACTIVE |
| `enroll_drip` | `_action_enroll_drip` | ACTIVE |
| `distribute_social` | `_action_distribute_social` | ACTIVE (creates DB rows; actual posting is stub — see social_poster) |
| `publish_content` | `_action_publish_content` | ACTIVE |
| `unpublish_content` | `_action_unpublish_content` | ACTIVE (was a bug — now wired; see INC-8) |

**Events consumed:**
- Namespace: ANY (rules can match any namespace/event_type combination)
- Special fast-path: `system:notification.requested` is handled directly via `_handle_notification_requested` without going through `automation_rules`

**Phase double-fire bug — STATUS: FIXED**
`_rule_matches` (lines 185–235) guards against double-fire: phase `start` never matches unless a rule has an explicit `trigger_phase = 'start'` opt-in. Terminal phases (`end`, `single`, `''`) match. Covered by `test_rule_matching_phase.py`.

**Unpublish no-op bug — STATUS: FIXED**
`_action_unpublish_content` (lines 832–869) now exists and issues a real `UPDATE cms_content SET status='draft'...`. Previously this handler was absent (migration 050 created the rule without the handler). Covered by `test_no_phantom_executors.py`.

**Runtime:** ACTIVE — task started at `main.py:70`

---

## 4. Workers

### `services/cms/src/workers/content_generator.py`

**Use:** Polls `cms_generations` table for `status='pending'` rows (SKIP LOCKED). Calls Anthropic Claude API to generate content. Supports five source types: `prompt`, `url`, `email`, `screenshot`, `repackage`.

**Poll interval:** 30 s (configurable via `GENERATION_POLL_INTERVAL`)

**DB reads/writes (CMS pool):**
- `cms_generations` — UPDATE → generating; UPDATE → completed/failed
- `cms_media` — fetches image data for vision/screenshot mode
- `email_sends` — fetches email content for email-source mode

**DB writes (shared pool):**
- `system_events` — emits `system:content.generated:start` and `system:content.generated:end`

**Model used:** `anthropic.AsyncAnthropic()` — reads `ANTHROPIC_API_KEY` implicitly; hardcoded to `claude-sonnet-4-20250514` for email-triggered content requests (line 83), caller-specified model otherwise.

**Runtime:** ACTIVE — loop task launched at `main.py:74`

---

### `services/cms/src/workers/email_queue.py`

**Use:** Dequeues `email_queue` rows (SKIP LOCKED, batch 10). Sends via `gmail_client.send_email`. Implements exponential retry (60 s → 120 s → ... → 3600 s cap, max attempts per row). Enforces daily send limits per account. Embeds trigger flags into HTML before send if `trigger_metadata` present.

**Poll interval:** 15 s

**DB reads/writes (CMS pool):**
- `email_queue` — lock/delete rows
- `email_sends` — READ subject/body/account; UPDATE status=sending/sent/failed; UPDATE gmail_message_id/thread_id
- `email_accounts` — READ delegate_email/limits; UPDATE sends_today
- `email_campaigns` — UPDATE total_sent
- `email_threads` — UPSERT thread record after send

**DB writes (shared pool):**
- `system_events` — `system:email.sent:start/end`

**Runtime:** ACTIVE — loop task launched at `main.py:75`

---

### `services/cms/src/workers/email_sweep.py`

**Use:** Sweeps Gmail inbox via History API for all `sweep_enabled=TRUE, is_active=TRUE` email accounts. Matches incoming messages to sends by thread_id/in-reply-to. Records reply engagement. Updates thread status. Classifies replies with Claude via `template_drafter.interpret_reply`. Auto-drafts HITL responses based on `trigger_metadata.response_map`. Detects content-request emails (TO: content@rfppipeline.com or subject prefix `[CONTENT REQUEST]`).

**Poll interval:** 300 s (5 min)

**DB reads/writes (CMS pool):**
- `email_accounts` — SELECT sweep_enabled accounts; UPDATE last_sweep_at, sweep_history_id
- `email_sends` — match by gmail_thread_id / gmail_message_id; INSERT auto-response sends
- `email_engagement` — INSERT reply records; UPDATE reply_sentiment, reply_intent, reply_interpreted
- `email_campaigns` — UPDATE total_replied
- `email_threads` — UPSERT on reply
- `email_outbox` — INSERT HITL outbox entry for auto-response
- `email_templates` — fetch response_map for auto-draft
- `cms_generations` — INSERT new generation request for content-request emails

**DB writes (shared pool):**
- `system_events` — fire-and-forget events via `emit_event`

**Runtime:** ACTIVE — loop task launched at `main.py:76`

---

### `services/cms/src/workers/campaign_executor.py`

**Use:** Polls `email_campaigns` where `status='active'` and `campaign_type IN ('one_time','recurring')` (SKIP LOCKED, batch 5). Creates `email_sends` per recipient from audience queries. Routes to HITL outbox if `hitl_required=TRUE`, else directly to `email_queue`. Logs to `campaign_execution_log`.

**Poll interval:** 60 s

**DB reads (CMS pool):** `email_campaigns`, `email_templates`, `email_sends` (dedup check), `email_accounts`
**DB writes (CMS pool):** `email_campaigns` (status=completed), `email_sends` (INSERT), `email_outbox` (INSERT), `email_queue` (INSERT), `campaign_execution_log` (INSERT/UPDATE)

**DB reads (shared pool):** `tenants`, `users` — audience enumeration for `all_active`, `tier_based`, `segment`, `lifecycle_stage` audience types

**DB writes (shared pool):**
- `system_events` — `system:campaign.executed:start/end`

**Known issue:** Recurring campaigns use `_execute_recurring_campaign` which deduplicates by `(campaign_id, recipient_email)` in `email_sends`, making it effectively one-time-per-recipient (no true cron; full cron parsing explicitly deferred to V2 — line 342 comment).

**Runtime:** ACTIVE — loop task launched at `main.py:77`

---

### `services/cms/src/workers/drip_engine.py`

**Use:** Polls `drip_enrollments` where `status='active' AND next_send_at <= now()` (SKIP LOCKED, batch 20). Advances each enrollment one step: creates `email_send`, updates `current_step`, computes next `next_send_at`. If no more steps exist, marks enrollment `completed`.

**Poll interval:** 60 s

**DB reads/writes (CMS pool):**
- `drip_enrollments` — lock batch; UPDATE current_step, last_sent_at, next_send_at, status
- `drip_sequences` — SELECT next step; SELECT step after for delay computation
- `email_campaigns` — READ account_id, hitl_required
- `email_templates` — READ subject/body
- `email_sends` — INSERT
- `email_outbox` — INSERT (if hitl_required)
- `email_queue` — INSERT (if not hitl_required)
- `campaign_execution_log` — INSERT drip_step record

**DB writes (shared pool):**
- `system_events` — `system:drip.step_sent:start/end`

**Runtime:** ACTIVE — loop task launched at `main.py:78`

---

### `services/cms/src/workers/social_poster.py`

**Use:** Polls `social_posts` where `status='scheduled' AND scheduled_at <= now()` (SKIP LOCKED, batch 10). Dispatches to platform adapters. Retries up to 3 times with 5-min delay.

**Poll interval:** 60 s

**DB reads/writes (CMS pool):**
- `social_posts` — UPDATE status=posting; UPDATE status=posted/failed; UPDATE retry_count, scheduled_at
- `social_accounts` — READ credentials

**Platform adapters:**
| Platform | Status |
|----------|--------|
| `linkedin` | **STUB** — builds ugcPost payload but raises `NotImplementedError("LinkedIn API posting not yet implemented — OAuth token exchange pending")` (lines 77–95). Worker catches `NotImplementedError` specifically and marks post `failed` without retry. |
| `twitter` | **STUB** — `raise NotImplementedError('Twitter/X posting not yet implemented')` (line 100) |

**Social posting is thus entirely non-functional at the platform API level.** The DB machinery (scheduling, status management, retry logic) works; the outbound API calls do not. `_action_distribute_social` in event_listener creates `social_posts` rows, which the worker then attempts to post and immediately fails with `failed` status.

**Runtime:** ACTIVE (loop runs; all posts immediately fail with NotImplementedError)

---

### `services/cms/src/workers/gmail_client.py`

**Use:** Wraps Google APIs. Supports two auth modes (auto-detected): service account domain-wide delegation (via `GOOGLE_SERVICE_ACCOUNT_JSON` or `GOOGLE_SERVICE_ACCOUNT_PATH`) or OAuth2 refresh token (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`). Runs sync Google API calls in a thread executor to avoid blocking the event loop.

**Key functions:** `send_email`, `sweep_inbox`, `get_message`, `extract_headers`, `extract_body_text`

**Runtime:** ACTIVE if Google credentials are configured

---

### `services/cms/src/workers/template_drafter.py`

**Use:** Uses Anthropic Claude to draft email templates from a prompt. Also provides `interpret_reply` (classifies reply sentiment/intent). Called by `email.py` (draft endpoint) and `email_sweep.py` (reply interpretation).

**Runtime:** ACTIVE (requires `ANTHROPIC_API_KEY`)

---

## 5. Routers

### `services/cms/src/routers/health.py`

**Use:** `GET /health` — returns `{status: ok, service: cms, database: connected|error, pending_generations: N, anthropic_key_set: bool}`. Always returns 200 (Railway liveness check).

**Runtime:** ACTIVE

---

### `services/cms/src/routers/auth.py`

**Use:** Session-based authentication for the CMS SPA. Issues JWT cookies (24 h, signed with `CMS_JWT_SECRET` or `CMS_API_KEY`). Only `master_admin` and `rfp_admin` users can log in. Authenticates against the **shared DB** `users` table.

**HTTP Routes:**
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/login | Bcrypt password check; sets `cms_login_session` JWT cookie |
| POST | /api/auth/logout | Clears cookie |
| GET | /api/auth/me | Returns current user from JWT cookie |

**DB reads (shared pool):** `users` — by email, role in (master_admin, rfp_admin)
**DB writes (shared pool):** `users` — UPDATE last_login_at; `system_events` — identity:cms_user.logged_in/login_failed

**Runtime:** ACTIVE

---

### `services/cms/src/routers/email.py`

**Use:** Full email automation CRUD — accounts, templates, campaigns, sends, engagement, threads, HITL outbox. This is the largest router (~1455 lines).

**HTTP Routes:**
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/email/accounts | List email accounts |
| GET | /api/email/accounts/{id} | Get account |
| POST | /api/email/accounts | Create account |
| PATCH | /api/email/accounts/{id} | Update account |
| GET | /api/email/templates | List templates |
| GET | /api/email/templates/categories | List categories with counts |
| GET | /api/email/templates/{id} | Get template |
| POST | /api/email/templates | Create template |
| PATCH | /api/email/templates/{id} | Update template |
| POST | /api/email/templates/draft | AI-draft template with Claude |
| POST | /api/email/templates/{id}/preview | Render template preview with Jinja2 |
| POST | /api/email/templates/{id}/test-send | Send test email (bypasses HITL) |
| GET | /api/email/campaigns | List campaigns |
| GET | /api/email/campaigns/{id} | Get campaign |
| POST | /api/email/campaigns | Create campaign |
| PATCH | /api/email/campaigns/{id} | Update campaign |
| POST | /api/email/campaigns/{id}/action | Activate/pause/resume/cancel/complete campaign |
| GET | /api/email/campaigns/{id}/stats | Campaign engagement stats |
| POST | /api/email/sends | Create send (→ HITL outbox) |
| GET | /api/email/sends | List sends |
| GET | /api/email/sends/{id} | Get send |
| GET | /api/email/engagement | List engagement records |
| GET | /api/email/threads | List threads |
| GET | /api/email/threads/{id} | Get thread with messages |
| GET | /api/email/outbox | List HITL outbox items |
| GET | /api/email/outbox/stats | Outbox counts dashboard |
| GET | /api/email/outbox/{id} | Get outbox item |
| POST | /api/email/outbox/{id}/claim | Claim item (send as my account) |
| POST | /api/email/outbox/{id}/unclaim | Release claim |
| PATCH | /api/email/outbox/{id}/modify | Edit content before approval |
| POST | /api/email/outbox/{id}/approve | Approve → queued → queue worker picks up |
| POST | /api/email/outbox/bulk-approve | Approve up to 50 items (transaction) |
| POST | /api/email/outbox/{id}/reject | Reject |

**DB reads/writes (CMS pool):** `email_accounts`, `email_templates`, `email_campaigns`, `email_sends`, `email_engagement`, `email_threads`, `email_outbox`, `email_queue`

**Runtime:** ACTIVE

---

### `services/cms/src/routers/content.py`

**Use:** CMS content pipeline — posts CRUD, workflow state machine, AI revision, generation request management.

**HTTP Routes:**
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/content/posts | List posts (status/category filter) |
| GET | /api/content/posts/{id} | Get post |
| POST | /api/content/posts | Create draft post |
| PATCH | /api/content/posts/{id} | Update post fields |
| POST | /api/content/posts/{id}/action | submit_review/approve/reject/publish/unpublish/archive/revert |
| POST | /api/content/posts/{id}/revise | AI revision using Claude (inline, not queued) |
| GET | /api/content/posts/{id}/reviews | Review history |
| GET | /api/content/generations | List generations |
| POST | /api/content/generations | Create generation request |
| GET | /api/content/generations/{id} | Get generation (poll for status) |
| POST | /api/content/generations/from-url | Shortcut: URL-source generation |
| POST | /api/content/generations/from-email/{id} | Email-source generation |
| POST | /api/content/generations/{id}/action | accept/reject/retry |

**DB reads/writes (CMS pool):** `cms_posts`, `cms_reviews`, `cms_generations`

**Runtime:** ACTIVE

---

### `services/cms/src/routers/media.py`

**Use:** Media file upload, listing, serving, metadata management. Files stored on Railway persistent volume (`/data/cms`). Metadata in CMS DB.

**HTTP Routes:**
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/media/upload | Upload image/document (multipart) |
| GET | /api/media/list | List media with filters |
| GET | /api/media/file/{path} | Serve file (FileResponse) |
| PATCH | /api/media/{id} | Update metadata |
| DELETE | /api/media/{id} | Delete file and metadata |
| GET | /api/media/stats | Storage usage stats |

**DB reads/writes (CMS pool):** `cms_media`, `cms_posts` (featured image back-link)

**Runtime:** ACTIVE

---

### `services/cms/src/routers/social.py`

**Use:** Social media account/post management. Creates scheduled posts in DB. Actual posting is done by `social_poster` worker (which is stubbed — see above).

**HTTP Routes:**
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/social/accounts | List social accounts |
| POST | /api/social/accounts | Register account |
| PATCH | /api/social/accounts/{id} | Update account / token refresh |
| GET | /api/social/posts | List posts |
| POST | /api/social/posts | Create/schedule post |
| POST | /api/social/posts/{id}/publish | Publish now (sets scheduled_at=now) |
| PATCH | /api/social/posts/{id} | Update post |

**DB reads/writes (CMS pool):** `social_accounts`, `social_posts`

**Runtime:** ACTIVE (routes work; actual platform posting is stubbed)

---

### `services/cms/src/routers/drip.py`

**Use:** Drip sequence and enrollment management.

**HTTP Routes:**
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/drip/campaigns/{id}/sequences | List drip steps |
| POST | /api/drip/campaigns/{id}/sequences | Add step |
| PATCH | /api/drip/sequences/{id} | Update step |
| DELETE | /api/drip/sequences/{id} | Remove step |
| GET | /api/drip/campaigns/{id}/enrollments | List enrollments |
| POST | /api/drip/campaigns/{id}/enroll | Enroll recipient |
| POST | /api/drip/enrollments/{id}/pause | Pause enrollment |
| POST | /api/drip/enrollments/{id}/resume | Resume enrollment |
| POST | /api/drip/enrollments/{id}/cancel | Cancel enrollment |

**DB reads/writes (CMS pool):** `drip_sequences`, `drip_enrollments`, `email_campaigns`

**Runtime:** ACTIVE

---

### `services/cms/src/routers/todos.py`

**Use:** Admin TODO management. TODOs created by event listener actions (`create_todo`) and manually.

**HTTP Routes:**
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/todos | List todos (type/status/priority/assigned_to filters) |
| POST | /api/todos | Create todo |
| PATCH | /api/todos/{id} | Update todo (status, assignment, priority) |

**DB reads/writes (CMS pool):** `admin_todos`

**Runtime:** ACTIVE

---

### `services/cms/src/routers/page_blocks.py`

**Use:** Visual editor for page-block CMS content. Reads/writes staging copy in CMS DB (`cms_posts`). Publish bridges blocks to the live public reference in shared DB (`cms_content`). Includes AI generation (Claude), AI revision, URL-to-content generation, and ISR revalidation of the Next.js frontend.

**HTTP Routes:**
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/page-blocks/?page=X | List page blocks from cms_posts |
| PATCH | /api/page-blocks/ | Batch update blocks (version snapshot in metadata) |
| POST | /api/page-blocks/publish | Publish all blocks → cms_content bridge |
| POST | /api/page-blocks/submit-review | Move drafts to pending |
| POST | /api/page-blocks/approve | Approve pending → publish bridge |
| POST | /api/page-blocks/reject | Reject pending → back to draft |
| POST | /api/page-blocks/reorder | Atomic reorder (display_order update) |
| POST | /api/page-blocks/add-blank | Create blank block in cms_posts |
| DELETE | /api/page-blocks/{id} | Delete from cms_posts + cms_content |
| POST | /api/page-blocks/ai/generate | Claude-generate block content |
| POST | /api/page-blocks/ai/revise | Claude-revise existing block |
| POST | /api/page-blocks/ai/from-url | Generate from URL source |
| POST | /api/page-blocks/revalidate | Trigger Next.js ISR revalidation |

**Auth:** requires JWT session cookie (`cms_login_session`) or `x-cms-api-key` header (hmac.compare_digest).

**DB reads/writes (CMS pool):** `cms_posts`
**DB reads/writes (shared pool):** `cms_content` (publish/approve bridge writes; delete cleanup)

**Runtime:** ACTIVE

---

## 6. Support Modules

### `services/cms/src/middleware/auth.py`

**Use:** Starlette `BaseHTTPMiddleware`. Checks all `/api/*` requests for: `X-CMS-API-Key` header, legacy API-key-derived session cookie, or JWT login session cookie. Public paths: `/health`, `/docs`, `/openapi.json`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`. SPA paths (`/cms/*`) optionally use HTTP Basic Auth (legacy `CMS_AUTH_MODE=basic`). Fail-closed: if `CMS_API_KEY` not set, returns 503.

**Runtime:** ACTIVE

---

### `services/cms/src/templates.py`

**Use:** Jinja2-based template rendering. Two environments (HTML with autoescape; plain-text without). Implements trigger flag system (base64-encoded JSON embedded as HTML comments `<!--RFP-TRIGGER:...-->`). `render_template()` looks up named templates from a built-in TEMPLATES dict and falls back to treating the input as an inline Jinja2 template. `render_db_template()` fetches from `email_templates` table. `resolve_profile_variables()` queries shared DB for tenant/user data.

**Templates defined in TEMPLATES dict (all in-code, not files):** `new_rfp_uploaded`, `source_change_detected`, `stage_advanced`, `admin_notification`, `welcome_accepted`, `application_accepted`, `rfp_ready_for_curation`, `review_ready`, `proposal_final_ready`, `admin_proposal_review_required`, `spotlight_new_topics`, `source_scout_changes` + several more. Full list available in the module.

**Runtime:** ACTIVE

---

### `services/cms/src/sender_identity.py`

**Use:** Resolves the From address for outgoing email. Three identities: `automation` (automation@rfppipeline.com), `engagement` (eric@rfppipeline.com), `cms_service` (cms_gmail_service@rfppipeline.com). Resolution priority: explicit identity hint > DB `sender_identities` table (loaded at startup, refreshed every 300 s) > namespace mapping > template heuristic > caller default. Fail-safe: never raises, always returns a valid address.

**Runtime:** ACTIVE

---

### `services/cms/src/models/events.py`

**Use:** `emit_event()` writes to CMS-local `cms_events` table, then bridges to shared `system_events` with `namespace='system'`. Used by all routers and workers for audit trail. Bridging failures are logged but don't abort the operation.

**Runtime:** ACTIVE

---

### `services/cms/src/models/schemas.py`

**Use:** Pydantic models for request validation: `PostCreate`, `PostUpdate`, `WorkflowAction`, `GenerationRequest`, `GenerationAction`, `MediaOut`, `MediaUpdate`.

---

### `services/cms/src/models/email_schemas.py`

**Use:** Pydantic models for email router: `AccountCreate`, `AccountUpdate`, `TemplateCreate`, `TemplateUpdate`, `TemplateDraftRequest`, `TemplatePreviewRequest`, `TemplateTestSendRequest`, `CampaignCreate`, `CampaignUpdate`, `CampaignAction`, `SendCreate`, `OutboxClaim`, `OutboxModify`, `OutboxApprove`, `OutboxBulkApprove`, `OutboxReject`.

---

### `services/cms/src/storage/volume.py`

**Use:** File storage abstraction for the Railway persistent volume at `CMS_STORAGE_ROOT` (default `/data/cms`). Validates MIME type and file size (images: 20 MB max; documents: 50 MB). Generates UUID-keyed paths. `get_storage_stats()` walks the volume directory.

**Runtime:** ACTIVE

---

### `services/cms/src/__init__.py`, `services/cms/src/middleware/__init__.py`, `services/cms/src/models/__init__.py`, `services/cms/src/routers/__init__.py`, `services/cms/src/workers/__init__.py`

All empty init files for package discovery. No logic.

---

## 7. SPA Frontend (`services/cms/frontend/src/`)

Built with Vite + React + React Router. Served by the FastAPI app as static files under `/cms/`.

### `main.tsx`
App entry point. Mounts React with `<BrowserRouter>`.

### `App.tsx`
Route table. Maps paths to page components. Wraps protected routes in auth check (redirect to Login if no session).

### `lib/api.ts`
Fetch wrapper. All calls go to `/api` (same-origin). Unwraps `{ data: ... }` response envelope.

### `components/Layout.tsx`
Sidebar navigation with links to all sections (Email, Content, Social, Drip, Todos, Page Blocks, Dashboard).

### `components/MetadataEditor.tsx`
Form fields for post SEO metadata (title, description, canonical URL).

### `components/RichTextEditor.tsx`
Rich text editor for post bodies.

### `components/StageIndicator.tsx`
Visual status badge for workflow stages.

### `components/AIRevisionPanel.tsx`
Panel for AI revision instructions; calls `/api/content/posts/{id}/revise`.

### `pages/Login.tsx`
Login form. POSTs to `/api/auth/login`. Sets session on success.

### `pages/Dashboard.tsx`
Overview counts (email accounts, active campaigns, pending outbox, content posts, social accounts, open todos). Six parallel API calls.

### `pages/ContentPipeline.tsx`
Lists `cms_generations` with status badges and action buttons.

### `pages/ContentGenerations.tsx`
Detailed AI generation management UI.

### `pages/ContentEditor.tsx`
Full post editing UI with rich text editor, metadata editor, AI revision panel, workflow action buttons.

### `pages/ContentPreview.tsx`
Rendered HTML preview of a post.

### `pages/EmailAccounts.tsx`
CRUD UI for email accounts.

### `pages/EmailCampaigns.tsx`
Campaign list and management. Supports all campaign types (one_time, recurring, drip, triggered).

### `pages/EmailOutbox.tsx`
HITL review queue. Claim, modify, approve, bulk-approve, reject emails.

### `pages/DripCampaigns.tsx`
Drip campaign and enrollment management.

### `pages/SocialAccounts.tsx`
Social account registration and management.

### `pages/SocialPosts.tsx`
Social post scheduling and status. Note: all posts fail at platform level (stubbed).

### `pages/Todos.tsx`
Admin TODO list with filtering and status updates.

### `pages/PageEditor.tsx`
Visual page block editor. Connects to `/api/page-blocks/*` endpoints for draft/publish/approve workflow.

### `vite.config.ts`
Vite build config. Proxies `/api` to CMS backend in dev mode.

---

## 8. Tests

### `tests/conftest.py`
Pytest fixtures (sample_template fixture used by test_templates.py).

### `tests/test_health.py`
Health endpoint test.

### `tests/test_rule_matching_phase.py`
Phase-aware rule matching: `_rule_matches` fires on terminal phases only (end/single/unphased), never on `start`. Covers both schema variants (trigger_namespace+trigger_type and trigger_bus+trigger_events). Explicitly tests that a start/end pair fires exactly once. **All tests pass (no DB required).**

### `tests/test_no_phantom_executors.py`
Structural guard: every action type in the dedup tuple has a corresponding dispatch branch in `_do_action_inner`. Tests that `unpublish_content` is wired. Tests that `publish_content` and `unpublish_content` are symmetric. **All tests pass (no DB required).**

### `tests/test_notify_templates.py`
Locks that all six workflow NOTIFY templates render non-None output. Tests empty-payload resilience. Regression lock for migration-052 (rfp_ready_for_curation, source_scout_changes). **All tests pass (no DB required).**

### `tests/test_templates.py`
Jinja2 rendering, `render_template` behavior (known names, unknown names, inline templates), trigger flag embed/extract roundtrip, `build_trigger_metadata` shape. **All tests pass (no DB required).**

### `tests/test_error_gating.py`
Source-level lock: confirms `event_listener` source contains `event.get('error')` check that skips errored events. **Passes (no DB required).**

### `tests/test_page_blocks_router.py`
Unit tests for `_row_to_block` serializer and router logic. Mocks all DB connections. **Likely passes (no DB required).**

### `tests/test_page_blocks_integration.py`
Real two-database integration test: publishes blocks from CMS DB to shared DB, verifies editing bookkeeping is stripped from public copy, verifies idempotency. **Requires TEST_DATABASE_URL and TEST_CMS_DATABASE_URL env vars; skipped otherwise.**

### `tests/test_sender_identity.py`
Sender identity resolution: precedence order (explicit > DB > namespace > template > default), env override, DB-backed identity loading, error-safe behavior. **All sync tests pass (no DB required); async tests need asyncpg.**

### `tests/test_todos_router.py`
Todos router tests.

### `tests/__init__.py`
Empty init.

---

## 9. Scripts

### `services/cms/scripts/backfill_page_blocks.py`
One-time migration utility. Copies existing `page_block` rows from shared DB `cms_content` into CMS DB `cms_posts` for the Phase 2 page-block editor rework. Idempotent on slug. Requires both DB URLs as env vars.

---

## 10. DB Migrations (`services/cms/db/`)

11 SQL migration files defining the CMS-own schema (applied to `govtech_cms`):

| File | Tables created/altered |
|------|----------------------|
| 001_cms_schema.sql | `cms_posts`, `cms_media`, `cms_reviews`, `cms_generations`, `cms_events` |
| 002_email_engine.sql | `email_accounts`, `email_templates`, `email_sends`, `email_queue`, `email_threads`, `email_engagement` |
| 003_hitl_approval_queue.sql | `email_outbox`, `automation_log` |
| 004_environment_marker.sql | `cms_environment` marker table |
| 005_drip_campaigns.sql | `email_campaigns`, `drip_sequences`, `drip_enrollments`, `campaign_execution_log` |
| 006_crm_tables.sql | `social_accounts`, `social_posts`, `admin_todos` |
| 007_template_triggers.sql | Adds `trigger_config`, `response_map`, `profile_variables`, `template_category` columns to `email_templates`; adds `trigger_metadata` to `email_sends` |
| 008_generation_sources.sql | Adds multi-source columns to `cms_generations` (source_type, source_url, source_email_id, source_content, attachments) |
| 009_sender_identities.sql | `sender_identities` table |
| 010_page_blocks_in_cms_posts.sql | Adds `display_order`, `metadata` to `cms_posts` |
| 011_deploy_baseline.sql | Baseline for Railway deploy tracking |

---

## Summary Tables

### A. HTTP Endpoints (all active, grouped by prefix)

| Prefix | Count | Router |
|--------|-------|--------|
| /health | 1 | health.py |
| /api/auth/* | 3 | auth.py |
| /api/email/accounts | 4 | email.py |
| /api/email/templates | 8 | email.py |
| /api/email/campaigns | 6 | email.py |
| /api/email/sends | 3 | email.py |
| /api/email/engagement | 1 | email.py |
| /api/email/threads | 2 | email.py |
| /api/email/outbox | 9 | email.py |
| /api/content/posts | 6 | content.py |
| /api/content/generations | 6 | content.py |
| /api/media/* | 6 | media.py |
| /api/social/accounts | 3 | social.py |
| /api/social/posts | 3 | social.py |
| /api/drip/* | 9 | drip.py |
| /api/todos | 3 | todos.py |
| /api/page-blocks/* | 13 | page_blocks.py |
| **Total** | **87** | |

### B. Worker Loops

| Worker | Poll Interval | Loop Entry | Status |
|--------|--------------|------------|--------|
| content_generator | 30 s | `generation_loop()` | ACTIVE |
| email_queue | 15 s | `queue_loop()` | ACTIVE |
| email_sweep | 300 s | `sweep_loop()` | ACTIVE |
| campaign_executor | 60 s | `executor_loop()` | ACTIVE |
| drip_engine | 60 s | `drip_loop()` | ACTIVE |
| social_poster | 60 s | `social_loop()` | ACTIVE (all posts fail: stubs) |
| event_listener | 10 s | `_poll_loop()` (task) | ACTIVE |

### C. Automation Actions + Stub Status

| Action type | Handler function | Status |
|-------------|-----------------|--------|
| `send_email` | inline in `_do_action_inner` | WORKING |
| `notify_admin` | inline in `_do_action_inner` | WORKING |
| `create_todo` | `_action_create_todo` | WORKING |
| `enroll_drip` | `_action_enroll_drip` | WORKING |
| `distribute_social` | `_action_distribute_social` | WORKING (creates DB rows; actual posting via social_poster = STUB) |
| `publish_content` | `_action_publish_content` | WORKING |
| `unpublish_content` | `_action_unpublish_content` | WORKING (was broken before; now fixed — INC-8) |
| `system:notification.requested` | `_handle_notification_requested` | WORKING |

---

## Known Bugs / Confirmed Issues

| Issue | Status | Evidence |
|-------|--------|---------|
| Phase double-fire (start/end pairs) | **FIXED** | `_rule_matches` phase guard lines 232–235; `test_rule_matching_phase.py` locks it |
| Unpublish no-op (migration-050 rule without handler) | **FIXED** | `_action_unpublish_content` wired at lines 832–869; `test_no_phantom_executors.py` locks it |
| Social poster stub (LinkedIn/Twitter) | **CONFIRMED OPEN** | `social_poster.py:93–95,100` both raise `NotImplementedError`; no OAuth implementation |
| Recurring campaign no true cron | **CONFIRMED OPEN** | `campaign_executor.py:342` — "Full cron parsing deferred to V2" |
| Template render None causes silent no-send | **FIXED** | `_handle_notification_requested` now emits `notification.failed` event and sends plaintext fallback (lines 479–521) |

---

## Database Summary

| Database | Connection | Tables written by CMS |
|----------|-----------|----------------------|
| `govtech_cms` (CMS-own) | `CMS_DATABASE_URL` → `_pool` | `cms_posts`, `cms_media`, `cms_reviews`, `cms_generations`, `cms_events`, `email_accounts`, `email_templates`, `email_sends`, `email_queue`, `email_threads`, `email_engagement`, `email_outbox`, `email_campaigns`, `drip_sequences`, `drip_enrollments`, `campaign_execution_log`, `social_accounts`, `social_posts`, `admin_todos`, `automation_log`, `sender_identities`, `cms_environment` |
| `govtech_intel` (shared) | `SHARED_DATABASE_URL` → `_event_pool` | `system_events` (writes), `cms_content` (publish bridge writes) |
| `govtech_intel` (shared) | `SHARED_DATABASE_URL` → `_event_pool` | `system_events` (reads), `automation_rules` (reads), `users` (reads), `tenants` (reads) |

---

## Critical Test Paths

For CI coverage, the following files are highest-priority integration tests:

1. `tests/test_rule_matching_phase.py` — event listener correctness; no DB needed
2. `tests/test_no_phantom_executors.py` — action dispatcher completeness; no DB needed
3. `tests/test_notify_templates.py` — template render correctness; no DB needed
4. `tests/test_templates.py` — Jinja2 + trigger flag system; no DB needed
5. `tests/test_sender_identity.py` — sender resolution; no DB needed
6. `tests/test_page_blocks_integration.py` — two-DB publish bridge; requires TEST_DATABASE_URL + TEST_CMS_DATABASE_URL

## Files Not Fully Assessed

- `services/cms/db/*.sql` — SQL schema files were enumerated but not read in full; column-level DDL was inferred from code usage.
- `services/cms/src/storage/volume.py` — read partially; file management logic not shown above.
- `services/cms/src/models/email_schemas.py` — structure inferred from usage in email.py; not fully read.
- `services/cms/frontend/src/pages/` — 13 page components described at summary level; complete component logic not line-by-line audited.
- `services/cms/src/workers/gmail_client.py` — read first 80 lines only; auth mode detection confirmed, but full sweep/history API implementation not assessed.
- `services/cms/src/templates.py` — read first 80 lines only; full TEMPLATES dict contents not enumerated here.

---

## Deprecation Candidates

| Item | Reason |
|------|--------|
| `CMS_AUTH_MODE=basic` / `_check_basic_auth` in auth middleware | Legacy HTTP Basic Auth fallback; superseded by JWT session cookies. Adds code complexity with no current users. |
| Legacy API-key-derived `cms_session` cookie (`_sign_cookie`) | Superseded by JWT `cms_login_session`. Both are checked on every request. |
| `_SEND_AS` default in `event_listener.py` | Superseded by `sender_identity.resolve_sender()`. The `_SEND_AS` variable is still used as a fallback default, which is correct, but the variable name is legacy. |
| `FRONTEND_HANDLED` empty set in `_process_new_events` | The comment says "as we migrate all email sending to the CRM, this set should shrink." It is currently an empty `set[tuple[str, str]]` — dead code that occupies a definition and a comment. |
