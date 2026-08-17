# COPY_INWARD_VERIFICATION.md — cross-tenant isolation, verified (C7 / GUARDRAIL #118)

**Date:** 2026-08-16 · **Status:** VERIFIED, with two fixes landed + one documented follow-up.
**Invariant under test:** *Sharing is copy-inward only — no cross-tenant shared objects.* When
content crosses from a shared/admin/other-tenant space into a tenant, it must be **copied** into a
new row stamped with the destination `tenant_id` — never referenced across tenants, never read by id
alone without a tenant-access check; and a tenant must never be able to **mutate a shared object**
that another tenant sees.

This is the systematic pass launch-readiness item **C7** asked for. The RLS *mechanism* was already
proven (docs/RLS_CUTOVER.md); this pass verifies the **app-layer copy-inward contract** on top of it,
adversarially, both statically (four independent code sweeps) and live (DB-layer probes as the
`govtech_app` NOBYPASSRLS role). Bottom line: **cross-tenant isolation holds.** No cross-tenant
shared object or cross-tenant read/write path was found. The audit surfaced one real *intra-tenant*
access-control bug (now fixed) and one RLS backstop-hardening gap (partially fixed, remainder
documented).

---

## 1. Method

| Sweep | Scope | Verdict |
|-------|-------|---------|
| A — Reuse / seed | `reuse-past`, seed-job select/apply/decide, pipeline mapper | **COPY-INWARD-SAFE** — every hop stamps the caller's verified `tenant_id`; every source read is `AND tenant_id = <caller>`; every body-supplied id (`cocoonId`/`seedJobId`/`sourceProposalId`) collapses a foreign id to a 404 |
| B — Bridges / catalogs | template-bridge, opportunity bridge, `document_templates`, `library_atoms`/`system_starter`, `atom_embeddings` | **COPY-INWARD-SAFE / SAFE-SHARED-CATALOG** — both bridges copy per-tenant, forward-only, no cross-tenant FK; atoms + embeddings strictly per-tenant/RLS-forced. Two hardening notes (see §3) |
| C — Partner / collab / notify / comments | partner-manager descent, `partner_user` scope, notification bell, comments | **GATED-SAFE except one LEAK** — descent/comments/bell correctly scoped; **artifact export/layout leaked** (see §2) |
| D — RLS census + bypass hunt | every `tenant_id` table across migs 001–184; every `sqlBypass`/`enterBypass` use | **0 uncovered live tables · 0 suspicious bypass uses** |

**Live DB census (running schema, head 185):** 39 tables carry `tenant_id`; the only 5 without RLS
are the documented identity/audit/bridge bypasses (`users`, `user_memberships`, `system_events`,
`tenant_bridge_cursor`, `tool_invocation_metrics`). All **34** genuinely tenant-scoped tables have a
`tenant_isolation` policy — including every post-cutover table (`atom_embeddings`,
`tenant_template_cards`, `notification_read_state`, `proposal_amendment_flags`,
`tenant_automation_policies`, `collaboration_vaults`/`vault_members`, `shadow_admin_grants`). The
bridge/source tables `master_templates`, `opportunity_bridge`, `scout_findings`,
`curated_solicitations` correctly carry **no** `tenant_id` (platform-owned; the per-tenant copies —
`tenant_template_cards`, `tenant_opportunity_cards` — are the RLS-forced destinations).

**Live adversarial DB proof** (`frontend/scripts/drive-copy-inward-isolation.sql`, run as the
NOBYPASSRLS `govtech_app` role, A = foundation, B = lighthouse, all writes rolled back):

```
R1 deny-all (no ctx) ............ 0 / 0 / 0
R2 own-tenant (ctx=A) ........... 13 / 34 / 10          A sees ONLY its own
R3 cross-tenant by forged B id .. PASS(0) ×4           B rows invisible to A even by exact id
R4 RLS overrides WHERE tenant=B . PASS(0)              a buggy tenant-filter still sees nothing
W1 forge own atom -> tenant B ... BLOCKED [42501]      WITH CHECK rejects the re-stamp
W2 update B proposal by id ...... 0 rows               USING filters B out
W3 delete B atom by id .......... 0 rows               USING filters B out
```

Cross-tenant read AND write are blocked in both directions on the strict tables. ✔

---

## 2. Fixed — artifact export/layout scope leak (intra-tenant)

**Finding (Sweep C, verified in code).** `verifyProposalAccess` is the *coarse* gate — tenant-wide-true
for any accepted collaborator, including a stage-scoped `partner_user` — and its docstring requires
callers to add the fine-grained per-section scope via `resolveUserAccess`. The per-**section** export
route does this; the per-**artifact** (whole-volume) routes did not:

- `app/api/portal/[tenantSlug]/proposals/[proposalId]/artifacts/[artifactId]/export/route.ts`
- `…/artifacts/[artifactId]/layout/route.ts`

Both gated only on `verifyProposalAccess`, then assembled **every** section of the volume — so a
collaborator granted *one* section could pull the entire volume as docx/pdf (export) or read its
section titles + page spans (layout). Intra-tenant scope-escalation of the designed stage-scoped
collaborator exception (no cross-*tenant* exposure).

**Fix.** Both routes now mirror the section-export route: a non-`tenant_admin` caller must be entitled
(via `resolveUserAccess`) to **every** section in the artifact, else 403. Tenant-wide members
(`tenant_admin`/`tenant_user`, and platform admins) get all sections and are unaffected.

**Also aligned:** the legacy `/api/events` poller gained the same `tenant_user` floor the canonical
notification bell already has, so a `partner_user` can't pull the raw tenant-wide event stream (not a
cross-tenant leak — session `tenant_id` is app-set — but it over-exposed intra-tenant telemetry).

---

## 3. RLS backstop hardening — the "with-shared" tables

mig 136 placed three tables in a "with-shared" class so tenants can *read* global rows
(`tenant_id IS NULL`): `tasks`, `process_instances`, `document_templates`. Its single `FOR ALL`
policy used `WITH CHECK (tenant_id = app.tenant_id OR tenant_id IS NULL)`, which — because `FOR ALL`
shares one USING/CHECK across every command — also let a `govtech_app` tenant session **write, mutate,
or delete** the shared `NULL` rows. Proven live (pre-fix, ctx = a tenant):

```
UPDATE document_templates … WHERE tenant_id IS NULL  -> 9 rows      (mutate shared catalog)
DELETE FROM document_templates WHERE tenant_id IS NULL -> 9 rows    (destroy shared catalog)
UPDATE tasks SET tenant_id=NULL WHERE id=<own>        -> 1 row      (promote own row to global)
```

Not reachable through any app route today (every tenant writer stamps its own `tenant_id`; the only
`NULL`/system writes are admin routes on the owner/`sqlBypass` pool + seed migrations, all RLS-exempt)
— a backstop gap, not a live leak. But the RLS second layer should hold on its own.

**Fixed: `document_templates` (mig 184).** Split into per-command policies — `SELECT` reads own +
shared; `INSERT`/`UPDATE`/`DELETE` restricted to the caller's own rows. Safe because
`document_templates` has **no** legitimate `govtech_app` `NULL`-writer (its only tenant-context writer,
the portal template-extract route, writes its own `tenant_id`). Re-proven live (post-184):

```
P1 read global catalog (ctx=A) .. 9              read-shared preserved
P2 update global rows ........... 0 rows         BLOCKED (was 9)
P3 delete global rows ........... 0 rows         BLOCKED (was 9)
P4 own-tenant insert ............ 1 row          own writes unaffected
P5 mint fake global (NULL) ...... BLOCKED [42501]
```

**Fixed: `tasks` + `process_instances` (mig 185).** These *do* have a legitimate `govtech_app` writer of
`NULL` rows — the automation engine creates `rfp_admin` admin ToDos (`tenant_id NULL`) via
`lib/automation/triggers.ts` (`import { sql }`) *during* tenant-context requests (e.g. purchase →
curation), and the workflow reconcilers create admin/global `process_instances`. That writer runs on the
RLS-enforced `govtech_app` pool with `app.tenant_id` **set**, so a legitimate `NULL`-INSERT and a
malicious tenant `NULL`-INSERT are byte-identical at the RLS layer — the mig-136-era carve-out sketch
(`INSERT … (NULL AND app.tenant_id unset)`) does **not** cover the real writer (it fires with
`app.tenant_id` *set*). So mig 185 splits the `FOR ALL` policy per-command and restricts only the vectors
with **no** legitimate `govtech_app` writer, leaving `INSERT` permissive:

- `SELECT` own + shared (unchanged) · `INSERT` own **or** `NULL` (preserves the automation writer)
- `UPDATE` own-only (USING + CHECK — no mutating a shared row, no promoting own→global)
- `DELETE` own-only (USING — no deleting a shared row)

Re-proven live (throwaway PG16, `govtech_app` role, ctx = a tenant, before → after mig 185):

```
                             OLD(136)   NEW(185)
UPDATE shared tasks .........   1    ->    0       BLOCKED
DELETE shared tasks .........   1    ->    0       BLOCKED
promote own -> NULL .........   1    ->  ERROR     BLOCKED (RLS check)
read own+shared .............   2    ->    2       preserved
UPDATE / INSERT own .........   -    ->    1       preserved
INSERT NULL admin ToDo ......   -    ->    1       automation writer preserved
UPDATE / DELETE shared PI ...   -    ->    0       BLOCKED
```

**Residual (documented).** A tenant session can still `INSERT` a *new* `tenant_id=NULL` row (mint a global
admin ToDo / workflow instance) — the one vector byte-identical to the legitimate writer, unclosable by
policy alone. Closing it requires routing `lib/automation/triggers.ts`'s `NULL`-row writes through the
owner/`sqlBypass` pool, after which `INSERT` can also be restricted own-only (as mig 184 did for
`document_templates`). Not app-exploitable today (no tenant route mints a `NULL` task / instance).

**Secondary (documented, not fixed): `system_starter` house catalog.** `lib/library/foundation.ts`
(`listSystemFoundations`/`copyFoundationToTenant`) trusts a tenant-settable `collection=system_starter`
tag with no owner filter and reads via bare `sql`. Not exploitable today (RLS returns empty for those
context-less reads under `govtech_app`), but if ever "fixed" by switching to `sqlBypass` without adding
a platform-tenant filter, a tenant could poison the shared catalog. Add an owner/platform-tenant filter
before any such change.

---

## 4. Verification backbone
`tsc` 0 · `vitest` 1129/1129 · mig chain applies clean to head 185 (sandbox) · live isolation proof
green (`frontend/scripts/drive-copy-inward-isolation.sql`). App role reverted to `NOLOGIN` after the run.

## 5. Net
Cross-tenant isolation is **verified** — copy-inward holds across every reuse/bridge/catalog surface,
partner descent and collaborators are correctly scoped, and the RLS layer blocks cross-tenant read and
write on all strict tables. The one real bug (artifact-export scope) is fixed; the shared-catalog RLS
backstop is closed for `document_templates` and the remaining two tables are documented with a safe,
scoped follow-up.
