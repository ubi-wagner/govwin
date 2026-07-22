# V1 UI-UX Audit — Spotlight + Portal (pre-HITL)

**Date:** 2026-06-24 · **Branch:** `claude/nice-hamilton-kBqtD` · **Scope:** every customer-facing page, client component, and API route under `frontend/app/portal/**`, `frontend/app/(auth)/**`, and the Spotlight feature, cross-checked against `docs/baseline/HITL_ROLE_TEST_PLAN.md` (the de-facto V1 spec), `CLAUDE.md` SOPs, and `CLAUDE_CLIFFNOTES.md`.

**Method:** 5 parallel code analysts (Spotlight · Proposals workspace · Portal core · Account+Event-audit · Cross-cutting/nav/access) + a manual auth-flow review. Read-only; no code changed. Findings cite `file:line` and are rated **P0** (blocks a core flow or is a security hole) · **P1** (major: broken/missing/disclosure) · **P2** (degraded UX/consistency) · **P3** (polish).

---

## ✅ Update — fixes applied on this branch (Tier 0 + both [once] fixes)

Tier-0 and the two high-leverage [once] items are implemented. Two findings were **downgraded after verifying the actual code** (noted below). Tier-2/3 items are unchanged.

**Implemented**
- **Spotlight convert flow** *(was P0)* — `proposals/create` paywall is now off by default for the founding cohort; "Build Proposal" reaches the workspace. Set `FOUNDING_COHORT_BYPASS=false` to re-enable the 402.
- **Dual "Spotlight" identity** *(was P0)* — the unwired saved-search API routes (`/api/portal/[slug]/spotlights[/[id]]`) were removed; `/spotlights/*` now unambiguously means the opportunity feed.
- **Partner authorization cluster** *(was P1 ×5)* — `resolveUserAccess`/role-floor guards added at the **page + comments-API** layer: section editor, review page, spotlight detail, profile (page + hidden nav), workspace shell, processes, comments POST. `tenant_user` tenant-wide access preserved by design (only `partner_user` is scoped).
- **Event-audit visualization** *(was the "not HITL-ready" verdict + P1 ×3)* — new `lib/event-labels.ts` (canonical label + deep-link map keyed on the **real emitted `type`**), wired into the activity stream, notification bell, notifications API, dashboard, and proposal timeline. Notifications now drop noisy `start` rows, return payload, and deep-link to the source entity. Unit-tested (`__tests__/event-labels.test.ts`).
- **Route scaffolding** *(was P1)* — `loading.tsx` + `error.tsx` + `not-found.tsx` under `app/portal/[tenantSlug]` (render inside the shell).
- **"Run AI Review" no-op** *(was P0)* — button disabled ("coming soon"); its color-team agent loop is built but unwired for V1.
- **`agents/page.tsx`** — page-layer `getTenantBySlug`+`verifyTenantAccess` added (defense-in-depth).

**Severity corrections (verified against the code)**
- **Outcome "42P10 → 500" (was P0): FALSE POSITIVE.** The route uses bare `ON CONFLICT DO NOTHING` (no target) — that does NOT raise `42P10` and does NOT 500. The only real effect was non-idempotent re-recording (duplicate audit rows). Fixed as **P2**: migration `073` adds `UNIQUE(unit_id, proposal_id)` and the route now targets it.
- **tenant_user AI (TU-07/08) "P0": reconciled to a spec note, not code.** AI section actions are admin-gated by the as-built design (proposals are created locked for admin co-draft). HITL TU-07/08 updated to reflect admin-driven AI. *If customer-facing section AI is desired, that's a deliberate product change — flagged for your decision.*

**Not in this batch (Tier 2/3):** gate seeding + 400 status (TU-09), canvas autosave + 409 merge, `canvas_versions` snapshot metadata, package export format/persistence, version restore, reviews-table persistence, library atomize race, team-management actions, duplicate upload route. See the tiered list at the bottom.

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

## C. Proposals workspace — core editing is real and well-guarded; the review/AI/outcome edges break

**What works:** Section editing (Tiptap/Canvas) loads content and persists via `PUT .../sections/[sectionId]/save` with **genuine optimistic concurrency** (CAS on `version` → 409), a `canvas_versions` snapshot, lock/stage/edit-window enforcement, and partner edit-permission gating; emits `proposal:section.saved:single`. Stage advance is atomic (`sql.begin`): snapshots sections, writes `stage_completion_snapshots` + `proposal_stage_history` + `proposal_activity_log`, emits `proposal:proposal.advanced:end`. The **Compliance Check** tool genuinely calls Claude Haiku with budget/rate guardrails + prompt-injection delimiting; in-canvas **AI draft/revision** calls Sonnet. Tenant isolation is solid across every route (no IDOR found), `{error,code}` everywhere, `await sql` wrapped. DOCX + section-level PPTX/XLSX exporters are real.

| Severity | File:line | Gap | Fix |
|---|---|---|---|
| **P0** | `proposals/[proposalId]/outcome/route.ts:251-254` | Recording Won/Lost does `INSERT INTO library_atom_outcomes … ON CONFLICT DO NOTHING` but the table has **no unique constraint** on `(unit_id, proposal_id)` → Postgres `42P10` aborts the `sql.begin` → **500 for any proposal with harvested atoms**. Outcome recording broken for the common case. | Add `UNIQUE(unit_id, proposal_id)` migration + target it (or drop `ON CONFLICT`). |
| **P0** | `proposal-ai-actions.tsx:40-42,162` + `proposal-contributor-view.tsx` | TU-07/TU-08 want a **tenant_user** to run AI Draft + Compliance Check, but those controls are `if (!isAdmin) return null`. The contributor (tenant_user/partner) view has **no** AI-draft/compliance/review actions — only per-node revise. TU-07/TU-08 can't be performed as tenant_user. | Expose section AI/compliance in `ProposalContributorView` (gated by edit permission), or mark admin-only in the spec. |
| **P0** | `ai/review/route.ts:148-167` + `proposal-ai-actions.tsx:225` | "Run AI Review" calls **no model and no tool** — it counts sections and emits `review_requested`; the consumer agent is dormant. UI shows "AI review requested for N sections" but **nothing reviews anything**. | Implement via a real Anthropic call (like `ai/compliance`), or hide the button + label not-yet-available. |
| **P0** | `reviews/route.ts:10,219-240` | Self-described stub ("V1 TODO P2-14"): POST writes a `review→review` history note; `reviewerIds` accepted but **never persisted**; the real `proposal_reviews` table is unused. No reviewer assignment/scores. | Persist to `proposal_reviews` (row per reviewer/round), or remove from the flow. |
| **P1** | `proposals/[proposalId]/review/page.tsx` (no inbound link) | The dedicated **Compliance Review page is unreachable** — nothing links to `…/proposals/[id]/review`; only typing the URL gets there. Also read-only (no run/advance). The HITL "review flow" is effectively hidden. | Add a "Compliance Review" link from the workspace (StageControl/admin panel), or fold into a workspace tab. |
| **P1** | `advance/route.ts:187-206` (+ nothing seeds `stage_gate_requirements`) | TU-09 (advance blocked by unmet gates) is **never exercised**: gate rows are seeded only by a manual `gates` POST, so a fresh proposal advances with an empty `unmet` set. Gate-block is opt-in, not default. | Seed default gates (`all_sections_complete`, `compliance_check_passed`) at proposal creation, or document gates as opt-in. |
| **P1** | `advance/route.ts:327` (+ `__tests__/advance.test.ts:367`) | TU-09 contract is **HTTP 400** + `GATE_REQUIREMENTS_NOT_MET`; route returns **422** (code + `details.unmet` correct). The unit test enshrines the wrong 422. | Change to 400; update the test. |
| **P1** | `canvas-editor.tsx:353-371` (+ `save/route.ts` 409) | TU-06 says "auto-save," but the editor is **manual-save only** (no debounce; just `beforeunload`). Client sends no base version; on a 409 it shows the raw error with no reload/merge — two editors thrash. | Add debounced autosave; on 409 prompt to reload latest; add a presence indicator. |
| **P1** | `save/route.ts:175-236` | The `canvas_versions` snapshot archives the **previous** content at the **old** version, hardcodes `source='human_edit'` (discarding AI `source`/`aiInstruction`/`aiModel`), never sets `parent_version_id`. AI revisions are mislabeled human; the 045 revision chain is dead. | Archive new content at `nextVersion` after the CAS, with the body's revision metadata + `parent_version_id`. |
| **P1** | `proposal-draft-section.ts:374-381` + `ai-revision-panel.tsx:60-66` | When `ANTHROPIC_API_KEY` is unset the AI tool **returns a success envelope** `{nodes:[], error:'…not configured'}`; `registry.invoke` logs success, clients only check `nodes.length` → user sees a **silent no-op**, no reason. | Throw a typed error on missing key so invoke logs failure + clients surface it (or read `result.error`). |
| **P1** | `comments/route.ts:194-197,243-250` | PU-05/TU-11: partner comments only within their grant. POST checks tenant membership only — **any tenant member (incl. partner) can comment on any section**, with no `nodeId`-belongs-to-proposal check. (API-layer twin of the §F disclosure cluster.) | `resolveUserAccess` for non-admins; reject `nodeId ∉ commentable/editable`; verify section↔proposal. |
| **P1** | `supporting-docs/route.ts:347-364`; `dropbox/route.ts:126-222` | Supporting-docs upload needs only "any collaborator row" (ignores `accepted_at`/`dropbox_enabled`/stage/revocation); Dropbox POST isn't gated by `dropbox_enabled` at all. A view-only partner can upload. | Gate both on `resolveUserAccess().canUpload`. |
| **P1** | `ai/compliance/route.ts:236-490,495` | ~8 early-return paths fire `emitEventStart` but never `emitEventEnd` (leaking open events); an un-guarded `recordAgentSpend` can 500 a successful check. | Emit `end` before each early return; wrap `recordAgentSpend` in try/catch. |
| **P1** | `stage/route.ts:139-316` (PATCH) | A **second, gate-bypassing** stage-change path (no gate check, no snapshots/log, emits an unlistened `proposal.stage_advanced`). UI never calls it but it's reachable by direct API — a tenant_admin can skip gates. | Delete the PATCH handler (keep GET), or route through advance logic. |
| **P2** | `package/route.ts:160,433-500` | Final **package** export is JSON+DOCX only (PPTX/XLSX wired only at section level) and DOCX is **streamed, not persisted** (the `proposal-export` S3 helper is dead; `download_count` increments with no artifact). Admin "Export" downloads a JSON blob. | Decide package format(s); render/stream DOCX from the admin panel; optionally persist to R2. |
| **P2** | `proposal-timeline.tsx:36-37` | Timeline reads `payload.toStage ?? payload.stage`, but advance emits `previousStage`/`targetStage` → renders generic "next stage"; also start/end vs the `:single` matcher. (Same taxonomy drift as §E/G.) | Match `proposal.advanced:end`; read `targetStage`. |
| **P2** | `versions/route.ts` (GET-only); `export/route.ts:24-153` | No version **restore** endpoint (no `section_reverted`); section export doesn't check per-section access and renders client-supplied bytes — any tenant member can export any section of a locked proposal. | Add audited `POST …/versions/[n]/restore` (OCC); gate export by `resolveUserAccess`, render from stored content for non-admins. |
| **P2/P3** | `registry.ts:113-271`; `supporting-docs/route.ts:446-464`; `collaborators/route.ts:314`; `stage-control.tsx:252`; `outcome/route.ts:161` & `reviews/route.ts:226` | `invoke()` has **no timeout/retry** (a hung Anthropic call hangs indefinitely); supporting-doc row flips to `uploaded` on presign (before the object lands); `dropbox_enabled` hardcoded `true`; admin "Advance" sends no `{force}` so override 422s; event types `outcome.recorded`/`review.created` don't match wired `proposal.*` templates. | Add `AbortSignal.timeout`+retry; use `pending`→`uploaded`; derive `dropbox_enabled`; send `{force:true}` for admin; rename event types. |

**Doc reconciliations (not code bugs):** `CLAUDE_CLIFFNOTES.md:128` says `canvas_versions.document` but code/migrations use `content` — **the doc is stale**. "Mistake 22" claims `ai/review` invokes a missing tool; it actually invokes nothing. The "DOCX-only" limit is true for the **package** export but not section-level export (PPTX/XLSX work there).

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

## G. Systemic themes (root causes — each fix clears many findings)

1. **Event taxonomy drift (B, D, E, C).** Emitted `type` strings already contain the entity (`proposal.created`, `proposal.advanced`, `topic.pinned`, `file.uploaded`), but consumers/label-maps/spec assume different names, phases, and payload fields (`proposal.advanced:single`+`toStage`, `opportunity.pinned`, `document.atomized:single`, namespace double-prefix). This one mismatch breaks the activity stream, notifications, dashboard recent-activity, the proposal timeline, automation-rule matching, and HITL event assertions. **Fix once:** a shared canonical event-label/key module (keyed on real `type`+`phase`, reading real payload fields), reused by the activity stream, notification panel + route, dashboard, and proposal timeline.
2. **"Nav-hiding ≠ access control" (F, C).** Tenant-wide *nav* pages gate correctly, but deep-linked pages/endpoints (section editor, review page, spotlight detail, settings, workspace shell, comments POST) stop at `verifyTenantAccess`. Uniform fix: add the `hasRoleAtLeast`/`resolveUserAccess` guard the sibling surfaces already use.
3. **AI features that report success but do nothing (C).** `ai/review` invokes no model; AI tools return a success envelope when `ANTHROPIC_API_KEY` is unset; both surface "success" toasts over no-ops. **Fix pattern:** throw typed errors on missing capability so `registry.invoke` logs failure and the UI shows it; hide buttons for unimplemented features.
4. **Duplicate/divergent endpoints (B, D, C).** Two upload routes, two pin paths with different side-effects, a second gate-bypassing `PATCH /stage`, an orphan dashboard route, an unwired `spotlights` CRUD. Consolidate to one path per action.
5. **False-empty on error (B, D, F, C).** Most pages/routes swallow query/storage errors into an empty list, so a DB/S3 failure looks like "no data." `processes` is the model (distinct error state).
6. **Missing route scaffolding (F).** No `loading.tsx`/`error.tsx`/`not-found.tsx` under `app/portal/**` → blank transitions and nav-less error screens during HITL.

---

## Prioritized fix list (decision-ready)

Tags: **[once]** = a single central fix that clears multiple findings · effort is rough (S<½d, M~1d, L>1d).

### Tier 0 — fix before HITL even starts (core flows / would derail a walkthrough)
| # | Fix | Why | Files | Effort |
|---|---|---|---|---|
| 1 | Unblock the **opportunity → proposal** convert flow | The headline V1 demo dead-ends on a 402 | set `FOUNDING_COHORT_BYPASS` in deploy **or** wire the CTA to Stripe checkout — `spotlight-detail-actions.tsx:56`, `proposals/create/route.ts:76` | S |
| 2 | Add `UNIQUE(unit_id, proposal_id)` to `library_atom_outcomes` | Win/Lost recording 500s for any proposal with harvested atoms | new migration + `outcome/route.ts:251` | S |
| 3 | Resolve the **dual "Spotlight" identity** | GET/PATCH/DELETE at the detail URL operate on the wrong table | `spotlights/[spotlightId]/route.ts` vs `page.tsx` | M |
| 4 | Decide tenant_user AI access; hide or implement **"Run AI Review"** | TU-07/08 can't be done; a button claims success but no-ops | `proposal-ai-actions.tsx`, `proposal-contributor-view.tsx`, `ai/review/route.ts` | M |
| 5 | Add `app/portal/[tenantSlug]/loading.tsx` (+ `error.tsx`, `not-found.tsx`) | Every navigation blanks during the SSR query fan-out; errors nuke the nav | new files under `app/portal/**` | S |

### Tier 1 — close the security cluster (disclosure to partner/tenant_user) **[mostly one pattern]**
| # | Fix | Why | Files | Effort |
|---|---|---|---|---|
| 6 | Add `resolveUserAccess`/`hasRoleAtLeast` guards to the deep-linked pages + comments POST | Partner/any tenant member can read any section, compliance matrix, opportunity detail, billing email, and comment anywhere by URL | `sections/[sectionId]/page.tsx`, `review/page.tsx`, `spotlights/[spotlightId]/page.tsx`, `profile/page.tsx`+`profile-editor.tsx`, `proposals/[proposalId]/page.tsx`, `processes/page.tsx`, `comments/route.ts` | M **[once]** |
| 7 | Tighten upload/dropbox gating + delete the gate-bypassing `PATCH /stage` | View-only partners can upload; admins can skip gates via direct API | `supporting-docs/route.ts`, `dropbox/route.ts`, `stage/route.ts` | S |

### Tier 2 — make the HITL walkthrough honest (events, gates, AI, audit trail)
| # | Fix | Why | Files | Effort |
|---|---|---|---|---|
| 8 | **[once]** Shared canonical event label/key map (real `type`+`phase`+payload) | Activity stream, notifications, dashboard, proposal timeline all render raw strings; automation rules mis-match | `activity-stream-client.tsx`, `notification-panel.tsx`, `notifications/route.ts`, `dashboard/page.tsx`, `proposal-timeline.tsx` | M |
| 9 | Persist notification read-state + deep-link rows to their source entity | Unread resets on reload; no click-through — the audit trail isn't trustworthy | `notification-panel.tsx`, `notifications/route.ts` (+ small read-cursor table) | M |
| 10 | Seed default `stage_gate_requirements` at proposal creation; return **400** on unmet | TU-09 "blocked by gates" never triggers; wrong status code | `proposals/create`, `advance/route.ts:327` + its test | M |
| 11 | Throw on missing `ANTHROPIC_API_KEY`; balance `ai/compliance` start/end events; guard `recordAgentSpend` | Silent AI no-ops; leaked open events; spend write can 500 a success | `proposal-draft-section.ts`, `ai/compliance/route.ts` | S |
| 12 | Fix `canvas_versions` snapshot (archive new content at `nextVersion`, keep AI metadata, set parent) + add autosave + 409 reload affordance | TU-06 autosave missing; revision history mislabeled/dead | `save/route.ts`, `canvas-editor.tsx` | M |
| 13 | Link the **Compliance Review** page from the workspace | The review flow is unreachable except by URL | `stage-control.tsx`/admin panel → `review/page.tsx` | S |
| 14 | Persist real reviewer assignments (or drop the endpoint) | `reviews` is a stub; reviewerIds discarded | `reviews/route.ts`, `proposal_reviews` | M |

### Tier 3 — consistency & polish (P2/P3, batch when convenient)
Source scoring from `tenant_profiles` not `applications` (Spotlight); align pin event type + route + drop the `pursuit_status` clobber; surface distinct error vs empty states (copy `processes`); fix documents "Untitled"+links; retire the legacy `uploads` route + wrap its emit; package-export format decision + R2 persistence; version-restore endpoint; `registry.invoke` timeout/retry; team member-management actions + token-based invites; seed-email de-dup; stale `V1 TODO` comment sweep; client-side upload size/extension feedback; unify error-screen button palette + shared `<EmptyState>`. See per-section tables for file:line.

### Cross-references
- **§0/§A** auth is the only thing you strictly need to start: log in as `eric.c.wagner@gmail.com` / `GovWin2026!`. Configure `RESEND_API_KEY` (or Google Workspace) before testing forgot-password or team invites.
- Items **6** and **8** are the highest-leverage: one auth-guard pattern and one event-label module each clear ~6 findings.
