# Session Handoff — start here next session (written 2026-07-13 EOD)

Read this first, then `docs/ALPHA_HITL_RUNBOOK.md` + `docs/HITL_IMMOBILEYES_CLICKPLAN.md`.
Plan for tomorrow: **Eric merges + deploys in the morning, we level-set, then drive the whole
loop end-to-end together.** This note is the orchestration layer over the runbook — it exists so a
fresh context doesn't re-investigate anything we already settled.

---

## 0. State as of tonight (facts, not memory)
- Branch `claude/nice-hamilton-kBqtD`, tip **`1ff061e`**, pushed, **49 commits ahead of `origin/main`**.
- `npx tsc --noEmit` → **exit 0** (frontend). Migrations on disk through **104** (`migrate.mjs` auto-applies).
- Core loop verified green in-sandbox (the Immobileyes rehearsal). Nothing on the core loop is half-written.
- **The container is ephemeral** — the local Postgres + scratchpad from today are probably GONE by morning.
  Any state we need is either committed in the repo or must be rebuilt from scratch (crib in §5). Don't
  waste time hunting for today's `mvp_e2e`/scratch DB — assume clean-slate.

## 1. Morning sequence (in order)
1. **Eric: merge the branch → deploy.** (My job is not to merge; wait for the deploy target to be live.)
2. **Level-set** on the two open decisions in §4 before we start clicking.
3. **Pre-flight the config gates in §2** on the deploy target — this is where the run dies if skipped.
4. **Drive the runbook T1→T6** together (`ALPHA_HITL_RUNBOOK.md §3`); the Immobileyes-specific
   click/perform/expect table is `HITL_IMMOBILEYES_CLICKPLAN.md`. I capture URL + status + `error`/`code`
   for any FAIL and file it against `ALPHA_TODO_BACKLOG.md`.

## 2. Pre-flight config gates (the run dies here if missed)
Two are **hard** (a step visibly fails without them), the rest are correctness:
- **[HARD] Real S3 / R2 creds** — `AWS_S3_BUCKET_NAME` (+ keys/region/endpoint). Absent → any storage
  route 500s at import, and `rfp-upload` 500s `STORAGE_ERROR` *after* creating the opp (orphans a
  zero-doc solicitation — backlog B2). Kills clickplan step 3 / runbook T3.7.
- **[HARD] Python pipeline worker running** (`cd pipeline && python src/main.py`, needs `DATABASE_URL`,
  `ANTHROPIC_API_KEY`, `API_KEY_ENCRYPTION_SECRET` = frontend's). Absent → no `process_instances` /
  workflow automation (runbook T6.22) and no live AI draft.
- `ANTHROPIC_API_KEY` on **both** frontend and pipeline — gates AI draft + compliance/color-team agents.
  Provision still interpolates the template mold without it; only the live-draft button needs it.
- `NEXTAUTH_URL` (= `AUTH_URL`) — else post-login / invite / Stripe redirects go to localhost.
- `AUTH_SECRET` / `NEXTAUTH_SECRET`, `DATABASE_URL` (pgvector + `CREATE EXTENSION` on the role).
- Email creds are **optional** — Accept returns the temp password inline with an `emailError` flag, so
  onboarding still completes without an email provider.
- Stripe price IDs use the **code's** names (`STRIPE_SPOTLIGHT_PRICE_ID`, `STRIPE_PROPOSAL_P1_PRICE_ID`)
  — only needed once self-serve purchase ships; the Alpha admin-provisioned path skips Stripe entirely.
- Health check before clicking: `GET /api/health` 200 (DB+S3 reachable); pipeline `:8080/health` ok;
  `SELECT max(filename) FROM _migration_history` = `104_…`.

## 3. DO NOT re-investigate — already settled (highest-value section)
If any of these resurfaces, it's known; apply the resolution, don't re-derive it:
- **"Unverified" commit badge** = sandbox has **no functional signing key** (`commit.gpgsign=true`,
  `gpg.format=ssh`, but the key file is a 0-byte placeholder; no private key / ssh-agent / ssh-keygen).
  A probe commit also came out unsigned. Identity is already correct on all commits (committer+author
  `noreply@anthropic.com`, name `Claude`). **Do NOT rewrite history to "re-sign"** — it changes every hash,
  force-pushes, and the commits come out unsigned anyway. Only fix = register a signing key on the GitHub
  account (Eric's call) or accept it as cosmetic. Eric said **leave it**.
- **jsonb string-scalar bug** — `${JSON.stringify(x)}::jsonb` stores a jsonb *string scalar* (objects AND
  arrays; `col->>'k'` → NULL). FIXED: 56 writes → `sql.json`, mig 104 backfills old rows. Rule: write via
  `${sql.json(x)}` / `${tx.json(x)}`; read via `coerceJsonb`. CLIFFNOTES Mistake #39. Don't reopen the debate —
  it was proven by round-trip (`jsonb_typeof=string` vs `object`), which is why we trust the fix over reasoning.
- **`${cond ? 't':'f'}::bool` silent no-op** — bound text `'t'` ≠ SQL literal, evaluates FALSE. FIXED to raw
  `${cond}` across the volume/topic update tools + routes. CLIFFNOTES Mistake #40.
- **`solicitation_compliance` has no `UNIQUE(solicitation_id)`** → upsert must be a plain INSERT, not
  `ON CONFLICT (solicitation_id)`. Set `submission_format` before push or it 422s "compliance variables missing".
- **Phantom `tenant_memberships`** table — doesn't exist; membership is `users.tenant_id`. Already fixed in lock route.
- **Advance auto-locks** — advancing draft→final sets `submitted` + `lock_count=1`, so a redundant
  proposal `/lock` afterward returns 409. That 409 is expected, not a bug.
- **`STORAGE_ROOT=/data`** in pipeline config is DEAD — storage is R2/S3, no `/data` volume.

## 4. Open decisions to level-set on (ask Eric in the morning)
1. **Deploy target for the E2E** — Railway prod-like, or a fresh sandbox stack? (Changes whether we use
   the runbook Option A vs B env list, and whether real S3/ANTHROPIC keys are already set.)
2. **S3/R2** — are real bucket creds available for the run? If not, we knowingly skip the doc-storage steps
   (rfp-upload store, pin→copy) and note them, rather than chasing the 500.
3. **Which company** — re-run as Immobileyes (matches the clickplan verbatim), or a fresh applicant to test
   the cold apply→accept path again?

## 5. Fast-boot crib (only if we run a fresh sandbox stack — else skip to the deploy)
```
# Postgres (pgvector) up, fresh DB, then from repo root with DATABASE_URL exported:
node db/migrations/migrate.mjs                       # applies 000→108, tracked in _migration_history
node scripts/seed_dev_accounts.mjs                   # 2 tenants + admins (idempotent)
psql "$DATABASE_URL" -f scripts/e2e_fixtures.sql     # optional demo opps/atoms
node scripts/seed_collateral_templates.mjs           # 4 marketing canvas templates into the admin library
cd frontend && npm ci && npx next build && npx next start -p 3000   # + env from §2
cd pipeline && python src/main.py                    # the worker (AI draft + workflow instances)
```
Reset between runs: `dropdb && createdb && migrate.mjs && seed_dev_accounts && e2e_fixtures.sql` (runbook §5).

## 6. Doc map (what to open for what)
- `ALPHA_HITL_RUNBOOK.md` — the T1→T6 end-to-end script with PASS/FAIL boxes + the §4 known-issue watchlist.
- `HITL_IMMOBILEYES_CLICKPLAN.md` — the 15-row click/perform/expect table (what was already verified green).
- `LAUNCH_READINESS_ZERODAY_2026-07-13.md` — the one-page readiness verdict (what's green, the gates, the badge).
- `ALPHA_TODO_BACKLOG.md` — everything descoped for Alpha (Stripe self-serve, scout scheduler, PDF, B1–B4, etc.).
- `ALPHA_ARCHITECTURE_ASBUILT.md` — the as-built system/file tree. `CLAUDE_CLIFFNOTES.md` — schema + Mistakes #1–40.

**One-line status for the top of tomorrow:** core loop is green and type-clean; the only things between us and
a full end-to-end pass are the two config gates (S3 creds + pipeline worker) and picking the deploy target. Let's go.
