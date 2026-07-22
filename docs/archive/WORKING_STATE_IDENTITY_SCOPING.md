# WORKING STATE — cross-company user scoping (multi-day effort)

> **Purpose:** durable "where are we" record so work survives container reclaim / context
> summarization. Update this at the end of every work session and commit it. Companion:
> `docs/IDENTITY_AUTHZ_MODEL.md` (the verified as-built model + gap register).

**Branch:** `claude/nice-hamilton-kBqtD` · **Migrations high-water:** 109 · **Last updated:** 2026-07-16

---

## The goal
Make users **properly scoped** so we can collaborate, run role-based access, and advance
automations. Concretely: one person (email) is `tenant_admin` of their own company AND can be an
**authorized, section-scoped collaborator** on another company's proposal — without over-granting.

## The model (settled — do not re-litigate)
- **Login key = `email` alone** (`users_email_key`). One email = one login = one home company
  (`users.tenant_id`) + one global role. **No** `(email,company)` composite, **no** membership junction
  (the "phantom `tenant_memberships`" was collapsed to `users.tenant_id` — decided).
- Cross-company participation = **grants** on the single identity: `proposal_collaborators`
  (`UNIQUE(proposal_id,email)`, `user_id` nullable) + `collaborator_stage_access`
  (view/comment/edit) + `shadow_admin_grants` (`t_and_c`/`invite`).
- The resolver `frontend/lib/proposal-access.ts::resolveUserAccess` is **cross-tenant capable** and
  is the source of truth for per-section scope. It is correct. The bug is the **gate ordering**.

## The bug (G1) — verified with the harness
Proposal-scoped routes gate on `verifyTenantAccess` (strict `users.tenant_id == proposal.tenant_id`)
**before** `resolveUserAccess` runs, so an accepted cross-tenant collaborator is 403'd/redirected
before the resolver can grant them scoped access. Of **32** proposal-scoped route/page files, **25**
gate tenant-only; **7** already call `resolveUserAccess` but still run the tenant gate first.

## The fix design (coherent, do NOT blind-swap gates)
Privilege in proposal routes must come from **proposal context**, not the global role. A `tenant_admin`
of company B is NOT an admin of company A's proposal.

Two helpers:
1. `isTenantWideMember(role, userTenantId, tenantId): boolean` (pure — put in `lib/rbac.ts`):
   `master_admin|rfp_admin` ⇒ true; `(tenant_admin|tenant_user) && userTenantId===tenantId` ⇒ true;
   else false. **partner_user (even in-tenant) and cross-tenant collaborators ⇒ false** (must be scoped).
2. `verifyProposalAccess(userId, role, userTenantId, tenantId, proposalId): Promise<boolean>`
   (in `lib/db.ts`): `isTenantWideMember(...)` ⇒ true; else true iff an **accepted** `proposal_collaborators`
   row exists for `(proposalId, userId)`.

Per-route recipe:
- **Coarse gate:** replace `verifyTenantAccess` → `verifyProposalAccess` on collaborator-reachable routes.
- **Fine scope:** where a route currently scopes with `if (role === 'partner_user')`, change to
  `if (!isTenantWideMember(role, sessionUser.tenantId, tenantId))` so cross-tenant `tenant_admin`/`tenant_user`
  collaborators are scoped too. Enforce via `resolveUserAccess` (`editableSections`/`commentableSections`/`canUpload`/`canExport`).
- **Admin/owner-only routes stay on `verifyTenantAccess`** (external collaborators correctly denied).

### Route disposition (the work list)
**WIDEN to verifyProposalAccess + scope (collaborator-reachable):**
`page.tsx` (workspace) · `sections/[sectionId]/page.tsx` · `review/page.tsx` ·
`sections/route.ts` (GET) · `sections/[sectionId]/save` (edit✓ editableSections) ·
`sections/[sectionId]/lock` (verify enforcement) · `sections/[sectionId]/versions` (view) ·
`sections/[sectionId]/export` (view/canExport) · `comments/route.ts` (GET+POST; fix scope predicate) ·
`comments/[commentId]/resolve` · `activity/route.ts` (view) · `compliance/route.ts` (view) ·
`supporting-docs` GET (view) + POST (canUpload) · `sections/[sectionId]/atomize-node` (edit)

**LEAVE on verifyTenantAccess (admin/owner-only — collaborators correctly excluded):**
`advance` · `stage` · `gates` · `lock` (proposal-level) · `collaborators` + `[collaboratorId]` (manage team) ·
`reviews` · `outcome` · `ai/draft` · `ai/review` · `ai/compliance` · `create` · `proposals/route.ts` (list) ·
`proposals/page.tsx` (list) · `dropbox` (owner) · `supporting-docs/[docId]` DELETE (owner)

## Verification harness
`scratchpad/verify_identity.mjs` (session scratchpad). Replays exact route SQL + bcrypt against a
live PG16 (migrations 001→109). Run:
```
# PG16 sandbox (as claude user; PG refuses root):
#   data: /tmp/pgs_gov/data  socket dir: /tmp/pgs_sock  port 5433  db: govtech_intel
export DATABASE_URL="postgres://claude@127.0.0.1:5433/govtech_intel"
cd frontend && node <scratchpad>/verify_identity.mjs
```
Personas P1–P5 all PASS; P3.7 reproduces the pre-gate bug; P3.8 the accept-relocate risk.
**TODO for the fix:** extend the harness to prove the FIXED gate — cross-tenant collaborator can edit
ASSIGNED sections, cannot edit UNASSIGNED, comment only where granted, `canAdvance===false`.

## Other gaps (from IDENTITY_AUTHZ_MODEL.md §6) — later days
- **G2** accept `ON CONFLICT(email)` relocates an existing user's home tenant → guard it.
- **G3** shadow grants not enforced (god-view overrides; `portalAdminAccess` dead).
- **G4** EconDev appointed-shadow (`source='invite'`) unbuilt (no role/UI).
- **G5** no first-class admin "apply on a customer's behalf".
- **G6** invite-accept tolerates `user_id=NULL` (no login created).

## Progress log
- 2026-07-16 (1): verified model end-to-end (harness green); wrote `IDENTITY_AUTHZ_MODEL.md`; scoped G1
  (25/32 routes tenant-only); designed the two-helper fix.
- 2026-07-16 (2): **G1 core spine LANDED (commit b5ea26d).** Added `isTenantWideMember` (rbac.ts) +
  `verifyProposalAccess` (db.ts) + rbac unit tests. Applied to the collaborate spine: workspace
  `page.tsx`, section-editor `page.tsx`, `sections/[sectionId]/save`, `comments` GET/POST (scoping
  predicate generalized `partner_user`→`!isTenantWideMember`). Harness P6 proves admit+scope; 613 tests · tsc 0.
  **NEXT (remaining G1 routes):** widen + scope the rest of the collaborator-reachable list — `sections/route.ts`
  GET, `review/page.tsx`, `sections/[sectionId]/versions|export|lock`, `comments/[commentId]/resolve`,
  `activity`, `compliance`, `supporting-docs` (GET + POST canUpload), `atomize-node`. Then G2 (accept relocate guard).
