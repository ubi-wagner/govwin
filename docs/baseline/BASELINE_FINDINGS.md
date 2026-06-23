# Baseline Findings — Phase 1 File-by-File Analysis

**Date:** 2026-06-23 · **Branch:** `claude/nice-hamilton-kBqtD` · **Commit base:** post-`a182d2e`
**Method:** 8 parallel subsystem agents performed a file-by-file pass over **all 908 tracked files**.
Per-file detail lives in `docs/baseline/inventory/`. This document is the **reconciled cross-cutting
synthesis** — the single feed for ARCHITECTURE_V9, the test matrix, the cliffnotes/standards update,
and the gap analysis.

> Status legend: ✅ live · 🟡 shipped-with-gaps · 🟦 built-but-dormant · 🔴 broken · ♻️ duplicate · 💀 dead · 🗑️ deprecation-candidate

---

## 1. Inventory Index

| File | Subsystem | Scope | Lines |
|------|-----------|-------|------|
| `inventory/FRONTEND_API.md` | Frontend | 138 API routes (auth/validation/tables/response/tenant-scope) | — |
| `inventory/FRONTEND_PAGES.md` | Frontend | 86 pages/layouts + middleware + config (guards) | 757 |
| `inventory/FRONTEND_LIB_COMPONENTS.md` | Frontend | 148 lib + component files (callers, dead/dup) | — |
| `inventory/PIPELINE_AGENTS_WORKFLOWS.md` | Pipeline | 47 agents/workflows modules (wired vs dormant) | 561 |
| `inventory/PIPELINE_CORE.md` | Pipeline | 74 core modules (dispatcher, ingest, shredder, storage) | 752 |
| `inventory/CMS.md` | CMS/CRM | 69 files (live verdict + endpoints + workers) | 782 |
| `inventory/DB_SCHEMA_CURRENT.md` | Data | 69 migrations → 72-table consolidated schema + lineage | 1745 |
| `inventory/DOCS_INFRA.md` | Docs/Infra | 105 docs + CI + infra (canonical/stale classification) | 766 |

---

## 2. Corrected Baseline Facts (deltas vs the earlier V5-anchored summary)

The first architecture summary was built from doc-reading agents anchored on the **stale `ARCHITECTURE_V5.md`**.
The file-by-file pass corrects it:

| # | Topic | Earlier claim | **As-built truth (file-by-file)** |
|---|-------|---------------|-----------------------------------|
| 1 | Canonical architecture | "V5 / V8" | **`ARCHITECTURE_V7` is the master**; `V8` is the content-subsystem delta only. V5 = never-built 5-service vision. → **V9 supersedes V7+V8.** |
| 2 | CMS/CRM | "dormant V1 placeholder" | **Two live CMS systems:** (a) Next.js-native content admin in the frontend (`admin/site/*` → `content_pages` via `lib/content-admin`); (b) `services/cms` FastAPI (87 endpoints, 7 worker loops, page-blocks SPA). Evidence: `services/cms/src/main.py:64–91`. |
| 3 | Storage | "shared `/data` Railway volume" | **S3-compatible object storage (Cloudflare R2, `forcePathStyle:true`).** `config.STORAGE_ROOT="/data"` is a **dead constant**; nothing in storage code imports it. |
| 4 | HITL workflow | "🔴 resume broken, 1h deadline" | **HITL resume is IMPLEMENTED** — `WorkflowManager.resume_instance()` (`manager.py:1000+`); only the *old* fire-and-forget path skips `HITL_WAIT`. TODO steps park + write `tasks`. `EVENT_CONTRACT_V3.md` documents the *old* bug and is **stale**. |
| 5 | CMS automation bugs | "🔴 phase double-fire + unpublish no-op" | **FIXED** with regression tests (`event_listener.py:232–235`, `test_rule_matching_phase.py`, `test_no_phantom_executors.py`). Only `social_poster` remains a stub (`NotImplementedError`). |
| 6 | AI / agent workforce | "assists at every stage" | **Split reality:** product AI = **frontend calling Anthropic directly** (`portal/.../ai/draft|review|compliance`, `claude-sonnet-4-20250514`) → ✅ works. Pipeline **agent workforce = 🟦 dormant**: `AgentFabric()` is a never-wired local var (`main.py:72`), `_execute_ai_invoke` always `ImportError`→skipped, `process_task_queue()` has zero callers, 10 archetypes register but `invoke_agent()` is never called. |
| 7 | Tables | "~53 / topics table" | **72 live tables / 14 domains**; **no topics table** (`solicitation_topics` dropped) — topics are `opportunities` rows with `solicitation_id`. |
| 8 | RLS | "RLS on tenant tables" | **RLS enabled on 4 memory tables, ZERO policies** in all 69 migrations → deny-all for restricted roles, bypassed because the service connects as DB owner. Isolation is **explicit `WHERE tenant_id`**, not RLS. |
| 9 | Migrations 063/064 | (suspected dup) | **Not a bug** — intentional republish (filename-keyed runner can't re-run 063, so 064 republishes updated `metadata.icon`). |
| 10 | Event namespaces | "7 incl. `library`" | `library` is **actively emitted** (F1). `agent` appears in schema/older docs (D1) — a **stale registry artifact to reconcile**. |

---

## 3. Cross-Cutting Bug List (confirmed in code)

| Sev | Bug | Location | Source |
|-----|-----|----------|--------|
| ✅ FIXED | **Double-emit** of `finder:topics.expanded` (both the expander and the dispatcher emit for one job) — introduced in M3 | `pipeline/src/ingest/topic_expander.py` `_emit_topics_expanded` + `dispatcher.py` `_run_expand_topics_job` | P2 |
| ~~🔴~~ FALSE POSITIVE | ~~`lib/import/pdf-reader.ts` imports `{ PDFParse }` but `pdf-parse` only has a default export → likely runtime error on first call~~ — pdf-parse is v2.4.5 and exports `PDFParse` as a NAMED export; the named import is CORRECT. Not a bug. | `frontend/lib/import/pdf-reader.ts` | F3 |
| ✅ FIXED | `lifecycle_scheduler` reconnect loop is **recursive** → stack-overflow under sustained DB outage | `pipeline/src/lifecycle_scheduler.py` | P2 |
| ✅ FIXED | `shredder/extractor.py` calls **synchronous boto3 inside async** → blocks the event loop per PDF | `pipeline/src/shredder/extractor.py` | P2 |
| ✅ FIXED | `agents/learning/__init__.py` has **broken absolute imports** (`pipeline.src.agents.learning.*`) → ImportError; masked because the scheduler imports modules directly | `pipeline/src/agents/learning/__init__.py` | P1 |
| ✅ FIXED | `invite` POST emits **double-prefixed type** `identity.identity.invite_accepted` (should be `invite.accepted`) and does multi-table writes with **no transaction** | `frontend/app/api/invite/route.ts` | F1 |
| ✅ FIXED | `consent` POST: multi-table writes with **no transaction** | `frontend/app/api/consent/route.ts` | F1 |
| ✅ FIXED | `portal/[tenantSlug]/profile` GET has **no role floor** → a `partner_user` can read `billing_email` + company profile | `frontend/app/api/portal/[tenantSlug]/profile/route.ts` | F1 |
| ✅ FIXED | `admin/sbir-data/ingest` **leaks internal error text** to client; `sql.unsafe` batch with no `ON CONFLICT` | `frontend/app/api/admin/sbir-data/ingest/route.ts` | F1 |
| ✅ FIXED | `document/converter.py` `convert_format()` has **no subprocess timeout** (hung LibreOffice blocks loop) | `pipeline/src/document/converter.py` | P2 |
| ✅ FIXED | `tools/source-scout.ts` **silently swallows** Claude errors (`catch { return null }`) | `frontend/lib/tools/source-scout.ts` | F3 |

---

## 4. SOP-Hygiene Gaps (codebase vs CLAUDE.md's own rules)

CLAUDE.md mandates "EVERY `await sql` inside try/catch" and consistent `{error,code}`. The floor is good
(all 138 routes authenticate + return `{error,code}`), but hygiene is uneven:

- ✅ FIXED: **~4 API routes** (16 of the originally listed 20 were already compliant) ran `await sql` with **no inner try/catch** (a DB error collapses to a generic outer-handler log) — incl. `admin/analytics`, `admin/pipeline`, `admin/tenants`, `admin/workflows/*`, `portal/dashboard`, `portal/proposals/[id]/{sections,compliance,dropbox,collaborators}`. The 4 genuinely non-compliant routes were fixed.
- ✅ FIXED: **7 routes** emit events **outside** try/catch → event failure returns false 500 after the business op succeeded.
- ✅ FIXED: **4 routes** call `auth()`/`requireAdmin()` outside the outer try/catch.
- ✅ FIXED: **Lib layer**: `lib/process/force-advance.ts` (4 sequential `await sql`, no handling), `lib/tasks/tasks.ts` (no try/catch), `lib/storage/s3-client.ts::listObjects` (bare `s3.send`).
- ~~**Unescaped ILIKE**~~ FALSE POSITIVE: `lib/tools/memory-search.ts` + `lib/tools/library-search-atoms.ts` already escape ILIKE via `.replace(/[%_\\]/g, '\\$&')`. Nothing to fix.
- **Doc conflict**: `API_CONVENTIONS.md` mandates `withHandler()`; `CLIFFNOTES §2` shows raw `NextResponse.json`. The codebase uses **both** patterns → standardize in P4.
- ✅ **No `console.log`** violations found anywhere.

---

## 5. Untested Critical Paths (feed P3 test authoring)

Existing tests: frontend 16 (vitest+playwright); pipeline **~25 real** (+4 empty placeholders: `test_sam_gov/scoring/agents/memory.py`); CMS ~17 (pytest).

Highest-risk **untested** paths to author tests for first:
1. `pipeline/src/ingest/topic_expander.py` — **no test at all** (M3 work): `_derive_source_id`, `_content_hash` (MD5), `_upsert_topic` dedup on `(solicitation_id, topic_number)`.
2. `pipeline/src/ingest/dispatcher.py` — `tick_schedules()` + `consume_one_job()` (`FOR UPDATE SKIP LOCKED`) — the job-queue backbone, untested.
3. `pipeline/src/storage/crypto.py` — AES-256-GCM round-trip (regression silently breaks SAM.gov key-based ingest).
4. Content-hash **dedup-under-update** (`base.py run()` amended path, `was_insert=False`).
5. `workflows/actions/score_tenants.py` — live scoring (multi-topic, fires every push); `scoring/engine.py` placeholder test is dead.
6. `pipeline/src/workers/source_scout.py` — Claude diff analysis + `source_diffs` writes.
7. Frontend critical routes: `auth/[...nextauth]`, `stripe/webhook`, `proposals/create`, `proposals/[id]/advance` (stage gates), `sections/[id]/save` (OCC), `tools/[name]`.

---

## 6. Open Reconciliations (resolve during P2–P4)

1. **Scoring path**: `scoring/engine.py::ScoringEngine` appears dormant (no caller); the live path is `workflows/actions/score_tenants.py::match_tenants`. Confirm engine.py is a dead duplicate → deprecate.
2. **`agent` vs `library` namespace**: confirm whether `agent` is ever emitted at runtime or only a schema/doc artifact; canon per CLAUDE.md = `library`.
3. **`automation_rules` dual schema**: legacy `trigger_bus/trigger_events` (001) coexists with `trigger_namespace/trigger_type` (019). Determine which the CMS listener + pipeline read; document/retire the other.
4. **`agent_task_queue`/`agent_task_results`** vs `process_instances` — orphaned? (predate 043).
5. **PPTX/XLSX exporters** unwired — intended capability gap or dead code? (affects export feature completeness).

---

## 7. What Each Downstream Phase Consumes From This

- **P2 ARCHITECTURE_V9** ← §2 (corrected facts), §6 (reconciliations), inventory topology.
- **P3 Testing** ← §3 (bugs → regression tests), §5 (untested critical paths → author tests), §4 (hygiene → lint/guard tests).
- **P4 Cliffnotes/Standards** ← §2 (schema/storage/CMS truth), §4 (SOP conflict to standardize), `DOCS_INFRA.md` canonical map.
- **P5 Gap analysis + ToDo** ← every 🟦/🔴/🗑️ item + `DEPRECATION_CANDIDATES.md` + `LAUNCH_READINESS_REVIEW.md`.
