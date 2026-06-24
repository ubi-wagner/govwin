# V1 UI-UX Audit — Spotlight + Portal (pre-HITL)

**Date:** 2026-06-24 · **Branch:** `claude/nice-hamilton-kBqtD` · **Scope:** every customer-facing page, client component, and API route under `frontend/app/portal/**`, `frontend/app/(auth)/**`, and the Spotlight feature, cross-checked against `docs/baseline/HITL_ROLE_TEST_PLAN.md` (the de-facto V1 spec), `CLAUDE.md` SOPs, and `CLAUDE_CLIFFNOTES.md`.

**Method:** 5 parallel code analysts (Spotlight · Proposals workspace · Portal core · Account+Event-audit · Cross-cutting/nav/access) + a manual auth-flow review. Read-only; no code changed. Findings cite `file:line` and are rated **P0** (blocks a core flow or is a security hole) · **P1** (major: broken/missing/disclosure) · **P2** (degraded UX/consistency) · **P3** (polish).

---

## 0. Can you even log in? (the "forgot my password" question)

**Yes — your credential is seeded and known.** `db/migrations/051_reset_admin_launch.sql` upserts:

> **`eric.c.wagner@gmail.com`** / **`GovWin2026!`** — role `master_admin`, `temp_password = false`.

No later migration (059/063/064/072) touches your row, so that password stands after a full migrate. You are **not** forced through `/change-password` (that only fires for `temp_password=true` users). The middleware, login page, reset/change-password chain, and forced-first-change flow are all well-built (see §A).

**But two real gaps sit right behind the login:**

1. **Email silently no-ops without provider creds (P1).** `lib/email.ts::sendEmail` returns `{provider:'skipped'}` (never throws) when neither Google Workspace (`GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN`) nor `RESEND_API_KEY` is set. Yet `/forgot-password` always renders **"Check your email"** regardless. So if you ever reset your own password in a HITL env without email configured, the link is generated and **never delivered** — a dead end with a reassuring message. *Mitigation:* you have a known seeded password, so you don't need reset to get in.
2. **Customer onboarding does NOT depend on email (good).** `POST /api/admin/applications/[id]/accept` returns the temp password and the admin UI **displays it on-screen** (`application-review.tsx:544`, "Temporary Password", mono/bold). So you can onboard a test tenant and read them their temp password directly. **Team-member invites** (`team/route.ts`), however, *only* email credentials — those will strand invited teammates if email is unconfigured.

**Seed ambiguity (P2):** three different admin identities exist across the repo — `eric@rfppipeline.com` (per `001_baseline.sql`), `eric.c.wagner@gmail.com` (`051`, the authoritative HITL launch reset), and `admin@rfppipeline.com`/`ChangeMe123!` (`scripts/seed_admin.ts` default). Use the `051` credential; consider deleting/aligning the others to avoid confusion.

---

## A. Auth & login flow — solid, with the email caveat above

**What works:** Login page (`app/(auth)/login/page.tsx`) has the "Forgot password?" link, typed error messages, a "password updated" success banner, and safe relative-only `from` redirect. The forgot/reset chain uses a **stateless HMAC token** signed with `AUTH_SECRET + current password hash` — self-invalidating on password change, 1-hour TTL, no DB writes, anti-enumeration (always returns success). Reset verifies with `timingSafeEqual` (fails closed on length mismatch), bcrypt cost 12, clears `temp_password`. Middleware (`middleware.ts`) is well-reasoned: edge-safe JWE handling (documents the v4→v5 loop bug it fixed), rate-limits `/api/auth/*` (5/15min on forgot+reset, 20/15min on login), forces `temp_password` users to `/change-password`, and enforces a role hierarchy by path prefix. `change-password` route is the canonical `withHandler`+Zod+events pattern.

| Severity | File:line | Gap | Fix |
|---|---|---|---|
| **P1** | `lib/email.ts:158-162` + `app/(auth)/forgot-password/page.tsx:34-47` | Reset email silently skipped when no provider configured, but UI says "check your email." | Surface a configuration error path in non-prod, or document the env requirement in the HITL runbook; have onboarding/reset report `emailSent:false`. |
| **P2** | `001_baseline.sql` vs `051_reset_admin_launch.sql` vs `scripts/seed_admin.ts` | Three admin emails/passwords. | Keep `051`; retire/align the others. |

---

## B. Spotlight — functional feed, but the convert flow is gated off and there's a dual-identity routing bug

**What works:** The feed (`spotlights/page.tsx`) joins `opportunities` + `curated_solicitations` + `tenant_pipeline_items`, prefers authoritative pipeline scores and falls back to a transparent client estimate, applies the `min_surface_score` threshold, and renders match reasons. `SpotlightFeed` visualizes score well (solid ring for pipeline vs dashed "Est."), with filters/sort, empty-filter state, and optimistic pin with revert. The pin route is solid (Zod, `{error,code}`, events, upsert). Detail page renders rich opportunity data. All `await sql` in try/catch; auth→tenant→role order correct.

| Severity | File:line | Gap | Fix |
|---|---|---|---|
| **P0** | `spotlight-detail-actions.tsx:56-86` + `proposals/create/route.ts:76-82` | The headline "opportunity → workspace" CTA ("Build Proposal") POSTs to `proposals/create`, which returns **402 PAYMENT_REQUIRED** unless `FOUNDING_COHORT_BYPASS==='true'` (default off). Core convert flow is dead by default. | Decide V1 path: default the founding-cohort bypass on, or wire the CTA to the existing Stripe checkout (`proposal_phase1/2` with `opportunityId`). |
| **P0** | `spotlights/[spotlightId]/route.ts:21-166` vs `spotlights/[spotlightId]/page.tsx:62-128` | **Dual "Spotlight" identity.** The page treats `[spotlightId]` as an `opportunities.id`; the co-located GET/PATCH/DELETE route treats it as a `spotlights` (saved-search) row — different tables, same URL segment. The entire `spotlights` saved-search CRUD is unreferenced by any UI. | Resolve which concept is "Spotlight" for V1 (the feed). Rename/relocate the saved-search routes; stop sharing the `[spotlightId]` segment. |
| **P1** | `spotlights/[spotlightId]/page.tsx:109-128` | Opportunity detail loaded by `WHERE o.id = $1` with **no tenant/pushed-to-pipeline gate** — any authenticated user can view any opportunity (incl. unpushed) by UUID. | Gate on the same `pushed_to_pipeline`/`tenant_pipeline_items` condition the feed uses, or document opportunities as global. |
| **P1** | `spotlight/pin/route.ts:84-89,144-150` | Pin emits `capture:topic.pinned` (start/end) but spec expects `capture:opportunity.pinned:single` via `opportunities/[id]/actions`. Audit assertions keyed on `opportunity.pinned` fail. | Align event type + route shape to the spec (or update the spec). |
| **P1** | `spotlight/pin/route.ts` (singular) vs `spotlights/*` (plural) | Route-namespace split: pin is the only `/spotlight/` (singular) route. | Move pin under `/spotlights/` (or `opportunities/[id]/actions`). |
| **P2** | `spotlights/page.tsx:99-114` | Scoring profile sourced from the `applications` table by the **current user's email**, not `tenant_profiles`. Invited teammates (who never applied) get an empty profile → no match reasons. | Source NAICS/keywords/agencies from `tenant_profiles` (tenant-scoped), consistent with TA-03. |
| **P2** | `spotlights/page.tsx:166-168` | A failed `topics` query renders the same "0 found" empty state as a genuinely empty feed — DB error indistinguishable from empty. | Track a query-failed flag; show a distinct error state. |
| **P2** | `spotlight-feed.tsx:331-349` | For pipeline-scored items the displayed "why this matches" reasons are the *estimator's*, not the pipeline's rationale; with an empty profile a high score shows zero reasons. | Surface the pipeline's own rationale (`priority_tier` is fetched but unused), or label estimated reasons when score is authoritative. |
| **P2** | `spotlights/page.tsx` | No `capture:opportunity.viewed` event on feed/detail view — no audit trail for the primary customer action. | Emit a view event. |
| **P3** | `spotlight-feed.tsx:215-218`; `spotlights/[spotlightId]/route.ts:7`; dashboard checklist | Feed pin failure has no per-row error toast; stale "V1 TODO" docstring; onboarding checklist says "Create your first Spotlight" but the feed has no create action. | Per-row pin error; remove stale TODO; relabel checklist to "Pin your first opportunity." |

---

## C. Proposals workspace

> _Pending the final analyst (largest scope — proposal drafting, AI tools, stage gates, review, collaborators, packaging). This section will be completed when that pass returns._

---

## D. Portal core (dashboard · pipeline · library · documents · processes) — real and tenant-isolated

**What works:** All five pages are SSR-backed and tenant-scoped; every audited route enforces auth → role floor → `getTenantBySlug` → `verifyTenantAccess`, scopes SQL by `tenant_id`, wraps `await sql` in try/catch, returns `{error,code}`, and escapes ILIKE. Dashboard populates stats/checklist/TaskQueue/recent-events/trial-banner; pipeline renders real pinned items with stage + countdown badges and correct detail links; library has a genuine card-catalog + upload→atomize→review with real format readers; documents aggregates four real sources; processes shows real instances with a distinct load-error state and a double-scoped force-advance. No dead nav links.

| Severity | File:line | Gap | Fix |
|---|---|---|---|
| **P1** | `components/portal/library-upload-form.tsx:142` | Atomize is called **inside the per-file loop with no `fileIds`** → the route atomizes *all* pending drafts (LIMIT 20) once per uploaded file; N-file upload re-atomizes the same set N times. `bulk-upload.tsx:165` does it right. | Call atomize once after all uploads with collected `fileIds`. |
| **P1** | `library/atomize/route.ts:128-134,295` | Emits `library:document.atomized` as start/end, but spec/CLIFFNOTES expect `:single`. Automation rules keyed on `:single` never fire (or double-fire). | Emit `emitEventSingle('library','document.atomized')` or confirm consumers match `:end`. |
| **P2** | `dashboard/route.ts:19-182` | Orphan route with **no caller** (page SSRs its own queries) and the two **diverge** (active-proposal definition differs; route references a non-existent `'dismissed'` pursuit_status). Dead code that will drift. | Delete the route or make the page consume it; reconcile definitions. |
| **P2** | `opportunities/[opportunityId]/actions/route.ts:118-123` | Single-item `pin` also force-sets `pursuit_status='monitoring'`, clobbering an existing `pursuing`/`passed` triage. Bulk pin (`opportunities/route.ts:230`) doesn't — inconsistent. | Drop the `pursuit_status` write from `pin` (or set only when `unreviewed`). |
| **P2** | `documents/page.tsx:159,387-394` | "Library Uploads" rows show **"Untitled"** (`heading_text` is null on upload rows) and link to `/library` (not a detail), with no download. | Title from `source_filename`; link to the atom or add a signed-URL download. |
| **P2** | `uploads/route.ts:234-246` | Legacy upload route emits `library:unit.uploaded` (vs canonical `file.uploaded`) and the emit is **outside try/catch** — an event-write failure 500s a succeeded upload → client retry → duplicate row + S3 object. | Wrap emit in try/catch; standardize type; consider retiring this duplicate of `library/upload`. |
| **P3** | `actions/route.ts:11`, `documents/route.ts:9`; `library-upload-form.tsx:30-39`; `dashboard/page.tsx:262-267` | Stale "V1 TODO" banners on implemented routes; disallowed-extension files silently dropped + no client size pre-check (50MB only surfaces as server 413); inline role-set checks instead of `hasRoleAtLeast`. | Cosmetic cleanups. |

---

## E. Account + Event-Audit (team · billing · profile · activity · notifications)

**What works:** All four account surfaces are real. Team renders live members + collaborators with role badges; the invite form creates a temp-password user, emails it, and emits `capture:team_member.invited`. Billing shows real purchases + subscription with working Stripe redirects (tenant_admin+). Profile upserts `tenant_profiles` (NAICS/keywords/agencies) and emits `capture:profile.updated`. The activity stream queries real `system_events` strictly tenant-scoped, filterable by namespace/type/window, correlation-grouped, with auto-refresh and clean empty/error states. Every route emits with the **correct tenant UUID**.

### ⚠️ Event-audit visualization verdict: NOT HITL-ready

The **plumbing is right but the presentation is broken** by one systemic bug repeated across all three audit surfaces: **the label maps are keyed to event names the system never emits.** `describeEvent` builds `${namespace}.${type}` but `type` *already* includes the entity, so real events become `proposal.proposal.created`, `library.file.uploaded`, `capture.topic.pinned` — **none** match the curated labels, so the timeline degrades to raw type strings. The notification bell has the same key mismatch **plus** no read persistence (`is_read` hardcoded `false`; "seen" is component-local and resets on reload) and **no deep-links** to the source entity. Net effect: the trail reads like a developer's event console, not a trustworthy human audit. Three P1 fixes get it there — re-key the shared label map to real emitted types, persist read-state + human titles, and make rows link to their source proposal/section/item (events already carry the IDs).

| Severity | File:line | Gap | Fix |
|---|---|---|---|
| **P1** | `activity-stream-client.tsx:77,80-153` | Label keys double-prefix the namespace → no curated label ever matches; trail shows raw strings. | Key on `${type}:${phase}` (or `type`); rebuild the map from real emitted types. |
| **P1** | `activity-stream-client.tsx:82-85` | `proposal.advanced` matched on `:single` reading `toStage`; real event is `:end` with `targetStage` → renders "next stage". | Match `:end`; read `payload.targetStage`. |
| **P1** | `notification-panel.tsx:64-75,128` + `notifications/route.ts:128` | `is_read` hardcoded false; no persistence; **no deep-link**; `EVENT_LABELS` mismatch → raw strings like "topic.pinned". | Persist read-state (read-cursor/table) + PATCH; render human labels; link to source via payload IDs. |
| **P2** | `notifications/route.ts:88-93` | Feed has no phase filter / type allow-list → both start & end rows appear (dupes) and noisy `system` events surface. | Filter `phase IN ('single','end')` + a notify-worthy allow-list; collapse pairs. |
| **P2** | `activity/page.tsx:80,121-130` | Hard `LIMIT 200`, no pagination/indicator — trail silently truncates (the proposal-activity route already does limit/offset+total). | Add cursor pagination + "showing N of M". |
| **P2** | `team/route.ts:193-197`; `team/page.tsx:104-228` | Invite creates a `users` row directly (no `invitations`/token-accept flow, so no revoke/expire) and the team page is **read-only** (no remove/role-change/resend/deactivate) despite "manage your tenant." | Route team invites through the token/`invitations` flow; add member-management actions. |
| **P3** | `dashboard/page.tsx:248-257`; `activity-stream-client.tsx:36-56,184`; `billing-panel.tsx:170` | Dashboard "Recent Activity" renders fully raw events; dead `agent` namespace + `error` phase config; consulting hours back-computed from cents. | Reuse fixed label map; drop dead config; read purchased quantity. |

---

## F. Cross-cutting — a real partner/tenant authorization cluster + missing route scaffolding

**What works:** The auth/tenant gate is consistently applied (`auth` → `isRole` → `getTenantBySlug` → `verifyTenantAccess`); the `/portal` dispatcher is infinite-loop-safe and recovers stale JWTs; `lib/rbac.ts` is a clean single source of truth; the tenant-**wide** nav pages (dashboard, spotlight list, pipeline, library, activity, team, documents, AI usage) **all** independently re-gate `hasRoleAtLeast` and redirect partners — nav-hiding is backed by server enforcement *there*. The section-**save** API, profile **PATCH/GET**, and AI-draft API all enforce role/collaborator checks server-side (no write/privilege-escalation P0 found).

### ⚠️ The cluster: page-level guards stop at `verifyTenantAccess` on the non-nav (deep-linked) pages

Hiding a nav link is not access control. Four partner-reachable pages verify **tenant membership only** and rely on nav-hiding for role/proposal scoping — so a `partner_user` (or any `tenant_user`) can reach them by direct URL. These are **read/disclosure** gaps (not tampering), but they leak exactly the data the most-restricted role shouldn't see. The fix pattern is uniform: add the `hasRoleAtLeast`/`resolveUserAccess` gate the sibling pages already have.

| Severity | File:line | Gap | Fix |
|---|---|---|---|
| **P1** | `proposals/[proposalId]/sections/[sectionId]/page.tsx:36-115` | Only `verifyTenantAccess` — **no `resolveUserAccess`**. Any tenant member/collaborating partner can open **any section of any proposal** by URL and read full canvas; `readOnly` keys off `isLocked` only, so it even opens in **edit** mode (save 403s later). | `resolveUserAccess`; `notFound()` if section not in viewable/commentable/editable; `readOnly = isLocked || !editable`. |
| **P1** | `proposals/[proposalId]/review/page.tsx:45-72` | Only `verifyTenantAccess` — any tenant_user/partner can read **any** proposal's compliance matrix + section statuses. | Resolve proposal access before render; else redirect. |
| **P1** | `spotlights/[spotlightId]/page.tsx:75-83` | Missing the `hasRoleAtLeast('tenant_user')` floor the **list** page has (PU-07) — partner can open opportunity detail by URL. | Add the role floor to match the list. |
| **P1** | `profile/page.tsx:33` + `profile-editor.tsx:152-153` | Settings link **is** shown to partners; the page gates only `verifyTenantAccess` and SSR-renders **`billing_email`** unconditionally (PU-08 fixed at API but not at page). | Null/hide `billingEmail` for non-tenant_admin, or gate the page. |
| **P2** | `proposals/[proposalId]/page.tsx:80-89,426-458` | Non-collaborator partner still gets the workspace shell → exposes title, **full collaborator roster + emails**, compliance matrix, stage history (sections themselves are gated). | After `resolveUserAccess`, `notFound()` if external with no grant. |
| **P2** | `processes/page.tsx` | Lacks the `hasRoleAtLeast` floor its sibling tenant-wide pages have — partner hitting `/processes` by URL sees the process ledger (read-only). | Add the role floor. |
| **P2** | `agents/page.tsx:13-31` | Omits `getTenantBySlug`+`verifyTenantAccess` (relies on layout) — diverges from the defense-in-depth pattern; latent if layout changes. | Add the tenant-access calls to match siblings. |

### Missing route scaffolding (perceived-quality + error UX during HITL)

| Severity | File:line | Gap | Fix |
|---|---|---|---|
| **P1** | `app/portal/**` — no `loading.tsx` anywhere | Pages are `force-dynamic` with 7+ sequential `await sql`; navigation shows a **frozen/blank** prior screen until SSR completes. | Add `app/portal/[tenantSlug]/loading.tsx` (skeleton); per-heavy-route ideally. |
| **P2** | `app/portal/**` — no `error.tsx` / `not-found.tsx` | Portal errors bubble to the **root** boundary that replaces the whole sidebar/nav; `notFound()` falls to the framework default 404 (no portal chrome). | Add portal-level `error.tsx` + `not-found.tsx` rendering inside the layout. |
| **P3** | `app/error.tsx`; empty-state patterns | Root "Try again" `reset()` re-throws on a failed SSR query (looks dead); empty/error states are ad hoc (dashed card vs italic line); most pages render false-empty on query failure (processes is the good exception). | Add a "go to dashboard" link; adopt a shared `<EmptyState>`; surface query failures distinctly. |

---

## G. Systemic themes (root causes, not one-offs)

1. **Event taxonomy drift (touches B, D, E).** Emitted `type` strings already contain the entity (`proposal.created`, `topic.pinned`, `file.uploaded`), but consumers/label-maps/spec assume different names/phases (`proposal.advanced:single`, `opportunity.pinned`, `document.atomized:single`, namespace double-prefix). This single mismatch breaks the activity stream, notifications, dashboard recent-activity, automation-rule matching, and HITL event assertions. **Fix once, centrally:** a shared canonical event-label/key module used by the activity stream, notification panel, notifications route, and dashboard — derived from the *actually emitted* types.
2. **"Nav-hiding ≠ access control" (F).** Tenant-wide nav pages gate correctly, but deep-linked pages (section editor, review, spotlight detail, settings, workspace shell) stop at `verifyTenantAccess`. Uniform fix: add `hasRoleAtLeast`/`resolveUserAccess` page guards.
3. **Duplicate/divergent endpoints (B, D).** Two upload routes (`uploads` vs `library/upload`), two pin paths with different side-effects, an orphan dashboard route, a `spotlights` table whose CRUD nothing calls. Consolidate to one path per action.
4. **False-empty on error (B, D, F).** Most pages swallow query errors into an empty list, so a DB failure looks like "no data." `processes` is the model to copy (distinct error state).
5. **Missing route scaffolding (F).** No `loading.tsx`/`error.tsx`/`not-found.tsx` under `app/portal/**` → blank transitions and nav-less error screens.

---

## Prioritized fix list

> _Finalized after the Proposals section lands._
