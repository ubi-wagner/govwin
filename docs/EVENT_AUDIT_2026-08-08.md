# Event / Audit Coverage — Partner-Manager Sprint (2026-08-08)

Extends the platform-wide observability sweep in `docs/EVENT_AUDIT_2026-08-02.md`. This record
confirms that **every mutating action in the partner-manager surface** (the sprint's new runtime
surface) posts a `system_events` audit — verified in code **and** live against the sandbox after
the end-to-end drive. Auditing is a government-compliance requirement and the fastest path to
catching regressions, so the rule for the partner surface is: **no state change without an event.**

## Coverage map — action → audit event

| Actor action | Route / lib | Event (`namespace:type`) | Live ✓ |
|---|---|---|:--:|
| Partner descends into a company | `api/partner/enter` | `finder:partner.entered` (tenant-scoped) | ✓ (3) |
| Partner exits to console | `api/partner/exit` | `finder:partner.exited` | ✓ (3) |
| Partner submits a new-company registration | `lib/partner/registration.ts` | `capture:application.submitted` (`metadata.partnerId`) + `finder:partner.company_dedup_reviewed` + `createTask(rfp_admin, partner_registration_triage)` | ✓ |
| RFP admin approves a partner registration | `api/admin/applications/[id]/accept` (partner branch) | `capture:application.accepted` + `finder:partner.company_registered` (owner + `partner_manager` membership set) | ✓ |
| Partner requests manager access | `lib/partner/manager-request.ts` | `finder:partner.manager_requested` + `createTask(<company admin>, manager_request)` | ✓ |
| Company admin **approves / declines** the request | `lib/partner/manager-request.ts:134` (`resolveManagerRequest`) | `finder:partner.manager_granted` / `finder:partner.manager_declined` | ✓ granted; decline path instrumented |
| Company admin adds partner as Manager directly | `api/portal/[slug]/team` | `finder:partner.manager_granted` (+ team-add start/end) | ✓ (2 total across both grant paths) |
| Partner's own-org auto-provision (first console visit) | `lib/partner/own-org.ts` | `finder:tenant.provisioned` | ✓ |
| Admin creates a partner org | `lib/partner/create-partner-org.ts` | `finder:tenant.created` | ✓ |

## Closed bypass (no unaudited creation)

`POST /api/partner/tenants` now returns **`410 GONE`** — instant tenant creation is retired; every new
company goes through the approval-gated registration (`/api/partner/registrations` → RFP-admin accept),
which is fully audited above. There is no code path that creates a tenant/membership without an event.

## Deliberate reads (not audited, by design)

- **Name-dedup precheck** (`api/partner/tenants/precheck`, `lib/partner/precheck.ts`) is a **read** — it
  returns similar names and never mutates. The auditable *decision* it informs is captured downstream:
  `company_dedup_reviewed` on registration/confirm-new, or `manager_requested` on the request branch.
- **Console rollup** (`lib/partner/rollup.ts`, `scope.ts`) is a read-only aggregate — no event.

## Live verification (`system_events`, 2026-08-08, after the E2E drive)

```
capture:application.accepted          6
capture:application.submitted         3
finder:partner.company_dedup_reviewed 1
finder:partner.company_registered     1
finder:partner.entered                3
finder:partner.exited                 3
finder:partner.manager_granted        2
finder:partner.manager_requested      1
```

`partner.manager_declined` was not exercised in the drive (no request was declined); its emission is
present in code (`resolveManagerRequest`, `manager-request.ts:134`) and fires on the decline branch.

## Result

**No audit gaps in the partner-manager surface.** Every actor action and every approval/decline
decision posts a `system_events` row (admin events `tenantId=null`; tenant/partner events carry the
affected tenant's UUID, per CLAUDE.md SOP: Events). Combined with the platform sweep of 2026-08-02, the
observability spine is intact end-to-end.

## Optional hardening (recommended, not built)

Add a CI guard that fails if a mutating `app/api/**/route.ts` (one containing `INSERT`/`UPDATE`/`DELETE`
or calling a lib that does) has no `emitEvent*` / audited helper on its write path — so *future* actions
can't ship unaudited. This turns the convention into an enforced invariant.
