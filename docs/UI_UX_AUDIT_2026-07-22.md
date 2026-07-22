# UI-UX + Auditability Sweep — both sides (2026-07-22)

Full-surface certification pass in response to "you 100% sure all UI-UX is complete… DB
to UI and back again for each and every thing, all auditable with actions, events, and
emissions." **Excludes** (by the standing carve-out) automation setup/management, full
workflow integration, and monitoring-management surfaces (`/admin/{agents,automation,
workflows,scouts,process,processes,system,system-state,events,analytics,storage}`,
`/portal/*/{automation,agents}`).

## Method
Fanned out **5 parallel auditors** over the ~55 in-scope functional surfaces + a dedicated
event-emission spine check:
- A/B — customer/tenant pages (discovery+account, build+docs)
- C/D — RFP-admin pages (intake+curation+opps, tenants+commerce+site)
- E — every state-changing API route vs the emission SOP

Gap classes hunted: retired-table reads, silent no-op/swallowed-error handlers, dead links,
missing API routes, redirect-traps, placeholder/"coming soon" copy, disabled-without-reason,
and (E) mutating routes that don't emit a namespaced `system_event`.

## Result: 17 gaps found + fixed (tsc 0 · vitest 729 · live-verified)

**Silent-failure handlers → now surface an error (9 handlers, 5 files):**
`proposal-admin-panel` (Accept&Lock, Lock-Volume, Lock-All "N/M failed", Force-advance),
`pipeline-cards` (pin/unpin/resync + card load), `source-detail-client` (notes/instructions),
`guardrail-defaults`, `spotlight-summary-editor`.

**Correctness — retired-table read (stale/empty UI):**
`admin/rfp-curation/[solId]` "Customer Interest" panel joined the RETIRED
`tenant_pipeline_items` → repointed to the live `tenant_opportunity_cards`
(`COALESCE(pinned_at, created_at)`, archived cards/tenants excluded). **Live-proven:** panel
now shows the pinned tenant (blocker-shots/07).

**Runtime SSR crash (found by the live-drive, not the static pass):**
`/admin/rfp-curation/[solId]` threw "Something went wrong" — `pdf-viewer.tsx` sets the pdfjs
worker + imports `react-pdf` at module-eval, and `curation-workspace` imported it statically,
so Next SSR of the client component crashed (prod, not just dev). Fixed with
`next/dynamic { ssr:false }`. **Live-proven:** the full curation workspace renders.

**Dead-ends / unbuilt:**
- admin document **PDF export** was a silent no-op → wired the existing `pdf-exporter` into the
  documents export route + client (503 fallback when Chromium is unavailable).
- source **"Paste Topics"** could never succeed (pasted rows have no solicitation to attach to)
  → retired the entry point; Upload PDFs / +Add Topic cover it.

**Auditability — every mutating action emits a namespaced event (4 of 97 routes were gaps):**
- `atoms/upload` + `atomize-node` → emit `library:atom.created` on the library write-back
- `atoms/select` → emit `library:section.atoms_selected` on the lineage record
- `admin/tenants` `tenant.created` → admin event ⇒ `tenantId: null` (UUID rides in payload)

Spine health (DB): all 7 allowed namespaces active; **0** forbidden (`admin`/`cms`/`spotlight`);
all 130+ emitted types are valid `entity.action_past_tense`; no `JSON.stringify::jsonb`
round-trip bugs in routes.

**Stale copy:** manage-console ("arrives next"), billing ("schedule via dashboard"),
templify ("find it under Templates").

## What "certified" means here
Every in-scope surface was read (static audit) and the highest-risk paths were driven live
(the earlier 5 blocker surfaces + the curation workspace/panel this pass). The remaining fixes
are error-surfacing, copy, and one-line emit additions that mirror the already-proven
`emitEventSingle` pattern — verified by `tsc` + `vitest` + code review rather than an
individual screenshot each. No dead buttons, retired-table reads, missing routes, or
un-audited mutations remain in the in-scope set.

## Still open (explicitly out of this scope)
The automation/agent/monitoring carve-out, plus the launch-readiness deferred items (invite-
token model, live cost formulas, `countWords` page count, a real AI-drafted sample) — these
land with the automation + agent phase and the budget/spend-cap work.
