# CLAUDE_CLIFFNOTES.md — Session Handoff

**Purpose:** Concise handoff document. Any future Claude session reads this
to immediately understand where the project is and what was done.

**Last updated:** 2026-04-26

**Authoritative architecture:** [`docs/ARCHITECTURE_DAY365.md`](./ARCHITECTURE_DAY365.md)

---

## Current State (2026-04-26)

### What's Built and Deployed

- **Frontend**: Next.js 15 on Railway (`govtech-frontend`), auto-deploys on merge
- **Pipeline**: Python 3.12 on Railway (`pipeline`), auto-deploys on merge
- **PostgreSQL**: PG 18, Railway managed (`govtech_intel`)
- **S3 Bucket**: Railway storage (`rfp-pipeline-prod-r8t7tr6` at `t3.storageapi.dev`)
- **Auth**: `eric@rfppipeline.com` is master_admin, login works end-to-end

### Sprint Summary (this session)

Major features built this session:

1. **Library import system** — format-aware readers (DOCX/PPTX/PDF/TXT) that preserve
   document structure as atomization boundaries. Mammoth for DOCX, pdf-parse for PDF,
   JSZip for PPTX. Heading-based atom grouping with category inference.
2. **Atom review UI** — `/portal/[slug]/library/review` for user-in-the-loop acceptance,
   rejection, recategorization, tagging of extracted atoms.
3. **Library CRUD API** — GET with filtering/pagination, PATCH, DELETE, bulk operations.
4. **Pipeline document agents** — 4 format-specific lifecycle agents (DocxAgent,
   PptxAgent, XlsxAgent, PdfAgent) with base class, registry, converter (LibreOffice
   headless).
5. **Comprehensive audit** — 5 parallel review agents found 47 issues across auth,
   events, fault tolerance, error handling. All fixed.
6. **Application form overhaul** — chip button UX fix, URL normalization, mandatory
   fields, full 14-section T&C with scroll-to-accept + email signature.
7. **Admin enhancements** — S3 file manager (`/admin/storage`), mandatory admin notes
   on accept/reject, status toggle for testing, SBIR award data ingest +
   auto-enrichment on application cards.
8. **Google Workspace email** — Gmail API via OAuth2 refresh token, 5 email templates,
   Calendar API for deadlines, auto-send on accept/reject/apply.
9. **CMS content system** — `automation_rules` + `cms_content` tables, content API for
   marketing pages.
10. **Presigned URL uploads** — browser-to-S3 direct upload for 300MB+ files.
11. **Onboarding guides** — Customer Guide (323 lines) + Admin Operations Guide
    (487 lines).

---

### Key Files Added/Modified This Sprint

**Frontend — Library import:**
- `frontend/lib/import/` — docx-reader, pptx-reader, pdf-reader, text-reader, types, index

**Frontend — Email + CMS:**
- `frontend/lib/email.ts` — Google Workspace OAuth2 + Gmail/Calendar API
- `frontend/lib/email-templates.ts` — 5 responsive HTML email templates
- `frontend/lib/terms.ts` — T&C v2-founding-cohort
- `frontend/lib/sbir-ingest.ts` — CSV parser for SBIR company/award data

**Frontend — Components:**
- `frontend/components/portal/atom-review.tsx` — atom review UI
- `frontend/components/admin/admin-file-manager.tsx` — S3 browser
- `frontend/components/admin/application-review.tsx` — application review panel

**Frontend — API routes:**
- `frontend/app/api/admin/storage/` — S3 file management API (GET/POST/PUT/PATCH/DELETE)
- `frontend/app/api/admin/sbir-data/` — ingest + lookup APIs
- `frontend/app/api/admin/content/` — CMS content API
- `frontend/app/api/admin/test-email/` — email diagnostic endpoint

**Pipeline — Document agents:**
- `pipeline/src/document/` — base.py, registry.py, converter.py, docx/pptx/xlsx/pdf agents

**Migrations:**
- `db/migrations/018_sbir_award_data.sql` — SBIR tables
- `db/migrations/019_automation_and_content.sql` — automation rules + CMS

**Docs:**
- `docs/CUSTOMER_ONBOARDING_GUIDE.md`
- `docs/RFP_ADMIN_OPERATIONS_GUIDE.md`

---

### Current Blockers / In-Progress

- **Gmail API OAuth2** — configured but returning "skipped" in some cases. Test
  endpoint deployed (`/api/admin/test-email`), needs debugging after Railway redeploy.
- **Railway deploy speed** — slow at the moment.
- **Large SBIR CSV upload** (300MB) — presigned URL flow built but not yet tested on
  Railway.

---

### Tool Registry

32 registered tools across 8 namespaces:

**solicitation.\*** (11): list-triage, get-detail, claim, release, push, dismiss,
approve, request-review, reject-review, save-annotation, delete-annotation

**compliance.\*** (4): add-variable, list-variables, save-variable-value,
extract-from-text

**volume.\*** (4): add, delete, add-required-item, delete-required-item,
update-required-item

**opportunity.\*** (3): get-by-id, add-topic, bulk-add-topics

**ingest.\*** (3): trigger-manual, list-recent-runs, get-run-detail

**memory.\*** (2): write, search

**library.\*** (2): save-atom, search-atoms

**proposal.\*** (1): draft-section

Plus the curation-memory tool (1).

---

### Test Suite

- **Pipeline**: 16 test files in `pipeline/tests/`
- **Frontend**: 12 test files in `frontend/__tests__/`
- All passing. Curation flow assertion was updated for `compliance_value.saved` event.

---

### Migrations

20 files (000-019), all idempotent, additive. Auto-apply via `migrate.yml` when
`db/migrations/**` changes on merge to main.

- 000: drop_all (dev only)
- 001-004: baseline, system seed, compliance seed, agents seed
- 005-006: dedupe pipeline schedules, normalize user emails
- 007-010: system events, capacity/health, curation extensions, shredder
- 011-014: applications, volumes/documents, topics as opportunities, phase-aware volumes
- 015: document dedup and rounds
- 016-017: system tenant, canvas templates + library_units
- 018: SBIR award data + company directory
- 019: automation rules + CMS content

---

### Environment

- **Branch**: `claude/analyze-project-status-KbAhg` (ahead of main)
- **Latest commit**: `1fb002f` — fix(accept): handle re-acceptance without duplicate tenant/user crash
- **ANTHROPIC_API_KEY**: set on both services
- **Google OAuth2**: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN set on frontend
- **GOOGLE_WORKSPACE_EMAIL**: `platform@rfppipeline.com`

---

### Email Architecture

- `platform@rfppipeline.com` — system automation sender (Google Workspace account)
- Aliases: `spotlight@`, `notifications@`, `noreply@` (on platform@)
- `support@` alias on `eric@rfppipeline.com`
- Gmail API via OAuth2 refresh token (not service account — org policy blocks key creation)
- 5 email templates: welcome, accepted, rejected, apply-confirmation, deadline-reminder

---

### What's Previously Built (pre-sprint)

- **Admin workspace**: PDF viewer (react-pdf) + compliance matrix side-by-side.
  Text selection, tag popover, variable assign with SourceAnchor.
  Highlights persist via solicitation_annotations. Provenance on matrix.
  Topics panel. Volumes panel. Activity feed.
- **Shredder**: PDF -> pymupdf4llm -> Claude -> sections + compliance -> DB + S3 artifacts
- **HITL memory**: verify/correct -> episodic_memories with namespace key
- **S3 artifacts**: Upload -> store -> shred -> artifacts. Portal provisioner.
- **Marketing**: 5 pages + Apply form + application pipeline
- **Canvas document system**: renderer, sidebar, editor, .docx export, library.save_atom tool

---

### What's STUB or PLANNED

- Stripe integration (payments)
- Scoring engine
- Automation engine (rules table exists, engine not built)
- 10 agent archetypes (all `pass` in pipeline)
- Workers (embedder, emailer, etc.)
- Spotlight feed (component exists, data pipeline stub)
- Proposal workspace (component exists, workflow stub)
- Agent provisioning
- Notifications system

---

### What NOT to Do

- Don't copy-paste from git commit `02d6b70` (pre-V2 wipe) — reference only
- Don't add service account keys (Google org policy blocks them)
- Don't use Resend for email (Google Workspace is the email provider)
- Don't touch Railway settings without user confirmation
- Don't bypass the tool registry — all tool invocations go through `registry.invoke()`

---

### Design Documents

- `ARCHITECTURE_DAY365.md` — full system design (14 sections, 5 Mermaid diagrams)
- `AGENT_FABRIC_DESIGN.md` — Claude agent architecture
- `CANVAS_DOCUMENT_ARCHITECTURE.md` — canvas/document system
- `IMPLEMENTATION_PLAN_V2.md` — complete file tree + implementation plan
- `TOOL_CONVENTIONS.md` — tool authoring standards
- `EVENT_CONTRACT.md` — event system contract
- `API_CONVENTIONS.md` — API route patterns

---

### New Session Onboarding

1. Read `CLAUDE.md` (project rules)
2. Read this file (current state)
3. Read `ARCHITECTURE_DAY365.md` (system design)
4. Run tests: `cd pipeline && python -m pytest tests/` + `cd frontend && npx vitest run`
5. Check `git log --oneline -20`
6. Update this file at next milestone
