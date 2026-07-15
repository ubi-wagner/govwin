# Stage 1: deps
FROM node:20-alpine AS deps
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --frozen-lockfile

# Stage 2: build
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ .
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
RUN npm run build

# Stage 3: runner
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/postgres ./node_modules/postgres
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/bcryptjs ./node_modules/bcryptjs

# Migration files + entrypoint — run automatically on deploy
COPY --chown=nextjs:nodejs db/migrations/*.sql ./db/migrations/
COPY --chown=nextjs:nodejs db/migrations/migrate.mjs ./db/migrations/migrate.mjs
# Dev/test account seed — shipped so entrypoint can run it after migrations when
# SEED_DEV_ACCOUNTS=true (opt-in; never runs in prod unless explicitly enabled).
COPY --chown=nextjs:nodejs scripts/seed_dev_accounts.mjs ./scripts/seed_dev_accounts.mjs
# Marketing page-content seed + its build-time snapshot (PAGE_SEEDS → JSON, produced
# by the builder's prebuild). Entrypoint runs it after migrations when
# SEED_PAGE_CONTENT=true to sync content_pages from code.
COPY --chown=nextjs:nodejs scripts/seed_page_content.mjs ./scripts/seed_page_content.mjs
COPY --from=builder --chown=nextjs:nodejs /app/lib/page-content/page-seeds.generated.json ./scripts/page-seeds.generated.json
COPY --chown=nextjs:nodejs frontend/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nextjs
EXPOSE 3000
CMD ["./entrypoint.sh"]
