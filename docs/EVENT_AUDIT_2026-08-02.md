# Auditable-Event Coverage Audit — 2026-08-02

**Question:** does every state-changing action by every actor (user/admin), automation, agent, and
manager leave an auditable record? The record is `system_events` (the canonical spine — namespaces
finder/capture/identity/proposal/library/system/tool, via `lib/events.ts`
`emitEventStart`/`emitEventEnd`/`emitEventSingle`) and/or the domain audit logs
(`proposal_activity_log`, `agent_task_log`, `triage_actions`, `download_count`).

**Scope:** the last ~week (62 commits) — the TVSF export work, the whole-proposal package route
(json/docx/pdf/zip), the `rfp_ingest_manager` agent + its `assess-ingest` producer, the full-draft
route + the new admin doorbell, the `sort_index` ordering, and the dead-code deletions.

## Result: one gap, found and fixed. Everything else covered.

### FIXED — `package/route.ts` `format=zip` emitted nothing (was HIGH)
The whole-proposal native-format zip download (a real deliverable) returned with **no**
`system_events` row, **no** `proposal_activity_log`, and **no** `download_count` — every audit action
in the file sat at line 309+, downstream of the zip branch's early returns (the branch ran
reads/renders only). Its json/docx/pdf siblings *and* the per-volume export route all emit; the zip
was the lone blind spot.
**Fix:** the zip branch now emits `proposal:package.export_started` (start, once past the ownership/
lock gate) and closes it on **every** return — `emitEventEnd(error)` on failed-volumes / no-content /
catch, and `emitEventEnd(result)` + `download_count` increment + `proposal_activity_log
'proposal_exported'` (`format:'zip'`) on success. Parity with docx/json/pdf.

## Coverage matrix (verified this sweep — do not re-add)

| Surface | Auditable record | Status |
|---|---|---|
| `package` json / docx / **pdf** | `proposal:package.export_started`/`.exported` + `proposal_activity_log` + `download_count` (docx/pdf share one block; `details.format` records the real format) | ✅ |
| `package` **zip** | same, on every path | ✅ **(fixed this sweep)** |
| per-volume `artifacts/[id]/export` | `emitEventSingle` + `download_count` | ✅ |
| `full-draft` (portal) | `proposal:proposal.full_draft_requested` start/end + `proposal_activity_log 'ai_draft_requested'` — via the shared `requestFullDraft` helper, `source:'portal'` | ✅ |
| **admin doorbell** `admin/proposals/[id]/full-draft` | same event via the same helper, `source:'admin_doorbell'`, admin actor + resolved tenant | ✅ (new) |
| `assess-ingest` (rfp_ingest_manager producer) | `finder:ingest.assessment_requested` start/end | ✅ |
| `rfp_ingest_manager` **agent run** | fabric emits `tool:agent.invoked` start/end on **every** terminal path (success/guard/error/unknown) + `agent_task_log` — incl. platform-scope `tenant_id=NULL` | ✅ |
| `rfp-upload` | `finder:rfp.uploaded` start + end on every branch | ✅ |
| triage (`rfp-curation/[solId]/triage`) | `finder:solicitation.triaged` start/end + `triage_actions` row | ✅ |

**Read-only (correctly unaudited):** `preview/route.ts`, the section-list `sections/route.ts`, and
`artifacts/[id]/layout` — GET-only; the `sort_index` work touched only their `ORDER BY`, no mutation.

## The attribution win (single audit path)
Both the tenant portal control and the admin doorbell now funnel a full-draft through ONE helper
(`lib/proposal-full-draft.ts::requestFullDraft`), so the emission never diverges — the only
difference is a `source` field (`portal` vs `admin_doorbell`) on the event payload + activity row.
Every full draft is one attributable record no matter who rings it.

## How to keep tabs
`/admin/agents` → "Recent Tool Invocations" reads `system_events WHERE namespace='tool'`; the Agent
Workforce + Usage read `agent_task_queue`/`agent_task_log`. The full `system_events` spine (all
namespaces) + `proposal_activity_log` are the queryable audit of everything above.
