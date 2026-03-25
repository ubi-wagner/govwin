# GitHub Secrets Setup

This guide shows you how to add the secrets GitHub needs to run migrations
and (optionally) full integration tests against your Railway database.

---

## Quick Setup (5 minutes)

Go to your GitHub repo:
**Settings > Secrets and variables > Actions > New repository secret**

Add each secret below. Copy the values from your **Railway dashboard**
(Railway > your service > Variables tab).

---

## Required Secret

| Secret Name      | Where to Get It                                      | Example                                                  |
|------------------|------------------------------------------------------|----------------------------------------------------------|
| `DATABASE_URL`   | Railway > Postgres service > Variables > DATABASE_URL | `postgresql://postgres:abc123@roundhouse.proxy.rlwy.net:12345/railway` |

This is the **only secret required** for the migration workflow to run.

---

## Optional Secrets (for future CI enhancements)

These are not needed today but will be useful if you add integration tests
or deploy previews from GitHub Actions.

| Secret Name                  | Purpose                                        | Where to Get It                         |
|------------------------------|------------------------------------------------|-----------------------------------------|
| `AUTH_SECRET`                | JWT signing for NextAuth (integration tests)   | Railway > Frontend > Variables          |
| `API_KEY_ENCRYPTION_SECRET`  | AES-256 key for API key encryption             | Railway > Frontend > Variables          |
| `SAM_GOV_API_KEY`            | SAM.gov API access (pipeline tests)            | Railway > Pipeline > Variables          |
| `ANTHROPIC_API_KEY`          | Claude AI analysis (pipeline tests)            | Railway > Pipeline > Variables          |

---

## How the Workflows Use Secrets

### `ci.yml` — Build & Test (runs on every push/PR)
- Does **NOT** use any real secrets
- Uses fake `DATABASE_URL` for Next.js build
- Runs type-check, lint, unit tests, build
- No database connection needed

### `migrate.yml` — Database Migrations (runs when migration files change)
- Uses `DATABASE_URL` to connect to Railway Postgres
- Runs `db/migrations/run.sh` which applies pending migrations
- Also triggerable manually via **Actions > Run Database Migrations > Run workflow**
- Supports dry-run mode to preview what would run
- Supports optional admin seeding

---

## Step-by-Step Walkthrough

### 1. Get your Railway DATABASE_URL

1. Open [Railway dashboard](https://railway.app/dashboard)
2. Click your project
3. Click the **Postgres** service
4. Go to the **Variables** tab
5. Copy the value of `DATABASE_URL`

It looks like: `postgresql://postgres:XXXXXXXX@HOSTNAME.proxy.rlwy.net:PORT/railway`

### 2. Add it to GitHub

1. Go to your repo on GitHub: `github.com/ubi-wagner/govwin`
2. Click **Settings** (top tab)
3. Left sidebar: **Secrets and variables** > **Actions**
4. Click **New repository secret**
5. Name: `DATABASE_URL`
6. Value: paste the Railway connection string
7. Click **Add secret**

### 3. Test it

1. Go to **Actions** tab in your repo
2. Click **Run Database Migrations** in the left sidebar
3. Click **Run workflow**
4. Set dry_run to `true` for a safe test
5. Click **Run workflow** (green button)
6. Watch the logs — it should connect and show migration status

### 4. Run for real

Same as above but set dry_run to `false`. It will apply all pending migrations.

---

## Security Notes

- GitHub secrets are **encrypted at rest** and **masked in logs**
- They are only available to workflows in your repo, not forks
- Railway's `DATABASE_URL` includes the password — treat it as highly sensitive
- If you rotate the Railway Postgres password, update the GitHub secret too
- Never put secrets in `.env.example`, workflow files, or any committed file

---

## Troubleshooting

**"DATABASE_URL secret is not set"**
→ You haven't added the secret yet. Follow Step 2 above.

**"connection refused" or "timeout"**
→ Railway Postgres may need public networking enabled:
  Railway > Postgres service > Settings > Networking > Enable public access

**"password authentication failed"**
→ The DATABASE_URL in GitHub secrets is stale. Copy a fresh one from Railway.

**"permission denied for table"**
→ The Railway DATABASE_URL usually connects as the superuser. If you created a
  restricted user, ensure it has CREATE, ALTER, INSERT, SELECT privileges.
