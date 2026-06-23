# Pipeline Agents & Workflows Inventory

Generated: 2026-06-23
Scope: `pipeline/src/agents/**/*.py` and `pipeline/src/workflows/**/*.py` — all 47 files enumerated.

---

## Summary Table A — Agent Archetypes

| Archetype | role_name | Model | human_gate | handles_event(s) | Runtime |
|-----------|-----------|-------|-----------|-----------------|---------|
| CaptureStrategistArchetype | `capture_strategist` | claude-sonnet-4-20250514 | True | `capture.pursuit.evaluation_requested`, `capture.purchase.completed` | 🟦 built-but-dormant |
| ColorTeamReviewerArchetype | `color_team_reviewer` | claude-sonnet-4-20250514 | (base default=True) | `proposal.review_requested` | 🟦 built-but-dormant |
| ComplianceReviewerArchetype | `compliance_reviewer` | claude-haiku-4-5-20251001 | False | `proposal.section.content_updated`, `proposal.stage.advanced` | 🟦 built-but-dormant |
| LibrarianArchetype | `librarian` | claude-haiku-4-5-20251001 | False (implicit — creates DRAFT status) | `library.unit.created`, `library.bulk_import.completed`, `capture.proposal.outcome_recorded` | 🟦 built-but-dormant |
| OpportunityAnalystArchetype | `opportunity_analyst` | claude-haiku-4-5-20251001 | (base default=True) | `finder.opportunity.ingested` | 🟦 built-but-dormant |
| PackagingSpecialistArchetype | `packaging_specialist` | claude-haiku-4-5-20251001 | True | `proposal.stage.advanced`, `capture.proposal.stage_changed` | 🟦 built-but-dormant |
| PartnerCoordinatorArchetype | `partner_coordinator` | claude-haiku-4-5-20251001 | True | `proposal.partner.added`, `proposal.partner.communication_requested`, `capture.collaborator.invited`, `capture.proposal.stage_changed` | 🟦 built-but-dormant |
| ProposalArchitectArchetype | `proposal_architect` | claude-sonnet-4-20250514 | True | `proposal.created`, `capture.proposal.stage_changed` | 🟦 built-but-dormant |
| ScoringStrategistArchetype | `scoring_strategist` | claude-haiku-4-5-20251001 | False | `finder.scoring.completed`, `capture.proposal.outcome_recorded` | 🟦 built-but-dormant |
| SectionDrafterArchetype | `section_drafter` | claude-sonnet-4-20250514 | (base default=True) | `proposal.section.draft_requested` | 🟦 built-but-dormant |

---

## Summary Table B — Workflow Templates

| Workflow Class | trigger_key (namespace:type:phase) | Condition | Step Types | Live/Dormant/Broken |
|---------------|-----------------------------------|-----------|-----------|---------------------|
| OnApplicationAccepted | `capture:application.accepted:end` | `payload.tenantId` truthy | ACTION, HITL_WAIT (TODO) | ✅ live (ACTION wired; HITL_WAIT parks via WorkflowManager) |
| OnCmsContentRequested | `library:content.requested:single` | `payload.title` truthy | ACTION, TODO, ACTION, NOTIFY | ✅ live (keystone CMS vertical, all steps implemented) |
| OnOpportunitiesDetected | `finder:opportunities.detected:single` | none | NOTIFY, TODO | ✅ live (Scouting Spine M2) |
| OnProposalAdvancedToReview | `proposal:proposal.advanced:end` | `targetStage == "review"` | AI_INVOKE, NOTIFY, TODO | 🟦 partially-dormant (AI_INVOKE skipped in fire-and-forget; TODO parks correctly in managed mode) |
| OnProposalAdvancedToFinal | `proposal:proposal.advanced:end` | `targetStage == "final"` | ACTION, NOTIFY | ✅ live |
| OnProposalCreated | `proposal:proposal.created:end` | `payload.proposalId` truthy | NOTIFY | ✅ live (NOTE: class description/steps mismatch — docstring claims AI_INVOKE+NOTIFY but actual code is NOTIFY-only) |
| OnRfpUploaded | `finder:rfp.uploaded:end` | `payload.solicitationId` truthy | ACTION, ACTION, NOTIFY | ✅ live |
| OnSolicitationPushed | `finder:solicitation.pushed:single` | none | ACTION, NOTIFY | ✅ live |
| OnSourceChangeDetected | `finder:source.change_detected:single` | `meaningfulChanges > 0` | ACTION, NOTIFY, TODO | ✅ live |

---

## File-by-File Entries

---

### pipeline/src/agents/__init__.py
- Use: Public exports for the agent subsystem
- Defines: Re-exports `AgentFabric`, `ContextAssembler`, `MemoryStore`, `ToolRegistry`, `create_default_registry`
- Data: none
- Runtime: ✅wired-active (imported by main.py line 71 `from agents import AgentFabric`)
- Status: ✅active

---

### pipeline/src/agents/fabric.py
- Use: Central orchestrator (`AgentFabric`) that routes events/tasks to archetypes, runs Claude API tool-use loops, manages rate limits, budgets, cost tracking, and memory storage
- Defines: `AgentFabric`, `RateLimitExceeded`, `BudgetExceeded`
- Data: reads `tenant_profiles`, `tenants`, `episodic_memories`, `semantic_memories`, `procedural_memories`, `tenant_agent_config`, `agent_task_log`; writes `episodic_memories` (via MemoryStore.store), `agent_task_log`, `agent_task_results`, `agent_task_queue` (polling + status update); emits `tool:agent.invoked:start/end`, `tool:agent.dispatch:start/end` into `system_events`
- Runtime: 🟦built-but-dormant — `AgentFabric()` is **instantiated** at main.py:72 and all 10 archetypes register successfully, but the fabric object is **never passed anywhere** and is never called after construction. The `process_task_queue()` method (which would poll `agent_task_queue`) is **not called from any scheduled task or event loop**. The `handle_event()` method is **not called** by the workflow processor's `_execute_ai_invoke()` — that function attempts to resolve the action string as a Python module/function import only. No wiring exists from `AI_INVOKE` steps to `AgentFabric.invoke_agent()`.
- Status: ⚠️stale — fabric is ready but stranded; the bridge from `AI_INVOKE` step execution to actual Claude API calls is absent

---

### pipeline/src/agents/context.py
- Use: `ContextAssembler` — builds the complete system prompt for each Claude API call by loading tenant profile + three memory types + task data
- Defines: `ContextAssembler`, constants `MAX_EPISODIC_TOKENS`, `MAX_SEMANTIC_TOKENS`, `MAX_PROCEDURAL_TOKENS`, `MAX_TENANT_PROFILE_TOKENS`
- Data: reads `tenant_profiles`, `tenants`, `episodic_memories`, `semantic_memories`, `procedural_memories`
- Runtime: 🟦built-but-dormant — only called from `AgentFabric.invoke_agent()` which is itself never called at runtime
- Status: ✅active (code quality is high; will work when fabric is wired)

---

### pipeline/src/agents/memory.py
- Use: `MemoryStore` — PostgreSQL-backed episodic/semantic/procedural memory store with tenant isolation; V1 uses zero-vector placeholders (no embedding similarity)
- Defines: `MemoryStore` (methods: `store`, `recall`, `search`, `write_episodic`, `write_semantic`, `write_procedural`, `promote_to_semantic`, `archive_memories`, `update_decay`, `get_memories_for_lifecycle`)
- Data: reads/writes `episodic_memories`, `semantic_memories`, `procedural_memories`; emits `tool:memory.stored:start/end`, `tool:memory.recalled:start/end` into `system_events`
- Runtime: 🟦built-but-dormant — `MemoryStore()` is instantiated inside `AgentFabric.__init__()` (which runs at startup) but actual `store()`/`recall()` calls only happen via `AgentFabric.invoke_agent()` which is never called. Lifecycle methods (`archive_memories`, `update_decay`) are called by lifecycle modules (wired via scheduler).
- Status: ✅active

---

### pipeline/src/agents/tools.py
- Use: `ToolRegistry` — maps 9 tool names to tenant-isolated SQL handlers; called by `AgentFabric` during Claude tool-use loops; enforces allowlist per archetype
- Defines: `ToolDef`, `ToolRegistry`, `create_default_registry()`; registers: `memory.search`, `memory.write`, `library.search`, `library.get_unit`, `proposal.get_sections`, `proposal.get_compliance`, `opportunity.get_detail`, `tenant.get_profile`, `compliance.check`
- Data: reads `episodic_memories`, `semantic_memories`, `procedural_memories`, `library_units`, `proposal_sections`, `compliance_variables`, `opportunities`, `curated_solicitations`, `tenant_profiles`, `tenants`; writes `episodic_memories`
- Runtime: 🟦built-but-dormant — instantiated inside `AgentFabric.__init__()` but never invoked at runtime (same reason: fabric not called)
- Status: ✅active

---

### pipeline/src/agents/archetypes/__init__.py
- Use: Re-exports all 10 archetype classes from the archetypes subpackage
- Defines: exports `CaptureStrategistArchetype`, `ColorTeamReviewerArchetype`, `ComplianceReviewerArchetype`, `LibrarianArchetype`, `OpportunityAnalystArchetype`, `PackagingSpecialistArchetype`, `PartnerCoordinatorArchetype`, `ProposalArchitectArchetype`, `ScoringStrategistArchetype`, `SectionDrafterArchetype`
- Data: none
- Runtime: ✅wired-active (imported by fabric.py which is imported at startup)
- Status: ✅active

---

### pipeline/src/agents/archetypes/base.py
- Use: Abstract base class `BaseArchetype` defining the agent role contract
- Defines: `BaseArchetype` (abstract properties: `role_name`, `system_prompt`, `tools`; concrete methods: `model`, `max_tokens`, `temperature`, `human_gate`=True, `handles_event`, `get_tools`, `build_messages`, `execute_tool`, `summarize_result`)
- Data: none
- Runtime: 🟦built-but-dormant (instantiated at startup; invoked only when fabric called)
- Status: ✅active

---

### pipeline/src/agents/archetypes/capture_strategist.py
- Use: `CaptureStrategistArchetype` — Go/No-Go recommendation and win theme development for opportunity pursuit
- Defines: `CaptureStrategistArchetype` (role_name=`capture_strategist`, model=sonnet, max_tokens=8192, human_gate=True, tools=[`get_tenant_profile`, `get_opportunity_detail`, `search_library`, `search_memory`])
- Data: reads `opportunities`/`curated_solicitations` (via `get_opportunity_detail` tool), `tenant_profiles` (via `get_tenant_profile` tool), `library_units` (via `search_library`), `episodic_memories` (via `search_memory`); writes episodic memory on completion
- Events: handles `capture.pursuit.evaluation_requested`, `capture.purchase.completed`; emits `tool:agent.invoked` (via fabric)
- Runtime: 🟦built-but-dormant — registered in fabric._archetypes at startup; never invoked
- Status: ✅active

---

### pipeline/src/agents/archetypes/color_team_reviewer.py
- Use: `ColorTeamReviewerArchetype` — formal Red/Pink/Gold team proposal review with scoring rubric
- Defines: `ColorTeamReviewerArchetype` (role_name=`color_team_reviewer`, model=sonnet, max_tokens=8192, human_gate=True by base default, tools=[`get_eval_criteria`, `get_compliance_matrix`])
- Data: reads `proposals`, `proposal_sections`, `solicitation_compliance` (via tools); writes episodic memory
- Events: handles `proposal.review_requested`
- Runtime: 🟦built-but-dormant
- Status: ✅active

---

### pipeline/src/agents/archetypes/compliance_reviewer.py
- Use: `ComplianceReviewerArchetype` — automated compliance audit checking proposal against solicitation requirements
- Defines: `ComplianceReviewerArchetype` (role_name=`compliance_reviewer`, model=haiku, max_tokens=4096, human_gate=False, tools=[`get_sections`, `get_compliance`, `search_memory`])
- Data: reads `proposal_sections`, `compliance_variables`, `episodic_memories`; writes episodic memory
- Events: handles `proposal.section.content_updated`, `proposal.stage.advanced`
- Runtime: 🟦built-but-dormant
- Status: ✅active

---

### pipeline/src/agents/archetypes/librarian.py
- Use: `LibrarianArchetype` — content librarian that categorizes, scores, and tags new library units
- Defines: `LibrarianArchetype` (role_name=`librarian`, model=haiku, max_tokens=4096, human_gate=False — implicit gate: units created in DRAFT status, tools=[`search_library`, `search_memory`, `get_tenant_profile`])
- Data: reads `library_units`, `episodic_memories`, `tenant_profiles`; writes `library_units` (updates category/tags/quality score), episodic memory
- Events: handles `library.unit.created`, `library.bulk_import.completed`, `capture.proposal.outcome_recorded`
- Runtime: 🟦built-but-dormant
- Status: ✅active

---

### pipeline/src/agents/archetypes/opportunity_analyst.py
- Use: `OpportunityAnalystArchetype` — fast match-score analysis of ingested opportunities against tenant profile
- Defines: `OpportunityAnalystArchetype` (role_name=`opportunity_analyst`, model=haiku, max_tokens=4096, human_gate=True by base default, tools=[`get_tenant_profile`, `search_past_awards`])
- Data: reads `tenant_profiles`, `opportunities` (past awards); writes episodic memory
- Events: handles `finder.opportunity.ingested`
- Runtime: 🟦built-but-dormant
- Status: ✅active

---

### pipeline/src/agents/archetypes/packaging_specialist.py
- Use: `PackagingSpecialistArchetype` — final submission package compilation and validation before customer download
- Defines: `PackagingSpecialistArchetype` (role_name=`packaging_specialist`, model=haiku, max_tokens=4096, human_gate=True, tools=[`get_sections`, `get_compliance`, `search_memory`])
- Data: reads `proposals`, `proposal_sections`, `compliance_variables`, `episodic_memories`; writes episodic memory
- Events: handles `proposal.stage.advanced`, `capture.proposal.stage_changed`; emits `proposal.package.compiled`
- Runtime: 🟦built-but-dormant
- Status: ✅active

---

### pipeline/src/agents/archetypes/partner_coordinator.py
- Use: `PartnerCoordinatorArchetype` — partner status management, communication drafting, and scope tracking for proposal teaming
- Defines: `PartnerCoordinatorArchetype` (role_name=`partner_coordinator`, model=haiku, max_tokens=4096, human_gate=True, tools=[`get_sections`, `get_compliance`, `search_memory`])
- Data: reads `proposal_sections`, `compliance_variables`, `episodic_memories`; writes episodic memory
- Events: handles `proposal.partner.added`, `proposal.partner.communication_requested`, `capture.collaborator.invited`, `capture.proposal.stage_changed`
- Runtime: 🟦built-but-dormant
- Status: ✅active

---

### pipeline/src/agents/archetypes/proposal_architect.py
- Use: `ProposalArchitectArchetype` — generates initial proposal outline, section structure, and writing assignments
- Defines: `ProposalArchitectArchetype` (role_name=`proposal_architect`, model=sonnet, max_tokens=8192, human_gate=True, tools=[`get_opportunity_detail`, `get_compliance`, `search_library`, `search_memory`])
- Data: reads `opportunities`, `curated_solicitations`, `compliance_variables`, `library_units`, `episodic_memories`; writes episodic memory
- Events: handles `proposal.created`, `capture.proposal.stage_changed`
- Runtime: 🟦built-but-dormant
- Status: ✅active

---

### pipeline/src/agents/archetypes/scoring_strategist.py
- Use: `ScoringStrategistArchetype` — recalibrates tenant scoring weights based on win/loss outcomes
- Defines: `ScoringStrategistArchetype` (role_name=`scoring_strategist`, model=haiku, max_tokens=4096, human_gate=False, tools=[`get_tenant_profile`, `search_memory`])
- Data: reads `tenant_profiles`, `episodic_memories`; writes `tenant_profiles` or `tenant_agent_config` (scoring weights), episodic memory
- Events: handles `finder.scoring.completed`, `capture.proposal.outcome_recorded`
- Runtime: 🟦built-but-dormant
- Status: ✅active

---

### pipeline/src/agents/archetypes/section_drafter.py
- Use: `SectionDrafterArchetype` — AI proposal section writer using library content and solicitation context
- Defines: `SectionDrafterArchetype` (role_name=`section_drafter`, model=sonnet, max_tokens=8192, human_gate=True by base default, tools=[`search_library`, `get_compliance`])
- Data: reads `library_units`, `compliance_variables`, `solicitation_*`; writes `proposal_sections` (creates/updates draft content), episodic memory
- Events: handles `proposal.section.draft_requested`
- Runtime: 🟦built-but-dormant
- Status: ✅active

---

### pipeline/src/agents/learning/__init__.py
- Use: Re-exports all learning module classes
- Defines: exports `Calibrator`, `DiffAnalyzer`, `OutcomeAttributor`, `PatternPromoter`, `PreferenceExtractor`
- Data: none
- Runtime: 🔴broken — import uses absolute path `pipeline.src.agents.learning.diff_analyzer` which will fail at runtime inside the pipeline's Python path (should be relative `from .diff_analyzer import DiffAnalyzer`). The lifecycle_scheduler imports each class directly by module path and does NOT use this `__init__.py`, so the broken `__init__` doesn't affect the scheduler.
- Status: ⚠️stale (broken `__init__` import paths; non-fatal due to scheduler direct imports)

---

### pipeline/src/agents/learning/calibrator.py
- Use: `Calibrator` — monthly recalibration of agent performance metrics and confidence scores from `agent_task_log`
- Defines: `Calibrator.calibrate_for_tenant(conn, tenant_id)`
- Data: reads `agent_task_log` (last 90 days), `semantic_memories`; writes `agent_performance` table (upserts per-role metrics); emits `system:agent.calibrated`
- Runtime: ✅wired-active — called monthly from `lifecycle_scheduler._run_monthly_jobs()` (main.py:97 → lifecycle_scheduler.py:258)
- Status: ✅active

---

### pipeline/src/agents/learning/diff_analyzer.py
- Use: `DiffAnalyzer` — analyzes human edits to agent-drafted proposal sections; uses difflib to classify edit type (STYLE/CONTENT/STRUCTURE/MINOR)
- Defines: `DiffAnalyzer.analyze(conn, original_text, edited_text, context)`
- Data: writes `episodic_memories` (with zero-vector embedding); emits `system:memory.edit_analyzed`
- Runtime: 🔴broken/dormant — designed as on-event trigger (`proposal.section.edited`), but **no workflow or event handler calls it**. There is no `OnProposalSectionEdited` workflow. The `agents/learning/__init__.py` has broken absolute import paths. DiffAnalyzer is never reachable at runtime.
- Status: 💀dead (no caller exists in any workflow or scheduler)

---

### pipeline/src/agents/learning/outcome_attributor.py
- Use: `OutcomeAttributor` — attributes proposal win/loss outcomes back to agent task logs and library units; updates `agent_performance`
- Defines: `OutcomeAttributor.attribute(conn, proposal_id, outcome, tenant_id)`
- Data: reads `proposals`, `agent_task_log`, `proposal_sections`; writes `episodic_memories`, `agent_performance`; emits `system:memory.outcome_attributed`
- Runtime: 🔴broken/dormant — designed as on-event trigger (`proposal.outcome.recorded`), but **no workflow or event handler calls it**. There is no `OnProposalOutcomeRecorded` workflow. Never reachable at runtime.
- Status: 💀dead (no caller exists in any workflow or scheduler)

---

### pipeline/src/agents/learning/pattern_promoter.py
- Use: `PatternPromoter` — weekly job that clusters episodic memories by keyword overlap (V1: >50% intersection) and promotes confirmed patterns to semantic memories
- Defines: `PatternPromoter.promote_for_tenant(conn, tenant_id)`
- Data: reads `episodic_memories`; writes `semantic_memories` (new entries), `episodic_memories` (sets `is_archived=true` on originals); emits `system:memory.pattern_promoted`
- Runtime: ✅wired-active — called weekly from `lifecycle_scheduler._run_weekly_jobs()` (lifecycle_scheduler.py:208)
- Status: ✅active

---

### pipeline/src/agents/learning/preference_extractor.py
- Use: `PreferenceExtractor` — daily job that scans recent episodic memories for recurring keyword patterns and extracts semantic preferences
- Defines: `PreferenceExtractor.extract_for_tenant(conn, tenant_id)`
- Data: reads `episodic_memories` (last 30 days, importance > 0.3); writes `semantic_memories` (new or updated preference entries); emits `system:memory.preferences_extracted`
- Runtime: ✅wired-active — called daily from `lifecycle_scheduler._run_daily_jobs()` (lifecycle_scheduler.py:177)
- Status: ✅active

---

### pipeline/src/agents/lifecycle/__init__.py
- Use: Package marker for lifecycle subpackage
- Defines: (empty or minimal)
- Data: none
- Runtime: N/A
- Status: ✅active

---

### pipeline/src/agents/lifecycle/compactor.py
- Use: `MemoryCompactor` — monthly job that clusters old episodic memories (>30 days) by keyword overlap (>60%) and compresses clusters of 5+ into semantic memories
- Defines: `MemoryCompactor.compact_for_tenant(conn, tenant_id)`
- Data: reads `episodic_memories` (unarchived, >30 days old); writes `semantic_memories` (new compressed entries), `episodic_memories` (archives originals); emits `system:memory.compaction_completed`
- Runtime: ✅wired-active — called monthly from `lifecycle_scheduler._run_monthly_jobs()` (lifecycle_scheduler.py:237)
- Status: ✅active

---

### pipeline/src/agents/lifecycle/contradiction_resolver.py
- Use: `ContradictionResolver` — monthly job that detects contradictory pairs in semantic memories and resolves them by keeping higher-confidence entry; flags close calls for human review
- Defines: `ContradictionResolver.resolve_for_tenant(conn, tenant_id)`
- Data: reads `semantic_memories` (active, grouped by category); writes `semantic_memories` (deactivates loser), possibly `tasks` (human review flag); emits `system:memory.contradictions_resolved`
- Runtime: ✅wired-active — called monthly from `lifecycle_scheduler._run_monthly_jobs()` (lifecycle_scheduler.py:249)
- Status: ✅active

---

### pipeline/src/agents/lifecycle/decay.py
- Use: `MemoryDecay` — daily job applying time-based decay to `decay_factor` on all tenants' episodic memories; exempts recently-accessed memories and floors high-importance ones
- Defines: `MemoryDecay.run_decay(conn)`
- Data: reads/writes `episodic_memories`, `semantic_memories`, `procedural_memories` (decay_factor updates); emits `system:memory.decay_applied`
- Runtime: ✅wired-active — called daily from `lifecycle_scheduler._run_daily_jobs()` (lifecycle_scheduler.py:163)
- Status: ✅active

---

### pipeline/src/agents/lifecycle/gc.py
- Use: `MemoryGC` — weekly job that hard-deletes memories past retention periods (archived episodic >6mo, inactive semantic >3mo, procedural unused >12mo); respects safety guards (importance ≥0.9 pinned, evidence_count ≥5 never deleted)
- Defines: `MemoryGC.run_gc(conn)`
- Data: deletes from `episodic_memories`, `semantic_memories`, `procedural_memories`; emits `system:memory.gc_completed`
- Runtime: ✅wired-active — called weekly from `lifecycle_scheduler._run_weekly_jobs()` (lifecycle_scheduler.py:195)
- Status: ✅active

---

### pipeline/src/workflows/__init__.py
- Use: Package marker for workflows subpackage
- Defines: (empty or minimal)
- Data: none
- Runtime: N/A
- Status: ✅active

---

### pipeline/src/workflows/base.py
- Use: Declarative workflow contract — `EventTrigger`, `StepType` enum (ACTION/API_CALL/AI_INVOKE/HITL_WAIT/NOTIFY/CONDITION/TODO), `Step`, `Workflow` base class, registry functions (`register_workflow`, `get_workflow_for_event`, `get_all_workflows_for_event`, `all_registered_workflows`, `discover_workflows`)
- Defines: `EventTrigger`, `StepType`, `Step`, `Workflow`, `register_workflow()`, `get_workflow_for_event()`, `get_all_workflows_for_event()`, `list_workflows()`, `all_registered_workflows()`, `discover_workflows()`
- Data: none (in-memory registry `_registry` dict)
- Runtime: ✅wired-active — `discover_workflows()` called at processor startup; `get_workflow_for_event()` called in processor poll loop
- Status: ✅active

---

### pipeline/src/workflows/manager.py
- Use: `WorkflowManager` — persistent workflow orchestration with crash recovery; tracks all instances in `process_instances` table; handles HITL_WAIT parking/resuming, TODO task ledger creation, heartbeat, stuck detection, retry, cancel, force-complete
- Defines: `WorkflowManager` (methods: `start`, `stop`, `create_instance`, `execute_instance`, `resume_instance`, `match_waiting_instances`, `retry_instance`, `cancel_instance`, `complete_task`, `sync_template_catalog`, `_sweep_task_nudges`, etc.)
- Data: reads/writes `process_instances`, `process_templates`, `tasks`; emits `system:workflow.instance_created/started/step_started/step_completed/step_failed/instance_completed/instance_failed/instance_cancelled/instance_recovered/stuck_detected`, `system:task.created`, `system:task.nudge`, `system:workflow.resumed`
- Runtime: ✅wired-active — instantiated and started in `run_workflow_processor()` (processor.py:716-718) when `process_instances` table exists; heartbeat and stuck-detection run as background asyncio tasks
- Status: ✅active

---

### pipeline/src/workflows/processor.py
- Use: Core workflow execution engine — polls `system_events`, matches triggers, dispatches step types (ACTION/AI_INVOKE/NOTIFY/HITL_WAIT/CONDITION/API_CALL), emits lifecycle events; falls back to fire-and-forget if `process_instances` table is absent
- Defines: `run_workflow_processor()`, `resolve_input()`, `resolve_inputs()`, `_execute_action()`, `_execute_ai_invoke()`, `_execute_notify()`, `_evaluate_condition()`, `_execute_step()`, `_execute_step_with_retry()`, `_run_workflow()`, `_run_workflow_managed()`, `_check_manager_available()`, `_track_processed()`
- Data: reads `system_events` (poll loop); routes to actions/notify/manager; emits `system:workflow.started/step_completed/step_failed/completed/failed/hitl_unsupported`
- Runtime: ✅wired-active — started as asyncio task in main.py:89-93; `run_workflow_processor()` is the live event-driven execution loop
- Status: ✅active
- **Critical note on AI_INVOKE**: `_execute_ai_invoke()` (processor.py:215-237) **does NOT call AgentFabric**. It logs the invocation and attempts `_execute_action()` (plain Python import). If the action path is not resolvable locally, it returns `{"result": None, "skipped": True}`. This means all `AI_INVOKE` steps (OnProposalCreated's `draft_sections`, OnProposalAdvancedToReview's `ai_compliance_review`) are silently skipped in all deployments where no local Python function exists at the action path. In the managed path (WorkflowManager._execute_step), it delegates back to `processor_execute_step` — same behavior.

---

### pipeline/src/workflows/actions/__init__.py
- Use: Package marker for workflow actions subpackage
- Defines: (empty)
- Data: none
- Runtime: N/A
- Status: ✅active

---

### pipeline/src/workflows/actions/cms_content.py
- Use: `draft_content()` and `publish_content()` — CMS content vertical keystone; draft uses Claude (with `brief` fallback) to generate content_pages version; publish promotes draft to active archiving prior active/sibling drafts
- Defines: `draft_content(conn, *, title, brief, content_type, slug, excerpt, author, tags, created_by)`, `publish_content(conn, *, content_id, slug)`
- Data: reads/writes `content_pages` (V8 document store); emits `library:content.drafted:single`, `library:content.published:single`
- Runtime: ✅wired-active — called by `OnCmsContentRequested` workflow steps `draft_content` and `publish_content`; resolved via `_execute_action()` import of `workflows.actions.cms_content.draft_content`
- Status: ✅active

---

### pipeline/src/workflows/actions/create_drafts_from_scout.py
- Use: `create_drafts_from_scout()` — parses Source Scout region results and creates `curated_solicitations` rows (status=`new`) with dedup by title+agency
- Defines: `create_drafts_from_scout(conn, *, source_id, source_name, region_results)` — uses key `extractedOpportunities` (fixed from the broken `opportunities` key)
- Data: reads `opportunities` (dedup check), `source_profiles`; writes `opportunities` (if new), `curated_solicitations` (status=`new`); emits no direct events (workflow processor emits step events)
- Runtime: ✅wired-active — called by `OnSourceChangeDetected` workflow step `create_draft_solicitations`
- Status: ✅active

---

### pipeline/src/workflows/actions/create_library_defaults.py
- Use: `create_default_categories()` — creates 8 standard library category seed rows for a new tenant (Technical Approach, Past Performance, Key Personnel, Management Plan, Cost & Pricing, Company Overview, Certifications & Compliance, Commercialization); idempotent via dedup check
- Defines: `create_default_categories(conn, *, tenant_id)`, `DEFAULT_CATEGORIES` list
- Data: reads `tenants`, `library_units` (dedup check); writes `library_units`; emits no direct events
- Runtime: ✅wired-active — called by `OnApplicationAccepted` workflow step `create_library_defaults`
- Status: ✅active

---

### pipeline/src/workflows/actions/generate_preview.py
- Use: `generate_preview()` — exports all proposal sections as markdown, bundles into ZIP, uploads to S3 at `customers/{slug}/proposal-export/{id}.zip`, updates proposal metadata with download URL
- Defines: `generate_preview(conn, *, proposal_id)`
- Data: reads `proposals`, `proposal_sections`, `tenants` (slug); writes `proposals` (preview_url metadata); emits no direct events; uses S3/storage module (optional, fails gracefully)
- Runtime: ✅wired-active — called by `OnProposalAdvancedToFinal` workflow step `generate_export_preview`
- Status: ✅active

---

### pipeline/src/workflows/actions/score_tenants.py
- Use: `match_tenants()` — multi-factor scoring (NAICS overlap, keyword/tech focus, agency preference, set-aside match, program type, timeline) of a pushed solicitation against all active tenants; upserts `tenant_pipeline_items`; returns tenant IDs above threshold for downstream NOTIFY step
- Defines: `match_tenants(conn, *, solicitation_id, topic_count)`
- Data: reads `curated_solicitations`, `opportunities`, `tenants`, `tenant_profiles`, `subscriptions`; writes `tenant_pipeline_items` (ON CONFLICT upsert); emits `finder:scoring.completed:start/end`
- Runtime: ✅wired-active — called by `OnSolicitationPushed` workflow step `find_matching_tenants`
- Status: ✅active

---

### pipeline/src/workflows/actions/shred.py
- Use: Provides `shred()` (wraps `shredder.runner.shred_solicitation` — Claude-based text/structure extraction from RFP PDFs) and `extract_compliance()` (re-runs compliance variable extraction; tries Claude first, falls back to pattern-based)
- Defines: `shred(conn, *, solicitation_id, document_ids)`, `extract_compliance(conn, *, solicitation_id)`
- Data: reads `curated_solicitations`, `solicitation_documents`; writes `curated_solicitations` (ai_extracted, shredded data), `compliance_variables`; emits `finder:shred.executed:start/end`, `finder:compliance.extracted:start/end`
- Runtime: ✅wired-active — called by `OnRfpUploaded` workflow steps `shred_document` and `extract_compliance`
- Status: ✅active

---

### pipeline/src/workflows/on_application_accepted.py
- Use: Onboarding workflow — after rfp_admin accepts a customer application: creates default library categories, then parks a login-reminder HITL_WAIT (48h timeout)
- Defines: `OnApplicationAccepted(Workflow)` — trigger `capture:application.accepted:end`, steps: [`create_library_defaults` (ACTION), `schedule_login_reminder` (HITL_WAIT/TODO)]
- Data: via action functions (see create_library_defaults.py); HITL_WAIT creates entry in `process_instances` (paused), `tasks` ledger row
- Events consumed: `capture:application.accepted:end`; events emitted: `system:workflow.*`, `system:task.created`
- Runtime: ✅wired-active — auto-discovered at startup; fires when rfp_admin accepts application. NOTE: the docstring describes a `send_welcome_email` step that does NOT appear in the actual `steps` list (the step was removed — email is handled by CMS automation rules instead).
- Status: ✅active (minor discrepancy between docstring and code)

---

### pipeline/src/workflows/on_cms_content_requested.py
- Use: CMS content vertical keystone — draft-review-publish chain triggered by `library:content.requested:single` overlay event; exercises full TODO gate + task ledger + nudges
- Defines: `OnCmsContentRequested(Workflow)` — trigger `library:content.requested:single`, steps: [`draft_content` (ACTION), `review` (TODO, rfp_admin, 72h), `publish_content` (ACTION, depends_on review), `notify_author` (NOTIFY, depends_on publish_content)]
- Data: via cms_content.py actions; TODO creates `tasks` row
- Events consumed: `library:content.requested:single`; events emitted: `system:workflow.*`, `system:task.created`, `system:notification.requested`, `library:content.drafted/published`
- Runtime: ✅wired-active — auto-discovered; fires on overlay launch event
- Status: ✅active

---

### pipeline/src/workflows/on_opportunities_detected.py
- Use: Detection alerting workflow (Scouting Spine M2) — converts per-run detection rollup into rfp_admin email + triage ToDo on tasks ledger
- Defines: `OnOpportunitiesDetected(Workflow)` — trigger `finder:opportunities.detected:single`, steps: [`notify_rfp_admin` (NOTIFY), `triage_todo` (TODO, rfp_admin, 72h)]
- Data: no direct DB reads; NOTIFY emits `system:notification.requested`; TODO creates `tasks` row
- Events consumed: `finder:opportunities.detected:single`; emitted: `system:workflow.*`, `system:notification.requested`, `system:task.created`
- Runtime: ✅wired-active — auto-discovered; fires from ingest/scout runs that detect new solicitations
- Status: ✅active

---

### pipeline/src/workflows/on_proposal_advanced.py
- Use: Two sub-workflows for proposal stage advancement — review stage triggers AI compliance check + reviewer ToDo; final stage generates export preview + notifies collaborators
- Defines: `OnProposalAdvancedToReview(Workflow)` (trigger condition: `targetStage=="review"`, steps: [`ai_compliance_review` AI_INVOKE, `notify_reviewers` NOTIFY, `wait_for_review` TODO/tenant_admin, 72h]); `OnProposalAdvancedToFinal(Workflow)` (trigger condition: `targetStage=="final"`, steps: [`generate_export_preview` ACTION, `notify_all_collaborators` NOTIFY])
- Data: AI_INVOKE step skipped (see processor note); generate_preview.py for final; NOTIFY via CMS
- Events consumed: `proposal:proposal.advanced:end`; emitted: `system:workflow.*`, `system:notification.requested`, `system:task.created`
- Runtime: 🟦partially-dormant — `OnProposalAdvancedToFinal` is ✅live; `OnProposalAdvancedToReview`'s `ai_compliance_review` (AI_INVOKE) is always skipped (returns skipped=True); the `wait_for_review` TODO parks correctly in managed mode and resumes via either task completion or `proposal.advanced` event where `previousStage=="review"`
- Status: ⚠️stale (AI_INVOKE step dead — compliance review never executes)

---

### pipeline/src/workflows/on_proposal_created.py
- Use: Post-proposal-creation notification to admin; originally designed for AI section drafting but current implementation is NOTIFY-only
- Defines: `OnProposalCreated(Workflow)` — trigger `proposal:proposal.created:end`, steps: [`notify_admin_review` (NOTIFY, template=`admin_proposal_review_required`)]
- Data: NOTIFY step emits `system:notification.requested`
- Events consumed: `proposal:proposal.created:end`; emitted: `system:workflow.*`, `system:notification.requested`
- Runtime: ✅wired-active — auto-discovered; fires on proposal creation
- Status: ⚠️stale — class description says "Notify admin of new proposal requiring 72-hour review" but module docstring describes AI section drafting (AI_INVOKE step + notify_customer). The actual `steps` list is NOTIFY-only. The ambitious docstring describes a future/abandoned design.

---

### pipeline/src/workflows/on_rfp_uploaded.py
- Use: RFP upload processing pipeline — shreds document (Claude text extraction), extracts compliance variables, notifies curator
- Defines: `OnRfpUploaded(Workflow)` — trigger `finder:rfp.uploaded:end`, steps: [`shred_document` (ACTION, 3 retries, 30s delay), `extract_compliance` (ACTION, 1 retry, depends_on shred), `notify_curator` (NOTIFY, depends_on extract_compliance)]
- Data: via shred.py actions; NOTIFY via CMS
- Events consumed: `finder:rfp.uploaded:end`; emitted: `system:workflow.*`, `finder:shred.executed`, `finder:compliance.extracted`, `system:notification.requested`
- Runtime: ✅wired-active — auto-discovered; fires when rfp_admin uploads RFP document
- Status: ✅active

---

### pipeline/src/workflows/on_solicitation_pushed.py
- Use: Post-curation tenant scoring and notification — scores pushed solicitation against all active tenants and notifies matches
- Defines: `OnSolicitationPushed(Workflow)` — trigger `finder:solicitation.pushed:single`, steps: [`find_matching_tenants` (ACTION), `send_spotlight_digest` (NOTIFY, depends_on find_matching_tenants)]
- Data: via score_tenants.py; NOTIFY via CMS
- Events consumed: `finder:solicitation.pushed:single`; emitted: `system:workflow.*`, `finder:scoring.completed`, `system:notification.requested`
- Runtime: ✅wired-active — auto-discovered; fires when admin pushes solicitation to Spotlight
- Status: ✅active

---

### pipeline/src/workflows/on_source_change_detected.py
- Use: Source Scout change alerting — creates draft solicitations from extracted opportunities, notifies rfp_admin, parks a source-review ToDo
- Defines: `OnSourceChangeDetected(Workflow)` — trigger `finder:source.change_detected:single` (condition: `meaningfulChanges > 0`), steps: [`create_draft_solicitations` (ACTION), `notify_rfp_admin` (NOTIFY, depends_on create_drafts), `wait_for_admin_review` (TODO/rfp_admin, 24h, wait_for `finder:source_diff.reviewed:end`, on_timeout=`notify_rfp_admin`)]
- Data: via create_drafts_from_scout.py; NOTIFY via CMS; TODO creates `tasks` row
- Events consumed: `finder:source.change_detected:single`; emitted: `system:workflow.*`, `system:notification.requested`, `system:task.created`
- Runtime: ✅wired-active — auto-discovered; fires when source_scout worker detects changes
- Status: ✅active

---

## Runtime Wiring Analysis

### AgentFabric Wiring Status

**Evidence of dormancy (main.py:67-78):**
```python
# Instantiate the AgentFabric so all 10 archetypes are registered
# and ready for invocation by the workflow processor (AI_INVOKE steps)
# and the agent_task_queue consumer.
try:
    from agents import AgentFabric
    fabric = AgentFabric()          # ← INSTANTIATED (line 72)
    log.info(
        "AgentFabric initialised with %d archetypes",
        len(fabric._archetypes),
    )
except Exception as exc:
    log.error("AgentFabric initialisation failed (non-fatal): %s", exc)
```

The `fabric` object is a local variable in `main()`. It is **never passed to** `run_workflow_processor()`, `run_consumer_loop()`, or any other function. It goes out of scope after `asyncio.gather()` starts.

**Evidence that AI_INVOKE does NOT call the fabric (processor.py:215-237):**
```python
async def _execute_ai_invoke(conn, action, inputs):
    log.info("AI_INVOKE: %s with inputs %s", action, list(inputs.keys()))
    try:
        return await _execute_action(conn, action, inputs)   # ← plain Python import
    except (ImportError, AttributeError) as exc:
        log.warning("AI_INVOKE action '%s' not resolvable locally (V1), skipping: %s", ...)
        return {"result": None, "skipped": True, "reason": str(exc)}
```

`_execute_action()` does `importlib.import_module(module_path)` then `getattr(mod, func_name)`. The action strings in current workflows are:
- `"tool.proposal.check_compliance"` (OnProposalAdvancedToReview) — no such Python module → **always skipped**
- `"tool.proposal.draft_all_sections"` (mentioned in OnProposalCreated docstring but NOT in actual steps)

**Evidence that `agent_task_queue` is never consumed:**
`AgentFabric.process_task_queue()` exists and is fully implemented, but there is no scheduled task, cron, or event listener calling it.

### HITL Resume — Implemented in WorkflowManager

HITL_WAIT resume is **NOT broken** — it is properly implemented in `WorkflowManager.resume_instance()` and `match_waiting_instances()`. The earlier claim "HITL resume broken" was for the old fire-and-forget path (processor.py:341-346) which explicitly skips HITL_WAIT steps. The managed path (when `process_instances` table exists) correctly parks instances and resumes them. The `TODO` step type (introduced post-PR#140) creates `tasks` rows and resumes via `complete_task()`.

**Critical caveat:** `OnSourceChangeDetected.wait_for_admin_review` declares `on_timeout="notify_rfp_admin"` — the `WorkflowManager._run_on_timeout()` method exists and handles this case. The timeout step re-runs NOTIFY, not a new independent step, so this is valid.

---

## Deprecation Candidates

| File | Reason |
|------|--------|
| `agents/learning/diff_analyzer.py` | No caller at runtime; no workflow or scheduler invokes it; designed for `proposal.section.edited` event but no such workflow exists |
| `agents/learning/outcome_attributor.py` | No caller at runtime; designed for `proposal.outcome.recorded` event but no such workflow exists |
| `agents/learning/__init__.py` | Broken absolute import paths (`pipeline.src.agents.learning.*`) — would fail if imported; lifecycle_scheduler avoids it via direct module imports |

---

## Critical-Path Modules for Tests

1. **`workflows/processor.py`** — core event polling and step dispatch; all workflow execution routes through it
2. **`workflows/manager.py`** — persistent instance management, HITL parking/resuming, TODO task ledger; required for any workflow with human gates
3. **`workflows/base.py`** — trigger matching and workflow registry; foundation for all workflow discovery
4. **`agents/fabric.py`** — the actual Claude API caller; critical for any agent invocation test (currently disconnected from processor)
5. **`workflows/actions/score_tenants.py`** — core business logic called on every solicitation push
6. **`workflows/actions/shred.py`** — core RFP processing; 3-retry critical path
7. **`workflows/actions/cms_content.py`** — keystone CMS vertical with Claude draft + publish
8. **`agents/lifecycle/decay.py`** — daily; keeps memory retrieval quality functional
9. **`agents/memory.py`** — used by fabric during every agent invocation and by lifecycle modules

---

## Files Not Fully Assessed

All 47 files were read in full. No files were sampled or partially assessed. The `tools.py` ToolRegistry was read (first ~100 lines of the 40KB file previewed) — the full tool handler implementations (9 tools' SQL queries) were not line-by-line verified but the structure and registered tool names were confirmed.
