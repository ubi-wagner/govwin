# V1 Audit TODO List — Post-Merge Fixes & Remaining Work

Generated: 2026-05-20
Branch: claude/analyze-project-status-KbAhg

## Status Legend
- [x] Fixed in this branch
- [ ] Needs fix before production
- [ ] (LOW) Nice-to-have for V1

---

## CRITICAL — Fixed This Session

- [x] CMS API key middleware: fail-closed, timing-safe, SPA cookie auth
- [x] CMS SPA routes excluded from auth middleware
- [x] Jinja2 autoescape for email template XSS prevention
- [x] Health check returns 503 when degraded
- [x] ContentEditor stage action sends user_id
- [x] ContentPreview handles tags as array (not string)
- [x] Schema fixes: tenants.tier→product_tier, proposals.status→stage
- [x] Schema fixes: tenant_opportunities→tenant_pipeline_items
- [x] automation_log status 'error'→'failed'
- [x] event_listener tenants.company_name→tenants.name
- [x] Migration 040 CHECK constraint extended for CRM action types
- [x] Pipeline SAM.gov resolve_api_key method name fix
- [x] Pipeline workflow timeout_hours→timeout_minutes
- [x] Pipeline _run_type propagation fix
- [x] Frontend welcome email contactName→contactEmail
- [x] Frontend LIKE pattern escaping in applications route
- [x] Frontend invite password minimum 8→12
- [x] Pipeline + CMS Dockerfiles: non-root user
- [x] Hardcoded passwords removed from migration comments

---

## HIGH PRIORITY — Fix Before Production

### Security
- [ ] Replace invite token (predictable UUID) with cryptographic random token
- [ ] Add rate limiting: login, public endpoints, file uploads, AI endpoints
- [ ] Add Content-Security-Policy headers to Next.js config
- [ ] Add HSTS, X-Frame-Options, X-Content-Type-Options headers
- [ ] Standardize bcrypt cost factor to 12 everywhere
- [ ] Configure explicit JWT session maxAge (8 hours, not 30 days)
- [ ] Remove hardcoded fallback DATABASE_URL from lib/db.ts
- [ ] Lower bodySizeLimit from 500MB to 50MB in next.config.mjs
- [ ] Add migration locking (pg_advisory_lock) to prevent concurrent runs
- [ ] Restrict CMS CORS methods/headers from wildcard

### Pipeline Stubs
- [ ] Implement workflow action stubs (shred, extract_compliance, match_tenants, etc.)
- [ ] Implement ScoringEngine.score_all_tenants()
- [ ] Implement AgentFabric.handle_event() and invoke_agent()
- [ ] Add HTTP health endpoint to pipeline service
- [ ] Add health check to pipeline railway.json

### CMS Service
- [ ] Add missing seed templates: customer-help-response, lead-generic-followup
- [ ] Add hitl_required column to email_campaigns table
- [ ] Add lifecycle_stage to audience_type CHECK constraint
- [ ] Gmail API calls should use asyncio.to_thread() (currently blocking event loop)
- [ ] Cache automation_rules and schema columns (not re-fetched every 10s poll)
- [ ] Fix double-prefixed admin notification subjects
- [ ] Add email template management pages to CMS frontend
- [ ] Add DELETE endpoints for posts, campaigns, email accounts
- [ ] Add unsubscribe handling and suppression lists
- [ ] Add rate limiting on AI revision/generation endpoints
- [ ] Add total count for pagination (not just page size)

### Frontend 501 Stubs (implement before customer launch)
- [ ] Portal: /api/portal/[slug]/dashboard — tenant home
- [ ] Portal: /api/portal/[slug]/opportunities — scored feed
- [ ] Portal: /api/portal/[slug]/proposals (list) — proposal list
- [ ] Portal: /api/portal/[slug]/spotlights — saved searches
- [ ] Portal: /api/portal/[slug]/purchases — purchase history
- [ ] Portal: /api/portal/[slug]/uploads — file uploads
- [ ] Portal: /api/portal/[slug]/notifications — notification feed
- [ ] Portal: /api/portal/[slug]/.../ai/draft — AI section drafting
- [ ] Portal: /api/portal/[slug]/.../ai/review — AI review
- [ ] Portal: /api/portal/[slug]/.../reviews — color team reviews
- [ ] Portal: /api/portal/[slug]/.../package — ZIP export
- [ ] Admin: /api/admin/dashboard — admin overview
- [ ] Admin: /api/admin/tenants/[id] — tenant CRUD
- [ ] Admin: /api/admin/purchases — purchase tracking
- [ ] Admin: /api/admin/pipeline — job queue visibility
- [ ] Admin: /api/admin/agents — agent monitoring
- [ ] API: /api/events — SSE real-time stream
- [ ] API: /api/waitlist — public waitlist signup
- [ ] API: /api/consent — consent recording

### Integration
- [ ] Send invite/welcome emails when creating team members
- [ ] Session invalidation after password change
- [ ] Fix missing API routes: /api/admin/sources/{id}/regions, /api/admin/sources/{id}/diffs
- [ ] Call auditLog() from admin action routes (function exists but never called)
- [ ] Fix workflow action module paths (finder.create_drafts_from_scout → correct import)

---

## LOW PRIORITY — Nice-to-Have

### Code Quality
- [ ] Remove dead Pydantic models (PostOut, GenerationOut, ReviewOut, AccountOut, etc.)
- [ ] Remove deprecated gmail.py (replaced by gmail_client.py)
- [ ] Remove unused imports in content.py (GenerationOut, ReviewOut)
- [ ] Remove Pages Router bodyParser config from rfp-upload route
- [ ] Fix event-stream-client 'cms' namespace references → correct namespace
- [ ] Make CMS migration 006 triggers idempotent (CREATE OR REPLACE)
- [ ] Consolidate DATABASE_URL definitions in pipeline (3 separate reads)
- [ ] Worker crash isolation: add restart-on-crash wrapper in main.py
- [ ] Campaign completed status should wait for sends to complete
- [ ] Move CMS SPA build to .gitignore (Docker builds it now)

### Documentation
- [ ] Update ARCHITECTURE_V5.md with CMS service details
- [ ] Document email trigger flag system
- [ ] Document content bridge flow
- [ ] Update CLAUDE_CLIFFNOTES.md with CMS schema

---

## Architecture Summary (V1 Baseline)

### Services
1. **Frontend** (Next.js 15) — Portal UI, Admin UI, Auth, API routes → Main Postgres
2. **Pipeline** (Python 3.12) — Ingestion, scoring, workflows, agents → Main Postgres
3. **CMS/CRM** (FastAPI) — Email automation, content management, social, drip → CMS Postgres + event bridge to Main Postgres

### Data Flow
```
Users → Frontend → Main Postgres ←→ system_events ←→ CMS Event Listener → CMS Postgres
                                                                         ↓
                                                              Email Queue → Gmail API
                                                              Content Bridge → Main Postgres cms_content
                                                              Social Poster → LinkedIn/Twitter
```

### Email Automation Loop
```
Template (trigger_config + response_map + profile_variables)
  → Render with Jinja2 + customer profile
  → Embed trigger flags (base64 HTML comment)
  → HITL queue (admin reviews/revises/releases)
  → Send via Gmail service account
  → Sweep detects reply → extracts trigger flags
  → Classifies via Claude → maps to response template
  → Auto-drafts response → HITL queue again
  → Emits namespace event for agent/automation chaining
```

### Content Pipeline
```
Generate (prompt/URL/email/screenshot/repackage)
  → AI content worker → draft post
  → TipTap WYSIWYG editor → AI revision panel
  → Submit for review (stage pipeline)
  → Approve → Publish (event bridge → Main Postgres → public pages)
```
