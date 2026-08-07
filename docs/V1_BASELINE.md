# Partner‑Manager V1 — baseline verification record

The evidence that the partner‑manager V1 baseline is tested, accurate, and complete. Feature spec:
`docs/PARTNER_MANAGER_DESIGN.md`. How‑to: `docs/PARTNER_MANAGER_MANUAL.md`. Replicate:
`docs/CLAUDE_VM_REPLICATION.md`.

## How it was verified

1. **Live end‑to‑end drives** (real browser + real DB), both partners:
   - **Paul / Entrepreneurs' Center:** add company → RFP‑admin approve → appears in stable → descend
     as manager → downloaded a real proposal (Word 61 KB + PDF 162 KB).
   - **Stephanie / YBI (net‑new partner):** add company → approve → **ranked** mirror OPPs → create
     bucket → pin OPP → create proposal pipeline (comp‑code purchase → `curation_pending`).
   - RFP admin created **Youngstown Business Incubator** via `/admin/tenants → + New partner org`.
   - Every step cross‑checked against the DB + the 9‑event audit chain (register → accept → backfill
     → card.applied×6 → bucket → pin → purchase → entered → collaboration_requested).
2. **Multi‑dimensional testing matrix** — 8 parallel audit agents (authz · partner surface · API
   contracts · DB integrity · workflow/automation · agent+tool invariants · event/audit · route/404),
   each proving findings with file:line / live psql, then an adversarial verify pass. 9 agents, 0
   errors. **Every finding below was then re‑verified by hand before acting.**
3. **Green backbone:** `tsc` 0 · `vitest` 879 · `migrate --check` 0‑drift · `next build` 0.

## Matrix result — clean where it counts

| Dimension | Verdict |
|---|---|
| **Authorization** (6 actors) | **Fail‑closed, 0 findings.** No missing/rank‑inverted/exploitable guard; `partner_admin` never reaches `/admin`; owning a tenant without a membership grants nothing; requester can't self‑approve. |
| **DB integrity** (live) | **Clean.** 0 orphans across 14 FKs; all partner CHECK constraints landed; both partners + orgs wired; mig‑160 invariant holds; scoring wired on all 3 provision paths. |
| **Agent fabric + tools** | **Untouched by V1** — no agent/tool wired, triggered, or modified; no invariant affected. |
| **API contracts** | 100% parameterized SQL, `{error,code}` on every branch, auth→validate→logic ordering. |
| **Routes/404** | Route‑clean — no new bare‑parent 404, no broken internal link. |

## Findings + resolution (all severities)

| Sev | Finding | Resolution |
|---|---|---|
| **HIGH** | A `manager_request` ToDo could be closed via the **generic** task completer (which only closes + resumes a workflow — grants nothing), silently dropping the partner grant. | **Fixed** — `completeTask` now rejects `manager_request` (`USE_MANAGER_REQUEST_FLOW`), routing it to the Team‑page approve/decline. Unit‑tested (`manager-request-guard.test.ts`). |
| **MED** | Partner ToDos passed `nudgeDays` but no `dueAt`, so the nudge sweep (requires `due_at IS NOT NULL`) never fired. | **Fixed** — `createTask` derives a `due_at` from the last nudge day when `nudgeDays` is set without an explicit `dueAt`. |
| **LOW** | `finder:partner.company_dedup_reviewed` was in the design doc but never emitted (doc↔code gap). | **Fixed** — emitted on partner registration submit (decision + similarCount). |
| **LOW** | manager‑request create/approve routes didn't UUID‑validate ids before the `::uuid` cast (→ 500 on bad input). | **Fixed** — `isValidUUID` guards → clean 400. |
| **LOW** | `/api/partner/enter` + `/exit` ran DB reads outside try/catch (SOP). | **Fixed** — wrapped; a failure redirects to `/partner` (exit still restores the base role). |
| LOW | Two **legacy** non‑partner tenants have unranked pipelines (0 bucket_scores). | Pre‑existing; the **code** fix (score‑on‑provision) is in place for all new tenants. A one‑time backfill of legacy tenants is an optional data task. |
| INFO | A partner‑manager already managing a company can approve *another* partner's manager‑request there (acts as its tenant_admin). | **By design** — documented in the design doc §5. |
| INFO | Partner‑lifecycle events use the `finder` namespace with the affected tenant's id. | **Deliberate** — the partner is platform‑scoped but the event concerns a specific tenant; documented in §6. |
| INFO | `partner_coordinator` agent drops the tenant filter when `tenant_id` is falsy (**pre‑existing**, not reachable from V1). | Noted for a separate agent‑fabric pass; outside partner‑manager V1. |

## Durable demo state (replicates from migrations)

Paul `pjackson@ecinnovates.com` / Entrepreneurs' Center (migs 157/159) · Stephanie `sgaffney@ybi.org`
/ Youngstown Business Incubator (mig 162) · Foundation (client, with a submitted TVSF proposal).
`bash scripts/replicate-vm.sh` rebuilds the whole VM to this state.

## Bottom line

V1 partner‑manager is **fail‑closed, integrity‑clean, and green**, with the one real correctness bug
(silent manager grant drop) fixed and regression‑tested. Remaining items are documented INFO
behaviors + one optional legacy‑data backfill.
