# Architectural Review -- Systemic Changes for V1 Stability

**Date**: 2026-05-22
**Author**: Claude Code (Opus 4.6)
**Scope**: Patterns identified across 6 audit rounds (200+ bugs) that require design changes, not individual code fixes.
**Context**: June 1 launch, 20 founding cohort seats, $299/mo + $999-1999/proposal.

---

## 1. Transaction Strategy

### Current State

Out of 110 API routes, exactly **1** uses `sql.begin()`: the application accept route (`/api/admin/applications/[id]/accept/route.ts`). Every other multi-step operation -- proposal creation, collaborator invitation, stage advancement, section saving, library import, solicitation push -- executes sequential `await sql` calls without transactional guarantees.

The bug extermination report (Round 4, Adversarial Audit) flagged this as finding #1: "No API route uses `sql.begin()`. Multi-step operations risk partial state on failure."

### Risk

- **Application accept** was the poster child: it creates a tenant, creates a user, updates the application status, and emits an event. A failure after tenant creation but before user creation leaves an orphaned tenant with no owner. This was fixed with `sql.begin()` in the audit.
- **Proposal creation**: Creates proposal row, copies compliance matrix, emits event. Partial failure = proposal with no compliance data.
- **Collaborator invite**: Creates access row, sends email with temp password, emits event. If email send fails after DB insert, the access row exists but the user never gets credentials.
- **Stage advancement**: Updates proposal stage, revokes previous-stage collaborator access, emits event. Partial failure = stage changed but old collaborators retain access.
- **Solicitation push**: Updates solicitation status, activates opportunity, writes memory, emits event. Partial failure = opportunity visible to customers with no memory context.

With 20 users, you may never hit this. With concurrent operations during a proposal deadline crunch, you will.

### Recommendation

Tier the routes by risk and wrap accordingly:

**Must be transactional (Critical -- wrap in sql.begin now):**
1. Application accept (DONE)
2. Proposal creation + compliance matrix copy
3. Stage advancement + access revocation
4. Collaborator invite + user creation
5. Solicitation push + opportunity activation + memory write

**Should be transactional (High -- wrap before multi-user):**
6. Section save + updated_at + event emission
7. Library bulk import + atomization
8. Outcome recording + library feedback

**Can tolerate eventual consistency (Medium -- post-launch):**
9. Pin/unpin (single row update + event)
10. Profile updates (single row)
11. Annotation save (single row)

The `sql.begin()` pattern in postgres.js is simple:

```typescript
const result = await sql.begin(async (tx) => {
  await tx`INSERT INTO proposals ...`;
  await tx`INSERT INTO proposal_compliance_matrix ...`;
  return { proposalId };
});
```

No schema changes needed. This is pure code wrapping.

### Effort

- Critical tier: 3-4 hours (5 routes)
- High tier: 2-3 hours (3 routes)
- Total: ~1 day

### Priority

**Critical for launch.** The founding cohort will have multiple admins and customer users operating concurrently. Any partial-state corruption requires manual DB intervention to fix.

### Decision Needed

Eric: Should we wrap all 8 critical+high routes before launch, or just the top 5 critical ones and defer the rest to week 2?

---

## 2. Optimistic Concurrency Control

### Current State

Zero routes implement version checking. The `proposal_sections` table has no `version` column. Every UPDATE is a blind overwrite -- last write wins, no conflict detection. The bug report (Adversarial Audit, finding #2) flagged: "Two users editing the same section simultaneously produce last-write-wins."

### Risk

- **Section editing**: Two collaborators open the same section, both edit, both save. The second save silently overwrites the first with no warning. The first user's work is lost.
- **Status transitions**: Two admins both click "advance to pink team" on the same proposal at almost the same time. The race condition guards (`AND stage = ${previousStage}`) prevent double-advance, but only because that specific fix was applied during the audit. Other status fields (lock state, assignment) have similar guards now.
- **Lock operations**: Already fixed with `AND is_locked = false/true` guards during the audit.

The race condition guards on status transitions are good -- they use the atomic UPDATE WHERE pattern. But content editing has no protection at all.

### Recommendation

**Phase 1 (pre-launch, minimum viable):**

Add `version INTEGER DEFAULT 1` to `proposal_sections`. On every save, include `WHERE version = ${expectedVersion}` and increment version. Return 409 Conflict if the WHERE matches zero rows. The frontend shows "This section was modified by another user. Reload to see their changes."

```sql
UPDATE proposal_sections
SET content = $1, updated_at = now(), version = version + 1
WHERE id = $2 AND version = $3
RETURNING version;
```

If no row returned: 409 Conflict.

**Phase 2 (post-launch):**

Add OCC to `proposals` (stage field), `library_units` (content), and `curated_solicitations` (compliance data). These are lower-risk because concurrent editing is less likely.

**Phase 3 (multi-user scaling):**

Real-time collaboration via WebSocket (planned for V2+; see docs/archive/ARCHITECTURE_V5.md). OCC is the bridge until then.

### Effort

- Phase 1: 2-3 hours (1 migration + 1 API route change + frontend conflict UI)
- Phase 2: 4-6 hours (3 more tables + API changes)
- Total Phase 1: ~half day

### Priority

**High for multi-user scenarios.** The founding cohort will have tenant_admin + team members + partners editing concurrently during proposal deadlines. Lost work during a crunch will erode trust fast.

### Decision Needed

Eric: Is adding a `version` column to `proposal_sections` acceptable as a migration before launch? The alternative is client-side timestamp comparison (cheaper but less reliable).

---

## 3. Input Validation Architecture

### Current State

Three distinct validation patterns coexist:

1. **Zod via withHandler** (4 routes): `/api/tools/[name]`, `/api/auth/change-password`, `/api/health`, `/api/admin/system`. The `withHandler` wrapper in `lib/api-helpers.ts` is well-designed -- handles auth, Zod parsing, role checks, error enveloping, and logging. This is the gold standard.

2. **Zod without withHandler** (6 routes): `/api/applications`, `/api/admin/rfp-upload`, `/api/admin/topics/[id]`, `/api/portal/[tenantSlug]/spotlight/pin`. These import Zod directly and do manual `safeParse` calls.

3. **Manual or no validation** (~100 routes): The remaining routes use ad-hoc `if (!body.field)` checks, `typeof` guards, or nothing at all. Many trust that URL params are valid UUIDs without checking.

The bug report (finding #4) flagged: "Non-UUID strings in URL params cause 500 instead of 400." Finding #3: "No input size limits on content, comments, notes fields."

### Risk

- **500 errors on bad input**: Every unvalidated UUID param that hits a SQL query with an invalid string produces a Postgres error surfaced as 500, not 400. This is ugly UX and makes error monitoring noisy.
- **Unbounded input**: Content fields accept megabytes of text. A malicious or accidental paste of a 50MB document into a section editor would be stored in Postgres, potentially OOMing the connection.
- **Inconsistent error shapes**: Some routes return `{ error: "message" }`, others return `{ error: "message", code: "CODE" }`. The CLAUDE.md SOP requires both `error` and `code` on every error response, but enforcement is spotty.
- **Developer confusion**: Three patterns means new routes copy whichever pattern is closest, perpetuating inconsistency.

### Recommendation

**Standardize on `withHandler` for all new routes immediately.** For existing routes, migrate in priority order:

1. **Public endpoints first** (applications, waitlist, content): These face the internet. Validate everything.
2. **Portal endpoints second** (proposals, sections, library): These face authenticated customers. Validate to prevent accidental corruption.
3. **Admin endpoints last** (curation, triage, storage): These face Eric and internal admins. Lower risk but still worth migrating.

**Add these shared Zod types to a `lib/schemas.ts`:**

```typescript
export const zUUID = z.string().uuid();
export const zTenantSlug = z.string().min(1).max(63).regex(/^[a-z0-9-]+$/);
export const zContent = z.string().max(500_000); // 500KB max for any content field
export const zComment = z.string().max(10_000);  // 10KB max for comments
export const zPageSize = z.coerce.number().int().min(1).max(100).default(25);
```

**Do NOT migrate all 100+ routes before launch.** That is a multi-day effort with high regression risk. Instead, apply `withHandler` to the ~10 highest-risk routes (public + proposal CRUD) and migrate the rest incrementally post-launch.

### Effort

- Shared schemas + 10 priority routes: 1 day
- Remaining 90+ routes: 3-4 days (post-launch)

### Priority

**Medium.** The security risk from unvalidated input is real but bounded by authentication on most routes. The public endpoints (`/api/applications`) are the acute risk; the rest is about consistency and DX.

### Decision Needed

Eric: Should we enforce `withHandler` as a lint rule (e.g., a pre-commit check that new route files must use it)? Or is documentation + code review sufficient?

---

## 4. Rate Limiting Strategy

### Current State

Zero rate limiting on any endpoint. The `rate_limit_state` table exists in the baseline migration (001) but is never queried by any application code. The only rate limiting in the entire system is the agent fabric's hardcoded 50 calls/hour/tenant check, which runs inside the Python pipeline and is unrelated to HTTP endpoints.

The bug report (finding #10) flagged: "Rate limiting absent on public endpoints -- /api/applications can be flooded."

### Risk

- **Application spam**: `/api/applications` is public, unauthenticated, and creates a DB row per request. A bot could insert millions of rows.
- **Auth brute force**: `/api/auth` endpoints (login, change-password) have no lockout or throttle. An attacker can try passwords at wire speed.
- **API abuse**: Authenticated endpoints have no per-user throttle. A compromised or misbehaving client could hammer proposal CRUD at thousands of requests per second.
- **AI cost amplification**: If agent invocation endpoints become HTTP-accessible, an attacker could burn through the Anthropic budget.

### Recommendation

**Tier 1 -- Pre-launch (IP-based, middleware-level):**

Add a simple in-memory rate limiter to `middleware.ts` for the highest-risk paths:

| Path Pattern | Limit | Window | Key |
|---|---|---|---|
| `/api/applications` (POST) | 5 | 15 min | IP |
| `/api/auth/*` | 10 | 15 min | IP |
| `/api/waitlist` (POST) | 5 | 15 min | IP |

Implementation: Use a `Map<string, {count, resetAt}>` in middleware. Edge runtime supports this for single-instance deploys (Railway runs one container). For multi-instance, switch to the `rate_limit_state` table.

**Tier 2 -- Post-launch (user-based, per-route):**

| Path Pattern | Limit | Window | Key |
|---|---|---|---|
| `/api/portal/*/proposals` (POST) | 10 | 1 hour | userId |
| `/api/portal/*/sections/*` (PUT) | 60 | 1 min | userId |
| `/api/admin/tools/*` | 100 | 1 min | userId |
| `/api/portal/*/ai/*` | 20 | 1 hour | tenantId |

Use the existing `rate_limit_state` table with a utility function:

```typescript
async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean>
```

**Tier 3 -- Scale (Redis-backed):**

When Railway adds a second container, move to Redis or Upstash for distributed rate limiting. The `rate_limit_state` table can serve as a fallback.

### Effort

- Tier 1: 2-3 hours (middleware + in-memory map)
- Tier 2: 4-6 hours (utility function + apply to priority routes)
- Total pre-launch: ~half day

### Priority

**High for public endpoints.** The application form and auth endpoints face the internet with zero protection. Even a simple rate limiter prevents the most obvious abuse. Internal endpoints are lower priority because they require authentication.

### Decision Needed

Eric: Is Railway running a single container (single-process rate limiting is fine) or multiple replicas (need DB-backed or Redis-backed)? This determines the implementation approach.

---

## 5. Background Job Architecture

### Current State

The pipeline runs three concurrent loops via `asyncio.gather` in `main.py`:

1. **Ingester consumer** (`run_consumer_loop`): Polls `pipeline_schedules` every 60s, creates `pipeline_jobs`, dispatches to ingester classes.
2. **Workflow processor** (`run_workflow_processor`): Polls `system_events` every 10s, matches triggers, executes workflow steps.
3. **Health server** (`run_health_server`): HTTP health check endpoint.

**Not running anywhere:**
- Memory lifecycle (decay, GC, compaction, contradiction resolution) -- 4 modules, fully implemented, no scheduling
- Learning modules (DiffAnalyzer, PreferenceExtractor, PatternPromoter, Calibrator) -- 5 modules, fully implemented, no scheduling
- Agent task queue polling -- fabric has the code, but nothing starts it
- Heartbeat/stuck detection for workflow instances -- WorkflowManager has the code, but it is not started in `main.py`

The agent framework docs specify schedules (decay = daily, GC = weekly, compactor = monthly, etc.) but these are documentation-only -- no cron, no scheduler, no integration point exists.

### Risk

- **Memory bloat**: Without decay and GC, episodic memories accumulate indefinitely. After 6 months of active use, context assembly will pull stale, irrelevant memories, degrading agent quality and increasing token costs.
- **No learning**: Without PreferenceExtractor and PatternPromoter running, the learning flywheel documented in AGENT_FRAMEWORK.md never turns. Agent output quality never improves from human feedback.
- **Stuck workflows**: Without heartbeat monitoring and stuck detection, a workflow that crashes mid-execution stays in `running` state forever. No alert, no auto-recovery.
- **Agent task queue**: Tasks queued by workflows via AI_INVOKE steps are never consumed because the fabric's task poller is not started.

### Recommendation

**Phase 1 -- Pre-launch (integrate WorkflowManager into main.py):**

The WorkflowManager already has heartbeat and stuck detection loops. Add them to `main.py`:

```python
from agents.fabric import AgentFabric
from workflows.manager import WorkflowManager

manager = WorkflowManager(database_url=DATABASE_URL)
fabric = AgentFabric(database_url=DATABASE_URL)

await asyncio.gather(
    run_consumer_loop(...),
    run_workflow_processor(...),
    run_health_server(...),
    manager.run_heartbeat_loop(shutdown_event),
    manager.run_stuck_detection_loop(shutdown_event),
)
```

**Phase 2 -- Post-launch (add memory lifecycle as scheduled tasks):**

Add a simple scheduler loop to `main.py` that runs lifecycle modules on their documented schedules. No external cron needed -- just a loop with `asyncio.sleep`:

```python
async def run_lifecycle_scheduler(database_url, shutdown_event):
    """Run memory lifecycle modules on documented schedules."""
    while not shutdown_event.is_set():
        hour = datetime.utcnow().hour
        day = datetime.utcnow().weekday()

        if hour == 3:  # 3 AM UTC daily
            await MemoryDecay(database_url).run()
            await PreferenceExtractor(database_url).run()

        if hour == 4 and day == 0:  # 4 AM Monday weekly
            await MemoryGC(database_url).run()
            await PatternPromoter(database_url).run()

        if hour == 5 and day == 0 and datetime.utcnow().day <= 7:  # First Monday monthly
            await MemoryCompactor(database_url).run()
            await ContradictionResolver(database_url).run()
            await Calibrator(database_url).run()

        await asyncio.sleep(3600)  # Check every hour
```

**Phase 3 -- Scale (separate worker process):**

When agent volume grows, split the pipeline into two Railway services:
- `pipeline-ingester`: Ingestion + shredding (CPU/IO bound)
- `pipeline-agents`: Workflow processing + agent tasks + memory lifecycle (API-call bound)

### Effort

- Phase 1: 2-3 hours (wire up existing code)
- Phase 2: 4-6 hours (scheduler loop + testing)
- Phase 3: 1-2 days (service split, post-launch)

### Priority

**Medium.** The learning flywheel and memory lifecycle are not needed for launch -- the founding cohort will generate minimal agent interactions in the first weeks. But the WorkflowManager stuck detection should be wired up before launch to prevent invisible workflow failures.

### Decision Needed

Eric: Should we add the WorkflowManager loops to `main.py` before launch (2-3 hours), or defer all background job work to post-launch? The stuck detection is the only piece that prevents silent failures in production.

---

## 6. Error Boundary Architecture

### Current State

One root `error.tsx` at `frontend/app/error.tsx`. Zero route-group-specific error boundaries. Zero `loading.tsx` files. This means:

- Any unhandled error in any page crashes the entire app to the root error boundary
- No loading states during navigation (pages appear to hang)
- No graceful degradation (a failing DB query on the proposals list takes down the entire portal layout)

### Risk

- **UX**: Pages with slow queries (proposals list, spotlight feed, library search) show a blank screen during data fetching. Users think the app is broken.
- **Blast radius**: A bug in the section editor page crashes the entire portal, including the sidebar navigation. The user cannot navigate away without a full page reload.
- **Admin vs. portal separation**: An admin-side error boundary should show different content (debug info, retry options) than a customer-facing one.

### Recommendation

**Minimum viable error boundaries (4 files):**

```
frontend/app/admin/error.tsx          -- Admin-specific error UI (show error details)
frontend/app/portal/error.tsx         -- Portal-specific error UI (customer-friendly)
frontend/app/portal/[tenantSlug]/loading.tsx -- Loading skeleton for tenant pages
frontend/app/admin/loading.tsx        -- Loading skeleton for admin pages
```

**Nice-to-have loading states (post-launch):**

```
frontend/app/portal/[tenantSlug]/proposals/loading.tsx
frontend/app/portal/[tenantSlug]/spotlights/loading.tsx
frontend/app/portal/[tenantSlug]/library/loading.tsx
```

Each loading state should show a skeleton UI matching the page layout (header, sidebar intact, content area with shimmer).

### Effort

- 4 minimum-viable files: 2-3 hours
- 3 nice-to-have loading states: 2-3 hours

### Priority

**Low (UX polish).** The root error boundary prevents actual crashes. The missing loading states are a UX issue, not a stability issue. Defer to post-launch unless there is time in Week 6.

### Decision Needed

Eric: Do you want the admin error boundary to show stack traces and error details (useful for debugging) or keep it generic (safer if customers ever see the admin UI)?

---

## 7. Event-Driven Architecture Gaps

### Current State

Events are emitted prolifically -- the `system_events` table captures every significant action. But consumption is sparse:

**Events with consumers:**
- `finder:rfp.uploaded:end` -> OnRfpUploaded workflow
- `finder:solicitation.pushed:single` -> OnSolicitationPushed workflow
- `finder:source.change_detected:single` -> OnSourceChangeDetected workflow
- `capture:application.accepted:end` -> OnApplicationAccepted workflow
- `proposal:proposal.created:end` -> OnProposalCreated workflow
- `proposal:proposal.advanced:single` -> OnProposalAdvanced workflows (2)

**Events emitted but never consumed (sampling):**
- `finder.opportunity.ingested` -- should trigger Opportunity Analyst agent
- `finder.scoring.completed` -- should trigger Scoring Strategist
- `capture.proposal.outcome_recorded` -- should trigger OutcomeAttributor + Calibrator
- `capture.section.drafted` -- should trigger Compliance Reviewer
- `capture.collaborator.invited` -- should trigger Partner Coordinator
- `capture.library.unit_created` -- should trigger Librarian
- `identity.user.created` -- no consumer
- `identity.purchase.completed` -- should trigger Capture Strategist

**The system namespace gap:** The workflow processor explicitly filters `WHERE namespace != 'system'` to prevent self-triggering loops. This is correct but means system-namespace events (workflow lifecycle, memory lifecycle, agent calibration) can never trigger workflows. If cross-namespace triggers are needed (e.g., "when agent calibration completes, notify admin"), a separate consumer would be required.

### Risk

- **Agent automation not wired**: The agent archetypes have `handles_event()` methods that declare which events they respond to, but nothing calls those methods. The workflow system and the agent fabric are two parallel systems that do not talk to each other yet.
- **Learning flywheel broken**: Even if lifecycle modules run, the events they should respond to (`proposal.section.edited` -> DiffAnalyzer) have no subscription mechanism.
- **Notification gaps**: Events like `collaborator.invited` should send emails, but the CMS automation rules only cover 10 event types out of 30+ defined.

### Recommendation

**Phase 1 -- Pre-launch (wire up critical agent triggers via workflows):**

Add 2-3 new workflow definitions that bridge events to agent invocations:

```python
# on_opportunity_ingested.py
class OnOpportunityIngested(Workflow):
    trigger = EventTrigger(namespace="finder", type="opportunity.ingested", phase="single")
    steps = [
        Step(name="analyze", step_type=StepType.AI_INVOKE, action="agents.opportunity_analyst"),
        Step(name="score_all", action="workflows.actions.score_tenants.match_tenants", depends_on="analyze"),
    ]
```

**Phase 2 -- Post-launch (add CMS rules for notification gaps):**

Add automation_rules rows for the uncovered events:
- `capture.collaborator.invited` -> `send_email` (invitation notification)
- `capture.proposal.outcome_recorded` -> `notify_admin` (win/loss alert)
- `identity.purchase.completed` -> `send_email` (purchase confirmation)

**Phase 3 -- Scale (event subscription framework):**

Replace the flat trigger-matching with a subscription registry where modules (agents, workflows, CMS rules) declare their subscriptions at boot time. The processor routes events to all subscribers, not just workflow triggers.

### Effort

- Phase 1: 3-4 hours (2-3 workflow definitions + action wiring)
- Phase 2: 2-3 hours (automation_rules seed migration)
- Phase 3: 2-3 days (subscription framework)

### Priority

**Medium.** The founding cohort will use agent features sparingly at first. The critical path (RFP upload -> shred -> curate -> push -> score) is fully wired. The agent triggers and notification gaps matter when customers start using proposal workspaces actively, which is Week 4+ post-launch.

### Decision Needed

Eric: Should we wire up the Opportunity Analyst auto-trigger for launch (so newly ingested opportunities automatically get AI analysis), or keep it manual-only for the founding cohort while we build confidence in the agent output?

---

## 8. CMS/Pipeline Data Synchronization

### Current State

Two separate PostgreSQL databases:
- **Main DB** (`govtech_intel`): All application data -- users, tenants, proposals, opportunities, events, agent memory. Used by frontend + pipeline.
- **CRM DB**: CMS-specific tables -- `email_accounts`, `email_templates`, `campaigns`, `outbox`, `cms_events`, `admin_todos`. Used by the CMS FastAPI service.

The CMS service reads `system_events` from the **main DB** (via a separate connection) to trigger automation rules, but writes its action results to the **CRM DB** (`automation_log`). User lookups for email delivery require cross-DB queries (CMS reads `users` table from main DB to resolve email addresses).

Email is currently split: some emails go through the CMS service (Gmail API) and some through the frontend (Resend). The `collaborator invite` route in the frontend sends email directly via Resend, while the CMS `send_email` action uses Gmail API.

### Risk

- **Cross-DB consistency**: If the CMS DB is down, automation rules still fire (they read from main DB) but cannot log results or check dedup (written to CRM DB). This could cause duplicate email sends.
- **Email provider split**: Two email providers (Resend + Gmail) means two sets of delivery logs, two reputation scores, two points of failure. Debugging "did the customer get the email?" requires checking both systems.
- **Operational complexity**: Two databases means two backup strategies, two migration pipelines, two connection strings to manage.
- **Template drift**: Email templates exist in both the CRM DB (`email_templates`) and as hardcoded strings in frontend Resend calls. No single source of truth.

### Recommendation

**For launch: Leave it as-is.** The CMS is a "dormant V1 placeholder" (per CLAUDE.md). The founding cohort of 20 users will receive ~5-10 emails total during onboarding. The dual-DB complexity is manageable at this scale.

**Post-launch (Month 2-3): Consolidate email to one provider.**

Pick one:
- **Option A**: All email through Resend (simpler, no OAuth, good deliverability). Move CMS email templates to the main DB. CMS service becomes a pure event consumer that calls Resend.
- **Option B**: All email through Gmail (existing Google Workspace integration, personal touch for founding cohort). Move frontend Resend calls to emit `notification.requested` events and let CMS handle delivery.

**Post-launch (Month 4-6): Evaluate CRM DB merge.**

If the CMS never grows beyond email automation + admin todos, merge its tables into the main DB and eliminate the second database entirely. The tables are small and low-write.

If the CMS evolves into a real CRM (contact management, deal pipeline, etc.), keep it separate but add proper cross-service communication (API calls, not cross-DB queries).

### Effort

- Launch: 0 (leave as-is)
- Email consolidation: 1-2 days
- DB merge (if chosen): 2-3 days

### Priority

**Low (post-launch).** The dual-DB architecture works fine at founding cohort scale. Consolidate when email volume or operational complexity justifies it.

### Decision Needed

Eric: For the founding cohort, do you want all customer emails to come from your Gmail (personal touch, "from Eric") or from a system address via Resend (scalable, no Google OAuth maintenance)? This decision drives which provider to consolidate on.

---

## Summary Matrix

| # | Area | Priority | Pre-Launch Effort | Risk if Deferred |
|---|------|----------|-------------------|------------------|
| 1 | Transaction Strategy | **Critical** | 1 day | Orphaned data on any multi-step failure |
| 2 | Optimistic Concurrency | **High** | 0.5 day | Lost work when 2+ users edit concurrently |
| 3 | Input Validation | **Medium** | 1 day (10 routes) | 500s on bad input, unbounded content |
| 4 | Rate Limiting | **High** | 0.5 day | Public endpoint abuse, auth brute force |
| 5 | Background Jobs | **Medium** | 0.5 day (manager only) | Stuck workflows go undetected |
| 6 | Error Boundaries | **Low** | 0.5 day | Poor UX on errors, no loading states |
| 7 | Event Architecture | **Medium** | 0.5 day | Agent automation not wired |
| 8 | CMS Synchronization | **Low** | 0 (defer) | Dual email providers, manageable at scale |

**Total pre-launch effort for Critical+High items: ~3 days.**

### Recommended Sprint Priority

1. Transaction wrappers on 5 critical routes (day 1, morning)
2. Rate limiting on public endpoints (day 1, afternoon)
3. OCC on proposal_sections (day 2, morning)
4. WorkflowManager integration into main.py (day 2, afternoon)
5. withHandler migration on 10 priority routes (day 3)
6. Error boundaries (day 3, if time permits)
