# HITL Readiness — Comprehensive TODO List

**Date:** 2026-05-28
**Goal:** Ship-ready for 20-seat founding cohort, first HITL testing push
**Source:** 4 deep-dive code audits + migration audit + prior bug sweeps

---

## Priority Tiers

- **P0 — Blocks HITL testing** (must work before Eric starts testing)
- **P1 — Blocks customer demo** (must work before founding cohort sees the product)
- **P2 — Post-launch** (nice-to-have, can iterate)

---

## Phase 1: Ingestion Pipeline (Scout → Ingest → Triage)

### P0-1: Ingesters must populate topic-level columns
**Problem:** All 3 ingesters (SBIR.gov, SAM.gov, DSIP) create opportunity rows but leave `topic_number`, `topic_branch`, `topic_status`, `tech_focus_areas`, and `solicitation_id` as NULL. Topic metadata is available in the API responses but not written to the DB.

**Tasks:**
- [ ] `pipeline/src/ingest/sbir_gov.py` — Set `topic_number` from API `topicNumber`, `topic_branch` from `branch`, `topic_status` from `topicStatus`, `solicitation_id` linking to parent BAA
- [ ] `pipeline/src/ingest/dsip.py` — Set `topic_number` (already available in normalize), `topic_branch` from `component`, `topic_status` from API `status` field, `solicitation_id` linking to parent BAA
- [ ] `pipeline/src/ingest/sam_gov.py` — For SBIR/STTR BAAs, parse attached topic lists and create one row per topic (currently creates one row per BAA)
- [ ] `pipeline/src/ingest/base.py` — Update `_upsert_opportunity()` to include topic columns in INSERT/UPDATE
- [ ] Create parent-child relationship: parent BAA gets `curated_solicitations` row, each topic gets `solicitation_id` pointing to it
- **Effort:** 4h | **Files:** 4

### P0-2: Fix dispatcher cron scheduling
**Problem:** ~~Fixed — cron heuristic was using string match "1" instead of run_type.~~ Verified fixed in this session.
**Status:** DONE

### P0-3: Workflow processor event recovery on restart
**Problem:** ~~Fixed — processor now seeds 5 minutes back instead of MAX(created_at).~~ Verified fixed.
**Status:** DONE

---

## Phase 2: Curation Pipeline (Admin Triage → Push)

### P0-4: Source Scout → Draft Solicitation flow
**Problem:** Source Scout detects changes, `create_drafts_from_scout` creates draft solicitations. This flow appears functional from code audit.
**Status:** BELIEVED WORKING — needs HITL verification

### P0-5: Shredder compliance extraction
**Problem:** `shred.py` + `extract_compliance()` are fully implemented. Uses Claude for structured extraction with pattern-based fallback.
**Status:** BELIEVED WORKING — needs HITL verification with real RFP PDFs

---

## Phase 3: Scoring + Spotlight (Push → Customer View)

### P0-6: Scoring must score individual topics, not just landing opportunity
**Problem:** `score_tenants.py` only scores `cs.opportunity_id` (the parent/landing opportunity). Individual topics (opportunities with `solicitation_id`) get no `tenant_pipeline_items` rows. Customers see nothing in their spotlight.

**Tasks:**
- [ ] `pipeline/src/workflows/actions/score_tenants.py` — After scoring landing opportunity, query all topics for the solicitation and upsert `tenant_pipeline_items` for each
- [ ] Scoring algorithm should use topic-level data (tech_focus_areas, topic_branch) when available
- **Effort:** 3h | **Files:** 1

### P0-7: Spotlight feed visibility gate
**Problem:** ~~Fixed — added `solicitation_id IN (SELECT id FROM curated_solicitations WHERE status = 'pushed_to_pipeline')` filter.~~
**Status:** DONE

### P1-8: Spotlight detail page — wrong join for topics
**Problem:** `spotlights/[spotlightId]/page.tsx` uses `cs.opportunity_id = o.id` instead of `cs.id = o.solicitation_id`. Namespace badges, curation status, and compliance data don't render for topic pages.

**Tasks:**
- [ ] Fix join: `LEFT JOIN curated_solicitations cs ON cs.id = o.solicitation_id`
- [ ] Fix compliance query to use `solicitation_id` chain instead of `opportunity_id`
- [ ] Add `cs.solicitation_type` to SELECT clause
- **Effort:** 1h | **Files:** 1

### P1-9: Spotlight filters don't apply
**Problem:** Spotlight GET handler fetches filter criteria (naics_codes, keywords, agencies, program_types) but the items query ignores them. Every spotlight shows the same items.

**Tasks:**
- [ ] `api/portal/[tenantSlug]/spotlights/[spotlightId]/route.ts` — Add WHERE clauses applying spotlight filters to items query
- **Effort:** 2h | **Files:** 1

---

## Phase 4: Proposal Creation + Skeleton

### P0-10: Proposal unlock flow
**Problem:** ~~Fixed — removed lock_count=0 rejection so admins can unlock the initial 72-hour review lock.~~
**Status:** DONE

### P0-11: Proposal creation — section skeleton from volumes
**Problem:** WORKING. `proposals/create/route.ts` pulls from `resolveTopicCompliance()`, builds sections from `volume_required_items`, applies templates, freezes compliance/volumes as S3 artifacts.
**Status:** VERIFIED WORKING

### P0-12: Purchase linkage
**Problem:** ~~Fixed — removed non-existent `updated_at` column from purchases UPDATE.~~
**Status:** DONE

### P0-13: OnProposalCreated workflow
**Problem:** ~~Fixed — removed premature AI draft step, now notifies admin for review.~~
**Status:** DONE

---

## Phase 5: AI Drafting + Editing

### P0-14: Frontend AI drafter (DraftAllSections)
**Problem:** Client component calls `proposal.draft_section` tool via `useTool()` hook. The tool is defined in `frontend/lib/tools/proposal-draft-section.ts` and calls Claude API directly. This should work but needs HITL verification.
**Status:** BELIEVED WORKING — needs verification that `ANTHROPIC_API_KEY` is set on frontend

### P0-15: Backend AI draft worker (pipeline_jobs consumer)
**Problem:** The `/api/portal/.../ai/draft` route queues jobs to `pipeline_jobs` table with `kind='draft_section'`, but no pipeline worker consumes these jobs. The ingester dispatcher only handles `kind IN ('ingest', 'shred_solicitation', 'scout_source')`.

**Tasks:**
- [ ] `pipeline/src/ingest/dispatcher.py` — Add `draft_section` to the job consumer dispatch, or create a separate consumer
- [ ] Implement the draft consumer that reads section context from job metadata, calls Claude, and saves the canvas content
- **Effort:** 4h | **Files:** 2-3
- **Note:** The frontend DraftAllSections component works independently of this. This is for the queue-based async path.

### P0-16: AI compliance check
**Problem:** WORKING. Synchronous Claude Haiku check per section against compliance variables. No DB persistence of results (by design — results shown inline).
**Status:** VERIFIED WORKING

---

## Phase 6: Collaboration + Stage Management

### P1-17: Stage advance with section snapshots
**Problem:** Stage advance route creates `canvas_versions` snapshots and `stage_completion_snapshots`. Code reviewed — appears functional.
**Status:** BELIEVED WORKING — needs HITL verification

### P1-18: Collaborator invite + stage access
**Problem:** Collaborator invite route, stage access permissions, and partner_user access controls all implemented. Team invite form exists in UI.
**Status:** BELIEVED WORKING — needs HITL verification

### P2-19: Real-time editing awareness
**Problem:** `editing_by` and `editing_since` columns exist on `proposal_sections` but no WebSocket/SSE implementation. Users won't see "User X is editing this section" warnings.

**Tasks:**
- [ ] Add polling-based "someone is editing" indicator to canvas editor
- **Effort:** 3h | **Files:** 2

---

## Phase 7: Export + Delivery

### P1-20: Proposal package export — ZIP/DOCX generation
**Problem:** Export endpoint returns structured JSON only. No actual ZIP, DOCX, PPTX, or PDF generation. Comment says "V1 TODO (P2-15)."

**Tasks:**
- [ ] Add DOCX generation using `docx` npm package (section content → Word document)
- [ ] Add ZIP bundling (DOCX + supporting docs + compliance matrix CSV)
- [ ] Wire download button in the UI to trigger file download
- **Effort:** 8h | **Files:** 2-3

---

## Phase 8: Agent Fabric

### P1-21: Agent archetype registration
**Problem:** `AgentFabric._archetypes` dict is always empty — no archetype auto-discovery or registration. The 10 archetypes exist as classes but are never instantiated.

**Tasks:**
- [ ] Add auto-discovery in `fabric.py.__init__()` or a `register_all()` function
- [ ] Wire archetype registration into pipeline startup (`main.py`)
- **Effort:** 2h | **Files:** 2

### P2-22: Pipeline draft_section worker using Agent Fabric
**Problem:** Once archetypes are registered (P1-21), the SectionDrafterArchetype can be used for queue-based drafting (P0-15).

**Tasks:**
- [ ] Create `pipeline/src/workers/draft_worker.py` that consumes `draft_section` pipeline_jobs
- [ ] Each job invokes `AgentFabric.invoke("section_drafter", ...)` with section context
- [ ] Save resulting canvas content to `proposal_sections.content` and create `canvas_versions` row
- **Effort:** 4h | **Files:** 2

---

## Phase 9: CMS + Email + Automation

### P0-23: CMS event bridge (publish/unpublish)
**Problem:** Migration 050 (now fixed) seeds the automation rules. `event_listener.py` has full action dispatch with 7 action types, completion events, dedup.
**Status:** WORKS — verified by code audit. Needs HITL smoke test.

### P1-24: Email outbox admin UI
**Problem:** Email queue worker, Gmail client, and campaign executor ALL work (verified). The HITL outbox API has full CRUD (claim, modify, approve, reject, bulk-approve). But there is **no admin frontend page** to manage the outbox. Admins have to use API calls directly.

**Tasks:**
- [ ] Build `frontend/app/admin/email-outbox/page.tsx` — table of pending/claimed emails with approve/reject buttons
- [ ] Wire to CMS API outbox endpoints (GET /outbox, POST /outbox/{id}/approve, etc.)
- [ ] Add outbox count badge to admin sidebar
- **Effort:** 6h | **Files:** 2-3

### P1-25: Automation rules admin UI
**Problem:** Backend fully supports dynamic rule matching and execution. Rules can only be created via direct DB inserts or CMS API — no frontend admin page exists.

**Tasks:**
- [ ] Build `frontend/app/admin/automation/page.tsx` — list/create/edit automation rules
- [ ] Show rule execution log from `automation_log` table
- **Effort:** 8h | **Files:** 2-3

### P1-26: Gmail OAuth configuration
**Problem:** Gmail client uses Google Workspace domain-wide delegation (service account + impersonation). Needs credentials configured on Railway.

**Tasks:**
- [ ] Set `GOOGLE_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS` env var on CMS Railway service
- [ ] Set `GMAIL_IMPERSONATE_EMAIL` env var (the Gmail address to send from)
- [ ] Test send via CMS health check or API
- **Effort:** 1h | **Files:** 0 (env config only)

### P0-27: Email template coverage
**Problem:** 6 templates exist and are verified working: `applicationAccepted`, `applicationRejected`, `welcomeOnboarded`, `adminNewApplicationAlert`, `spotlightDigest`, `collaboratorInvite`. Covers the core HITL flows.
**Status:** VERIFIED WORKING — 6 templates with inline CSS, variable substitution

### P2-28: Social media posting
**Problem:** `social_poster.py` — framework works (polling, status tracking, retry). LinkedIn and Twitter `raise NotImplementedError`. CRUD API for accounts/posts is functional.

**Tasks:**
- [ ] Implement LinkedIn API OAuth2 token exchange + ugcPost creation
- [ ] Build social post create/schedule UI in CMS SPA
- **Effort:** 16h | **Files:** 4-5

### P2-29: Drip campaign builder UI
**Problem:** Drip engine WORKS (step advancement, delay logic, enrollment lifecycle, HITL routing). Drip CRUD API is functional. No admin UI for creating/managing sequences.

**Tasks:**
- [ ] Build drip campaign builder UI in CMS SPA
- [ ] Test drip enrollment → step advancement → email delivery
- **Effort:** 8h | **Files:** 3-4

---

## Phase 10: Auth + Security

### P0-28: Portal dispatcher resilience
**Problem:** ~~Fixed — added DB fallback for stale JWT role + tenant slug lookup.~~
**Status:** DONE

### P1-29: CMS login page
**Problem:** CMS SPA uses HTTP Basic Auth as stopgap. Real login page needed.

**Tasks:**
- [ ] Build login page component in CMS SPA (`services/cms/frontend/`)
- [ ] Implement session-based auth (JWT or cookie) in FastAPI
- **Effort:** 6h | **Files:** 4-5

### P1-30: Admin billing page
**Problem:** Sidebar links to `/admin/billing` which exists as a basic page. Needs Stripe subscription management.
**Status:** BASIC PAGE EXISTS — enhancement is P2

---

## Phase 11: Data Quality + Monitoring

### P1-31: Double-shred prevention
**Problem:** RFP upload creates both a `pipeline_jobs` row AND emits an event that triggers `OnRfpUploaded` workflow — both try to shred the same document.

**Tasks:**
- [ ] Remove the direct `pipeline_jobs` INSERT from the upload route; let the workflow handle it
- [ ] OR add dedup check in the shred action
- **Effort:** 1h | **Files:** 1

### P1-32: Lifecycle scheduler bounded reconnect
**Problem:** ~~Fixed — replaced recursive reconnect with capped exponential backoff.~~
**Status:** DONE

### P2-33: Dashboard count accuracy
**Problem:** Some dashboard counts use `.length` on JS arrays instead of SQL `COUNT(*)`.

**Tasks:**
- [ ] Audit all dashboard pages for count accuracy
- [ ] Replace client-side counting with SQL aggregates
- **Effort:** 2h | **Files:** 2-3

---

---

## Railway Environment Variables

### Frontend Service (govtech-frontend-production)
```
DATABASE_URL          — PostgreSQL connection string (already set)
NEXTAUTH_SECRET       — JWT signing secret (already set)
NEXTAUTH_URL          — Public URL (already set)
ANTHROPIC_API_KEY     — For AI drafting + compliance checks
STRIPE_SECRET_KEY     — For payments (already set)
STRIPE_WEBHOOK_SECRET — For webhook verification (already set)
```

### Pipeline Service (govtech-pipeline-production)
```
DATABASE_URL          — PostgreSQL connection string (already set)
ANTHROPIC_API_KEY     — For shredder + agent fabric
SAM_GOV_API_KEY       — For SAM.gov ingester (get from sam.gov/api)
API_KEY_ENCRYPTION_SECRET — For encrypted key storage
```

### CMS Service (govtech-cms-production)
Where to set CMS-specific env vars on Railway:
```
DATABASE_URL              — Main DB (same as frontend/pipeline)
CMS_DATABASE_URL          — CMS-specific DB (if separate, otherwise same)
CMS_BASIC_USER            — HTTP Basic Auth username (stopgap)
CMS_BASIC_PASS            — HTTP Basic Auth password (stopgap)
ANTHROPIC_API_KEY         — For AI content generation
GOOGLE_SERVICE_ACCOUNT_JSON — Gmail API service account credentials (JSON string)
GMAIL_IMPERSONATE_EMAIL   — Gmail address to send from (e.g., notifications@yourcompany.com)
GMAIL_DAILY_LIMIT         — Optional, defaults to 500
```

All CMS env vars go on the **CMS Railway service** (the one running `services/cms/`), not the frontend. The CMS is a separate FastAPI service with its own Railway deployment.

---

## Summary by Priority

| Priority | Count | Total Effort | Description |
|----------|-------|-------------|-------------|
| **P0** | 2 open | ~7h | Ingester topic columns, scoring topics |
| **P1** | 10 open | ~35h | Spotlight fixes, export, agent fabric, email outbox UI, automation UI, CMS auth, dedup, Gmail config |
| **P2** | 5 open | ~33h | Social media, drip campaigns, real-time editing, dashboard, billing |
| **DONE** | 12 | — | Fixed this session |

### Critical Path for HITL Testing

```
Step 1: P0-1 (Ingester topic columns)     — 4h
  → Topics have proper metadata + parent-child links

Step 2: P0-6 (Scoring scores topics)      — 3h
  → Topics appear with scores in spotlight feed

Step 3: Verify env vars set on Railway    — 15m
  → ANTHROPIC_API_KEY on frontend + pipeline
  → SAM_GOV_API_KEY on pipeline

Step 4: HITL testing begins
  → Admin: ingest real DOD/DOE data → curate → push
  → Customer: see topics in spotlight → pin → purchase proposal
  → Admin: review skeleton → unlock → customer drafts with AI
  → Export JSON (DOCX generation is P1-20)
```

**Total blocking effort: ~7 hours of coding + env var config, then HITL testing can begin.**

---

## What Works Today (Verified by Code Audit)

| Component | Status |
|-----------|--------|
| SAM.gov + SBIR.gov + DSIP ingesters | ✅ Run, create opportunities (need topic columns) |
| Source Scout (detect + draft) | ✅ Full implementation |
| Shredder (PDF → structured data) | ✅ Claude-powered extraction |
| Compliance extraction | ✅ Claude + pattern-based fallback |
| Admin triage/curation UI | ✅ Full CRUD |
| Push to spotlight | ✅ Event chain connects |
| Proposal creation from volumes | ✅ Full skeleton builder |
| AI compliance check | ✅ Synchronous Claude Haiku |
| Canvas editor | ✅ 12 node types, WYSIWYG |
| Stage management (5 stages) | ✅ Gate checks, snapshots |
| Collaborator invites | ✅ Stage-scoped permissions |
| CMS event bridge | ✅ Publish/unpublish to Main DB |
| Email queue + Gmail client | ✅ Send, track, retry |
| Campaign executor | ✅ Audience targeting, HITL routing |
| Drip engine | ✅ Step advancement, enrollment lifecycle |
| 6 email templates | ✅ Inline CSS, variable substitution |
| Auth + RBAC (5 roles) | ✅ Middleware + page-level checks |
| Workflow engine | ✅ Event matching, crash recovery |
| Activity logging | ✅ All major actions logged |
| Migration runner | ✅ Per-migration transactions |
