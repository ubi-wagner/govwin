.PHONY: up down migrate seed dev type-check shell-db test

up:
	docker compose up -d

down:
	docker compose down

migrate:
	@for f in db/migrations/*.sql; do \
		echo "Running $$f..."; \
		docker compose exec -T db psql -U govtech -d govtech_intel -f /dev/stdin < $$f; \
	done

seed:
	cd frontend && npx tsx scripts/seed_admin.ts

dev:
	cd frontend && npm run dev

type-check:
	cd frontend && npx tsc --noEmit

shell-db:
	docker compose exec db psql -U govtech -d govtech_intel

test:
	bash scripts/test-all.sh
