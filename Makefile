# GovTech Intel v3
.PHONY: up down migrate seed dev type-check railway-vars

up:
	docker compose up -d

down:
	docker compose down

migrate:
	chmod +x ./db/migrations/run.sh && ./db/migrations/run.sh

seed:
	cd frontend && npx tsx ../scripts/seed_admin.ts

dev:
	cd frontend && npm run dev

type-check:
	cd frontend && npm run type-check

shell-db:
	psql "$$DATABASE_URL"

railway-vars:
	@echo ""
	@echo "=== Railway Environment Variables ==="
	@echo ""
	@echo "BOTH services (frontend + pipeline):"
	@echo "  DATABASE_URL          auto-injected when you link Postgres plugin"
	@echo ""
	@echo "FRONTEND service:"
	@echo "  AUTH_SECRET           openssl rand -base64 32"
	@echo "  AUTH_URL              https://your-app.up.railway.app"
	@echo "  AUTH_RESEND_KEY       from resend.com"
	@echo "  EMAIL_FROM            noreply@yourdomain.com"
	@echo "  NEXT_PUBLIC_APP_URL   https://your-app.up.railway.app"
	@echo ""
	@echo "PIPELINE service:"
	@echo "  SAM_GOV_API_KEY       from sam.gov profile"
	@echo "  ANTHROPIC_API_KEY     from console.anthropic.com"
	@echo "  CLAUDE_MODEL          claude-sonnet-4-20250514"
	@echo "  DOCUMENT_STORE_PATH   /app/docs"
