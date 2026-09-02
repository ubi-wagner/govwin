# Stage 1: deps
FROM node:20-alpine AS deps
WORKDIR /app
# PDF export uses a SYSTEM Chromium (installed via apk in the runner stage), not
# Playwright's downloaded browsers — skip the ~400MB browser download during install.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
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
# System Chromium for PDF export (lib/export/pdf-exporter.ts launches it via Playwright).
# playwright/playwright-core ride along in the standalone bundle (serverExternalPackages);
# the browser binary + font/render deps come from apk. --no-sandbox is set at launch time
# (the app runs as the non-root `nextjs` user). PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD avoids a
# redundant browser download; the exporter also auto-detects /usr/bin/chromium* as a fallback.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium-browser
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/postgres ./node_modules/postgres
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/bcryptjs ./node_modules/bcryptjs
# playwright/playwright-core are serverExternalPackages (not webpack-bundled); copy them
# explicitly so PDF export can `import('playwright')` at runtime. Self-contained
# (playwright → playwright-core → no further deps); the browser itself is system chromium (apk above).
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/playwright ./node_modules/playwright
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/playwright-core ./node_modules/playwright-core

# The guide-coverage registry, shipped the same way the migration SQL is: GENERATED IN THE REPO,
# copied in. `/admin/guides` reads it at runtime, and it cannot be produced here — the builder stage
# copies only `frontend/`, and the script needs a git history the image does not have. Without this
# line the board renders its "artifact is not in this build" notice in production: honest, but dead.
# Regenerate with `node frontend/scripts/catalog-guides.mjs` and commit it.
COPY --chown=nextjs:nodejs docs/guide-coverage.json ./docs/guide-coverage.json

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
