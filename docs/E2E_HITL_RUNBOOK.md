# E2E HITL Runbook — every role, actor & process end-to-end

The single script for driving the whole platform through its human-in-the-loop (HITL) gates,
one login-able account per role, against a ready scenario. Covers the master+mirror OPP
lifecycle, the Proposal Draft Manager (full-draft Modes A/B/C + the adversarial gate), and the
**admin-plane triggers** — the Proposal Auto-Drive doorbell + the `rfp_ingest_manager` (§5.5).

> **V1 flows to spot-check (2026-08-04).** Also exercise: the **Proposal Studio** 3-loop gate
> (Draft → Refine → Compliance — preview/comment/regenerate or approve→next; "run all 3"); the
> **amendment engine** (admin logs → **Confirm → notify** on the curation Amendments panel → the
> tenant's amber banner → an admin **Acknowledge**); the **soft-archive** lifecycle (Archive portal →
> its build workflows cascade → **Restore**; archive a library atom → gone from draft selection;
> archive a tenant = license slumber; **nothing is hard-deleted** — docs/ARCHIVABLE_CONTRACT.md); the
> **Submission Package** review; and **Record Outcome → Won** starting a contract + kickoff task.
> UI note: transient results now surface as **toasts** (not `alert()`); destructive actions still
> gate on a native **confirm()**.

> **Actors.** *Human* roles: `master_admin`, `rfp_admin`, `tenant_admin`, `tenant_user`,
> `partner_user` (+ the *shadow-admin* path where an rfp/master admin descends into a tenant's
> RLS space as `tenant_admin`). *Machine* actors: the agent workforce (advisory; every output
> lands at a human gate — it never advances a gate on its own).

> ### ✅ Fixes verified this cycle (2026-08-01) — spot-check these as you go
> The post-audit sweep (F1–F6) landed + is verified (`tsc` 0 · `vitest` 811 · `next build` · Playwright
> `hitl-deep-sweep` 5/5, `hitl-role-smoke` 5/5). Confirm them live:
> 1. **Section editors rehydrate (F2).** Open any proposal section that already has content → it shows
>    the saved canvas, **not a blank editor**. (Was: mig-071 TEXT-vs-object guard rendered saved
>    sections blank on reopen; §4 / §4b in docs/PROJECT_AUDIT.md.) *Fast check:* Foundation TVSF
>    proposal `c3db60b1` → section "#2 Overview of the Technology" renders "Two differentiators define it".
> 2. **Library-seed apply MERGES (F1).** Admin "Apply seed" into a section with existing content now
>    **appends** (and snapshots the prior content to Version History) instead of **replacing** it.
> 3. **Agent Workforce roster = 36 (F6).** `/admin/agents` lists all 36 archetypes incl. the Proposal
>    Draft Manager cohort (Advisory Manager, Traceability Auditor, Redaction Guard, Continuity Manager,
>    Market Analyst, Stylist, Formatter, Proposal Draft Manager) + both Library-Seed producers; exactly
>    one shows **dormant** (Content Generator). (Was hardcoded to 25.)
> 4. **Auto-advance / AI-review read the live policy table (F3).** No behavior change to click through;
>    they no longer read the retired `tenant_automation_preferences` (dropped in mig 142).

> ### 🆕 New this cycle (2026-08-02) — the admin-agent program (drive these in §5.5)
> `tsc` 0 · `vitest` **829** · pipeline agent suite **257** · admin-doorbell driven **live** as master_admin.
> 1. **`rfp_ingest_manager` (36th archetype).** The platform-scope ingest-orchestration *manager* — reads a
>    curated solicitation's ingest state, infers the stage, plans which specialist agents to run next.
>    Advisory, injection-fenced, **no tenant descent**. Roster-visible on `/admin/agents`; triggered by
>    `POST /api/admin/rfp-curation/[solId]/assess-ingest`.
> 2. **Proposal Auto-Drive "doorbell".** The `/admin/agents` card that rings the tenant Proposal Draft
>    Manager (`OnFullDraftRequested{A,B,C}`) on any tenant's proposal from the admin plane — no portal
>    descent. Emits `proposal:full_draft_requested` (`source=admin_doorbell`).
> 3. **One audit path + the zip gap closed.** Portal + doorbell funnel through one `requestFullDraft` helper
>    (`source` distinguishes them); `package?format=zip` now emits its audit (was a blind spot). Every
>    action posts to `system_events` — the `/admin/events` Event Stream is the "keep tabs" surface.

---

## 1. Spin up + seed (one time per sandbox)

```bash
export DATABASE_URL='postgresql://claude@127.0.0.1:5433/govtech_intel'

# 1) Postgres (data dir persists across idle; just restart the process)
rm -f /tmp/pgs_gov/data/postmaster.pid; mkdir -p /tmp/pgs_sock
chown -R claude:claude /tmp/pgs_gov /tmp/pgs_sock
su claude -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgs_gov/data \
  -o '-p 5433 -k /tmp/pgs_sock' -l /tmp/pgs_gov/log start"
# fresh cluster? initdb + createdb + run db/migrations/[0-9][0-9][0-9]*.sql (skip 000_drop_all.sql)

# 2) Seed the E2E HITL cohort (idempotent, additive — creates only e2e-* accounts)
node scripts/seed-e2e-hitl.mjs        # prints accounts + the drivable proposal id

# 3) Frontend — build + serve. ⚠️ next.config is output:'standalone', so `next start` is BROKEN
#    (chunk 404s). Run the standalone server, staging static + public into it first.
cd frontend && NODE_ENV=production DATABASE_URL="$DATABASE_URL" npx next build   # ~2 min: long timeout
rm -rf .next/standalone/.next/static && cp -r .next/static .next/standalone/.next/static
cp -r public/* .next/standalone/public/ 2>/dev/null
( cd .next/standalone && PORT=3000 HOSTNAME=127.0.0.1 NODE_ENV=production DATABASE_URL="$DATABASE_URL" \
  AUTH_SECRET='dev-screenshot-secret-000' AUTH_TRUST_HOST=true NEXTAUTH_URL='http://localhost:3000' \
  AUTH_URL='http://localhost:3000' ANTHROPIC_API_KEY='sk-noop' AWS_S3_BUCKET_NAME='rfp-pipeline-local' \
  AWS_REGION='us-east-1' PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node server.js & )   # run_in_background
until curl -s -o /dev/null http://localhost:3000/login; do sleep 1; done
# ⚠️ Sign in at localhost:3000 (NOT 127.0.0.1) — the NextAuth cookie is host-bound. Full recipe +
#    gotchas (re-stage on every rebuild; PDF tooling): docs/CONTINUATION.md §2.
```

**Pipeline (only needed to see agents actually run).** The full-draft / adversarial workflows
FIRE on the admin control regardless, but the agent *steps* need a real key. Start the pipeline
worker with a live `ANTHROPIC_API_KEY` to see `section_drafter` / the full-draft cohort produce
review-staged drafts; with `sk-noop` the AI_INVOKE steps safe-skip (the HITL gates still surface).

---

## 2. The cohort (one account per role — shared password)

`node scripts/seed-e2e-hitl.mjs` guarantees these, all with **password `E2ETest!2026`**
(override via `E2E_PW=…`). Sign in at `/login`.

| Role | Email | Home | Drives |
|---|---|---|---|
| `master_admin` | `e2e-master@rfppipeline.test` | `/admin` (no tenant) | platform oversight · agents · shadow-descend |
| `rfp_admin` | `e2e-rfpadmin@rfppipeline.test` | `/admin` (no tenant) | ingest → curate → release → shadow |
| `tenant_admin` | `e2e-tadmin@acme-navy.test` | `/portal/acme-navy-systems` | purchase → provision → draft → **full-draft** → lock → advance → package |
| `tenant_user` | `e2e-tuser@acme-navy.test` | `/portal/acme-navy-systems` | scoped view/edit per admin grant |
| `partner_user` | `e2e-partner@ext.test` | `/vaults` (per invite) | vault upload/atomize · stage-scoped review |

**Two cohorts on the box — use the right one for the job:**

**(a) `acme-navy-systems` (e2e-* cohort)** — the clean 5-role LOGIN + DISCOVERY set. 6 ranked cards,
comp code **`rfppipelinetest`**. On a fresh box it has **no provisioned proposal yet** (the build side
starts empty) — drive the *discovery → purchase → curate → release* path here, or provision one, then
build. `node scripts/seed-e2e-hitl.mjs` (re)asserts these accounts + refreshes the cards.

**(b) `foundation` (Foundation / TVSF) — the RICH BUILD scenario.** This is the fully-seeded demo:
company profile, library atoms, ranked SBIR buckets, and a **built TVSF proposal with 13 content-bearing
sections + downloadable docx/xlsx**. Use it for the section editor, rehydration (F2), library/atoms,
packaging, and the customer story. **All Foundation accounts use `DemoPass123!`.**

| Role | Email | Notes |
|---|---|---|
| `tenant_admin` (bound) | `kate.ulepic@foundation3dp.com` | Foundation's INTERNAL admin — session is tenant-pinned to `foundation`. |
| `tenant_admin` (external shadow) | `pjackson@ecinnovates.com` | **Paul Jackson (EC)** — the EXTERNAL shadow-admin. `users.tenant_id` is null, so the session is **not** tenant-pinned; he reaches Foundation via a membership resolved per-request. Lands at `/portal/foundation/dashboard`. This is the shadow-admin model, by design. |
| `tenant_user` | `connor.casey@foundation3dp.com` (also `conor.atkins@`, `will.curley@`) | scoped team members |

> **Drivable build:** Foundation proposal **`c3db60b1-2f0e-4bc8-903c-1ec098906c58`** ("TVSF Round 45").
> Rehydration proof section: **`e43e02fd-798b-4d46-a95f-1e158ce67704`** ("#2 Overview of the Technology").
>
> The acme-navy / Foundation libraries are purpose-built; for the **Army/AF cross-pedigree** continuity
> test (hundreds of atoms) the `immobileyes` CUAS scenario is available where seeded
> (`atossa@immobileyes.com` / `DemoPass123!`, proposal `62960c36-…`).

---

## 3. The process map (who owns each gate)

```
 rfp_admin        tenant_admin (customer / shadow)                        partner_user
 ─────────        ────────────────────────────────                       ────────────
 ingest OPP  ──▶  see card (Spotlight) ──▶ comp-code PURCHASE ──▶ curation_pending
   │                                                                  │ (72h SLA ToDo → rfp_admin)
 curate ◀──────────────────────────────────────────────────────────┘
 (matrix · molds · templates)
   │
 RELEASE  ──▶  provisioned build (UNLOCKED, matrix instantiated)
                    │
                    ├─ draft sections (AI-assist)                    invite ──▶ nook / vault
                    ├─ RUN FULL DRAFT  ── Mode A (V0.1 HITL)              │      upload → atomize
                    │                     Mode B (V0.2 restyle)           │      (download-whole only)
                    │                     Mode C (V0.5 full auto)         ▼
                    │                       └─ ADVERSARIAL GATE (HITL | AUTO)   HITL: content → vault
                    ├─ review staged canvas_versions (redline)
                    ├─ LOCK section  ──▶ compliance matrix advances
                    ├─ ADVANCE stage (Review → Revise → Lock → Advance)
                    └─ PACKAGE + DOWNLOAD (docx/pptx/xlsx/pdf)

 master_admin / rfp_admin oversight + ADMIN-PLANE TRIGGERS (no portal descent):
   /admin/agents  →  Agent Workforce roster  +  Proposal Auto-Drive DOORBELL (ring Mode A/B/C
                     on any tenant's proposal)
   rfp_ingest_manager  →  assess a curated solicitation's ingest readiness (which agents to run next)
   /admin/events  →  the audit Event Stream (every action, all namespaces — "keep tabs")
   shadow-descend into a tenant (act as tenant_admin in their RLS space).
```

Every arrow is a HITL gate: an actor performs an action, the system records a `system_events`
row, and (where applicable) a workflow parks a **ToDo** on the next actor's queue.

---

## 3.5 Hotel quick-start — the Foundation/TVSF rich build (30–40 min, touches every dimension)

The fastest way to exercise the whole platform on the seeded box. Sign in at `/login`. Each step
is **do → expect**; the DB one-liners in §6 confirm anything the UI doesn't show.

**A — Discovery & scoring (as `pjackson@ecinnovates.com` / `DemoPass123!`)**
1. Land → `/portal/foundation/dashboard`. **Expect** the Foundation cockpit (no bounce to `/login`).
2. `/portal/foundation/buckets` → **Expect** SBIR opportunities ranked into spotlight buckets with
   scores. `/portal/foundation/cards` → **Expect** the ranked opportunity cards; open one for score
   transparency.

**B — The build & the section editor (the F2 fix) — the core**
3. `/portal/foundation/proposals` → open **TVSF Round 45** (`c3db60b1…`). **Expect** the section list
   + compliance matrix + AI Actions panel.
4. Open section **"#2 Overview of the Technology"** → **Expect** it renders the SAVED content
   ("Foundation's system prints a foundation's wall geometry…", "Two differentiators define it…") —
   **NOT a blank canvas.** This is the F2 rehydration fix; reopen a few sections to confirm none blank.
5. Edit a paragraph → Save → reopen. **Expect** your edit persisted (round-trips through TEXT content).
6. **Lock** a completed section → **Expect** the compliance-matrix row for its item flips to satisfied.
7. **Advance** the stage (Review → Revise → Lock → Advance) → **Expect** the stage label moves + a
   `proposal.advanced` event (§6). *(AI review on advance is governed by the 'Stage advanced'
   automation gate — F3.)*

**C — Library, packaging, downloads**
8. `/portal/foundation/atoms` → **Expect** the atom library (uploaded → atomized → tagged). Upload a
   doc → atomize → **Expect** new `library_atoms`. Select atoms to ground a section (mold).
9. Package + **download** the proposal → **Expect** real docx/xlsx files that open.

**D — Oversight & the agent workforce (the F6 fix) — sign in as `e2e-master@rfppipeline.test` / `E2ETest!2026`**
10. `/admin/agents` (**Agent Workforce**) → **Expect** the **full 36-archetype roster** incl. Proposal
    Draft Manager, Advisory Manager, Traceability Auditor, Redaction Guard, Continuity Manager, Stylist,
    Formatter, Market Analyst, **RFP Ingest Manager** + both Library-Seed producers; exactly **one
    dormant** (Content Generator).
10b. On the same page → the **Proposal Auto-Drive (Doorbell)** card → pick **Foundation — TVSF Round 45**
    + **Mode C** → **Ring**. **Expect** a success banner; a `proposal.full_draft_requested`
    (`source=admin_doorbell`) pair in the audit (§5.5 / §6). This is the admin-plane build trigger.
11. `/admin/events` → **Expect** the immutable audit Event Stream — your doorbell ring shows at the top,
    attributed. Filter by namespace. `/admin/tenants` → open `foundation` → **Enter tenant**
    (shadow-descend) → **Expect** you're now acting as `tenant_admin` in Foundation's space.

**E — The other actors (login smoke)**
12. `e2e-rfpadmin@…` → `/admin/intake`, `/admin/rfp-curation`, `/admin/purchases` render (ingest→release).
13. `e2e-tuser@acme-navy.test` (tenant_user) → scoped portal; `e2e-partner@ext.test` (partner_user) → `/vaults` only.

*(The `hitl-deep-sweep` Playwright spec automates B-step-4, D-step-10, and the surface walk — §7.)*

---

## 4. Per-role walkthroughs

Each step: **do** → **expect** → **verify**. Verify with the UI, or the DB one-liners in §6.

### A. `master_admin` — platform oversight + shadow
1. Sign in `e2e-master@rfppipeline.test` → land `/admin/dashboard`. **Expect** platform metrics, no tenant scope.
2. `/admin/agents` (**Agent Workforce**). **Expect** the 36-archetype roster with per-tenant usage; the Proposal Draft Manager cohort (proposal_manager, formatter, stylist, continuity_manager, traceability_auditor, redaction_guard, market_analyst, advisory_manager, cost_estimator woken) is listed. **Verify** roster renders; forward-only usage counts only (no tenant content).
3. `/admin/events`. **Expect** the immutable audit timeline; filter by namespace (finder/capture/proposal/library/system/tool). **Verify** your own admin actions appear (tenantId null for admin events).
4. **Shadow-descend:** `/admin/tenants` → open `acme-navy-systems` → "Enter tenant / Manage". **Expect** an in-session role rewrite to `tenant_admin` in that tenant's RLS space. **Verify** `GET /api/auth/session` now shows `role=tenant_admin`, `tenantSlug=acme-navy-systems`, `membershipPinned=true`.

### B. `rfp_admin` — ingest → curate → release → shadow
1. Sign in `e2e-rfpadmin@rfppipeline.test`. **Expect** the admin surface (no tenant home).
2. **Ingest.** `/admin/intake` → upload ONE solicitation + N topic files → each topic becomes an **opportunity (OPP)**. **Expect** N OPPs created; a `finder.*` audit event per OPP. **Verify** `/admin/opportunities` lists them.
3. **Activate / push.** Approve an OPP (open+close dates required) → `solicitation.push` fans it onto the `opportunity_bridge` → tenant cards. **Expect** every activated tenant gets a `tenant_opportunity_cards` row (auto-scored). **Verify** the tenant sees it in `/portal/<slug>/cards`.
4. **Curate** (after a purchase lands — see §C.2). `/admin/rfp-curation` → the purchased portal is `curation_pending` with a **72h SLA ToDo**. Fill the **compliance matrix**, attach **molds/templates** to required items, confirm volumes. **Expect** the matrix + molds are ready to instantiate. **Verify** the ToDo shows on the admin queue; matrix rows saved.
5. **Release.** `/admin/purchases` (or the curation workspace) → **Release** the `curation_pending` portal → provisions the build **UNLOCKED**, instantiates the compliance matrix + molds from the master. **Expect** portal status → launched; a `capture.*`/provision event; the tenant's build is now buildable. **Verify** the tenant's `/portal/<slug>/proposals` shows the provisioned proposal, unlocked.
6. **Shadow into the tenant** to help build (same as §A.4) — you are now `tenant_admin` in acme-navy's space; proceed with §C.

### C. `tenant_admin` — the full customer build (the core)
Sign in `e2e-tadmin@acme-navy.test` → `/portal/acme-navy-systems`.
1. **Discover.** `/portal/acme-navy-systems/cards` (Spotlight). **Expect** ranked opportunity cards (bucket-scored). Open one; see the score transparency.
2. **Purchase.** On a pinned card → **Buy proposal portal** → enter comp code **`rfppipelinetest`**. **Expect** a `proposal_portals` row `curation_pending` (72h SLA) + a `capture:purchase.completed` event; the RFP admin gets a curation ToDo (§B.4). **Verify** `/portal/…/portals` shows "awaiting curation" with the countdown.
   - *(For the drive, the acme-navy proposal `3b0e7f8b` is ALREADY provisioned+unlocked — skip to step 4 to exercise the build without waiting on release.)*
3. **(after RFP admin releases)** The build appears provisioned + UNLOCKED with the matrix instantiated.
4. **Open the build.** `/portal/acme-navy-systems/proposals/3b0e7f8b-7ca2-4570-91d9-48326add00ff`. **Expect** sections + the compliance matrix + the AI Actions panel.
5. **Draft a section (AI-assist).** "Draft with AI". **Expect** empty sections queued for `section_drafter`; content lands in review (with a live key). **Verify** section version history shows an `ai_draft`.
6. **RUN FULL DRAFT** — the Proposal Draft Manager (see §5 for the deep dive). Pick a **Mode** (A/B/C), optional **Voice**, and — Mode C only — the **Adversarial gate**. Submit. **Expect** a `proposal.full_draft_requested` event; outputs land in **review-staged `canvas_versions`** (redlined, reversible); NO gate auto-advances. **Verify** the success banner + new section versions (source `ai_revision`).
7. **Review + Lock.** Review the staged canvas_versions; **Complete & Lock** a section. **Expect** the section locks → the **compliance matrix advances** for its item. **Verify** the matrix row flips to satisfied.
8. **Advance stage.** Review → Revise → Lock → Advance. **Expect** a `proposal.advanced` event; the stage label moves (e.g., V0.5 → V1). **Verify** stage in the header.
9. **Package + download.** Generate the submission package → **download** per-format (docx/pptx/xlsx/pdf). **Expect** `packaging_specialist` compiles a manifest across ALL volumes; downloads are real files. **Verify** the manifest lists every required volume; the .docx/.xlsx open.
10. **Library.** `/portal/acme-navy-systems/library` (or `/atoms`) → **upload a package → atomize → tag** → reuse atoms to ground a section (select-for-mold). **Expect** `library_atoms` + `atom_tags` + `atom_lineage`. **Verify** the atom picker shows them.
11. **Team + partner.** `/portal/acme-navy-systems/team` → invite `e2e-tuser@acme-navy.test` (tenant_user, scope grant) and `/vaults` → create a nook + invite `e2e-partner@ext.test` (partner_user). **Expect** invite events; the invitees can now sign in with scope. **Verify** §D and §E.
12. **Automation policy.** `/portal/acme-navy-systems/manage` (or `/automation`) → set a gate's policy (HITL vs auto, recipients, cadence). **Expect** `tenant_automation_policies` rows; the admin-floor chip is locked. **Verify** a subsequent gate honors it.

### D. `tenant_user` — scoped access
1. Sign in `e2e-tuser@acme-navy.test` → `/portal/acme-navy-systems`. **Expect** the permission-adaptive cockpit; only granted proposals/sections are actionable.
2. Open an assigned section → edit content. **Expect** save works within scope; locked/other sections are read-only. **Verify** an out-of-scope proposal 403s (never query-by-id).

### E. `partner_user` — vault / stage-scoped
1. Accept the invite (email link → `/invite`), sign in `e2e-partner@ext.test`. **Expect** landing at the nook/vault only (no tenant-wide access).
2. `/vaults/<nook>` → **upload** a file → **atomize** into the vault. **Expect** a `library:vault.artifact_uploaded` event + ONE HITL ToDo raised to the tenant_admin; content lands in the **nook** (RLS-isolated). **Verify** the tenant_admin sees the nook ToDo; the partner can **download the WHOLE artifact only** (not per-atom).
3. **Isolation check.** Attempt to reach `/portal/acme-navy-systems/...` → **Expect** denied (partner is vault-scoped, not tenant-scoped).

---

## 5. Proposal Draft Manager — the new flows (P4) in detail

Route: `POST /api/portal/[tenantSlug]/proposals/[proposalId]/full-draft` — the **sole producer**
of `proposal.full_draft_requested`. UI: the **"Run full draft"** panel on the proposal page
(tenant_admin+; covers the shadow-admin path). Body: `{ mode, voice?, adversarial?, adversarialPolicy? }`.

| Mode | Version | What runs | HITL landing |
|---|---|---|---|
| **A** | V0.1 | stage ranked atoms → merge (`section_drafter`) — you drive section-by-section | stage-review ToDo |
| **B** | V0.2 | controlled restyle (`stylist`) → re-scaffold (`formatter`); locking sets the style | style-lock ToDo |
| **C** | V0.5 | full auto: seed → draft → format → style → **cost_estimator** → **packaging** → gate cohort | full-draft review ToDo |

**Voice** (optional, narrative only): any of `passive · persuasive · technical · commercial ·
research · development` — re-voices the same atoms; cost/spec artifacts ignore it.

**Adversarial gate (Mode C only).** Tick **Adversarial gate** → the review-gate cohort
(`continuity_manager` + `traceability_auditor` + `redaction_guard`, optional `market_analyst`
pre-augment) is elevated to the reusable **AdvisoryOverlay**: a 1:n perspective-diverse fan-out →
`advisory_manager` reconcile (discrepancy → survival vote → remediation). Pick the **Landing**:
- **Human review** (`hitl`, default) → findings land in a review ToDo.
- **Auto-reconcile** (`auto`) → the reconciled verdict is recorded as an advisory audit event
  (`proposal.advisory_overlay_reconciled`), no human ToDo.

Either way the overlay is **advisory** — it never advances a gate; Mode C still ends in the
full-draft review ToDo. **Cost is exact:** `cost_estimator`'s `compute_budget` runs the
deterministic `proposal.budget_model` burden-waterfall (DL→fringe→OH→G&A→fee × PoP buckets), so
the cost sheet's dollars are audit-exact, never hallucinated.

**Drive it (tenant_admin / shadow):** proposal `3b0e7f8b` → "Run full draft" → **Mode C** +
tick **Adversarial gate** + **Auto-reconcile** → Submit. **Expect** the success banner names the
gate; a `proposal.full_draft_requested` (mode c, adversarial) event; then (with a live pipeline
key) staged canvas_versions + a `proposal.advisory_overlay_reconciled` audit row. **Verify** §6.

**Army/AF cross-pedigree** (use the immobileyes tenant for atom richness): assemble a section
from atoms whose lineage is a *different* agency, run Mode C + Adversarial → `continuity_manager`
(the overlay's fan-out target) flags the leaked non-customer agency reference as
incongruous-vs-intentional. This is the entity-reference integrity check, made 1:n adversarial.

---

## 5.5 Admin-plane triggers — the doorbell + the ingest manager (no portal descent)

The **admin-agent program (Phase 1)**: drive the (already-built) tenant engine from up top, advisory +
audited. Sign in as `e2e-master@rfppipeline.test` / `E2ETest!2026` (or any `rfp_admin`+). Canonical spec:
docs/ADMIN_AGENT_DESIGN.md; audit sweep: docs/EVENT_AUDIT_2026-08-02.md.

**A — Proposal Auto-Drive "doorbell" (fully clickable, verified live).**
1. `/admin/agents` → scroll to the **Proposal Auto-Drive (Doorbell)** card (under Agent Workforce).
   **Expect** a proposal dropdown populated across ALL tenants (`GET /api/admin/proposals`) + a Mode
   picker (A/B/C).
2. Pick a proposal (e.g. **Foundation — TVSF Round 45**), pick **Mode C**, click **Ring**. **Expect** a
   success banner ("Full draft (Mode C) requested. Drafts land in review…").
3. **Verify the audit landed, attributed to YOU as the admin:**
   ```bash
   psql "$DATABASE_URL" -c "SELECT phase,actor_email,payload->>'source' src,payload->>'mode' mode
     FROM system_events WHERE type='proposal.full_draft_requested' ORDER BY created_at DESC LIMIT 2;"
   # → start + end, actor_email=<you>, src=admin_doorbell, mode=c
   ```
   Then `/admin/events` → **Expect** the two `proposal.full_draft_requested` rows at the TOP of the Event
   Stream (`source=admin_doorbell`). This is the "keep tabs" surface — the ring is visible + attributed.
   *(The downstream drafting — OnFullDraftRequested Mode C running the agents — needs a live pipeline
   `ANTHROPIC_API_KEY`, same deploy-gate as every agent; the ring + audit fire regardless.)*
4. **Attribution contract:** a tenant-initiated full draft (the portal "Run full draft", §5) and this
   admin ring land the SAME event via one `requestFullDraft` helper — only `source` differs
   (`portal` vs `admin_doorbell`). Drive both and compare the two rows.

**B — `rfp_ingest_manager` (roster-visible; API/workflow-triggered — UI button pending).**
1. `/admin/agents` → the roster lists **RFP Ingest Manager** (Our-org — RFP-admin ops, `platform`, live).
2. Trigger an ingest-readiness assessment on a curated solicitation (API for now — no UI button yet):
   ```bash
   SID=$(psql "$DATABASE_URL" -tAc "SELECT id FROM curated_solicitations LIMIT 1")
   # from the browser devtools console (carries your admin cookie), or an authenticated client:
   #   fetch(`/api/admin/rfp-curation/${SID}/assess-ingest`, {method:'POST'}).then(r=>r.json())
   psql "$DATABASE_URL" -c "SELECT phase,actor_email FROM system_events
     WHERE type='ingest.assessment_requested' ORDER BY created_at DESC LIMIT 2;"   # → start + end
   ```
   **Expect** the `finder:ingest.assessment_requested` start/end pair. With a live pipeline key the
   `OnIngestAssessmentRequested` workflow runs `rfp_ingest_manager` → an advisory readiness plan +
   `agent_task_log` row (advisory, never mutates). **Verify** the agent's deterministic stage read runs
   over our own solicitations via `pipeline/tests/test_rfp_ingest_manager_wiring.py` (the live-drive test).

---

## 6. Verification hooks (assert any gate)

```bash
export DATABASE_URL='postgresql://claude@127.0.0.1:5433/govtech_intel'

# active membership/role of the logged-in browser session (fastest role assert):
curl -s http://localhost:3000/api/auth/session   # → role / tenantId / tenantSlug / membershipPinned

# recent audit events (namespace-scoped) — proves a gate fired:
psql "$DATABASE_URL" -c "SELECT namespace,type,phase,tenant_id,created_at FROM system_events ORDER BY created_at DESC LIMIT 20;"

# the full-draft / adversarial events specifically (payload.source = portal | admin_doorbell):
psql "$DATABASE_URL" -c "SELECT type,phase,actor_email,payload->>'source' src,payload->>'mode' mode,payload->>'adversarial' adv FROM system_events WHERE type LIKE 'proposal.full_draft_requested' OR type LIKE 'proposal.advisory_overlay%' ORDER BY created_at DESC LIMIT 10;"

# admin-agent triggers (the doorbell ring + the ingest-manager assessment):
psql "$DATABASE_URL" -c "SELECT type,phase,actor_email,payload->>'source' src FROM system_events WHERE type IN ('proposal.full_draft_requested','ingest.assessment_requested') ORDER BY created_at DESC LIMIT 10;"

# parked HITL ToDos by assignee (who owes an action):
psql "$DATABASE_URL" -c "SELECT task_type,assignee_role,status,entity_ref FROM tasks WHERE status IN ('open','pending') ORDER BY created_at DESC LIMIT 20;"

# proposal + matrix + lock state:
psql "$DATABASE_URL" -c "SELECT id,stage,is_locked FROM proposals WHERE id='3b0e7f8b-7ca2-4570-91d9-48326add00ff';"
psql "$DATABASE_URL" -c "SELECT status,count(*) FROM proposal_compliance_matrix WHERE proposal_id='3b0e7f8b-7ca2-4570-91d9-48326add00ff' GROUP BY status;"
```

---

## 7. Automated coverage (Playwright)

Run from `frontend/` (see the specs under `frontend/e2e/`):

```bash
cd frontend
TEST_BASE_URL=http://localhost:3000 npx playwright test --project=hitl   # self-authenticating HITL specs
# or individually:
npx playwright test e2e/hitl-role-smoke.spec.ts  # all 5 roles authenticate + carry the right role
npx playwright test e2e/hitl-deep-sweep.spec.ts  # every actor reaches its surfaces + F2/F6 fix proofs
npx playwright test e2e/hitl-full-draft.spec.ts  # the full-draft route incl. Mode C + adversarial
```

- **`hitl-role-smoke`** — logs in as each of the 5 e2e-* accounts and asserts the session role
  (+ tenant scope) — the role-routing contract for every actor. *(Verified 5/5, 2026-08-01.)*
- **`hitl-deep-sweep`** — the multi-actor surface sweep: logs in as master / rfp / tenant_admin
  (Foundation) / tenant_user / partner and walks **29 surfaces** (admin + portal + vault), asserting
  none 500 / blank / auth-bounce; **plus the two UI-observable fixes** — F2 (Foundation TVSF section
  rehydrates its saved content) and F6 (`/admin/agents` lists the full 36-archetype roster incl. the
  P1–P4 cohort, with one marked dormant). *(Verified 5/5, 2026-08-01.)*
- **`hitl-full-draft`** — as tenant_admin, asserts the "Run full draft" panel is reachable and
  drives the full-draft route (Mode C + adversarial auto, Mode A ignores it, bad mode → 400).

The unit/contract layer already covers the internals: `frontend/__tests__/full-draft.test.ts`
(portal route + adversarial threading), **`frontend/__tests__/admin-doorbell.test.ts`** (the admin
doorbell: rfp_admin+ gate, cross-tenant resolve, `source=admin_doorbell` emission — 6/6), and pipeline
`test_budget_model` / `test_advisory_gate` / `test_p5_scenario_proof` (cost math, overlay landing,
SBIR + Army/AF wiring) + **`test_rfp_ingest_manager_wiring.py`** (the ingest manager: registration,
action map, injection fence, guardrail landing, + a live drive over our own solicitations — 7/7).

---

## 8. Reset / re-run

`node scripts/seed-e2e-hitl.mjs` is idempotent — re-run any time to re-assert the cohort + refresh
the tenant's cards. It creates only `e2e-*` accounts and deletes nothing. To rebuild the whole DB,
re-run the migrations then this seed (§1).
