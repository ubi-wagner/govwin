# CRM inventory — generated

Regenerate: `CRM_DATABASE=… node frontend/scripts/inventory-crm.mjs`

Schema read from: **live catalog**

> This is the first time any instrument in this repo has looked at the CRM. Every lens, audit and
> reconciliation measures `govtech_intel`; the CRM has its own service, its own console and its
> own database, and none of the three has ever appeared in a coverage number here.

---

## Isolation posture

24 tables · **7 carry `tenant_id`** · **7 of those have no RLS and no policy**

| table | columns | rls | policies |
|---|---|---|---|
| `admin_todos` | 16 | **off** | 0 |
| `cms_generations` | 27 | **off** | 0 |
| `drip_enrollments` | 13 | **off** | 0 |
| `email_engagement` | 13 | **off** | 0 |
| `email_sends` | 33 | **off** | 0 |
| `email_threads` | 15 | **off** | 0 |
| `social_accounts` | 12 | **off** | 0 |

## Tables

| table | cols | tenancy | verdict | writers | readers |
|---|---|---|---|---|---|
| `_cms_migrations` | 2 | — | ORPHAN — no code reads or writes it | 0 | 0 |
| `_crm_metadata` | 3 | — | ORPHAN — no code reads or writes it | 0 | 0 |
| `admin_todos` | 16 | `tenant_id` | write-only — nothing reads it | 2 | 0 |
| `campaign_execution_log` | 10 | — | write-only — nothing reads it | 2 | 0 |
| `cms_config` | 4 | — | superseded | 0 | 0 |
| `cms_events` | 11 | — | superseded | 1 | 0 |
| `cms_generations` | 27 | `tenant_id` | superseded | 3 | 1 |
| `cms_media` | 14 | — | superseded | 1 | 1 |
| `cms_posts` | 34 | — | superseded | 3 | 1 |
| `cms_reviews` | 10 | — | superseded | 1 | 0 |
| `deploy_baseline` | 3 | — | ORPHAN — no code reads or writes it | 0 | 0 |
| `drip_enrollments` | 13 | `tenant_id` | write-only — nothing reads it | 3 | 0 |
| `drip_sequences` | 10 | — | live | 1 | 2 |
| `email_accounts` | 18 | — | live | 3 | 2 |
| `email_campaigns` | 26 | — | live | 4 | 3 |
| `email_engagement` | 13 | `tenant_id` | live | 1 | 1 |
| `email_outbox` | 17 | — | write-only — nothing reads it | 4 | 0 |
| `email_queue` | 9 | — | write-only — nothing reads it | 4 | 0 |
| `email_sends` | 33 | `tenant_id` | live | 6 | 2 |
| `email_templates` | 22 | — | live | 1 | 5 |
| `email_threads` | 15 | `tenant_id` | live | 2 | 1 |
| `sender_identities` | 7 | — | read-only — nothing writes it | 0 | 1 |
| `social_accounts` | 12 | `tenant_id` | live | 1 | 2 |
| `social_posts` | 17 | — | write-only — nothing reads it | 3 | 0 |

### Superseded, with the reason

- `cms_posts` — front-facing content moved to the frontend content_pages store (CLAUDE.md §Services)
- `cms_media` — ditto — media now lives under the frontend/R2 path
- `cms_reviews` — ditto — the content review queue moved with it
- `cms_generations` — ditto — content generation is frontend-owned
- `cms_events` — ditto — content events go to system_events
- `cms_config` — ditto

## API surface

88 endpoints · 40 reached by the console or the platform · 48 with no caller found

| method | path | router | caller |
|---|---|---|---|
| POST   | `/api/auth/login` | auth | called |
| POST   | `/api/auth/logout` | auth | called |
| GET    | `/api/auth/me` | auth | called |
| POST   | `/api/content/generations/{gen_id}/action` | content | called |
| GET    | `/api/content/generations/{gen_id}` | content | **none found** |
| POST   | `/api/content/generations/from-email/{send_id}` | content | **none found** |
| POST   | `/api/content/generations/from-url` | content | **none found** |
| GET    | `/api/content/generations` | content | called |
| POST   | `/api/content/generations` | content | called |
| POST   | `/api/content/posts/{post_id}/action` | content | called |
| GET    | `/api/content/posts/{post_id}/reviews` | content | **none found** |
| POST   | `/api/content/posts/{post_id}/revise` | content | called |
| GET    | `/api/content/posts/{post_id}` | content | called |
| PATCH  | `/api/content/posts/{post_id}` | content | called |
| GET    | `/api/content/posts` | content | called |
| POST   | `/api/content/posts` | content | called |
| GET    | `/api/drip/campaigns/{campaign_id}/enrollments` | drip | **none found** |
| POST   | `/api/drip/campaigns/{campaign_id}/enroll` | drip | **none found** |
| GET    | `/api/drip/campaigns/{campaign_id}/sequences` | drip | called |
| POST   | `/api/drip/campaigns/{campaign_id}/sequences` | drip | called |
| POST   | `/api/drip/enrollments/{enrollment_id}/cancel` | drip | **none found** |
| POST   | `/api/drip/enrollments/{enrollment_id}/pause` | drip | **none found** |
| POST   | `/api/drip/enrollments/{enrollment_id}/resume` | drip | **none found** |
| DELETE | `/api/drip/sequences/{sequence_id}` | drip | **none found** |
| PATCH  | `/api/drip/sequences/{sequence_id}` | drip | **none found** |
| GET    | `/api/email/accounts/{account_id}` | email | **none found** |
| PATCH  | `/api/email/accounts/{account_id}` | email | **none found** |
| GET    | `/api/email/accounts` | email | called |
| POST   | `/api/email/accounts` | email | called |
| POST   | `/api/email/campaigns/{campaign_id}/action` | email | **none found** |
| GET    | `/api/email/campaigns/{campaign_id}/stats` | email | **none found** |
| GET    | `/api/email/campaigns/{campaign_id}` | email | **none found** |
| PATCH  | `/api/email/campaigns/{campaign_id}` | email | **none found** |
| GET    | `/api/email/campaigns` | email | called |
| POST   | `/api/email/campaigns` | email | called |
| GET    | `/api/email/engagement` | email | **none found** |
| POST   | `/api/email/outbox/{outbox_id}/approve` | email | called |
| POST   | `/api/email/outbox/{outbox_id}/claim` | email | **none found** |
| PATCH  | `/api/email/outbox/{outbox_id}/modify` | email | **none found** |
| POST   | `/api/email/outbox/{outbox_id}/reject` | email | called |
| POST   | `/api/email/outbox/{outbox_id}/unclaim` | email | **none found** |
| GET    | `/api/email/outbox/{outbox_id}` | email | **none found** |
| POST   | `/api/email/outbox/bulk-approve` | email | **none found** |
| GET    | `/api/email/outbox/stats` | email | **none found** |
| GET    | `/api/email/outbox` | email | called |
| GET    | `/api/email/sends/{send_id}` | email | **none found** |
| GET    | `/api/email/sends` | email | **none found** |
| POST   | `/api/email/sends` | email | **none found** |
| POST   | `/api/email/templates/{template_id}/preview` | email | **none found** |
| POST   | `/api/email/templates/{template_id}/test-send` | email | **none found** |
| GET    | `/api/email/templates/{template_id}` | email | **none found** |
| PATCH  | `/api/email/templates/{template_id}` | email | **none found** |
| GET    | `/api/email/templates/categories` | email | **none found** |
| POST   | `/api/email/templates/draft` | email | **none found** |
| GET    | `/api/email/templates` | email | **none found** |
| POST   | `/api/email/templates` | email | **none found** |
| GET    | `/api/email/threads/{thread_id}` | email | **none found** |
| GET    | `/api/email/threads` | email | **none found** |
| DELETE | `/api/media/{media_id}` | media | **none found** |
| PATCH  | `/api/media/{media_id}` | media | **none found** |
| GET    | `/api/media/file/{path:path}` | media | **none found** |
| GET    | `/api/media/list` | media | **none found** |
| GET    | `/api/media/stats` | media | **none found** |
| POST   | `/api/media/upload` | media | **none found** |
| DELETE | `/api/page-blocks/{block_id}` | page_blocks | called |
| POST   | `/api/page-blocks/add-blank` | page_blocks | called |
| POST   | `/api/page-blocks/ai/from-url` | page_blocks | called |
| POST   | `/api/page-blocks/ai/generate` | page_blocks | called |
| POST   | `/api/page-blocks/ai/revise` | page_blocks | called |
| POST   | `/api/page-blocks/approve` | page_blocks | called |
| POST   | `/api/page-blocks/publish` | page_blocks | called |
| POST   | `/api/page-blocks/reject` | page_blocks | called |
| POST   | `/api/page-blocks/reorder` | page_blocks | **none found** |
| POST   | `/api/page-blocks/revalidate` | page_blocks | called |
| POST   | `/api/page-blocks/submit-review` | page_blocks | called |
| GET    | `/api/page-blocks` | page_blocks | called |
| PATCH  | `/api/page-blocks` | page_blocks | called |
| PATCH  | `/api/social/accounts/{account_id}` | social | **none found** |
| GET    | `/api/social/accounts` | social | called |
| POST   | `/api/social/accounts` | social | called |
| POST   | `/api/social/posts/{post_id}/publish` | social | **none found** |
| PATCH  | `/api/social/posts/{post_id}` | social | **none found** |
| GET    | `/api/social/posts` | social | called |
| POST   | `/api/social/posts` | social | called |
| PATCH  | `/api/todos/{todo_id}` | todos | called |
| GET    | `/api/todos` | todos | called |
| POST   | `/api/todos` | todos | called |
| GET    | `/health` | health | **none found** |

## The bridge to the platform

| seam | file | detail |
|---|---|---|
| shared-database | `services/cms/src/event_listener.py` | automation_rules, system_events, tenants, users |
| event-emit | `services/cms/src/event_listener.py` | writes system_events on the main DB |
| shared-database | `services/cms/src/mailer/ledger.py` | email_suppressions, email_send_ledger |
| shared-database | `services/cms/src/models/events.py` | system_events |
| event-emit | `services/cms/src/models/events.py` | writes system_events on the main DB |
| shared-database | `services/cms/src/routers/auth.py` | users |
| event-emit | `services/cms/src/routers/auth.py` | writes system_events on the main DB |
| http-callback | `services/cms/src/routers/page_blocks.py` | frontend /api/cms/revalidate |
| event-emit | `services/cms/src/routers/page_blocks.py` | writes system_events on the main DB |
| shared-database | `services/cms/src/workers/campaign_executor.py` | tenants, users |
| event-emit | `services/cms/src/workers/campaign_executor.py` | writes system_events on the main DB |
| event-emit | `services/cms/src/workers/content_generator.py` | writes system_events on the main DB |
| event-emit | `services/cms/src/workers/drip_engine.py` | writes system_events on the main DB |
| event-emit | `services/cms/src/workers/email_queue.py` | writes system_events on the main DB |
| platform→crm | `frontend/app/admin/crm/page.tsx` | reads a CRM env var |
