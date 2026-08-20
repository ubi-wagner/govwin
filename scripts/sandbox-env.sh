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

export AUTH_SECRET="sandbox-auth-secret-do-not-use-in-production-0000"
export AUTH_TRUST_HOST="true"
export NEXTAUTH_URL="http://localhost:3000"
export AUTH_URL="http://localhost:3000"

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

# Durable working directory for run artifacts (logs, captures, PID files).
export GOVWIN_RUN_DIR="/home/user/.govwin/run"

mkdir -p "$LOCAL_STORAGE_DIR" "$GOVWIN_RUN_DIR" 2>/dev/null || true
