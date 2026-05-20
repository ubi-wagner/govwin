# CRM-CMS Phase 1 — Architecture & Implementation Plan

**Version:** 1.0  |  **Date:** 2026-05-20  |  **Status:** Approved for implementation

---

## 1. Overview

### 1.1 Goal

Operational CRM with email automation, lead lifecycle, content pipeline, and social
distribution — built on the existing CMS service foundation.

### 1.2 Architecture

CMS service = content/email/social engine (handles all lifecycle operations).
Frontend = all UI (admin reviews, public rendering).
Event bridge coordinates via `system_events` table in Main Postgres.

| Layer | Responsibility | Codebase |
|-------|---------------|----------|
| **CMS Service** (FastAPI) | Engine — email, content, social, campaigns, drip, event actions | `services/cms/` |
| **Frontend** (Next.js 15) | All UI — CRM dashboard, leads, campaigns, social, support, public pages | `frontend/` |
| **Event Bridge** | Coordination — `system_events` + `automation_rules` in Main Postgres | Shared DB |

### 1.3 Integration Model

```
┌─────────────────────────┐         ┌──────────────────────────┐
│      Frontend (Next.js)  │         │    CMS Service (FastAPI)  │
│                          │         │                           │
│  Admin CRM Pages         │   HTTP  │  Email Engine             │
│  API Routes (/api/admin) │ ──────► │  Content Pipeline         │
│  Public Marketing Pages  │         │  Social Poster            │
│                          │         │  Campaign Executor        │
└──────────┬───────────────┘         └──────────┬────────────────┘
           │                                     │
           │  INSERT system_events              │  POLL system_events
           │  INSERT admin_todos                │  READ automation_rules
           ▼                                     ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Main Postgres (govtech_intel)                  │
│  system_events · automation_rules · admin_todos                  │
│  social_accounts · social_posts · tenants · applications         │
└──────────────────────────────────────────────────────────────────┘
           │  CMS-owned tables (separate connection pool)
           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    CMS Postgres                                   │
│  email_accounts · email_templates · email_campaigns              │
│  email_sends · email_outbox · drip_sequences · drip_enrollments  │
│  campaign_execution_log · cms_content · cms_media                │
└──────────────────────────────────────────────────────────────────┘
```

### 1.4 What Exists (Working)

- Email CRUD endpoints (accounts, templates, campaigns, sends, outbox HITL approval)
- Content workflow state machine (draft -> in_review -> approved -> published)
- Event listener (polls `system_events`, matches `automation_rules`)
- Gmail integration (OAuth2 + service account)
- Hard-coded email templates (8 templates with branded layout)
- CMS content table in Main Postgres (blog_post, resource, guide, page_block, etc.)
- Admin content editor (slug, tags, status, metadata, AI URL extraction)
- Public marketing pages with page-block tag system

### 1.5 What's Broken

| Issue | Impact | Fix |
|-------|--------|-----|
| 3 background workers defined but NEVER STARTED | Content gen, email queue, sweep are dead code | Start as asyncio tasks in `main.py` lifespan |
| Media router defined but never registered | `/api/media/*` endpoints unreachable | `app.include_router(media.router, ...)` in `main.py` |
| Zero auth on CMS API endpoints | Any caller can hit CMS service | API key middleware (`X-CMS-API-Key`) |
| `anthropic` not in `requirements.txt` | Content generation worker will crash | Add `anthropic>=0.40.0` |
| Event namespace uses `cms` (forbidden) | Violates EVENT_CONTRACT.md Section 2 | Change to `system` with `cms_content.*` types |
| Campaign execution engine missing | Campaigns created but never sent | Build `campaign_executor.py` |
| `social_post` content type orphaned | Exists in validation but no pipeline | Wire to social posting system |

---

## 2. Lead Lifecycle Model

### 2.1 Stages

No new "contacts" table — leads ARE applications, customers ARE tenants. The lifecycle is the JOIN.

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│   lead   │───►│  target  │───►│ customer │───►│ at_risk  │───►│ churned  │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
```

| Stage | Source Table | Condition |
|-------|-------------|-----------|
| `lead` | `applications` | `status IN ('pending', 'under_review')` |
| `target` | `tenants` | `status = 'trial'` |
| `customer` | `tenants` | `status = 'active' AND subscription_status = 'active'` |
| `at_risk` | `tenants` | Computed: no login events 14+ days AND active subscription |
| `churned` | `tenants` | `status = 'churned'` OR `subscription_status IN ('cancelled', 'expired')` |

New column for denormalized stage tracking:

```sql
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT
  DEFAULT 'customer' CHECK (lifecycle_stage IN ('lead','target','customer','at_risk','churned'));
```

### 2.2 Lifecycle Transitions

| Transition | Trigger Event |
|-----------|---------------|
| lead -> target | `capture:application.accepted:end` |
| target -> customer | `capture:subscription.activated` |
| customer -> at_risk | `system:tenant.engagement_declined` (cron-computed) |
| at_risk -> customer | `system:tenant.engagement_restored` |
| customer/at_risk -> churned | `capture:subscription.cancelled` |
| churned -> customer | `capture:subscription.activated` |

---

## 3. Email Automation Engine

### 3.1 Campaign Execution Engine (NEW)

**Worker: `campaign_executor.py`** — polls active campaigns every 60s.

| Filter Type | Description | Query Source |
|------------|-------------|--------------|
| `all_active` | All active tenants | `tenants WHERE status = 'active'` |
| `segment` | Metadata criteria | `tenants WHERE metadata @> filter` |
| `tier_based` | Subscription tiers | `tenants WHERE subscription_tier IN (...)` |
| `lifecycle_stage` | Specific stage | `tenants WHERE lifecycle_stage = $1` |
| `individual` | Specific emails | Direct list from campaign config |

Execution: enumerate audience -> check suppressions -> check frequency limits -> render template -> create `email_send` -> email_queue worker delivers (via HITL if required).

### 3.2 Drip Campaign Sequences

Drip = ordered email steps with delays. Per-recipient state in `drip_enrollments`.

**Worker: `drip_engine.py`** — polls every 60s for enrollments where `next_send_at <= NOW()` and `status = 'active'`. For each: look up step, render template, create `email_send`, advance `current_step`, compute next `next_send_at`. If no more steps, set `status = 'completed'`.

### 3.3 Predefined Drip Campaigns (Seeded)

**1. Welcome/Onboarding (3 emails over 7 days)**

| Step | Delay | Subject |
|------|-------|---------|
| 1 | Day 0 | Welcome to RFP Pipeline — getting started guide |
| 2 | Day 3 | Feature highlights: scoring, proposals, library |
| 3 | Day 7 | Tips for your first proposal |

**2. Trial Expiring (2 emails)**

| Step | Delay | Subject |
|------|-------|---------|
| 1 | 7 days before | Your trial ends in 7 days — feature recap + upgrade |
| 2 | 1 day before | Last day of your trial — one-click upgrade |

**3. Re-engagement (3 emails over 14 days)**

| Step | Delay | Subject |
|------|-------|---------|
| 1 | Day 0 | We miss you — recent platform improvements |
| 2 | Day 7 | What's new since your last login |
| 3 | Day 14 | A special offer just for you |

**4. Post-Proposal (2 emails)**

| Step | Delay | Subject |
|------|-------|---------|
| 1 | Day 1 | Submission confirmed — what happens next |
| 2 | Day 14 | Follow up — win/loss guidance + next opportunities |

### 3.4 HITL Approval

Existing flow preserved: sends -> outbox -> claim -> modify -> approve -> queue -> deliver.

- Automation-triggered emails bypass HITL (existing behavior, keep it)
- Campaign sends go through HITL by default; campaigns can set `hitl_required=false` to bypass
- Admin can always override: claim any outbox item and modify before sending

### 3.5 Automation Rules (New Seeds in Main Postgres Migration)

| Trigger | Action | Config |
|---------|--------|--------|
| `capture:application.submitted` | `enroll_drip` | campaign: onboarding |
| `capture:application.accepted:end` | `enroll_drip` | campaign: welcome |
| `system:trial.expiring_7d` | `enroll_drip` | campaign: trial_expiring |
| `capture:subscription.cancelled` | `enroll_drip` | campaign: re_engagement |
| `proposal:proposal.outcome_recorded` | `enroll_drip` | campaign: post_proposal |
| `system:content.published` | `distribute_social` | platforms: [linkedin] |
| `system:support.email_received` | `create_todo` | assignee: rfp_admin, priority: high |
| `proposal:proposal.stage_changed` | `send_email` | template: stage_advanced |

---

## 4. Content Pipeline

### 4.1 AI Content Generation

Fix: start `content_generator` worker in `main.py`. Add `anthropic` to requirements.

New endpoint: `POST /api/content/generate-body` — accepts topic, tone, length, keywords.
Generates full blog post body via Claude. Result stored in `cms_generations` table.
Admin reviews via action endpoint: accept creates draft post, reject discards.

### 4.2 Staged Pipeline

```
Generate ──► Draft ──► Review ──► Revise ──► Publish ──► Distribute
```

| From | To | Trigger |
|------|----|---------|
| Generate | Draft | Admin accepts generation |
| (none) | Draft | Admin creates manually |
| Draft | Review | Author submits for review |
| Review | Revise | Reviewer requests changes |
| Revise | Review | Author resubmits |
| Review | Published | Reviewer approves |
| Published | Distribute | Automation rule fires |

### 4.3 Content Distribution

On publish event, automation rule fires:
1. Create `social_posts` for each connected platform
2. Queue in CMS service for scheduled posting
3. Admin can preview/edit before posting (optional HITL gate)

---

## 5. Social Media

### 5.1 Data Model (Main Postgres Migration)

**`social_accounts`**

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `platform` | TEXT | linkedin, twitter, facebook, instagram |
| `account_name` | TEXT | Display name |
| `platform_account_id` | TEXT | External platform ID |
| `access_token` | TEXT | Encrypted OAuth token |
| `refresh_token` | TEXT | Encrypted refresh token |
| `token_expires_at` | TIMESTAMPTZ | Token expiry |
| `tenant_id` | UUID FK | NULL = platform-owned account |
| `status` | TEXT | active, expired, revoked, disconnected |
| `metadata` | JSONB | Platform-specific config |

**`social_posts`**

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `content_id` | UUID | FK cms_content (nullable for standalone) |
| `social_account_id` | UUID FK | Which account to post from |
| `platform` | TEXT | Denormalized from account |
| `post_text` | TEXT | Post body |
| `media_urls` | TEXT[] | Attached media |
| `link_url` | TEXT | Shared link URL |
| `scheduled_at` | TIMESTAMPTZ | When to post |
| `posted_at` | TIMESTAMPTZ | When actually posted |
| `platform_post_id` | TEXT | ID returned by platform API |
| `status` | TEXT | draft, scheduled, posting, posted, failed |
| `engagement_data` | JSONB | Likes, shares, comments |
| `error_message` | TEXT | Last error if failed |
| `retry_count` | INT | Retry attempts (max 3) |

### 5.2 LinkedIn Integration

- LinkedIn API v2 for company page posts
- OAuth2 flow for account connection
- Post types: article share (with URL), text post, image post
- Use `ugcPosts` endpoint for rich media
- Token refresh: check before posting, auto-refresh if expiring within 7 days
- Future platforms (Twitter/X, Facebook) follow same adapter pattern

### 5.3 CMS Service Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/social/accounts` | Register platform account |
| `GET` | `/api/social/accounts` | List connected accounts |
| `POST` | `/api/social/posts` | Create/schedule post |
| `POST` | `/api/social/posts/{id}/publish` | Send to platform now |
| `GET` | `/api/social/posts` | List with filters |

### 5.4 Social Posting Worker (NEW)

**Worker: `social_poster.py`** — polls every 30s for `social_posts` where `scheduled_at <= NOW()` and `status = 'scheduled'`. Dispatches to platform adapter, records `platform_post_id` on success, retries up to 3 times on failure.

---

## 6. Customer Support

### 6.1 Inbound Processing

Fix: start `email_sweep` worker in `main.py`. Extend classification to detect support@ and help@ emails.

Claude classifies incoming emails:
- question -> route to knowledge base / auto-reply
- complaint -> create high-priority support todo
- unsubscribe -> process automatically
- out_of_office -> suppress future sends
- interest -> route to sales / flag for follow-up

### 6.2 Response Workflow

1. Support email arrives -> sweep worker classifies
2. Creates `admin_todo` (type: support_ticket)
3. Admin sees in CRM support queue
4. Admin drafts reply -> goes through HITL outbox
5. Reply sent via Gmail with thread continuity

---

## 7. Admin TODOs

### 7.1 Data Model (Main Postgres Migration)

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `title` | TEXT NOT NULL | Human-readable summary |
| `description` | TEXT | Detailed context |
| `todo_type` | TEXT NOT NULL | curation, support, content_review, campaign, general |
| `priority` | TEXT NOT NULL | critical, high, medium, low |
| `status` | TEXT NOT NULL | open, in_progress, done, dismissed |
| `assigned_to` | UUID FK | References users(id) |
| `tenant_id` | UUID FK | References tenants(id), NULL for system |
| `related_entity_type` | TEXT | application, rfp, content, campaign, etc. |
| `related_entity_id` | UUID | ID of related entity |
| `due_at` | TIMESTAMPTZ | Optional deadline |
| `metadata` | JSONB | Extra context |
| `created_by` | UUID FK | NULL for system-generated |
| `completed_at` | TIMESTAMPTZ | Set when done |

### 7.2 Auto-Generated TODOs

| Triggering Event | Todo Title | Type | Priority |
|-----------------|-----------|------|----------|
| `capture:application.submitted` | "Review application from {company_name}" | general | high |
| `finder:rfp.uploaded` | "Curate RFP: {solicitation_title}" | curation | medium |
| `system:support.email_received` | "Respond to support request from {email}" | support | high |
| `system:cms_content.submitted_for_review` | "Review content: {title}" | content_review | medium |
| `system:campaign.completed` | "Review campaign results: {campaign_name}" | campaign | low |
| `finder:source.change_detected` | "Review scout changes: {source_name}" | curation | medium |
| `proposal:proposal.submitted` | "Check proposal submission: {proposal_title}" | general | medium |

### 7.3 Admin CRM Dashboard

Shows: open todos by priority, lead pipeline, campaign stats, support queue.

---

## 8. Database Schema Changes

### 8.1 Main Postgres — Migration `040_crm_phase1.sql`

```sql
-- Lifecycle tracking
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT
  DEFAULT 'customer' CHECK (lifecycle_stage IN ('lead','target','customer','at_risk','churned'));

-- Admin TODOs
CREATE TABLE admin_todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  todo_type TEXT NOT NULL CHECK (todo_type IN ('curation','support','content_review','campaign','general')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical','high','medium','low')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','dismissed')),
  assigned_to UUID REFERENCES users(id),
  tenant_id UUID REFERENCES tenants(id),
  related_entity_type TEXT,
  related_entity_id UUID,
  due_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Social accounts
CREATE TABLE social_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('linkedin','twitter','facebook','instagram')),
  account_name TEXT NOT NULL,
  platform_account_id TEXT,
  access_token TEXT, -- encrypted
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  tenant_id UUID REFERENCES tenants(id), -- null = platform account
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked','disconnected')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Social posts
CREATE TABLE social_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID, -- FK to cms_content (nullable for standalone posts)
  social_account_id UUID NOT NULL REFERENCES social_accounts(id),
  platform TEXT NOT NULL,
  post_text TEXT NOT NULL,
  media_urls TEXT[],
  link_url TEXT,
  scheduled_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  platform_post_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','posting','posted','failed')),
  engagement_data JSONB DEFAULT '{}',
  error_message TEXT,
  retry_count INT DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_admin_todos_status ON admin_todos(status) WHERE status != 'done';
CREATE INDEX idx_admin_todos_assigned ON admin_todos(assigned_to) WHERE status != 'done';
CREATE INDEX idx_admin_todos_type ON admin_todos(todo_type);
CREATE INDEX idx_social_posts_scheduled ON social_posts(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX idx_social_posts_account ON social_posts(social_account_id);
CREATE INDEX idx_social_accounts_platform ON social_accounts(platform);

-- New automation rules
INSERT INTO automation_rules (id, trigger_namespace, trigger_type, action_type, action_config, is_active, description) VALUES
  (gen_random_uuid(), 'capture', 'application.submitted', 'create_todo', '{"title_template": "Review application from {company_name}", "todo_type": "general", "priority": "high"}', true, 'Auto-create admin todo on new application'),
  (gen_random_uuid(), 'system', 'content.published', 'distribute_social', '{"platforms": ["linkedin"]}', true, 'Post published content to LinkedIn'),
  (gen_random_uuid(), 'finder', 'source.change_detected', 'create_todo', '{"title_template": "Review scout changes: {source_name}", "todo_type": "curation", "priority": "medium"}', true, 'Auto-create curation todo on source change');

-- Trigger for updated_at
CREATE TRIGGER admin_todos_updated_at BEFORE UPDATE ON admin_todos FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER social_accounts_updated_at BEFORE UPDATE ON social_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER social_posts_updated_at BEFORE UPDATE ON social_posts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

### 8.2 CMS Postgres — Migration `005_drip_campaigns.sql`

```sql
-- Drip campaign sequences
CREATE TABLE drip_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  step_number INT NOT NULL,
  template_id UUID REFERENCES email_templates(id),
  subject_override TEXT,
  body_override TEXT,
  delay_hours INT NOT NULL DEFAULT 0,
  delay_from TEXT NOT NULL DEFAULT 'enrollment' CHECK (delay_from IN ('enrollment','previous_step')),
  condition_filter JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(campaign_id, step_number)
);

-- Drip enrollments
CREATE TABLE drip_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES email_campaigns(id),
  tenant_id UUID, -- from shared DB
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  current_step INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','paused','cancelled','failed')),
  enrolled_at TIMESTAMPTZ DEFAULT now(),
  next_send_at TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Campaign execution log
CREATE TABLE campaign_execution_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES email_campaigns(id),
  execution_type TEXT NOT NULL CHECK (execution_type IN ('one_time','recurring','drip_step')),
  step_number INT,
  recipients_targeted INT DEFAULT 0,
  sends_created INT DEFAULT 0,
  errors INT DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_drip_enrollments_next ON drip_enrollments(next_send_at) WHERE status = 'active';
CREATE INDEX idx_drip_enrollments_campaign ON drip_enrollments(campaign_id, status);
CREATE INDEX idx_drip_sequences_campaign ON drip_sequences(campaign_id, step_number);
```

---

## 9. CMS Service Changes

### 9.1 Fixes

1. **main.py**: start all 3 worker loops as asyncio tasks in lifespan
2. **main.py**: register media router with `prefix="/api/media"`
3. Add auth middleware (API key header: `X-CMS-API-Key`, checked against `CMS_API_KEY` env var)
4. **requirements.txt**: add `anthropic>=0.40.0`
5. **events.py**: change namespace from `cms` to `system` (types: `cms_content.published`, etc.)
6. Consolidate Gmail: keep service account client (`workers/gmail_client.py`), phase out OAuth2 (`gmail.py`)

### 9.2 New Workers

| Worker | File | Interval | Responsibility |
|--------|------|----------|----------------|
| Campaign Executor | `workers/campaign_executor.py` | 60s | Poll active campaigns, enumerate audience, create sends |
| Drip Engine | `workers/drip_engine.py` | 60s | Poll due enrollments, advance sequences, create sends |
| Social Poster | `workers/social_poster.py` | 30s | Poll scheduled posts, dispatch to platform adapters |

### 9.3 New Routers

| Router | Prefix | Description |
|--------|--------|-------------|
| `routers/social.py` | `/api/social` | CRUD for social accounts and posts |
| `routers/todos.py` | `/api/todos` | Read admin_todos from shared DB (read-only bridge) |

### 9.4 New Actions for Event Listener

Add to `event_listener.py` action handlers:
- **enroll_drip**: enroll recipient in a drip campaign
- **create_todo**: create `admin_todo` in shared DB
- **distribute_social**: create `social_posts` for connected accounts

---

## 10. Frontend Changes

### 10.1 New Admin Pages

| Route | Description |
|-------|-------------|
| `/admin/crm` | CRM dashboard (todo summary, lead pipeline, campaign stats) |
| `/admin/crm/leads` | Lead pipeline (applications + tenant lifecycle) |
| `/admin/crm/campaigns` | Email campaigns (list, detail, stats, drip builder) |
| `/admin/crm/campaigns/[campaignId]` | Campaign detail with sends, engagement |
| `/admin/crm/support` | Support queue (filtered admin_todos) |
| `/admin/crm/social` | Social media management (accounts, posts, schedule) |
| `/admin/crm/todos` | Admin TODO list (all types, filters, assignment) |

### 10.2 New Sidebar Section

Add "CRM" section to admin sidebar between Operations and Monitoring:
- CRM Dashboard
- Leads
- Campaigns
- Support
- Social
- TODOs

### 10.3 New API Routes

All under `/api/admin/crm/`, requiring `master_admin` or `rfp_admin` role:

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/admin/crm/todos` | List with filters |
| `POST` | `/api/admin/crm/todos` | Create manual todo |
| `PATCH` | `/api/admin/crm/todos/[id]` | Update status/assignment |
| `GET` | `/api/admin/crm/leads` | Joined applications + tenants lifecycle view |
| `GET/POST` | `/api/admin/crm/campaigns` | Proxy to CMS service email campaign endpoints |
| `CRUD` | `/api/admin/crm/social/accounts` | Social accounts management |
| `CRUD` | `/api/admin/crm/social/posts` | Social posts + scheduling |

### 10.4 Content Editor Enhancement

- Add `publish_at` date picker (schedule future publication)
- Add social distribution toggle (auto-post on publish)

---

## 11. Event Flow Diagrams

### Content Pipeline Flow

```
Admin writes/generates → Draft → Review → Approve → Publish → Event: system:content.published
                                                                  ↓
                                                     Automation: distribute_social
                                                                  ↓
                                                     Create social_posts per account
                                                                  ↓
                                                     Social poster worker sends to LinkedIn
```

### Lead Lifecycle Flow

```
Visitor → Application (lead) → Accept (target/trial) → Subscribe (customer) → Lapse (churned)
              ↓                      ↓                       ↓                    ↓
      Onboarding drip         Welcome drip           Engagement drip      Re-engagement drip
      Create admin todo       Create admin todo
```

### Support Flow

```
Inbound email → Sweep worker → Claude classify → Create admin_todo (support)
                                                        ↓
                                            Admin sees in CRM support queue
                                                        ↓
                                            Admin drafts reply → HITL outbox → Send
```

---

## 12. Implementation Phases

### Week 1: Fix & Foundation

| Task | File(s) | Priority |
|------|---------|----------|
| Start all 3 worker loops in lifespan | `services/cms/src/main.py` | P0 |
| Register media router | `services/cms/src/main.py` | P0 |
| Add API key auth middleware | `services/cms/src/middleware/auth.py` | P0 |
| Add `anthropic` to requirements | `services/cms/requirements.txt` | P0 |
| Fix event namespace (`cms` -> `system`) | `services/cms/src/models/events.py` | P0 |
| Create Main Postgres migration 040 | `pipeline/migrations/040_crm_phase1.sql` | P0 |
| Create CMS Postgres migration 005 | `services/cms/db/migrations/005_drip_campaigns.sql` | P0 |
| Implement admin_todos API routes | `frontend/src/app/api/admin/crm/todos/` | P1 |
| Build CRM dashboard page | `frontend/src/app/(admin)/admin/crm/page.tsx` | P1 |
| Add CRM section to admin sidebar | `frontend/src/components/admin/sidebar.tsx` | P1 |

**Exit criteria:** Workers start without errors, media endpoints respond, CMS auth works, migration applies, dashboard renders.

### Week 2: Email Automation

| Task | File(s) | Priority |
|------|---------|----------|
| Implement campaign executor worker | `services/cms/src/workers/campaign_executor.py` | P0 |
| Implement drip engine worker | `services/cms/src/workers/drip_engine.py` | P0 |
| Add drip sequence CRUD endpoints | `services/cms/src/routers/drip.py` | P0 |
| Add `enroll_drip` action to event listener | `services/cms/src/event_listener.py` | P0 |
| Add `create_todo` action to event listener | `services/cms/src/event_listener.py` | P0 |
| Seed predefined drip campaigns | `services/cms/db/seeds/drip_campaigns.sql` | P1 |
| Build campaigns admin page | `frontend/src/app/(admin)/admin/crm/campaigns/page.tsx` | P1 |
| Wire automation rules for drip enrollment | Migration 040 seed data | P1 |

**Exit criteria:** Campaigns execute and deliver, drip enrollments advance, auto-todo on application submit.

### Week 3: Content & Social

| Task | File(s) | Priority |
|------|---------|----------|
| Enhance content generator (body generation) | `services/cms/src/workers/content_generator.py` | P0 |
| Add social accounts/posts endpoints | `services/cms/src/routers/social.py` | P0 |
| Implement social poster worker | `services/cms/src/workers/social_poster.py` | P0 |
| Implement LinkedIn adapter | `services/cms/src/workers/social_adapters/linkedin.py` | P0 |
| Add `distribute_social` action to event listener | `services/cms/src/event_listener.py` | P1 |
| Build social management admin page | `frontend/src/app/(admin)/admin/crm/social/page.tsx` | P1 |
| Add publish_at and social toggle to content editor | `frontend/src/app/(admin)/admin/content/` | P2 |

**Exit criteria:** AI generates blog bodies, published content creates LinkedIn posts, social poster delivers.

### Week 4: Support & Polish

| Task | File(s) | Priority |
|------|---------|----------|
| Extend email sweep for support detection | `services/cms/src/workers/email_sweep.py` | P0 |
| Build support queue admin page | `frontend/src/app/(admin)/admin/crm/support/page.tsx` | P0 |
| Build leads pipeline view | `frontend/src/app/(admin)/admin/crm/leads/page.tsx` | P1 |
| Add reply-in-thread to support workflow | CMS email router + Gmail client | P1 |
| Integration testing: full lifecycle | Test scripts | P1 |

**Exit criteria:** Support emails auto-create todos, admin can respond through CRM, leads pipeline shows full lifecycle, no regressions.
