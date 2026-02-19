# Railway Deployment Guide

Complete step-by-step to get govtech-intel-v3 live on Railway.

---

## What You're Deploying

```
Railway Project: govtech-intel
├── Postgres plugin     ← pgvector-enabled, Railway manages it
├── govtech-frontend    ← Next.js, built from /frontend/Dockerfile
└── govtech-pipeline    ← Python worker, built from /pipeline/Dockerfile
```

One GitHub repo → two services. One push deploys both.

---

## Step 1 — Push to GitHub

```bash
cd govtech-intel-v3

git init
git add .
git commit -m "feat: initial scaffold — multi-tenant govtech intel v3"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

---

## Step 2 — Create Railway Project

1. Go to railway.app → **New Project**
2. Choose **Deploy from GitHub repo**
3. Select your repo → Railway will auto-detect and start a deploy
4. **Cancel the initial deploy** — you need to configure services first

---

## Step 3 — Add Postgres Plugin

1. In your Railway project, click **+ New** → **Database** → **Add PostgreSQL**
2. Railway creates a managed Postgres instance
3. Click the Postgres service → **Connect** tab → copy the `DATABASE_URL`

**Enable pgvector:**
1. Click the Postgres service → **Query** tab (or connect via psql)
2. Run: `CREATE EXTENSION IF NOT EXISTS vector;`
3. Run: `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`
4. Run: `CREATE EXTENSION IF NOT EXISTS pgcrypto;`

---

## Step 4 — Configure the Frontend Service

Railway will have created one service from your repo auto-detect.
Rename it to `govtech-frontend`.

**Settings → Build:**
- Builder: `Dockerfile`
- Dockerfile path: `frontend/Dockerfile`
- Build context: `frontend`  ← important, must be the subdirectory

**Settings → Deploy:**
- Start command: leave empty (Dockerfile CMD handles it)
- Health check path: `/api/health`  ← we'll add this endpoint

**Variables tab — add all of these:**

| Variable | Value |
|---|---|
| `DATABASE_URL` | Click **+ Reference** → select your Postgres plugin |
| `AUTH_SECRET` | Run `openssl rand -base64 32` locally, paste result |
| `AUTH_URL` | `https://YOUR-APP.up.railway.app` (get URL after first deploy) |
| `AUTH_RESEND_KEY` | From resend.com → API Keys |
| `EMAIL_FROM` | `noreply@yourdomain.com` (or your Resend verified domain) |
| `NEXT_PUBLIC_APP_URL` | `https://YOUR-APP.up.railway.app` |
| `NODE_ENV` | `production` |

---

## Step 5 — Add Pipeline Service

1. In your Railway project → **+ New** → **GitHub Repo** → same repo
2. Railway creates a second service — rename to `govtech-pipeline`

**Settings → Build:**
- Builder: `Dockerfile`
- Dockerfile path: `pipeline/Dockerfile`
- Build context: `pipeline`

**Settings → Deploy:**
- Start command: leave empty (CMD in Dockerfile handles it)
- **Disable health checks** — this is a worker, not a web server
  - Settings → Health checks → toggle off

**Variables tab:**

| Variable | Value |
|---|---|
| `DATABASE_URL` | **+ Reference** → Postgres plugin |
| `SAM_GOV_API_KEY` | Your SAM.gov API key (or leave blank until you have it) |
| `ANTHROPIC_API_KEY` | From console.anthropic.com |
| `CLAUDE_MODEL` | `claude-sonnet-4-20250514` |
| `DOCUMENT_STORE_PATH` | `/app/docs` |
| `UPLOAD_STORE_PATH` | `/app/uploads` |
| `LOG_LEVEL` | `INFO` |

---

## Step 6 — Run Migrations

After both services deploy successfully (green), run migrations via Railway CLI:

**Option A: Railway CLI (recommended)**
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to your project
cd govtech-intel-v3
railway link

# Run migrations via the pipeline service's environment
railway run --service govtech-pipeline \
  psql "$DATABASE_URL" -f db/migrations/001_auth_tenants.sql
railway run --service govtech-pipeline \
  psql "$DATABASE_URL" -f db/migrations/002_control_plane.sql
railway run --service govtech-pipeline \
  psql "$DATABASE_URL" -f db/migrations/003_opportunities.sql
railway run --service govtech-pipeline \
  psql "$DATABASE_URL" -f db/migrations/004_knowledge_base.sql
```

**Option B: Railway shell**
1. Click `govtech-pipeline` service → **Shell** tab
2. Paste each migration:
   ```bash
   psql $DATABASE_URL -f /path/to/001_auth_tenants.sql
   ```
   Note: migrations aren't in the pipeline build context.
   Easiest: copy-paste SQL content directly into psql.

**Option C: Postgres Query tab**
1. Click Postgres service → **Query** tab
2. Paste and run each migration file's SQL in order

---

## Step 7 — Seed Admin Account

```bash
# Using Railway CLI — runs in the context of your Railway env
railway run --service govtech-frontend \
  npx tsx scripts/seed_admin.ts
```

Or run locally with Railway's DATABASE_URL:
```bash
# Get the DATABASE_URL from Railway dashboard
export DATABASE_URL="postgresql://..."
cd frontend && npx tsx ../scripts/seed_admin.ts
```

---

## Step 8 — Update AUTH_URL

After your first deploy, Railway gives you a URL like:
`https://govtech-frontend-production.up.railway.app`

Update these env vars in the frontend service with the real URL:
- `AUTH_URL` → `https://govtech-frontend-production.up.railway.app`
- `NEXT_PUBLIC_APP_URL` → same

Redeploy the frontend service (Settings → Deploy → Redeploy).

---

## Step 9 — Verify

1. Visit your Railway URL → should redirect to `/login`
2. Log in with the admin credentials from seed script
3. Should land on `/admin/dashboard`
4. Check pipeline service logs → should see "LISTEN active on channel: pipeline_worker"

---

## Ongoing Deployments

```bash
# Every push to main deploys both services automatically
git add .
git commit -m "feat: add tenant management page"
git push origin main
# Railway detects changes, rebuilds affected Dockerfiles, redeploys
```

Railway only rebuilds a service if files in its build context changed:
- Changes in `frontend/` → rebuilds frontend only
- Changes in `pipeline/` → rebuilds pipeline only
- Changes in `db/` → no automatic rebuild (run migrations manually)

---

## Railway CLI Quick Reference

```bash
railway login              # Authenticate
railway link               # Link local dir to Railway project
railway status             # See all services
railway logs               # Stream logs from all services
railway logs --service govtech-pipeline   # Logs from one service
railway shell --service govtech-pipeline  # Open shell in service
railway run --service X -- <command>      # Run command in service env
railway variables          # List env vars for current service
```

---

## Troubleshooting

**Frontend build fails:**
- Check that `frontend/Dockerfile` build context is set to `frontend` (not repo root)
- Ensure `package-lock.json` is committed (needed for `npm ci`)

**Pipeline keeps restarting:**
- Check Railway logs for Python errors
- `DATABASE_URL` not set → service crashes immediately
- Missing `psycopg[binary]` → check requirements.txt

**Auth not working:**
- `AUTH_SECRET` must be set before any login attempt
- `AUTH_URL` must match your actual Railway URL exactly (no trailing slash)

**Migrations failed:**
- Check extension support: Railway Postgres supports pgvector but you must `CREATE EXTENSION` manually
- Run migrations in order — 001 must run before 002 etc.

**pgvector not found:**
- Railway uses standard Postgres — pgvector is available but not pre-enabled
- Run `CREATE EXTENSION IF NOT EXISTS vector;` in the Postgres Query tab first
