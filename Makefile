# RFP Pipeline SaaS — Developer Makefile
#
# Pre-V2 parity restoration: `migrate`, `railway-vars`, `shell-db` targets
# are back. See RAILWAY.md for the full deployment runbook.

.PHONY: up down migrate seed dev type-check shell-db test railway-vars

# ---------------------------------------------------------------------
# Local dev stack
# ---------------------------------------------------------------------
up:
	docker compose up -d

down:
	docker compose down

# ---------------------------------------------------------------------
# Database migrations
# ---------------------------------------------------------------------
# Applies all pending migrations in db/migrations/ via the tracking-table
# runner. Respects $DATABASE_URL — so you can run this against the local
# docker-compose db (default) OR against the Railway Postgres by:
#
#     DATABASE_URL=<railway-postgres-url> make migrate
#
# Idempotent (via _migration_history tracking table + per-file checksums).
# 000_drop_all.sql is skipped by default; set ALLOW_SCHEMA_RESET=true to
# allow it during V1 pre-launch clean-builds.
migrate:
	chmod +x ./db/migrations/run.sh && ./db/migrations/run.sh

# ---------------------------------------------------------------------
# Seed the initial admin (legacy — 001_baseline.sql now handles this)
# ---------------------------------------------------------------------
# NOTE: As of the rebaseline PR, the master_admin user is created by
# 001_baseline.sql directly (idempotent INSERT ... ON CONFLICT DO NOTHING)
# so this target is usually NOT needed on fresh deploys. It remains for
# cases where you want to create a different admin user via the
# interactive scripts/seed_admin.ts helper.
seed:
	cd frontend && npx tsx ../scripts/seed_admin.ts

# ---------------------------------------------------------------------
# Dev servers
# ---------------------------------------------------------------------
dev:
	cd frontend && npm run dev

type-check:
	cd frontend && npx tsc --noEmit

test:
	bash scripts/test-all.sh

# ---------------------------------------------------------------------
# DB shell (works locally AND against Railway — whatever $DATABASE_URL is)
# ---------------------------------------------------------------------
shell-db:
	psql "$$DATABASE_URL"

# ---------------------------------------------------------------------
# Railway environment variable quick reference
# ---------------------------------------------------------------------
# Prints which env vars need to be set on which Railway service.
# Run `make railway-vars` any time you spin up a new Railway deploy.
railway-vars:
	@echo ""
	@echo "=== Railway Environment Variables ==="
	@echo ""
	@echo "BOTH services (frontend + pipeline):"
	@echo "  DATABASE_URL             auto-injected by the Postgres plugin"
	@echo ""
	@echo "FRONTEND service (govtech-frontend):"
	@echo "  AUTH_SECRET              openssl rand -base64 32"
	@echo "  AUTH_URL                 https://your-app.up.railway.app"
	@echo "  NEXT_PUBLIC_APP_URL      https://your-app.up.railway.app"
	@echo "  API_KEY_ENCRYPTION_SECRET  openssl rand -hex 32"
	@echo "  RESEND_API_KEY           from resend.com (renamed from AUTH_RESEND_KEY)"
	@echo "  EMAIL_FROM               noreply@yourdomain.com"
	@echo "  STRIPE_SECRET_KEY        from dashboard.stripe.com"
	@echo "  STRIPE_WEBHOOK_SECRET    from Stripe webhook endpoint config"
	@echo "  STRIPE_PRICE_FINDER      from Stripe product catalog"
	@echo "  STRIPE_PRICE_PHASE1      from Stripe product catalog"
	@echo "  STRIPE_PRICE_PHASE2      from Stripe product catalog"
	@echo ""
	@echo "PIPELINE service:"
	@echo "  SAM_GOV_API_KEY          from sam.gov profile"
	@echo "  ANTHROPIC_API_KEY        from console.anthropic.com"
	@echo "  CLAUDE_MODEL             claude-sonnet-4-20250514"
	@echo "  API_KEY_ENCRYPTION_SECRET  must match the frontend value"
	@echo "  STORAGE_ROOT             /data (pipeline volume mount)"
	@echo ""
	@echo "BOTH services (auto-injected by Railway when the bucket is linked):"
	@echo "  AWS_ACCESS_KEY_ID        bucket credentials"
	@echo "  AWS_SECRET_ACCESS_KEY    bucket credentials"
	@echo "  AWS_DEFAULT_REGION       auto"
	@echo "  AWS_ENDPOINT_URL         https://t3.storageapi.dev"
	@echo "  AWS_S3_BUCKET_NAME       rfp-pipeline-prod-<hash>"
	@echo ""
	@echo "GitHub Actions secret (required for the migrate.yml workflow):"
	@echo "  DATABASE_URL             same as the Railway Postgres URL"
	@echo ""
	@echo "See RAILWAY.md for the full deployment runbook."
