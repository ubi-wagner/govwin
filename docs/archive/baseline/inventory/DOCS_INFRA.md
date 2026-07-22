# Documentation & Infrastructure Inventory

**Generated:** 2026-06-23
**Method:** File-by-file read of every doc and infra file from
`git ls-files '*.md' 'docs/**' 'scripts/**' '.github/**'` plus root
infra files (`Makefile`, `railway.json`, `docker-compose.yml`, `RAILWAY.md`, `.env.example`).
**Total files inventoried:** ~105 docs + 7 infra files + 7 scripts/.github files.

---

## Classification Key

| Class | Meaning |
|-------|---------|
| CANONICAL | Current source of truth for its topic; use as the authoritative reference |
| SUPERSEDED(by X) | Replaced by a newer version; X is the live replacement |
| STALE | Describes an earlier system state; some content is wrong vs. as-built |
| DEPRECATED | Topic/feature is retired or radically changed; document no longer accurate |
| REFERENCE | Historical record, audit trail, or sprint log — not consulted for live system state |
| VISION | Forward-looking design document; as-built reality may differ |

---

## Architecture Documents

### ARCHITECTURE_V5.md
- Topic: Original 5-service vision architecture + Phase 1 addendum (2026-04-05/09)
- Freshness: 2026-04-05 (addendum 2026-04-09)
- Class: SUPERSEDED(by ARCHITECTURE_V7.md for system overview; ARCHITECTURE_V8.md for content subsystem)
- Notes: V5 described a never-built 5-service topology (Finder / Capture / Agent / Content / Identity). As-built is 3-service (Frontend + Pipeline + CMS/CRM). The Phase 1 addendum curation state machine is still accurate. CLAUDE.md still points to this file — that pointer is stale.

### ARCHITECTURE_V7.md
- Topic: Master system index and architecture reference; 3-service as-built (2026-05-21)
- Freshness: 2026-05-21
- Class: CANONICAL (for overall system architecture, service topology, CI/CD, deployment)
- Notes: Supersedes V6 for all V1 baseline decisions. Authoritative for service boundaries, tech stack, CI/CD flow, migration runner mechanics, health checks, roles. The document catalog in §4 is slightly stale (doesn't list V8 or the newest CLAUDE_CLIFFNOTES updates), but the architecture content itself is accurate.

### ARCHITECTURE_V8.md
- Topic: Website content management subsystem redesign — content_pages table, versioned drafts, CMS/CRM scope reduction to email only (2026-06-02)
- Freshness: 2026-06-02
- Class: CANONICAL (for content management architecture — content_pages model, editor design, AI generation path, CMS→CRM-only scope)
- Notes: V8 is narrowly scoped. It does NOT supersede V7 globally — only the content subsystem changes: dual-editor/cms_posts bridge removed, `content_pages` introduced, CMS service reduced to CRM-only. All marked build phases are complete (✅). The legacy closed-loop content bridge is "left standing but inactive" per V8.

### docs/ARCHITECTURE_V6.md
- Topic: V1 launch baseline architecture — 3-service, 2-database, dual-editor for content (2026-05-31 per header; 2026-05-20 per V7)
- Freshness: 2026-05-31 (date in header) / 2026-05-20 (per V7 catalog)
- Class: SUPERSEDED(by ARCHITECTURE_V7.md)
- Notes: Comprehensive 1394-line doc covering schemas, event bus, tool registry, UI pages, data flows. Still accurate for most structural content (schema tables, role hierarchy, auth flow). The content pipeline section (§2.3 dual-editor, §8.5 CMS page blocks flow) is superseded by V8. EVENT_CONTRACT_V3.md explicitly flags "V6 §4.4/§10.1 are STALE." Worth archiving but not deleting — it is the most complete single-document schema and page inventory.

### docs/ARCHITECTURE_DAY365.md
- Topic: Day-365 aspirational architecture; medium-term vision (2026-04-26)
- Freshness: 2026-04-26
- Class: VISION
- Notes: Living doc describing what the platform looks like one year after launch. Not as-built. Still useful as vision context but should not be consulted for current system state.

---

## Claude Code Session Guides

### CLAUDE.md (root)
- Topic: Engineering SOPs and Claude Code session instructions
- Freshness: 2026-05-20 (last updated per ARCHITECTURE_V7.md catalog)
- Class: STALE
- Notes: Three concrete staleness issues:
  (1) Points to `ARCHITECTURE_V5.md` for full system design — should point to V7/V8.
  (2) States "All services share one PostgreSQL database (govtech_intel) and one storage volume (/data)" — as-built has TWO databases (Main + CMS Postgres) and S3 storage, not a local /data volume as the primary store.
  (3) States CMS/CRM is "Dormant V1, placeholder" — CMS/CRM is fully built and deployed (email, content pipeline, CRM).
  The SOP sections (error handling, code quality, events, security) are still accurate and should be preserved.

### CLAUDE_CLIFFNOTES.md (root)
- Topic: Engineering quick-reference: schema columns, API template, event rules, mistake catalog (2026-05-31 unified automation update)
- Freshness: 2026-05-31 (last update note)
- Class: CANONICAL
- Notes: This is the most important session reference doc. Contains the authoritative schema quick-reference (53 migrations, exact column names with GOTCHA notes), canonical API route template, event namespace rules, 24 documented mistakes with fixes, and architecture quick reference. Current through mistake 24 (push/scoring topic-set fix). The root copy is the live version.

### docs/CLAUDE_CLIFFNOTES.md
- Topic: Session handoff document — OLDER version (2026-04-27)
- Freshness: 2026-04-27
- Class: SUPERSEDED(by CLAUDE_CLIFFNOTES.md at root)
- Notes: This is the docs/ copy, dated 2026-04-27. It is a much earlier snapshot (19 migrations, Phase 0.5 feature list). The root copy (2026-05-31) is the canonical version. The docs/ copy contradicts the root on schema, CMS state, and mistake list. Having two files with identical names at different paths is a navigation hazard. RECOMMEND DELETING or renaming the docs/ copy.

---

## Event System Documents

### docs/EVENT_CONTRACT_V3.md
- Topic: Unified automation architecture — Jobs, Process Templates, event ledger (2026-05-31)
- Freshness: 2026-05-31
- Class: CANONICAL (for automation execution model, vocabulary, as-built reality §10, gap matrix §11)
- Notes: Supersedes the design sections of EVENT_CONTRACT.md. Companion to EVENT_CONTRACT_V2.md (which covers what fires; V3 covers how work is composed). Verified against codebase with file:line citations. Contains the authoritative gap matrix (HITL broken, AI_INVOKE stubbed, etc.).

### docs/EVENT_CONTRACT_V2.md
- Topic: As-built event catalog — every emitEvent* call, namespace dictionary, processor reference, state machine (2026-05-21)
- Freshness: 2026-05-21
- Class: CANONICAL (for event type enumeration and as-built event catalog)
- Notes: Complements V3. Source: actual codebase analysis. The canonical reference for which events fire, from which files, with which payload fields.

### docs/EVENT_CONTRACT.md
- Topic: Original event namespace and workflow automation contract, Version 2.0 (2026-04-29)
- Freshness: 2026-04-29
- Class: SUPERSEDED(by EVENT_CONTRACT_V2.md for catalog; EVENT_CONTRACT_V3.md for design)
- Notes: Per EVENT_CONTRACT_V3.md: "Supersedes the design sections of EVENT_CONTRACT.md." The namespace dictionary in EVENT_CONTRACT.md is still correct but EVENT_CONTRACT_V2.md is more complete and codebase-verified. Retain as historical artifact.

### docs/NAMESPACES.md
- Topic: Original canonical namespace registry — events, tools, logs, DB tables, roles, storage (Phase 0.5b, 2026-04-09)
- Freshness: 2026-04-09 (Phase 0.5b era)
- Class: SUPERSEDED(by EVENT_CONTRACT_V2.md §1 for event namespaces; DEVELOPMENT_STANDARDS.md for overall conventions)
- Notes: Still largely correct on the 7 event namespaces and forbidden namespaces. But EVENT_CONTRACT_V2.md and CLAUDE_CLIFFNOTES.md §3 are more current and complete. The NAMESPACES.md section on log scope names and storage prefixes is not replicated elsewhere — check before archiving.

### docs/WORKFLOW_REFERENCE.md
- Topic: Complete reference for automated workflows, pipeline job dispatch, CMS email automation (2026-05-21)
- Freshness: 2026-05-21
- Class: CANONICAL (for workflow/process-template definitions and CMS automation rules)
- Notes: As-built reference for the WorkflowManager, process templates, CMS event listener. Complements EVENT_CONTRACT_V3.md §10-11 gap analysis.

### docs/AUTOMATION_WORKFLOWS.md
- Topic: Event-driven workflow automation system reference (2026-05-22)
- Freshness: 2026-05-22
- Class: STALE
- Notes: Uses the older "workflow" vocabulary (retires as design term per EVENT_CONTRACT_V3.md). References HITL_WAIT as a skip ("logs and skips in V1 — no process_instances table yet") which was outdated by migration 043 that added process_instances. WORKFLOW_REFERENCE.md is the current version of this content.

---

## Database & Schema Documents

### docs/DB_SCHEMAS.md
- Topic: Complete table/column/type reference for both databases; generated from all migrations (2026-05-21)
- Freshness: 2026-05-21
- Class: CANONICAL (for full schema listing — all columns, types, constraints)
- Notes: Generated 2026-05-21. CLAUDE_CLIFFNOTES.md (root) adds corrections through migration 051 with GOTCHA annotations. Use DB_SCHEMAS.md for full table listings; use CLAUDE_CLIFFNOTES.md §1 for column-name gotchas on frequently-queried tables.

### docs/MIGRATIONS_RUNBOOK.md
- Topic: Database migration procedures — throwaway PG, local docker-compose, Railway production
- Freshness: 2026-04-09 (Phase 0.5 era, no explicit date but examples reference migration 007)
- Class: STALE
- Notes: Commands are still mostly valid but references early migration numbers (007, etc.) and doesn't cover the `.mjs` tracking-table runner (migrate.mjs) that is the actual production runner. CLAUDE_CLIFFNOTES.md §7 and ARCHITECTURE_V7.md §3 are more current on migration mechanics.

### docs/DECISIONS.md
- Topic: Append-only architectural decisions log (D001 onward, starting 2026-04-08)
- Freshness: Ongoing append-only log
- Class: CANONICAL (as a decision record — not a system description)
- Notes: Records architectural choices with rationale. D002 covers the single-bucket-three-folder S3 layout. Append-only by design; earlier decisions are never deleted even if superseded.

---

## API, Error Handling & Development Standards

### docs/DEVELOPMENT_STANDARDS.md
- Topic: Consolidated code quality, security, testing, error handling rules (2026-05-21)
- Freshness: 2026-05-21
- Class: CANONICAL (for TypeScript/Python code standards, build gates, security rules)
- Notes: Created during V7 audit; consolidates CLAUDE.md, ERROR_HANDLING.md, API_CONVENTIONS.md, TOOL_CONVENTIONS.md, DEFINITION_OF_DONE.md, TESTING_STRATEGY.md. More stringent than CLAUDE.md (bans raw NextResponse.json, requires AppError subclasses, withHandler wrapper). Check whether frontend code actually uses withHandler or still uses the simpler template from CLAUDE_CLIFFNOTES.md §2 — there is a gap between these two standards documents.

### docs/API_CONVENTIONS.md
- Topic: Binding API route contract — response shape, withHandler, zod validation, auth ordering, logging, event emission (Phase 0.5b, 2026-04-09)
- Freshness: 2026-04-09
- Class: STALE
- Notes: The core contract (response shapes, auth-first ordering, zod validation) is sound. But the DEVELOPMENT_STANDARDS.md version is more current and consolidates this content. The specific mandate to use "withHandler from lib/api-helpers.ts" and "no raw NextResponse.json" may not reflect actual as-built code (CLAUDE_CLIFFNOTES.md §2 canonical template uses raw NextResponse.json). Contradicts the simpler CLAUDE_CLIFFNOTES.md template.

### docs/ERROR_HANDLING.md
- Topic: Per-layer error handling SOP, AppError hierarchy, ToolError hierarchy (Phase 0.5b)
- Freshness: 2026-04-09 (Phase 0.5b era)
- Class: STALE
- Notes: Philosophy and AppError class hierarchy are sound. DEVELOPMENT_STANDARDS.md §3 consolidates and updates this. Check whether frontend actually uses AppError subclasses universally or the simpler code pattern.

### docs/DEFINITION_OF_DONE.md
- Topic: Per-commit/PR/phase checklist (Phase 0.5b)
- Freshness: 2026-04-09 (Phase 0.5b era)
- Class: STALE
- Notes: Core checklist items (tsc --noEmit, build, no console.log) are still valid. DEVELOPMENT_STANDARDS.md consolidates and is more complete. References EVENT_CONTRACT.md and FOLDER_STRUCTURE.md rather than V2/V3 versions.

### docs/TESTING_STRATEGY.md
- Topic: Test pyramid (unit/integration/E2E), what tests go at each level, fixtures (Phase 0.5b)
- Freshness: 2026-04-09 (Phase 0.5b era)
- Class: STALE
- Notes: Strategy is sound but predates CMS pytest suite (added in V7 era, 17 tests). DEVELOPMENT_STANDARDS.md §5 consolidates and updates this. The specific test location conventions are still valid.

### docs/TOOL_CONVENTIONS.md
- Topic: Dual-use Tool framework spec — one implementation, three entry points (Phase 0.5b)
- Freshness: 2026-04-09 (Phase 0.5b era)
- Class: STALE
- Notes: Architecture is still conceptually accurate (dual-use tools via registry.ts). But doesn't reflect V7 tool count (32 tools as of V6 audit). DEVELOPMENT_STANDARDS.md §4 consolidates. The authoring guide at frontend/lib/tools/README.md is the implementation reference.

### docs/API_REFERENCE.md
- Topic: Complete API endpoint listing — Frontend + CMS (2026-05-21)
- Freshness: 2026-05-21
- Class: CANONICAL (as an endpoint inventory)
- Notes: Snapshot as of 2026-05-21. Lists 501 stubs that may have since been implemented. Use as a starting point; verify against actual route files for current status.

### docs/FOLDER_STRUCTURE.md
- Topic: Where every file lives — import rules, directory conventions (Phase 0.5b)
- Freshness: 2026-04-09 (Phase 0.5b era)
- Class: STALE
- Notes: Lists "services/cms/ — Dormant V1 placeholder" — CMS is fully built. Core directory layout is accurate. DEVELOPMENT_STANDARDS.md §6 consolidates.

---

## Agent / AI System Documents

### docs/AGENT_FRAMEWORK.md
- Topic: Agent system architecture — 10 archetypes, tool registry, ContextAssembler (2026-05-22)
- Freshness: 2026-05-22
- Class: CANONICAL (for agent architecture as-built)
- Notes: Source of truth for pipeline/src/agents/. Accurately describes agents as "stateless functions with injected context." Correctly notes agents are DORMANT at runtime (V2). Companion to AGENT_FABRIC_DESIGN.md (design) and MEMORY_MANAGEMENT.md.

### docs/AGENT_FABRIC_DESIGN.md
- Topic: How Claude agents are deployed, provisioned, scoped, and cost-controlled (2026-04-24)
- Freshness: 2026-04-24
- Class: VISION
- Notes: Explicitly "Design document. Pre-implementation." Three-layer architecture (Platform / Tenant / Proposal agents) is the design intent; CLAUDE_CLIFFNOTES.md §5 "Agent Fabric" section documents the as-built (dormant) reality. Useful as design reference but not as-built description.

### docs/MEMORY_MANAGEMENT.md
- Topic: AI memory system — three types, lifecycle, maturation, context injection (2026-05-23)
- Freshness: 2026-05-23
- Class: CANONICAL (for memory architecture and lifecycle)
- Notes: Source of truth for pipeline/src/agents/memory.py etc. Notes V1 retrieval vs V2 pgvector retrieval. CLAUDE_CLIFFNOTES.md §5 summarizes the dormant/live boundary.

### docs/RATE_MONITORING.md
- Topic: Rate limiting, cost model, usage tracking (2026-05-23)
- Freshness: 2026-05-23
- Class: CANONICAL (for rate limit implementation and cost model)
- Notes: Source of truth for frontend/lib/rate-limit.ts and pipeline/src/agents/fabric.py guardrails. CLAUDE_CLIFFNOTES.md §5 notes fabric guardrails are coded but never reached (agent fabric dormant).

### docs/ARCHITECTURAL_REVIEW.md
- Topic: 8 systemic design decisions for V1 stability — transactions, event sourcing, tenant isolation, etc. (2026-05-22)
- Freshness: 2026-05-22
- Class: REFERENCE (decisions and their rationale, not an operational guide)
- Notes: Identifies structural patterns across 200+ bug fixes. Valuable context for why certain patterns exist. Not a how-to guide.

### docs/agent-fabric/00-INDEX.md through 08-RFP-CURATION-PIPELINE.md (8 files)
- Topic: Detailed implementation architecture for the AI workforce (how agents work, archetypes, memory, multi-tenant security, cost model, etc.)
- Freshness: ~2026-04 era (no explicit dates; references "Phase 4" future work)
- Class: VISION
- Notes: These are pre-implementation design docs describing the intended V2 agent fabric. AGENT_FRAMEWORK.md (2026-05-22) is the as-built reference. Archive these as design history once agent fabric ships.

---

## Canvas / Document Builder

### docs/CANVAS_DOCUMENT_ARCHITECTURE.md
- Topic: Canvas document system — atoms, JSON model, export pipeline (2026-04-25)
- Freshness: 2026-04-25
- Class: STALE
- Notes: Explicitly "Design document. Pre-implementation." as of 2026-04-25. The canvas system IS implemented. ARCHITECTURE_V6.md §6.5 and CLAUDE_CLIFFNOTES.md §5 "Canvas Model" are the as-built references with accurate node type lists and presets. DOCUMENT_BUILDER_GUIDE.md is the user-facing reference.

### docs/DOCUMENT_BUILDER_GUIDE.md
- Topic: User manual for the three canvas editors (document/slide/spreadsheet) (2026-05)
- Freshness: 2026-05 (per V7 catalog)
- Class: CANONICAL (for user-facing canvas editor documentation)
- Notes: Describes as-built capabilities. Good reference for what users can do.

### docs/EXPORT_CAPABILITIES_ANALYSIS.md
- Topic: MS Office export library capability mapping to canvas node types (undated)
- Freshness: Unknown (post-canvas implementation)
- Class: REFERENCE
- Notes: Analysis document mapping docx/pptx/xlsx library features to canvas nodes. Reference for adding export features.

---

## Operations & Deployment

### RAILWAY.md (root)
- Topic: Complete step-by-step Railway deployment guide (2026-05)
- Freshness: 2026-05
- Class: CANONICAL (for Railway deployment procedure)
- Notes: Covers 3-service + 2-Postgres deploy, GitHub Actions wiring. References "govtech-cms" volume at /data/cms — check if this conflicts with the S3-primary storage model in STORAGE_LAYOUT.md.

### docs/STORAGE_LAYOUT.md
- Topic: S3 bucket structure — single bucket, three prefixes (rfp-admin/, rfp-pipeline/, customers/) (2026-04 era)
- Freshness: 2026-04 (Phase 0.5 era)
- Class: CANONICAL (for S3 path conventions)
- Notes: Still accurate per CLAUDE_CLIFFNOTES.md §5 "Storage" section. The bucket name (rfp-pipeline-prod-r8t7tr6) and three-folder layout match current code.

### docs/CONTENT_DISTRIBUTION_STRATEGY.md
- Topic: Email system, social system, CRM automation status and strategy (2026-05-24)
- Freshness: 2026-05-24
- Class: STALE
- Notes: Describes "social posting not wired" and some CMS features as in-progress. More current status in ARCHITECTURE_V7.md and V8.

---

## Planning, Sprint, and Status Documents

### docs/SYSTEM_STATUS_20260507.md
- Topic: System status snapshot — 95 routes, 212 tests, what's built (2026-05-07)
- Freshness: 2026-05-07
- Class: REFERENCE (point-in-time snapshot; superseded by V1_MVP_BASELINE.md)
- Notes: Still useful as a milestone record. V1_MVP_BASELINE.md (2026-05-23) has the more current pre-launch assessment.

### docs/V1_MVP_BASELINE.md
- Topic: V1 definitive capability assessment — 97% readiness, 15 user journeys (2026-05-23)
- Freshness: 2026-05-23
- Class: REFERENCE (pre-launch assessment; live status may have evolved)
- Notes: Most recent overall readiness assessment. Not a doc to keep updated; serves as a baseline milestone record.

### docs/V1_AUDIT_TODO.md
- Topic: V1 pre-merge audit findings — all marked resolved (2026-05-20)
- Freshness: 2026-05-20
- Class: REFERENCE (completed audit; all items marked [x])
- Notes: All items resolved. Archive as audit history.

### docs/V1_TODO.md
- Topic: V1 launch comprehensive TODO plan — 68 tasks, generated from ARCHITECTURE_V6 gap analysis (2026-05-20)
- Freshness: 2026-05-20
- Class: REFERENCE (historical planning; many tasks now completed)
- Notes: Used ARCHITECTURE_V6.md §10 as input. Completion status unknown but V1_MVP_BASELINE.md claims 97% readiness. Archive.

### docs/V1_E2E_TODO.md
- Topic: V1 E2E functionality audit — purchase through stage gates, as of 2026-05-31
- Freshness: 2026-05-31
- Class: REFERENCE (audit/sprint doc; some items may still be open)
- Notes: Recent (2026-05-31). Lists verified working flows and remaining items. Not maintained after the sprint.

### docs/TODO.md
- Topic: Full system punch list — P0/P1/P2 items from canvas, pipeline, event, automation, deployment audits
- Freshness: Unknown (undated; appears to be mid-2026-05 era)
- Class: REFERENCE (working task list; completion status unknown)
- Notes: Lists specific P0 items (TOC auto-generation, etc.). Should be reviewed against current code.

### docs/PHASE_1_PLAN.md
- Topic: Phase 1 (RFP curation) index into 10 mini-TODOs (2026-04)
- Freshness: 2026-04 (status: "scoping, not yet started" at time of writing)
- Class: REFERENCE (historical sprint plan; Phase 1 is complete)
- Notes: Phase 1 is shipped. Archive.

### docs/phase-1/ (10 files: A through J)
- Topic: Phase 1 mini-TODOs for individual work chunks (architecture, DB, ingester, shredder, curation, API, UI, memory, state machine, testing)
- Freshness: 2026-04 era
- Class: REFERENCE (completed sprint sub-tasks)
- Notes: Phase 1 is complete. Archive the entire directory.

### docs/PHASE_0_5_CHECKLIST.md
- Topic: Phase 0.5 hardening checklist (2026-04-08)
- Freshness: 2026-04-08
- Class: REFERENCE (completed phase checklist)
- Notes: All items marked [x]. Archive.

### docs/PHASE_0_5_VERIFICATION.md
- Topic: Phase 0.5 verification report — 8 commits, local verification results (2026-04-08)
- Freshness: 2026-04-08
- Class: REFERENCE (completed verification; historical)
- Notes: Archive.

### docs/MVP_DEVELOPMENT_PLAN.md
- Topic: MVP plan for Spotlight + Proposal Portal — 6 phases, agent-executable tasks (undated)
- Freshness: Unknown (early 2026)
- Class: REFERENCE (planning doc; product is now built)
- Notes: References $199/mo base and $499/$999 proposal pricing — different from current ($299/mo, $999/$1,999). Stale pricing. Archive.

### docs/IMPLEMENTATION_PLAN_V2.md
- Topic: Clean build implementation plan — what to carry forward, file tree reference (2026-04-07)
- Freshness: 2026-04-07
- Class: REFERENCE (pre-build plan; build is complete)
- Notes: Status says "PENDING REVIEW — Do not begin until approved." The build is long complete. Useful only as a "what we planned vs what we built" artifact. CLAUDE.md still points here for "complete file tree" — that pointer is stale.

### docs/SCOUTING_SPINE_PLAN.md
- Topic: Execution TODO for scouting → curation → delivery loop (undated, branch `claude/nice-hamilton-kBqtD`)
- Freshness: Post-2026-05-31 (references Mistake 24 topics-set fix)
- Class: REFERENCE (sprint execution plan; some items ✅, some ⬜)
- Notes: Status tracker for scouting/scoring improvements. Check current branch state.

### docs/UNIFY_AUTOMATION_SPRINT.md
- Topic: Execution plan for unifying automation onto Jobs + Process Templates (2026-05-31)
- Freshness: 2026-05-31
- Class: REFERENCE (sprint plan; increments 1-3 marked ☑ with SHAs)
- Notes: Records which automation unification gaps were fixed and in which commit. Archive once all gaps are resolved.

### docs/PIPELINE_AUDIT_SPRINT.md
- Topic: Pipeline E2E audit and fix results (2026-05-30, complete)
- Freshness: 2026-05-30
- Class: REFERENCE (completed audit sprint)
- Notes: All items fixed. Archive.

### docs/PROCESS_FLOW_GAPS.md
- Topic: Remaining process flow gaps after 2026-05-29 audit (ingest triage, source-change, etc.)
- Freshness: 2026-05-29
- Class: REFERENCE (ongoing gap tracker; some items still open [])
- Notes: Has open items. Should be reviewed and either resolved or merged into TODO.md.

### docs/CMS_EDITOR_SPRINT.md
- Topic: CMS visual editor migration sprint TODO — PageEditor, status tabs (2026-05-30)
- Freshness: 2026-05-30
- Class: REFERENCE (completed sprint; all tasks [x])
- Notes: All tasks done. Archive.

### docs/CMS_REFACTOR_PLAN.md
- Topic: CMS refactor architecture review — what works, CMS SPA, TipTap, content workflow (2026-05-28)
- Freshness: 2026-05-28
- Class: STALE
- Notes: Describes CMS SPA content workflow. V8 changes the content architecture (content_pages, CMS→CRM-only). This plan's content architecture section is superseded by ARCHITECTURE_V8.md.

### .plan.md (root)
- Topic: SBIR/STTR platform refinement — 7 work streams, pricing ($199/$499/$999) (undated)
- Freshness: Unknown (pricing differs from current)
- Class: DEPRECATED
- Notes: References old pricing ($199/mo base, $499 Phase I, $999 Phase II). Current pricing is $299/mo, $999/$1,999. Business model sections are outdated. Work streams may be complete. Archive.

---

## Audit and Review Documents

### docs/AUDIT_PRELAUNCH_20260428.md
- Topic: Pre-launch security audit — events, API security, DB schema, data flow (2026-04-28)
- Freshness: 2026-04-28
- Class: REFERENCE (completed audit; issues resolved)
- Notes: 32 event namespace issues found; most fixed, some documented as "cosmetic non-blocking." Valuable as audit history.

### docs/BUG_EXTERMINATION_REPORT.md
- Topic: 6-round audit history — 200+ bugs found and fixed (2026-05-22)
- Freshness: 2026-05-22
- Class: REFERENCE (audit history; all bugs fixed as of report date)
- Notes: Documents what was broken and how it was fixed. Valuable context for why patterns exist.

### docs/CODE_REVIEW_V1.md
- Topic: V1 standards compliance code review — 89% compliance, 3 critical violations (2026-05-20)
- Freshness: 2026-05-20
- Class: REFERENCE (point-in-time audit; violations noted as fixed)
- Notes: Archive as audit history.

---

## Launch and Testing Documents

### LAUNCH_READINESS_REVIEW.md (root)
- Topic: Public site launch-readiness review — conversion analysis, copy recommendations, pricing (approved for implementation)
- Freshness: 2026-06 (references approved pricing: $5k/mo, $299/mo, $999/$1,999)
- Class: CANONICAL (as the approved site copy/content strategy plan)
- Notes: Contains Eric's approved pricing and narrative structure. Still a running plan of record per the document's own statement. The "build log appended at bottom" means this doc grows as work lands. Not stale — it IS the approved plan.

### docs/HITL_TEST_PLAN.md
- Topic: HITL test plan V1 baseline — 90-120 min test, test accounts (2026-05-21)
- Freshness: 2026-05-21
- Class: SUPERSEDED(by docs/HITL_TEST_PLAN_V2.md)
- Notes: V2 is the current test plan.

### docs/HITL_TEST_PLAN_V2.md
- Topic: Pre-launch HITL validation — all 15 user journeys, 7 test sessions, ~7 hours (2026-05-24 v2.1)
- Freshness: 2026-05-24
- Class: CANONICAL (for pre-launch manual testing protocol)
- Notes: Most comprehensive test plan. Still valid for regression testing.

### docs/HITL_QUICKSTART.md
- Topic: Quick-start guide for HITL testing (2026-05-24)
- Freshness: 2026-05-24
- Class: CANONICAL (for testing setup procedure)
- Notes: Short setup guide. Companion to HITL_TEST_PLAN_V2.md.

### docs/HITL_TODO.md
- Topic: HITL readiness TODO — P0/P1/P2 items before founding cohort (2026-05-31)
- Freshness: 2026-05-31
- Class: REFERENCE (may still have open items; check before HITL)
- Notes: Most recent (2026-05-31). Some P0 items may be resolved; review status.

### docs/TESTING_ADMIN_E2E.md
- Topic: Admin E2E test scripts — RFP curation pipeline (2026-04 era)
- Freshness: 2026-04 (references old Railway URLs)
- Class: STALE
- Notes: References staging URL `govtech-frontend-staging.up.railway.app`. Tests are likely still valid procedurally but should be validated against current UI.

### docs/TESTING_CUSTOMER_E2E.md
- Topic: Customer E2E test scripts — proposal portal (2026-04 era)
- Freshness: 2026-04 (same era as TESTING_ADMIN_E2E.md)
- Class: STALE
- Notes: Same era as TESTING_ADMIN_E2E.md. Procedurally valid but should be validated.

---

## User-Facing Guides

### docs/CUSTOMER_ONBOARDING_GUIDE.md
- Topic: Customer onboarding — application through first AI draft (2026-04)
- Freshness: 2026-04
- Class: CANONICAL (for customer-facing onboarding content)
- Notes: Describes the product accurately. May need pricing update to reflect current $299/mo, $999/$1,999.

### docs/RFP_ADMIN_OPERATIONS_GUIDE.md
- Topic: Admin operations manual for rfp_admin/master_admin (2026-04)
- Freshness: 2026-04
- Class: CANONICAL (for admin operational procedures)
- Notes: Functional guide. Supplement with docs/manuals/ADMIN_OPERATIONS_MANUAL.html for HTML version.

### docs/manuals/ADMIN_OPERATIONS_MANUAL.html
- Topic: HTML admin operations manual
- Freshness: Unknown
- Class: REFERENCE
- Notes: HTML artifact. May duplicate RFP_ADMIN_OPERATIONS_GUIDE.md content.

### docs/manuals/CUSTOMER_PORTAL_MANUAL.html
- Topic: HTML customer portal manual
- Freshness: Unknown
- Class: REFERENCE
- Notes: HTML artifact. May duplicate CUSTOMER_ONBOARDING_GUIDE.md content.

---

## Planning Documents — Specific Features

### docs/PLAN_PROPOSAL_PORTAL.md
- Topic: Proposal portal unified workspace plan — 3 perspectives, configurable gates (2026-05-07)
- Freshness: 2026-05-07
- Class: REFERENCE (design/planning; portal is built)
- Notes: Describes the proposal workspace UX design intent. Archive once verified as implemented.

### docs/PLAN_SOLICITATION_INGEST_REFACTOR.md
- Topic: Solicitation ingest refactor plan — separating ingestion from curation (undated)
- Freshness: Unknown
- Class: REFERENCE (planning doc; check if implemented)
- Notes: Describes target state for sources/ingest separation. Check against current Sources Hub implementation.

### docs/CRM_CMS_PHASE1.md
- Topic: CRM/CMS Phase 1 architecture and implementation plan — email, content, social (2026-05-20)
- Freshness: 2026-05-20
- Class: STALE
- Notes: Describes CRM as CMS service = content/email/social engine. V8 reduces CMS to CRM-only (email/social). Content architecture section superseded by V8. Email/social sections still accurate.

### docs/EMAIL_SENDERS.md
- Topic: Email sender identities — automation@, engagement@, cms_service@ — Google Workspace setup (undated)
- Freshness: Unknown (post-V7 era based on content)
- Class: CANONICAL (for email sender identity configuration)
- Notes: Operational reference for email identity setup. No duplicate elsewhere.

### docs/CONTENT_DISTRIBUTION_STRATEGY.md
- Topic: Email system, social system, CRM automation strategy (2026-05-24)
- Freshness: 2026-05-24
- Class: STALE
- Notes: Pre-V8. Social posting described as "not wired." Content architecture section superseded by V8.

---

## Documentation for Specific Subsystems

### docs/AUTOMATION_WORKFLOWS.md
(See entry above under Event System Documents — STALE)

### docs/sam-gov-api-cheatsheet.md
- Topic: SAM.gov Opportunities API v2 quick reference — endpoints, parameters, auth
- Freshness: Unknown (likely 2026-04 era)
- Class: CANONICAL (as an external API reference)
- Notes: External API cheatsheet; content validity depends on SAM.gov API stability.

### docs/DECISIONS.md
(See entry above under Database & Schema — CANONICAL)

---

## Fixture and Code-Adjacent Docs

### pipeline/src/shredder/golden_fixtures/*/extracted.md (6 files)
- Topic: Golden-fixture expected extraction outputs for shredder tests
- Freshness: Matches test fixture dates
- Class: CANONICAL (as test fixtures — authoritative expected outputs)
- Notes: These are golden-test reference files, not documentation. Treat as code.

### pipeline/src/shredder/golden_fixtures/*/notes.md (5 files)
- Topic: Notes on fixture extraction edge cases and gotchas
- Freshness: Matches fixture dates
- Class: CANONICAL (as fixture notes)
- Notes: Test-support documentation.

### frontend/lib/tools/README.md
- Topic: Tool authoring guide for the dual-use tool framework
- Freshness: Unknown
- Class: CANONICAL (for tool authoring)
- Notes: The implementation reference for writing new tools.

### services/cms/frontend/README.md
- Topic: CMS SPA frontend README
- Freshness: Unknown
- Class: REFERENCE
- Notes: Standard service README.

---

## Infrastructure Files

### .github/workflows/ci.yml
- Topic: CI workflow — runs on push/PR to main; 4 jobs
- Freshness: Current (references actions/checkout@v5, setup-node@v5, setup-python@v5)
- Class: CANONICAL (active CI configuration)
- Notes: Runs 4 jobs: (1) frontend — npm ci → type-check → lint → test → build; (2) pipeline — pip install → pytest tests/; (3) crm — py_compile + pytest + CMS SPA npm build; (4) migrate-crm — spins up Postgres 16, runs services/cms/db/run.sh, verifies cms_posts/email_accounts/email_outbox tables exist. The `migrate-crm` job runs only on main pushes. No main-DB migration check in CI (main DB migrations run via entrypoint.sh on Railway deploy). The frontend build step uses a fake DATABASE_URL — it does NOT test actual DB connectivity.

### .github/workflows/migrate.yml
- Topic: Manual migration workflow (workflow_dispatch) — main DB and/or CRM DB against production/staging/both
- Freshness: Current
- Class: CANONICAL (for ad-hoc migration runs)
- Notes: Manual-only (not triggered by push). Supports dry-run mode. Uses `scripts/migrate.sh` (WARNING: no-tracking version — see note below) but actually calls `db/migrations/run.sh` (the tracked version). Requires DATABASE_URL / STAGING_DATABASE_URL / CMS_DATABASE_URL / CMS_STAGING_DATABASE_URL secrets.

### Makefile
- Topic: Developer convenience targets — up, down, migrate, seed, dev, type-check, test, test-integration, shell-db, railway-vars
- Freshness: Current (references V8 content_pages integration tests)
- Class: CANONICAL (for local dev commands)
- Notes: `make migrate` calls `db/migrations/run.sh` (tracking-table runner, correct). `make test-integration` runs CMS content bridge and content_pages tests against TEST_DATABASE_URL/TEST_CMS_DATABASE_URL. `make seed` is deprecated (migration 001 now seeds master_admin directly).

### docker-compose.yml
- Topic: Local dev stack — db (PG16+pgvector), pipeline, frontend; CMS under `--profile cms`
- Freshness: Current (references V8 storage model, cms profile as optional)
- Class: CANONICAL (for local development setup)
- Notes: CMS service is behind `--profile cms` — consistent with CMS being an active service, not dormant. Uses local /data volume for pipeline and frontend (STORAGE_ROOT=/data). Note: CMS section comment says "V1 dormant" — this is a copy-paste stale comment; CMS is fully built but optional for local dev.

### .env.example
- Topic: Environment variable reference and defaults for all three services
- Freshness: Current (references V8 content model, Resend API, current model name claude-sonnet-4-20250514)
- Class: CANONICAL (for environment variable documentation)
- Notes: Well-organized with [REQUIRED]/[SECRET]/[RECOMMENDED]/[OPTIONAL] labels. CMS section comment says "V1 dormant, deferred to V2+" — stale; CMS is deployed. The STORAGE_ROOT=/data note says "V2 is the Railway S3-compatible bucket" — accurate, S3 is the primary store.

### RAILWAY.md
- Topic: Railway deployment guide — project structure, step-by-step deploy, env vars
- Freshness: 2026-05 (per V7 catalog)
- Class: CANONICAL (for Railway deployment)
- Notes: References 3 services + 2 Postgres + 1 volume. Covers watch paths for auto-deploy per service.

### scripts/migrate.sh
- Topic: Raw migration runner — loops over db/migrations/*.sql with psql, no tracking
- Freshness: N/A
- Class: DEPRECATED
- Notes: Explicitly flagged in CLAUDE_CLIFFNOTES.md §5 "Deployment": "CAUTION: scripts/migrate.sh has NO tracking — never use it." Use `db/migrations/run.sh` or `make migrate` instead.

### scripts/test-all.sh
- Topic: Local test runner — type-check, frontend unit tests, pipeline pytest
- Freshness: Current
- Class: CANONICAL (for local test runs)
- Notes: Matches CI jobs for frontend and pipeline. Does not run CMS tests (those are in ci.yml crm job).

### scripts/seed_admin.ts
- Topic: Interactive seed script for creating a different admin user
- Freshness: N/A (deprecated for normal use)
- Class: DEPRECATED (for normal use)
- Notes: Makefile comments: "NOTE: As of the rebaseline PR, the master_admin user is created by 001_baseline.sql directly... so this target is usually NOT needed on fresh deploys. It remains for cases where you want to create a different admin user."

### scripts/init-reference-folders.mjs
- Topic: Initialize S3 reference folder structure
- Freshness: Unknown
- Class: REFERENCE (one-time setup script)
- Notes: One-time initialization script. Run once per deploy setup.

### scripts/split_awards.py
- Topic: SBIR award data splitting utility (Python)
- Freshness: Unknown
- Class: REFERENCE (utility script for data import)
- Notes: Used for SBIR award data import pipeline.

### railway.json
- Topic: Railway service configuration file
- Freshness: Current
- Class: CANONICAL (for Railway service configuration)
- Notes: Defines service watch paths and build settings for Railway.

---

## Other Documents (brief)

### docs/DOCUMENT_BUILDER_GUIDE.md
(See entry above — CANONICAL for user-facing canvas editor docs)

### docs/RFP_ADMIN_OPERATIONS_GUIDE.md
(See entry above — CANONICAL for admin ops)

### docs/CUSTOMER_ONBOARDING_GUIDE.md
(See entry above — CANONICAL for customer onboarding)

### docs/mockups/proposal-portal.html
- Topic: HTML mockup of the proposal portal UI
- Freshness: Unknown (design-phase artifact)
- Class: REFERENCE (design mockup)
- Notes: UI design artifact. Archive.

---

## PDF Reference Documents (docs/*.pdf)
- Topic: Actual solicitation PDFs used as shredder test inputs / reference materials
  (254D_mods, AFX25.5, AF_X24.4, AF_X24.5, Air Force_X25.6, DoD SBIR/STTR BAAs, DoW 2026 BAAs, etc.)
- Class: REFERENCE (external source documents; not maintained by this team)
- Notes: These are the actual government solicitation PDFs. Some are also used as golden fixture inputs. Not documentation — reference materials. Keep as needed for fixtures and compliance reference.

---

## Summary: Canonical Doc Set

One current doc per topic:

| Topic | Canonical Doc | Notes |
|-------|--------------|-------|
| System architecture (overall) | `ARCHITECTURE_V7.md` | Master index; 3-service as-built |
| Content management architecture | `ARCHITECTURE_V8.md` | content_pages, editor, V8 changes only |
| Engineering SOPs (Claude sessions) | `CLAUDE_CLIFFNOTES.md` (root) | Schema quick-ref, API template, mistakes |
| DB schema (full column listing) | `docs/DB_SCHEMAS.md` | All tables; use with CLIFFNOTES GOTCHA notes |
| Event type catalog (as-built) | `docs/EVENT_CONTRACT_V2.md` | Every emitEvent* call, codebase-verified |
| Automation execution model | `docs/EVENT_CONTRACT_V3.md` | Jobs/Templates, gap matrix, as-built reality |
| Workflow/process template definitions | `docs/WORKFLOW_REFERENCE.md` | WorkflowManager, CMS automation rules |
| API endpoint inventory | `docs/API_REFERENCE.md` | As of 2026-05-21; verify stubs vs current |
| Code quality rules | `docs/DEVELOPMENT_STANDARDS.md` | Consolidates API_CONVENTIONS, ERROR_HANDLING, etc. |
| Agent architecture (as-built) | `docs/AGENT_FRAMEWORK.md` | Dormant fabric; 10 archetypes; memory |
| Memory system | `docs/MEMORY_MANAGEMENT.md` | Lifecycle, types, maturation |
| Rate limiting / cost model | `docs/RATE_MONITORING.md` | HTTP rate limit, agent guardrails |
| Tool framework | `frontend/lib/tools/README.md` | Authoring guide |
| S3 storage layout | `docs/STORAGE_LAYOUT.md` | Bucket, 3 prefixes, path helpers |
| Deployment (Railway) | `RAILWAY.md` | Step-by-step Railway setup |
| Deployment (infra config) | `railway.json` | Railway service config |
| Local dev | `docker-compose.yml` + `Makefile` | Stack setup and dev commands |
| Environment variables | `.env.example` | All vars with labels |
| CI/CD | `.github/workflows/ci.yml` | 4 CI jobs on push/PR |
| Manual migrations | `.github/workflows/migrate.yml` | Ad-hoc migration runner |
| Testing protocol (manual) | `docs/HITL_TEST_PLAN_V2.md` | 15 journeys, 7 sessions |
| Architecture decisions | `docs/DECISIONS.md` | Append-only decisions log |
| Site content strategy | `LAUNCH_READINESS_REVIEW.md` | Approved copy plan |
| User guide (customer) | `docs/CUSTOMER_ONBOARDING_GUIDE.md` | Onboarding flow |
| User guide (admin ops) | `docs/RFP_ADMIN_OPERATIONS_GUIDE.md` | Admin curation ops |
| Canvas editor guide | `docs/DOCUMENT_BUILDER_GUIDE.md` | User-facing editor manual |
| SAM.gov API | `docs/sam-gov-api-cheatsheet.md` | External API reference |
| Email senders | `docs/EMAIL_SENDERS.md` | Sender identity config |
| Architectural decisions (structural) | `docs/ARCHITECTURAL_REVIEW.md` | V1 design decisions rationale |

---

## Recommend Archive / Delete

High-priority (contradictory or navigation hazards):

1. **`docs/CLAUDE_CLIFFNOTES.md`** — DELETE or rename to `docs/CLAUDE_CLIFFNOTES_OLD_20260427.md`. Having two files named CLAUDE_CLIFFNOTES.md (root vs docs/) causes active confusion. The root version is the live one.
2. **`CLAUDE.md` (root)** — UPDATE immediately: change V5 pointer to V7/V8; correct "one PostgreSQL + one /data volume" to two databases + S3; correct "CMS dormant placeholder" to "CMS/CRM active: email, social, CRM automation."
3. **`scripts/migrate.sh`** — DELETE or rename to `scripts/migrate_DANGEROUS_NO_TRACKING.sh`. CLAUDE_CLIFFNOTES.md explicitly says "NEVER USE IT."

Medium-priority (completed sprints / superseded):

4. `docs/EVENT_CONTRACT.md` — Archive (superseded by V2/V3)
5. `docs/NAMESPACES.md` — Archive (superseded by EVENT_CONTRACT_V2.md; retain log-scope-names section if not replicated elsewhere)
6. `docs/PHASE_1_PLAN.md` + `docs/phase-1/` (10 files) — Archive entire directory; Phase 1 is complete
7. `docs/PHASE_0_5_CHECKLIST.md` + `docs/PHASE_0_5_VERIFICATION.md` — Archive
8. `docs/IMPLEMENTATION_PLAN_V2.md` — Archive (build is complete; CLAUDE.md pointer to this for "file tree" is stale)
9. `docs/MVP_DEVELOPMENT_PLAN.md` — Archive (old pricing, pre-build)
10. `.plan.md` (root) — Archive (old pricing, old business model)
11. `docs/V1_TODO.md` — Archive (completed task list)
12. `docs/V1_AUDIT_TODO.md` — Archive (all items resolved)
13. `docs/PHASE_0_5_CHECKLIST.md` — Archive
14. `docs/CMS_EDITOR_SPRINT.md` — Archive (all tasks [x])
15. `docs/PIPELINE_AUDIT_SPRINT.md` — Archive (complete)
16. `docs/V1_MVP_BASELINE.md` — Demote to REFERENCE archive (point-in-time snapshot)
17. `docs/SYSTEM_STATUS_20260507.md` — Archive (superseded by V1_MVP_BASELINE.md)
18. `docs/HITL_TEST_PLAN.md` — Archive (superseded by V2)
19. `docs/CANVAS_DOCUMENT_ARCHITECTURE.md` — Archive (design doc; canvas is built; CLIFFNOTES §5 is as-built)
20. `docs/CONTENT_DISTRIBUTION_STRATEGY.md` — Archive (pre-V8; superseded by V8 content model)
21. `docs/CMS_REFACTOR_PLAN.md` — Archive (pre-V8; superseded by V8)
22. `docs/CRM_CMS_PHASE1.md` — Archive (pre-V8; partly superseded)
23. `docs/AGENT_FABRIC_DESIGN.md` — Demote to VISION archive (pre-implementation; AGENT_FRAMEWORK.md is as-built)
24. `docs/agent-fabric/` (8 files) — Archive entire directory as design history
25. `docs/AUTOMATION_WORKFLOWS.md` — Archive (superseded by WORKFLOW_REFERENCE.md)
26. `docs/FOLDER_STRUCTURE.md` — Archive ("CMS dormant" is stale; content in DEVELOPMENT_STANDARDS.md §6)
27. `docs/API_CONVENTIONS.md` — Archive (consolidated into DEVELOPMENT_STANDARDS.md; contradicts CLIFFNOTES template)
28. `docs/ERROR_HANDLING.md` — Archive (consolidated into DEVELOPMENT_STANDARDS.md)
29. `docs/DEFINITION_OF_DONE.md` — Archive (consolidated into DEVELOPMENT_STANDARDS.md)
30. `docs/TESTING_STRATEGY.md` — Archive (consolidated into DEVELOPMENT_STANDARDS.md; pre-CMS test suite)
31. `docs/AUDIT_PRELAUNCH_20260428.md` + `docs/BUG_EXTERMINATION_REPORT.md` + `docs/CODE_REVIEW_V1.md` — Move to `docs/archive/audit-history/`
32. `docs/PLAN_PROPOSAL_PORTAL.md` + `docs/PLAN_SOLICITATION_INGEST_REFACTOR.md` — Archive (design plans; features built)
33. `docs/mockups/proposal-portal.html` — Archive (design artifact)

---

## Documents Not Fully Assessed

The following could not be fully read due to length or scope:

- **`docs/ARCHITECTURE_V6.md`** — Read first 1014 of 1394 lines. The unread portion (lines 1015-1394) likely covers §9 V1 Launch Requirements and §10 Gap Analysis. Those sections are now superseded by V1_MVP_BASELINE.md and V1_TODO.md respectively.
- **`docs/DB_SCHEMAS.md`** — Read opening (40 lines). Full table listing spans all ~53 migrations; only the first table (accounts) was directly read. Classification as CANONICAL is based on its stated generation method (all migrations) and date (2026-05-21), cross-referenced with CLAUDE_CLIFFNOTES.md.
- **`railway.json`** — Not read directly (listed in git ls-files but content not opened). Classification as CANONICAL is based on its expected role as Railway service config.
- **`docs/agent-fabric/01-HOW-AGENTS-WORK.md` through `08-RFP-CURATION-PIPELINE.md`** (7 files) — Classified as VISION based on the index (00-INDEX.md) which clearly marks these as design docs. Not individually read.
- **`docs/manuals/ADMIN_OPERATIONS_MANUAL.html`** + **`docs/manuals/CUSTOMER_PORTAL_MANUAL.html`** — HTML format; not read. Classified as REFERENCE based on naming convention.
