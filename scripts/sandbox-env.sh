#!/usr/bin/env bash
# The sandbox environment, in the repo where it survives a container restart.
#
# WHY THIS FILE EXISTS. This lived at /tmp/govwin-sandbox/env.sh and the container restart took it
# — along with the local storage root at /tmp/govwin-storage and several hours of the local git
# checkout. Recovering it cost real time twice in one day, and it is the same /tmp ephemerality
# that had already broken pipeline/tests/test_crypto.py (see that file's docstring). Third strike:
# nothing the run depends on lives in /tmp any more.
#
# There are no production secrets here. These are the sandbox's own throwaway credentials, which is
# why the file can sit in the repo; a real deployment gets its values from the platform.
#
#   source scripts/sandbox-env.sh
#
# The two roles matter and are not interchangeable (docs/RLS_CUTOVER.md):
#   DATABASE_URL        govtech_app — NOBYPASSRLS. What the FRONTEND runs as, and what any test of
#                       tenant-scoped behaviour must run as, or RLS is not being tested.
#   DATABASE_URL_OWNER  govtech     — the owner. Migrations, bootstrap, legitimate cross-tenant
#                       admin reads, and the PIPELINE worker (whose own role, rfp_agent, is still
#                       deploy-gated). Platform-scope rows (tenant_id IS NULL) are only writable
#                       here, which is why the workflow engine needs it.

export DATABASE_URL="postgresql://govtech_app:apppass@localhost:5432/govtech_intel"
export DATABASE_URL_OWNER="postgresql://govtech:changeme@localhost:5432/govtech_intel"

# The CRM's own database. It was ABSENT from every sandbox until 2026-08-26, which is why no
# instrument in this repo had ever measured the CRM — a lens that cannot connect reports
# nothing, and nothing reads exactly like a pass (docs/CRM_ANALYSIS.md §0).
#
#   createdb -O govtech cms_postgres && bash services/cms/db/run.sh
export CMS_DATABASE_URL="postgresql://govtech:changeme@localhost:5432/cms_postgres"
# The bridge the CRM uses to reach the MAIN database. Note the role: migration 215 denies
# writes to email_send_ledger on the app role, so a non-owner here makes every CRM send run
# degraded (docs/CRM_MIGRATION_PLAN.md, last section).
export SHARED_DATABASE_URL="$DATABASE_URL_OWNER"

# The admin password, in ONE place. sandbox-reset-passwords.mjs WRITES $SANDBOX_PASSWORD; eighteen
# driver scripts READ $RFP_ADMIN_PW / $ADMIN_PW / $DRIVE_ADMIN_PW, each with its own hardcoded
# default of 'RFPAdmin2026!' — a value nothing sets any more. On a fresh sandbox that mismatch
# surfaces as a bare `/login?error=invalid` redirect and a 60s Playwright timeout, which reads like
# a broken auth flow rather than a wrong constant. Deriving the aliases from the one variable means
# the writer and the readers cannot disagree.
export SANDBOX_PASSWORD="${SANDBOX_PASSWORD:-SandboxDrive2026!}"
export RFP_ADMIN_PW="$SANDBOX_PASSWORD"
export ADMIN_PW="$SANDBOX_PASSWORD"
export DRIVE_ADMIN_PW="$SANDBOX_PASSWORD"

# A SEPARATE, THROWAWAY database for the DB-dependent pytest suite. Not optional, and not the same
# database as above: those tests clean up with unscoped statements like
# `DELETE FROM system_events WHERE namespace='finder'`. Pointed at the sandbox that deletes real
# audit history, and the deletes that DON'T fail on a foreign key are the ones that do damage. It
# also skews every count the drive scripts measure.
#
# Without this set, the ~257 DB-dependent tests SKIP — so the suite reports green while the half
# that touches Postgres never ran. Create it once with:
#   psql "$DATABASE_URL_OWNER" -c 'CREATE DATABASE govtech_test OWNER govtech'
#   ALLOW_SCHEMA_RESET=true DATABASE_URL="$TEST_DATABASE_URL" node db/migrations/migrate.mjs
export TEST_DATABASE_URL="postgresql://govtech:changeme@localhost:5432/govtech_test"

export AUTH_SECRET="sandbox-auth-secret-do-not-use-in-production-0000"
export AUTH_TRUST_HOST="true"
export NEXTAUTH_URL="http://localhost:3000"
export AUTH_URL="http://localhost:3000"

# WHERE THE APP IS — stated ONCE, because it was stated twice and the two disagreed.
#
# The four lenses (verify-surfaces / -api-contract / -db-crud / -ui-vs-db) each defaulted to
# http://localhost:3001, while every other harness — scripts/lib/cross-company.mts,
# capture-guides.mjs — and NEXTAUTH_URL/AUTH_URL above all say 3000, which is the port the sandbox
# actually serves on. So on a standard box the entire four-lens backbone died on
# `net::ERR_CONNECTION_REFUSED at http://localhost:3001/login` before it measured one surface.
#
# That is the worst shape a rig failure can take: the lenses are what CLAUDE.md points at for "does
# the customer-facing surface actually render", and a connection refused at the login page looks
# like a broken box rather than an unrunnable check. Exporting it here gives the value one
# definition that every harness reads, instead of six defaults to keep in agreement.
#
# Override for a box serving elsewhere: GUIDE_BASE=http://localhost:3001 <cmd>
export GUIDE_BASE="${GUIDE_BASE:-http://localhost:3000}"

# Emulated Claude: EMULATE=1 points the SDK at the local test harness so every AI-gated flow runs
# end to end with no live key, mirroring the production wiring exactly (docs/AI_FLOWS_PROOF.md).
export EMULATE="1"
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
export ANTHROPIC_API_KEY="emulated-claude"

# Dependency-free local-hash embedder — gated; keeps semantic retrieval live without a provider.
export ATOM_EMBED="local"

# Object storage: the local filesystem driver standing in for R2. NOT under /tmp any more.
export STORAGE_DRIVER="local"
export LOCAL_STORAGE_DIR="/home/user/.govwin/storage"

export API_KEY_ENCRYPTION_SECRET="sandbox-api-key-encryption-secret-32bytes!"
export NODE_ENV="production"
export PLAYWRIGHT_BROWSERS_PATH="/opt/pw-browsers"
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD="1"

# Cron-endpoint auth + the sweeps the pipeline pokes over HTTP. Both endpoints already accept
# `Authorization: Bearer $CRON_SECRET`; without the URL set, each poker logs once and stays inert,
# so the sandbox mirrors a deploy that has not configured them. The reconcile sweep is what heals a
# tenant that never opens its feed — the customer feed read-repairs only for a tenant that VISITS.
export CRON_SECRET="sandbox-cron-secret-not-a-production-value"
export CARD_RECONCILE_URL="http://localhost:3000/api/admin/reconcile-cards"
# AGENT_GATE_SWEEP_URL is deliberately left UNSET here: TW-8 auto-advance ships inert until a deploy
# opts in (docs/LAUNCH_READINESS_2026-08.md), and the sandbox should show that default, not hide it.

# Durable working directory for run artifacts (logs, captures, PID files).
export GOVWIN_RUN_DIR="/home/user/.govwin/run"

# ── Drive credentials — ONE source, because two disagreed and it cost a run ──────────────────────
#
# scripts/sandbox-reset-passwords.mjs sets the seeded admin accounts to SANDBOX_PASSWORD, and the
# self-heal calls it on every repair. Every drive script and e2e spec, meanwhile, defaulted to a
# DIFFERENT literal ('RFPAdmin2026!') — 48 sites of it. So the sandbox healing itself silently
# invalidated every admin drive, and the symptom was `?error=invalid` on a login that had worked
# twenty minutes earlier. Diagnosing that from the symptom is expensive; it looks like a broken
# product, not a rotated password.
#
# All 48 sites already read process.env.RFP_ADMIN_PW before their literal, so exporting it here
# fixes all of them at once and makes the reset script the single authority. The literals stay as
# a last-resort default for anyone running a script without sourcing this file.
export SANDBOX_PASSWORD="${SANDBOX_PASSWORD:-SandboxDrive2026!}"
export RFP_ADMIN_PW="${RFP_ADMIN_PW:-$SANDBOX_PASSWORD}"
# lighthouse is NOT in the reset script's target list, so it keeps its seeded password.
export LIGHTHOUSE_PW="${LIGHTHOUSE_PW:-LighthouseAdmin}"
# …and LIGHTHOUSE_PW belongs to `eric@lighthouse.com` ONLY. The lighthouse COLLABORATOR is a
# different account with a different seeded password (`seed_dev_accounts.mjs`: COLLAB_PW), and this
# file exported the first without the second — so a harness reaching for "the lighthouse password"
# found one that does not open the collaborator account and died at the login form. That cost the
# UI atlas its whole `/vaults` lane, which is the only surface a vault-only partner can see.
export COLLAB_PW="${COLLAB_PW:-CollabPass1}"
export TENANT_PW="${TENANT_PW:-DemoPass123!}"
# The lighthouse tenant_admin is driven by BOTH suites and they resolved its password differently —
# the branch drives via passwordFor()/TENANT_PW, e2e/auth.setup.ts via LIGHTHOUSE_PW. Pointing the
# second at the first means running one suite cannot silently break the other.
export LIGHTHOUSE_PW="${LIGHTHOUSE_PW:-$TENANT_PW}"

mkdir -p "$LOCAL_STORAGE_DIR" "$GOVWIN_RUN_DIR" 2>/dev/null || true

# e2e/hitl-foundation-build.spec.ts asserts `TVSF_OPP env must be set` before it does anything, so
# without this the spec fails in 200ms and looks like a broken comp-purchase flow. It is the TVSF
# Round-45 opportunity that migration 143 seeds and that hitl-foundation-ui-walk hardcodes; keeping
# it here means the two specs cannot drift onto different opportunities.
export TVSF_OPP="d53a22e4-792d-4fe7-8253-a42270fd9981"

# The proposal-creation paywall is FAIL-SAFE: lib/paywall.ts enforces it unless a deploy explicitly
# opts out, so /proposals/create returns 402 PAYMENT_REQUIRED by default. This sandbox mirrors the
# product's current posture — self-serve Stripe checkout is descoped and the comp code stands in —
# which is exactly the founding-cohort case the flag exists for. Without it, e2e/matrix.tenant fails
# on a 402 while its own header says it drives "the admin-granted provision path (no Stripe)".
export FOUNDING_COHORT_BYPASS="true"
