# Deprecation Candidates — For Joint Review

**Date:** 2026-06-23 · derived from the Phase 1 file-by-file pass (`docs/baseline/inventory/`).

> ⚠️ **NOTHING in this list will be deleted without explicit sign-off.** Each item names a required
> **pre-removal check** (usually a repo-wide grep / a runtime-write check). Confidence: **H** = strong
> evidence of obsolescence, **M** = likely but verify, **L** = suspicious, needs investigation.
> Items split into: **A. Code (safe-ish)** · **B. DB tables (need write-path check)** · **C. Docs/infra** ·
> **D. Stale text to FIX (keep the file)**.

---

## A. Code — files / blocks

| Item | Type | Reason | Conf | Recommended action · pre-removal check |
|------|------|--------|------|----------------------------------------|
| `pipeline/src/events.py::emit_opportunity_event/emit_customer_event` | dead fn | deprecated wrappers, no callers in scope | H | delete · `grep -rn emit_opportunity_event\|emit_customer_event` |
| `pipeline/src/config.py STORAGE_ROOT="/data"` | dead const | storage is R2/S3; constant never imported by storage code | H | delete · `grep -rn STORAGE_ROOT` |
| `pipeline/tests/test_sam_gov.py`, `test_scoring.py`, `test_agents.py`, `test_memory.py` | empty test | placeholder files, no test functions | H | replace with real tests (P3) or remove |
| `pipeline/src/agents/learning/diff_analyzer.py` | dead module | no caller; target event has no workflow | M | confirm no import, then archive |
| `pipeline/src/agents/learning/outcome_attributor.py` | dead module | no caller; target event has no workflow | M | confirm no import, then archive |
| `pipeline/src/agents/learning/__init__.py` | broken | absolute imports `pipeline.src.agents.learning.*` would ImportError | M | **fix imports** (not delete) — it masks a real bug |
| `pipeline/src/scoring/engine.py::ScoringEngine` | dormant dup | no wired caller; live scoring is `workflows/actions/score_tenants.py` | M | confirm, then deprecate/remove · `grep -rn ScoringEngine` |
| `frontend/lib/export/pptx-exporter.ts` | dead/unwired | `exportToPptx` has no importer | M | **decide:** wire it (feature) or remove · `grep -rn exportToPptx` |
| `frontend/lib/export/xlsx-exporter.ts` | dead/unwired | `exportToXlsx` has no importer | M | same as above · `grep -rn exportToXlsx` |
| `frontend/lib/tools/opportunity-update-topic.ts` (dead `setParts` block) | dead code | dynamic SQL builder built but never executed (static SQL used) — **M1 work** | H | remove dead block (keep file) |
| `frontend/lib/tools/volume-update-required-item.ts` (dead `setParts` block) | dead code | same pattern | H | remove dead block (keep file) |
| `frontend/app/api/admin/rfp-curation/[solId]/triage/route.ts` (`updateFields`) | dead code | object built, never used | H | remove dead block (keep route) |
| `frontend/components/portal/portal-nav-link.tsx` | duplicate | identical to `admin/admin-nav-link.tsx` modulo color | L | consolidate into one themed component |
| `GET /api/system` route | dead/stub | 501 stub; `/api/admin/system` does the job | H | delete · confirm no client fetch |
| `GET,PATCH /api/portal/[tenantSlug]/agents/config` | stub | both return 501 (TODO P2-18) | H | implement (agent config UI) or remove |
| `POST /api/portal/[tenantSlug]/proposals` | redundant | immediately 400 "use /create" | M | keep as guard or remove + update callers |

## B. DB tables — require write-path confirmation before any drop

> Drop only after confirming **no service writes** (grep all 3 services) AND a backup/retention decision.

| Table | Reason suspected dead | Conf | Pre-removal check |
|-------|----------------------|------|-------------------|
| `opportunity_events`, `customer_events`, `content_events` | legacy pre-007 event bus, replaced by `system_events`; still have NOTIFY triggers | M | grep inserts across all services; check trigger usage |
| ~~`agent_task_queue`, `agent_task_results`~~ **KEEP** | NOT orphaned (grep-resolved): frontend writes (`lib/agent-client.ts`) + monitoring reads (`capacity.ts`, `admin/agents`); only the pipeline consumer `AgentFabric.process_task_queue()` is unscheduled. These are the interface to the dormant agent workforce | — | do NOT drop — revisit only if the workforce is formally abandoned |
| `solicitation_templates` | created 001, never modified; overlaps `solicitation_documents` | L | grep reads/writes |
| `solicitation_outlines` | created 001, never modified | L | grep reads/writes |
| `library_atom_outcomes` | overlaps activity-log outcome tracking (044) | L | grep reads/writes |
| `spotlights` | created 001; may be superseded by tenant scoring (`tenant_pipeline_items`) | L | grep reads/writes |
| `cms_content` | superseded by `content_pages` (055); old CMS bridge (050) may still write | L | **retain** until CMS bridge confirmed clear |

## C. Docs / infra — archive or delete

| Item | Reason | Conf | Action |
|------|--------|------|--------|
| `docs/CLAUDE_CLIFFNOTES.md` | stale duplicate (2026-04-27, 19 migrations) of live root copy — navigation hazard | H | delete (or replace with a pointer to root) |
| `scripts/migrate.sh` | CLIFFNOTES says "NEVER USE IT" (no tracking table) | H | delete or rename `*.DANGER` with warning |
| `docs/EVENT_CONTRACT.md` | superseded by V2/V3 | H | move to `docs/archive/` |
| `docs/NAMESPACES.md` | superseded by EVENT_CONTRACT_V2 | M | move to `docs/archive/` (after confirming the canonical namespace list lives in V2/V9) |
| `docs/phase-1/*` (10 files), `docs/PHASE_1_PLAN.md` | Phase 1 complete | M | move to `docs/archive/` |
| `docs/PHASE_0_5_CHECKLIST.md`, `docs/PHASE_0_5_VERIFICATION.md` | complete | M | archive |
| `docs/IMPLEMENTATION_PLAN_V2.md` | build done | M | archive |
| `docs/HITL_TEST_PLAN.md`, `docs/AUTOMATION_WORKFLOWS.md` | superseded (by V2 / WORKFLOW_REFERENCE) | M | archive |
| `docs/API_CONVENTIONS.md`, `ERROR_HANDLING.md`, `DEFINITION_OF_DONE.md`, `TESTING_STRATEGY.md` | consolidated into `DEVELOPMENT_STANDARDS.md` | M | archive **after** P4 confirms consolidation is complete + conflicts resolved |
| `ARCHITECTURE_V5.md`, `docs/ARCHITECTURE_V6.md` | superseded by V7/V8 → V9 | M | archive **after** V9 lands |

## D. Stale text to FIX (keep the file)

| File | Stale text | Fix |
|------|-----------|-----|
| `CLAUDE.md` | points to `ARCHITECTURE_V5.md`; "one DB + `/data` volume"; CMS "Dormant V1" | repoint to V9; "two DBs (Main + CMS) + R2/S3 object storage"; CMS "live" |
| `docs/FOLDER_STRUCTURE.md` | "services/cms — Dormant V1 placeholder" | mark live |
| `docker-compose.yml` | CMS service comment "V1 dormant" | remove stale comment |
| `.env.example` | CMS section "V1 dormant, deferred to V2+" | mark live; document `CMS_DATABASE_URL` requirement |

---

### Suggested handling order
1. **D (stale text)** — zero risk, do during P4.
2. **A dead-code blocks + H-confidence files** — low risk, do with tests (P3/P5).
3. **C docs** — create `docs/archive/`, move superseded docs after V9/P4 land.
4. **B tables** — slowest; each needs a write-path grep + retention decision; likely a dedicated migration after sign-off.
