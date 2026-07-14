# Alpha ToDo Backlog — multi-tier (2026-07-05)

Structured three ways as requested: **(1) System**, **(2) Component functionality**, **(3) Role-based
end-to-end data flow (incl. the Claude agent role)** with UI ↔ API ↔ tool ↔ event coverage and
fault-tolerance. Status legend: **✅ DONE** (landed + sandbox-verified this cycle) · **🟡 OPEN-P1**
(important for a smooth Alpha / early prod) · **🔴 OPEN-P0** (blocks the paid loop in prod) · **⚪ P2**
(post-Alpha). Every item names the file(s). Verification standard used this cycle: reproduce in the
sandbox before/after (drive-test), not just tsc/unit.

---

## TIER 1 — SYSTEM (cross-cutting)

### 1.1 Data layer / correctness
- ✅ **jsonb string-scalar class eliminated** — 56 `${JSON.stringify(x)}::jsonb` writes → `sql.json`
  (proven: string-scalar vs object round-trip). Backfill mig 104. Files: 34 across `lib/**`,`app/api/**`.
- ✅ **postgres.js `'t':'f'}::bool` edit no-op** fixed in `volume-update-required-item.ts`,
  `opportunity-update-topic.ts`, `admin/topics/[id]/route.ts` (raw JS boolean). Class swept clean.
- ✅ **Phantom `tenant_memberships`** query → `users.tenant_id` (`proposals/[id]/lock/route.ts`).
- ✅ Bug-hunt swept clean: param-cast, phantom-schema, CHECK-literal, sql-error-handling.
- 🟡 **Event-type naming convention** — a few types embed phase or aren't past-tense (`invoke.start`,
  `v0_completed`, `rfp.shredding.start`). Non-manifesting (verified) but violates the SOP; normalize for
  the automation story. Files: `lib/tools/registry.ts`, `pipeline/src/workflows/actions/draft_v0.py`,
  `pipeline/src/shredder/runner.py`.
- ⚪ Residual `sql.json` cast ergonomics — consider a shared `toJsonb()` helper in `lib/db.ts` to drop the
  `as unknown as Parameters<typeof sql.json>[0]` casts at ~10 typed sites.

### 1.2 Migrations / schema
- ✅ 000→104 apply clean on a fresh pgvector DB; CI has a migrate-vs-pgvector gate. Latest = **104**.
- 🔴 **pgvector pre-flight** on any NEW prod/staging DB (`001`+`101` `CREATE EXTENSION vector`) — confirm the
  image has pgvector and the role can `CREATE EXTENSION` (else crash-loop). Doc: LAUNCH plan §5.
- 🟡 **FORCE RLS vs DB role** — greenfield tenant tables are FORCE-RLS; correctness relies on the app role
  being superuser/BYPASSRLS (the `WHERE tenant_id` + `withTenant` GUC are the guard). Verify the prod role;
  don't flip to a non-owner without auditing bare-`sql` callers. Files: `lib/rls.ts`, migs 094/096/097/101.
- ⚪ `MIGRATIONS_RUNBOOK.md` + CLIFFNOTES migration count are stale (say 008/067; real = 104).

### 1.3 Events / automation runtime
- ✅ Event audit posts objects end-to-end (jsonb fix load-bearing); 7 canonical namespaces enforced.
- ✅ Workflow engine (Python) creates `process_instances` carrying `opportunity_id` from the frozen overlay
  (`ProjectCollaboration`, `OnSolicitationPushed`, `OnProposalCreated`→`draft_v0`).
- 🟡 **No ScheduleTrigger/cron** in the workflow engine → daily cadences (scout digest, date-anchored task
  generation) can't fire. Files: `pipeline/src/workflows/base.py`, `main.py:170`, `ingest/dispatcher.py:60`.
- 🟡 **Fan-out self-heal** — `tenant_bridge_cursor` written, never read; a dropped per-tenant apply is lost
  until a full backfill. Add a cursor catch-up consumer. File: `lib/opportunity-bridge.ts:219-302`.

### 1.4 Config / deploy / observability (prod-readiness)
- 🔴 **Frontend env**: `ANTHROPIC_API_KEY`, `AWS_S3_BUCKET_NAME` (+AWS keys), `NEXTAUTH_URL`, Stripe price
  IDs under the **code's** names. Rewrite `RAILWAY.md` (wrong build context + missing vars). ✅ `.env.example`
  Stripe names corrected this cycle.
- 🔴 **Email provider** (Google Workspace OR `RESEND_API_KEY`) + CMS `SHARED_DATABASE_URL` — else all
  notifications silently `skipped`. Files: `lib/email.ts`, `services/cms/.../event_listener.py:53`.
- 🟡 `/api/health` always 200 (won't fail Railway's probe on a dependency outage) — return non-200 on
  degradation. Confirm Postgres PITR/backups. `system_health_snapshots` has 0 writers.
- ⚪ In-memory rate limiter resets per deploy / per-container (fine at 1 container).

### 1.5 Fault tolerance (system posture)
- ✅ Best-effort side effects (backfill, harvest, matrix, notifications) wrapped so they never fail the
  primary action. ✅ Optimistic-lock CAS on section save + proposal lock. ✅ Idempotent accept/lock/atom-return.
- ✅ AI spend fail-closed (`lib/ai/agent-guard.ts` rate/budget/cap). AI degrades with an honest message when
  keys absent (draft/compliance/color-team).
- 🟡 Agent-task-queue stale-claim recovery (a crashed worker's `running` rows aren't re-picked) — `fabric.py`.

---

## TIER 2 — COMPONENT FUNCTIONALITY

For each: **U**I / **A**PI / **T**ool / **E**vent state, then ToDos.

### 2.1 Public content + waitlist + account approval
- Works: marketing pages (CMS + fallbacks); `/apply`→`applications`; **accept → tenant + tenant_admin +
  temp-password (✅ returned to UI this cycle) + ✅ card mirror on signup**. U✅ A✅ E✅.
- 🟡 `admin/waitlist` ✅ repointed to the real `waitlist` table (was reading applications).
- 🔴 (prod) email delivery of the welcome/temp-password (config, Tier 1.4).
- ⚪ Provisioning seeds no `product_tier`/`subscription_status` (fine while admin-provisioned).

### 2.2 Scout engine + source management + admin notifications
- Works: source registry + admin annotate UI; manual scout → change-detection → `source_review` ToDo +
  alert workflow. U✅ A✅ T✅ E✅ (manual).
- 🔴 **Daily scheduler** to drive `scout_all_due()` + a digest (Tier 1.3). `auto_crawl_enabled` defaults false.
- 🔴 **Web-search NEW-source discovery** — does not exist (net-new; needs a search-API key). Descoped for Alpha.
- 🟡 Role-bucket triage ToDo gets no recurring email nudge (`manager.py:1083`).

### 2.3 Opp river + bridge + clone-on-signup + archival
- Works: global river (`/admin/cards`); forward-only bridge → per-tenant cards; multi-topic fan-out; ✅
  backfill-on-signup; archive-hides-card; admin lifecycle updates propagate. U✅ A✅ T✅ E✅.
- 🟡 **B3/B4 automated propagation** — `finder:opportunity.amended` (ingester) + `finder:topic.imported`/
  `topics.expanded` (post-push topics) have **no consumer** → released opps go stale on the customer surface
  when updated via the *automated* path. Add consumers → `republishIfReleased` + a "publish topic set" helper.
  Files: `pipeline/src/ingest/base.py:331`, `lib/tools/opportunity-bulk-add-topics.ts`, new
  `pipeline/src/workflows/on_opportunity_amended.py`, `lib/opportunity-bridge.ts`.
- 🟡 **B1** dup-title upload → 500 (add `ON CONFLICT`/strengthen `content_hash`). **B2** orphaned zero-doc
  solicitation on storage failure (make create+store one txn or add a reaper). Files: `rfp-upload/route.ts`,
  `intake.ts`.
- ⚪ Backfill over-includes archived; no default bucket on signup (cards unranked until a bucket exists).

### 2.4 Customer library + 5 buckets + per-bucket ranking + pin→S3
- Works: upload→atomize→`library_atoms`; buckets CRUD; per-card-per-bucket scoring; ✅ pin→real S3 copy;
  pin-update detection. U✅ A✅ T✅.
- 🟡 **`/cards` inline rank display** (data present, UI omits it). File: `components/portal/pipeline-cards.tsx`.
- 🟡 **atoms→bucket context** (bucket-ranking has zero atom refs) — the headline differentiator; build or defer.
- 🟡 **Pinned-opp nudge delivery** — emit a tenant-scoped event on `pin_update_available` → `/notifications`
  + email. File: `lib/opportunity-bridge.ts:187`.
- ⚪ Seed default buckets on signup; bucket edit UI; pin→S3 e2e spec.

### 2.5 Purchase → skeleton curation → release → EconDev → portal
- Works: real Stripe SDK+webhook; **real per-solicitation curation** (compliance + volumes + ✅
  template-link + ✅ expert-notes now reach the mold); **provision** (artifacts+sections+matrix+templates);
  ✅ **release** (initial unlock at `lock_count=0`); partner_user stage-scoped access. A✅ T✅ E✅.
- 🔴 **Self-serve purchase→provision chain** — no buy CTA; proposal checkout unreachable from UI; purchase
  creates no proposal. For Alpha: **admin-provisioned** (works). For prod: wire CTA + provision-on-purchase.
  Files: `components/cards/opportunity-card.tsx`, `billing-panel.tsx`, `stripe/webhook/route.ts`, `proposals/create`.
- 🟡 **Curation UI last-mile** — the template **picker** + expert-notes field aren't in `AddEditItemModal`
  (backend proven; admins link via the tool today). File: `components/rfp-curation/curation-workspace.tsx:2470`.
- 🟡 **Template Studio CRUD UI** (browse-only today) + **seed real bodies** for the 4 registry templates
  (DB rows are empty `{}` → fall back to registry). Files: `app/admin/templates/page.tsx`, new seed migration.
- ⚪ Dedicated EconDev "manager" role/gate; `solicitation_outlines` is orphaned (wire or delete).

### 2.6 Proposal pipeline → download
- Works: canvas save (OCC); accept/lock (CAS, idempotent, matrix→satisfied, harvest); advance (+force);
  ✅ **whole-proposal .docx download**; per-section export; AI draft/compliance/color-team (keys-gated). U✅ A✅.
- 🟡 **PDF export** (disabled; no renderer) — decide docx-only vs build.
- ✅ Greenfield provision now populates the matrix (was 0%). ✅ docx-exporter hardened against missing
  canvas/node styles.
- ⚪ ~7 dormant agent archetypes; no-op "AI review" button; embedded images in docx.

### 2.7 Templify past proposals (bonus / marketing)
- ⚪ Feasible, ~70% reuse (parse→canvas→template→provision fill path exists). Net-new: assembler,
  anonymize AI tool, admin flow, marketing surface. **Gated on 2.5 template-link (now works).** Highest risk:
  PII-leak-into-marketing → mandatory HITL + deterministic scrub + residual-scan. Plan in
  `scratchpad/core_value_eval.md` Thread C. Files (net-new): `lib/tools/proposal-anonymize.ts`,
  `app/api/admin/proposal-templify/*`, `app/admin/proposal-templify/page.tsx`.

---

## TIER 3 — ROLE-BASED END-TO-END DATA FLOW (incl. the Claude agent role)

Each role's happy path across **UI → API → tool → event**, and where it can fault.

### 3.1 `rfp_admin` (curator/operator)
- Flow: apply-review (`/admin/applications` → `accept/route.ts` → tenants+users + `capture:application.accepted`
  + `backfillTenant`) → source mgmt (`/admin/sources` → scout job → `finder:source.change_detected`) → ingest
  (`rfp-upload` → `opportunities`+`curated_solicitations` + `finder:rfp.uploaded`) → curate/skeleton
  (`rfp-curation` tools: `volume.*`, `compliance.*`, template-link → `finder:required_item.*`) → push
  (`solicitation.push` → bridge fan-out → `finder:solicitation.pushed`) → provision/release.
- Fault posture: ✅ all admin writes audited; ✅ curation edits now persist; 🟡 dup-title ingest 500 (B1);
  🟡 automated amendments don't re-propagate (B3/B4). Data-flow gap: template picker not in UI (tool works).

### 3.2 `tenant_admin` (customer)
- Flow: login → `/change-password` → `/cards` (mirrored river) → library (`atoms/upload`+`POST /atoms`) →
  buckets (`buckets` CRUD → `autoScoreCard`) → pin (`cards/[id]/pin` → S3 copy) → build workspace
  (`sections/[id]/save` OCC, `ai/draft`, `ai/compliance`) → lock (`sections/[id]/lock`, `proposals/[id]/lock`
  → harvest + `proposal:proposal.locked`) → download (`package?format=docx`).
- Fault posture: ✅ OCC on save/lock; ✅ idempotent lock/atom-return; ✅ download real docx. Gap: 🟡 no inline
  rank on `/cards`; 🟡 no pin nudge; provisioned-locked proposals need admin release (3.1).

### 3.3 `tenant_user` / `partner_user` (collaborator / EconDev reviewer)
- Flow: invited on a proposal → `collaborator_stage_access` → stage-scoped view/comment/edit
  (`proposals/[id]/collaborators`, `comments`) → completes a task (`tasks/tasks.ts::completeTask` resumes the
  parked `process_instance`).
- Fault posture: ✅ access enforced by `lib/proposal-access.ts` (editableSections gate). Gap: 🟡 no dedicated
  EconDev "manager" role — partner_user is the stand-in; ⚪ task delegation/typed-completers (J1–J3) are ToDos.

### 3.4 `master_admin`
- Flow: full system access — migrations, workflow monitor (`/admin/workflows`), analytics, force-advance
  (`lib/process/force-advance.ts`), lifecycle overrides. Fault posture: ✅ CAS on lifecycle transitions;
  ✅ force-advance metadata now a readable object (jsonb fix).

### 3.5 **Claude agent role** (the agent workforce)
- Live agents (real producers): `section_drafter` (`draft_v0` on `OnProposalCreated`), `color_team_reviewer`
  (enqueued on advance → `agent_task_queue` → `_post_section_recommendation` → `proposal_comments`),
  `compliance_reviewer` (AI_INVOKE on advance). Product-AI in the frontend: `proposal.draft_section`,
  `ai/compliance` (Anthropic direct, budget-guarded). Curation memory: `writeCurationMemory` → `episodic_memories`
  (✅ now object-valued → cross-cycle `compliance-suggest` works again).
- Data flow: event → workflow processor (`main.py` 10s poll) → `AgentFabric.process_task_queue` → tool →
  DB write + `tool:invoke.*` / `agent.*` events. Fault posture: ✅ fail-closed spend guard; ✅ honest
  degrade without keys; instance-failure non-fatal.
- Gaps: 🟡 ~7 archetypes dormant (registered, no producer) — capture_strategist, librarian,
  opportunity_analyst, packaging_specialist, partner_coordinator, proposal_architect, scoring_strategist;
  🟡 `fabric.handle_event` not called; ⚪ ToolRegistry dotted-vs-bare name mismatch (agents build SQL directly
  today, bypassing the registry tenant guard) — decide rename vs remove. Files: `pipeline/src/agents/fabric.py`,
  `pipeline/src/agents/archetypes/*`.
- **Anti-lie protocol for dispatched agents (this cycle's finding):** verifier agents *contradicted each other*
  on identical code (reasoned-"object" vs reproduced-"string"); the reproduction was correct. **Standard
  going forward:** an agent claim is only trusted after (a) an adversarial verifier that *reproduces*, and
  (b) the main loop reproduces in the sandbox. Encoded in the bug-hunt workflow + this backlog.

---

## Prioritized next actions (if continuing toward prod)
1. 🔴 Config/runbook truth pass + email + keys (Tier 1.4) — unblocks everything.
2. 🔴 Self-serve purchase→provision (2.5) OR keep founding-cohort admin-provisioned for Alpha.
3. 🟡 Ingest B3/B4 auto-propagation (2.3) + B1/B2 robustness.
4. 🟡 Curation UI last-mile + Template Studio CRUD + seed bodies (2.5).
5. 🟡 `/cards` rank display + pinned-opp nudges + atoms→bucket context (2.4).
6. 🟡 Daily scout scheduler + digests (2.2) once email is live.
7. ⚪ Templify (2.7); dormant agents (3.5); PDF export (2.6).
