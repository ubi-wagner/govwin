# SETUP.md — GovWin Deployment & Configuration Guide

Step-by-step instructions for deploying GovWin on Railway, configuring API keys, setting up storage, and preparing for Gmail integration.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Railway Project Setup](#2-railway-project-setup)
3. [Database Setup](#3-database-setup)
4. [Generate Secrets](#4-generate-secrets)
5. [Environment Variables](#5-environment-variables)
6. [API Key Configuration](#6-api-key-configuration)
7. [Persistent Storage (Railway Volume)](#7-persistent-storage-railway-volume)
8. [Run Migrations](#8-run-migrations)
9. [Seed Admin Account](#9-seed-admin-account)
10. [Post-Deploy Checklist](#10-post-deploy-checklist)
11. [Gmail / Google Workspace Integration](#11-gmail--google-workspace-integration)
12. [Local Development](#12-local-development)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Prerequisites

- A [Railway](https://railway.app) account (Hobby plan or higher for persistent volumes)
- A GitHub repo with the GovWin codebase pushed to it
- Local tools: `openssl`, `git`, optionally `railway` CLI (`npm install -g @railway/cli`)
- API keys (see [Section 6](#6-api-key-configuration))

---

## 2. Railway Project Setup

### Create the Project

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Select your repo → Railway will auto-detect and start a deploy
3. **Cancel the initial deploy** — you need to configure services first

### Create Three Services

| Service | Type | Config |
|---------|------|--------|
| **Postgres** | Railway plugin | **+ New** → **Database** → **Add PostgreSQL** |
| **govtech-frontend** | GitHub service | Rename the auto-created service |
| **govtech-pipeline** | GitHub service | **+ New** → **GitHub Repo** → same repo |

### Configure Frontend Service

**Settings → Build:**
- Builder: `Dockerfile`
- Dockerfile path: `frontend/Dockerfile`
- Build context: `frontend`

**Settings → Deploy:**
- Health check path: `/api/health`
- Leave start command empty (Dockerfile CMD handles it)

### Configure Pipeline Service

**Settings → Build:**
- Builder: `Dockerfile`
- Dockerfile path: `pipeline/Dockerfile`
- Build context: `pipeline`

**Settings → Deploy:**
- **Disable health checks** — this is a background worker, not a web server
- Leave start command empty

---

## 3. Database Setup

After the Postgres plugin is created:

1. Click the Postgres service → **Query** tab
2. Run these SQL commands to enable required extensions:

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
```

Railway auto-injects `DATABASE_URL` for services that reference the plugin.

---

## 4. Generate Secrets

Run these commands locally and save the output:

```bash
# Auth session signing secret (NextAuth)
openssl rand -base64 32
# → Save as AUTH_SECRET

# API key encryption secret (AES-256-GCM for encrypting stored API keys)
openssl rand -base64 32
# → Save as API_KEY_ENCRYPTION_SECRET
```

Keep these safe — you'll need them for the environment variables below.

---

## 5. Environment Variables

### Frontend Service Variables

| Variable | Value | Notes |
|----------|-------|-------|
| `DATABASE_URL` | Click **+ Reference** → select Postgres plugin | Auto-injected |
| `AUTH_SECRET` | Output from `openssl rand -base64 32` | Session signing |
| `AUTH_URL` | `https://YOUR-APP.up.railway.app` | Update after first deploy |
| `NEXT_PUBLIC_APP_URL` | Same as AUTH_URL | Client-side URL |
| `NODE_ENV` | `production` | |
| `APP_ENV` | `production` | |
| `API_KEY_ENCRYPTION_SECRET` | Output from `openssl rand -base64 32` | Encrypts API keys in DB |
| `STORAGE_ROOT` | `/data` | Persistent volume mount path |
| `AUTH_RESEND_KEY` | `re_xxxxxxxxxxxx` | Optional — for email notifications |
| `EMAIL_FROM` | `noreply@yourdomain.com` | Optional — sender address |

### Pipeline Service Variables

| Variable | Value | Notes |
|----------|-------|-------|
| `DATABASE_URL` | Click **+ Reference** → select Postgres plugin | Auto-injected |
| `API_KEY_ENCRYPTION_SECRET` | Same value as frontend | Must match — shared encryption |
| `STORAGE_ROOT` | `/data` | Same persistent volume |
| `APP_ENV` | `production` | |
| `SAM_GOV_API_KEY` | Your SAM.gov API key | See [Section 6](#samgov-api-key) |
| `ANTHROPIC_API_KEY` | `sk-ant-xxxxxxxxxxxx` | See [Section 6](#anthropic-api-key) |
| `CLAUDE_MODEL` | `claude-sonnet-4-20250514` | Or any supported Claude model |

---

## 6. API Key Configuration

GovWin supports two methods for API key storage:

1. **Environment variables** (simpler, requires redeploy to rotate)
2. **Encrypted DB storage** (preferred — rotate via admin UI, no redeploy needed)

The pipeline reads from the `api_key_registry` table first and falls back to env vars.

### SAM.gov API Key

1. Go to [sam.gov](https://sam.gov) → log in → click your name → **Account Settings**
2. Scroll to **Public API Key** → generate one
3. Set as `SAM_GOV_API_KEY` env var on the Pipeline service

**Key facts:**
- Expires every **90 days** (tracked automatically in `api_key_registry`)
- The admin dashboard alerts you **15 days** before expiry
- Rate limited to **1,000 requests/day** (tracked in `rate_limit_state`)
- Rotate via Admin → Sources in the web UI (encrypted in DB, no redeploy needed)

### Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com) → **API Keys** → **Create Key**
2. Set as `ANTHROPIC_API_KEY` env var on the Pipeline service

**Key facts:**
- No forced expiry, but validated periodically (30-day check interval)
- Used for LLM analysis of opportunities scoring >= 50 (configurable threshold)
- Scoring engine works without it — deterministic scoring still runs; LLM enhancement is skipped
- Model configurable via `CLAUDE_MODEL` env var (default: `claude-sonnet-4-20250514`)

### API Key Encryption (Admin UI Rotation)

Once the app is running, you can store and rotate API keys through the admin dashboard:

- Keys are encrypted with **AES-256-GCM** using the `API_KEY_ENCRYPTION_SECRET` env var
- Each key gets a random 12-byte IV — even the same key encrypts differently each time
- The DB stores: encrypted value, last-4-char hint, issue date, expiry date, validation status
- **Important:** `API_KEY_ENCRYPTION_SECRET` must be the same on frontend and pipeline services

---

## 7. Persistent Storage (Railway Volume)

Both services need access to a persistent volume for document storage.

### Mount the Volume

1. Click **govtech-frontend** → **Settings** → **Volumes** → **+ Mount Volume**
   - Mount path: `/data`
2. Click **govtech-pipeline** → **Settings** → **Volumes** → **+ Mount Volume**
   - Mount path: `/data` (same path, can be same or separate volume)

### What Gets Stored

```
/data/
├── opportunities/           ← Downloaded RFP documents, weekly-partitioned
│   └── 2026-W12/
│       └── SAM-HC1028-25-R-0042-Enterprise-Cloud/
│           ├── original_rfp.pdf
│           └── attachment_1.pdf
├── customers/               ← Per-tenant files, tier-aware
│   └── {tenant-slug}/
│       ├── finder/
│       │   ├── curated/     ← AI-generated summaries
│       │   └── saved/       ← Pinned opportunity shortcuts
│       ├── reminders/       ← Tier 2+
│       ├── binder/          ← Tier 3+
│       ├── grinder/         ← Tier 4
│       └── uploads/         ← All tiers
└── system/
    ├── templates/
    └── logs/
```

The `stored_files` table tracks all files with metadata (path, size, backend type). The `STORAGE_ROOT` env var tells the app where the volume is mounted.

---

## 8. Run Migrations

After both services deploy, run all 13 migrations **in order**.

### Option A: Railway CLI (Recommended)

```bash
# Install and authenticate
npm install -g @railway/cli
railway login
railway link    # Select your project

# Run all migrations in order
for i in 001 002 003 004 005 006 007 008 009 010 011 012 013; do
  echo "Running migration $i..."
  railway run --service govtech-frontend \
    psql "$DATABASE_URL" -f db/migrations/${i}_*.sql
done
```

### Option B: Postgres Query Tab

1. Click the Postgres service → **Query** tab
2. Copy-paste each migration file's SQL and run, in order:

| # | File | Purpose |
|---|------|---------|
| 001 | `auth_tenants.sql` | Auth, tenants, users, audit log |
| 002 | `control_plane.sql` | System config, job queue, schedules, API key registry |
| 003 | `opportunities.sql` | Opportunities, scoring, documents, amendments, views |
| 004 | `knowledge_base.sql` | Past performance, capabilities (Phase 2) |
| 005 | `seed_test_data.sql` | Test data (skip in production if desired) |
| 006 | `drive_files.sql` | Drive file tracking |
| 007 | `event_bus_and_drive_architecture.sql` | Event bus, NOTIFY channels, workers |
| 008 | `api_key_encryption.sql` | Encrypted API key storage |
| 009 | `local_storage.sql` | Local filesystem storage migration |
| 010 | `opportunity_full_metadata.sql` | Extended opportunity fields |
| 011 | `reminder_nudges_schedule.sql` | Reminder and nudge scheduling |
| 012 | `site_content.sql` | CMS / site content tables |
| 013 | `content_library.sql` | Content library for proposals |

### Option C: Makefile (Local)

```bash
make migrate    # Runs db/migrations/run.sh
```

---

## 9. Seed Admin Account

Create the master admin user who manages the platform:

```bash
# Via Railway CLI
railway run --service govtech-frontend npx tsx scripts/seed_admin.ts

# Or locally with Railway's DATABASE_URL
export DATABASE_URL="postgresql://..."
cd frontend && npx tsx ../scripts/seed_admin.ts

# Or via Makefile
make seed
```

The script prompts for:
1. Admin full name
2. Admin email (login credential)
3. Admin password
4. Company name (first tenant)
5. Company slug (URL-friendly identifier)

This creates a `master_admin` user, an `enterprise` tenant, and an empty tenant profile.

---

## 10. Post-Deploy Checklist

After deploying and seeding:

- [ ] **Update AUTH_URL** — Copy your Railway frontend URL and set it as `AUTH_URL` and `NEXT_PUBLIC_APP_URL` on the frontend service. Redeploy.
- [ ] **Login** — Visit `https://your-app.up.railway.app/login` with your seed credentials
- [ ] **Check admin dashboard** — Visit `/admin/dashboard`, verify system status is green
- [ ] **Verify pipeline** — Check pipeline service logs for `"LISTEN active on channel: pipeline_worker"`
- [ ] **Verify API keys** — Visit `/admin/sources`, confirm SAM.gov and Anthropic key status
- [ ] **Create first tenant** — `/admin/tenants` → create a real customer tenant
- [ ] **Configure scoring profile** — Set NAICS codes, keywords, set-asides, agency priorities
- [ ] **Create tenant user** — Add a user for the tenant
- [ ] **Trigger SAM.gov ingest** — `/admin/pipeline` → trigger a `sam_gov` full ingest job
- [ ] **Verify scoring** — Scoring runs automatically after ingest; check tenant pipeline
- [ ] **Test tenant login** — Log in as the tenant user, verify they see scored opportunities

---

## 11. Gmail / Google Workspace Integration

**Current status: Deferred** — The architecture, event tables, and notification queue are built. The email delivery worker is planned but not yet wired up.

### What's Already Built

- `notifications_queue` table — stores pending email notifications (deadline nudges, amendment alerts, digests)
- `customer_events` table — tracks events that trigger notifications
- NOTIFY channel `customer_events` — wakes workers when events are inserted
- `ReminderDeadlineWorker` and `ReminderAmendmentWorker` — create notification queue entries
- `lib/google-drive.ts` — Google Drive integration (15+ functions, fully built)

### What's Needed to Enable Gmail

A **notification queue consumer** worker that:
1. Listens for pending notifications in `notifications_queue`
2. Renders email templates (deadline nudges, amendment alerts, daily digests)
3. Sends via Gmail API using service account delegation

### Google Workspace Setup (When Ready)

#### Step 1: Create a Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project (or use existing) → **APIs & Services** → **Credentials**
3. **Create Credentials** → **Service Account**
4. Name: `govwin-automation` (or similar)
5. Download the JSON key file

#### Step 2: Enable APIs

In the same Google Cloud project:
- Enable **Gmail API**
- Enable **Google Drive API**
- Enable **Google Sheets API** (for pipeline snapshots)

#### Step 3: Set Up Domain-Wide Delegation

1. In Google Cloud Console → **IAM & Admin** → **Service Accounts**
2. Click your service account → **Details** → copy the **Client ID**
3. Go to [Google Workspace Admin](https://admin.google.com) → **Security** → **API Controls** → **Manage Domain-Wide Delegation**
4. **Add new** → paste the Client ID
5. Add these OAuth scopes:
   ```
   https://www.googleapis.com/auth/gmail.send
   https://www.googleapis.com/auth/drive
   https://www.googleapis.com/auth/spreadsheets
   ```

#### Step 4: Set Environment Variables

Add to **both** frontend and pipeline services:

```
GOOGLE_SERVICE_ACCOUNT_KEY=<base64-encoded contents of the JSON key file>
GOOGLE_DELEGATED_ADMIN=admin@rfppipeline.com
GOOGLE_DELEGATED_SENDER=admin@rfppipeline.com
GOOGLE_WORKSPACE_DOMAIN=rfppipeline.com
```

To base64-encode the key file:
```bash
base64 -w 0 service-account-key.json
# Paste the output as GOOGLE_SERVICE_ACCOUNT_KEY
```

#### Architecture Notes

- **Service account delegation** — one service account acts as `admin@rfppipeline.com` to send emails and manage Drive. No per-user OAuth required.
- **Workspace admin** — `eric@rfppipeline.com` manages the Google Workspace domain
- **Sender** — all automated emails come from `admin@rfppipeline.com` (or a custom alias)
- The system does NOT require individual user Google accounts — delegation handles everything

---

## 12. Local Development

### Quick Start

```bash
# Clone and configure
git clone <repo> && cd govwin
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD, AUTH_SECRET, API keys

# Start database
make up                  # docker compose up -d

# Run migrations
make migrate             # ./db/migrations/run.sh

# Seed admin
make seed                # npx tsx scripts/seed_admin.ts

# Start frontend
make dev                 # http://localhost:3000

# Start pipeline (separate terminal)
cd pipeline && pip install -r requirements.txt && python src/main.py
```

### Docker (All Services)

```bash
docker compose up -d
# Frontend: http://localhost:3000
# DB: localhost:5432
# Pipeline: background worker
```

### Makefile Targets

| Target | Command | Purpose |
|--------|---------|---------|
| `make up` | `docker compose up -d` | Start all services |
| `make down` | `docker compose down` | Stop all services |
| `make migrate` | `./db/migrations/run.sh` | Run SQL migrations |
| `make seed` | `npx tsx ../scripts/seed_admin.ts` | Create admin user |
| `make dev` | `npm run dev` | Start Next.js dev server |
| `make type-check` | `npm run type-check` | TypeScript check |
| `make shell-db` | `psql "$DATABASE_URL"` | Connect to Postgres |
| `make railway-vars` | Print env vars | Show required Railway vars |

---

## 13. Troubleshooting

### Frontend build fails
- Verify Dockerfile path is `frontend/Dockerfile` and build context is `frontend`
- Ensure `package-lock.json` is committed (`npm ci` requires it)

### Pipeline keeps restarting
- Check logs — `DATABASE_URL` not set causes immediate crash
- Verify `psycopg[binary]` is in `requirements.txt`

### Auth not working
- `AUTH_SECRET` must be set before any login attempt
- `AUTH_URL` must match your actual Railway URL exactly (no trailing slash)

### Migrations fail
- Extensions must be created first (see [Section 3](#3-database-setup))
- Migrations must run in order — 001 before 002, etc.

### API keys not working
- SAM.gov: keys expire every 90 days; check `/admin/sources` for status
- Anthropic: verify key starts with `sk-ant-`
- If using DB-stored keys: ensure `API_KEY_ENCRYPTION_SECRET` matches on both services

### Storage issues
- Verify the persistent volume is mounted at `/data` on both services
- Check `STORAGE_ROOT` env var is set to `/data`
- Railway Hobby plan supports persistent volumes; free plan does not
