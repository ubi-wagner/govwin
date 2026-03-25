# GitHub Secrets Setup

This guide covers all secrets and keys the platform needs — where they live,
how they connect, and what breaks if they're missing.

---

## The Big Picture: Where Secrets Live

```
┌──────────────────────────────────────────────────────────────────┐
│                        RAILWAY (runtime)                         │
│                                                                  │
│  Frontend Service          Pipeline Service         Postgres     │
│  ├─ DATABASE_URL ──────────┤ DATABASE_URL ──────────── (DB)      │
│  ├─ AUTH_SECRET            ├─ API_KEY_ENCRYPTION_SECRET           │
│  ├─ AUTH_URL               ├─ SAM_GOV_API_KEY (env fallback)     │
│  ├─ API_KEY_ENCRYPTION_    ├─ ANTHROPIC_API_KEY (env fallback)   │
│  │  SECRET ────────────────┘  (MUST MATCH frontend)              │
│  ├─ STORAGE_ROOT           ├─ STORAGE_ROOT                       │
│  └─ NODE_ENV               └─ CLAUDE_MODEL                       │
│                                                                  │
│  api_key_registry table (in Postgres):                           │
│  ├─ sam_gov     → encrypted with API_KEY_ENCRYPTION_SECRET       │
│  └─ anthropic   → encrypted with API_KEY_ENCRYPTION_SECRET       │
│      ▲ written by frontend admin UI                              │
│      ▼ read + decrypted by pipeline                              │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                     GITHUB (CI/CD only)                          │
│                                                                  │
│  Repository Secrets:                                             │
│  ├─ DATABASE_URL ──── used by migrate.yml to run SQL migrations  │
│  └─ (others optional — for future integration tests)             │
│                                                                  │
│  ci.yml uses FAKE credentials — never touches real DB            │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                     LOCAL DEV (.env file)                        │
│                                                                  │
│  .env (gitignored, never committed):                             │
│  ├─ DATABASE_URL ──── can point to Railway DB or local Docker    │
│  ├─ AUTH_SECRET                                                  │
│  ├─ API_KEY_ENCRYPTION_SECRET ── MUST match Railway if sharing DB│
│  └─ ... (see .env.example for full list)                         │
└──────────────────────────────────────────────────────────────────┘
```

---

## Critical: API Key Encryption Chain

When you enter SAM.gov or Anthropic API keys through the **admin UI (Sources page)**:

1. **Frontend encrypts** the key with `API_KEY_ENCRYPTION_SECRET` (AES-256-GCM)
2. Encrypted blob is stored in `api_key_registry` table in Postgres
3. **Pipeline decrypts** using the same `API_KEY_ENCRYPTION_SECRET`
4. Pipeline calls the external API with the decrypted key

**If the encryption secret doesn't match between frontend and pipeline,
the pipeline cannot decrypt the keys and all SAM.gov/Anthropic calls fail.**

The pipeline falls back to env vars (`SAM_GOV_API_KEY`, `ANTHROPIC_API_KEY`)
if decryption fails, but the admin-entered keys won't work.

### Checklist:
- [ ] `API_KEY_ENCRYPTION_SECRET` is set on **both** Railway frontend AND pipeline services
- [ ] Both values are **identical** (copy-paste, don't retype)
- [ ] If you're developing locally against the Railway DB, your `.env` must have the **same** encryption secret as Railway
- [ ] If you rotate the encryption secret, **all stored keys become unreadable** — re-enter them via admin UI

---

## GitHub Secrets Setup (5 minutes)

Go to your GitHub repo:
**Settings > Secrets and variables > Actions > New repository secret**

### Required (for auto-migrations)

| Secret Name      | Where to Get It                                      | Example                                                  |
|------------------|------------------------------------------------------|----------------------------------------------------------|
| `DATABASE_URL`   | Railway > Postgres service > Variables > DATABASE_URL | `postgresql://postgres:abc123@roundhouse.proxy.rlwy.net:12345/railway` |

This is the **only secret required** for the migration workflow.

### Optional (for future CI integration tests)

| Secret Name                  | Purpose                                        | Where to Get It                         |
|------------------------------|------------------------------------------------|-----------------------------------------|
| `AUTH_SECRET`                | JWT signing for NextAuth                       | Railway > Frontend > Variables          |
| `API_KEY_ENCRYPTION_SECRET`  | AES-256 key for API key encryption             | Railway > Frontend > Variables          |
| `SAM_GOV_API_KEY`            | SAM.gov API access                             | Railway > Pipeline > Variables          |
| `ANTHROPIC_API_KEY`          | Claude AI analysis                             | Railway > Pipeline > Variables          |

---

## Railway Secrets Setup

These should already be configured if you followed SETUP.md. Verify:

### Frontend Service — Required Variables

| Variable                     | How to Generate / Where to Get                        |
|------------------------------|-------------------------------------------------------|
| `DATABASE_URL`               | Click **+ Reference** → select Postgres plugin        |
| `AUTH_SECRET`                | `openssl rand -base64 32` (run once, save the output) |
| `AUTH_URL`                   | Your Railway app URL, e.g. `https://app.up.railway.app` |
| `API_KEY_ENCRYPTION_SECRET`  | `openssl rand -base64 32` (run once, **save and share with pipeline**) |
| `STORAGE_ROOT`               | `/data` (mount a Railway volume here)                 |
| `NODE_ENV`                   | `production`                                          |

### Pipeline Service — Required Variables

| Variable                     | How to Generate / Where to Get                        |
|------------------------------|-------------------------------------------------------|
| `DATABASE_URL`               | Click **+ Reference** → select Postgres plugin        |
| `API_KEY_ENCRYPTION_SECRET`  | **Same value as frontend** (copy-paste it)             |
| `STORAGE_ROOT`               | `/data`                                               |
| `CLAUDE_MODEL`               | `claude-sonnet-4-20250514` (or your preferred model)  |

### Pipeline Service — API Key Fallbacks (optional)

These env vars are used **only if** the pipeline can't decrypt the DB-stored key.
If you've entered keys through the admin UI and the encryption secret matches,
these are not needed.

| Variable                     | When to Set                                           |
|------------------------------|-------------------------------------------------------|
| `SAM_GOV_API_KEY`            | Backup if DB-encrypted key fails                      |
| `ANTHROPIC_API_KEY`          | Backup if DB-encrypted key fails                      |

---

## Admin UI API Keys vs Environment Variable API Keys

There are **two ways** API keys reach the pipeline:

### Method 1: Admin UI (Preferred)
1. Go to admin dashboard > **Sources** page
2. Click **Rotate Key** for SAM.gov or Anthropic
3. Paste the API key → it's encrypted and stored in `api_key_registry`
4. Click **Test Key** to verify connectivity
5. Pipeline reads from DB first, decrypts with `API_KEY_ENCRYPTION_SECRET`

**Advantages:** Rotate without redeploying. Audit trail. Validation testing.

### Method 2: Environment Variables (Fallback)
1. Set `SAM_GOV_API_KEY` / `ANTHROPIC_API_KEY` on the Railway pipeline service
2. Pipeline uses these if DB lookup or decryption fails

**Advantages:** Simpler initial setup. No encryption dependency.

### What the pipeline does at runtime:
```
1. Query api_key_registry for source
2. If row exists and has encrypted_key:
   a. Decrypt with API_KEY_ENCRYPTION_SECRET
   b. If decryption succeeds → use this key
   c. If decryption fails → fall back to env var
3. If no row in DB → use env var
4. If no env var either → fail (or use stub data if USE_STUB_DATA=true)
```

---

## How Workflows Use Secrets

### `ci.yml` — Build & Test (every push/PR)
- **Does NOT** use real secrets
- Uses fake `DATABASE_URL` for Next.js build
- No database connection needed

### `migrate.yml` — Database Migrations (when migration files change)
- Uses `DATABASE_URL` to connect to Railway Postgres
- Runs `db/migrations/run.sh` which applies pending migrations
- Manual trigger: **Actions > Run Database Migrations > Run workflow**
- Supports dry-run mode and optional admin seeding

---

## Step-by-Step: Adding DATABASE_URL to GitHub

### 1. Get your Railway DATABASE_URL

1. Open [Railway dashboard](https://railway.app/dashboard)
2. Click your project
3. Click the **Postgres** service
4. Go to the **Variables** tab
5. Copy the value of `DATABASE_URL`

Looks like: `postgresql://postgres:XXXXXXXX@HOSTNAME.proxy.rlwy.net:PORT/railway`

### 2. Add it to GitHub

1. Go to `github.com/ubi-wagner/govwin`
2. Click **Settings** (top tab)
3. Left sidebar: **Secrets and variables** > **Actions**
4. Click **New repository secret**
5. Name: `DATABASE_URL`
6. Value: paste the Railway connection string
7. Click **Add secret**

### 3. Test with dry run

1. Go to **Actions** tab
2. Click **Run Database Migrations** in the left sidebar
3. Click **Run workflow**
4. Set dry_run to `true`
5. Watch the logs — should connect and show migration status

### 4. Run for real

Same as above with dry_run set to `false`.

---

## Security Notes

- GitHub secrets are **encrypted at rest** and **masked in logs**
- They are only available to workflows in your repo, not forks
- Railway's `DATABASE_URL` includes the password — treat as highly sensitive
- If you rotate the Railway Postgres password, update the GitHub secret too
- If you rotate `API_KEY_ENCRYPTION_SECRET`, re-enter all API keys via admin UI
- Never put real secrets in `.env.example`, workflow files, or any committed file

---

## Troubleshooting

**"DATABASE_URL secret is not set"**
→ You haven't added the secret to GitHub. Follow the walkthrough above.

**"connection refused" or "timeout"**
→ Railway Postgres may need public networking enabled:
  Railway > Postgres service > Settings > Networking > Enable public access

**"password authentication failed"**
→ The DATABASE_URL in GitHub secrets is stale. Copy a fresh one from Railway.

**Pipeline says "Decryption failed" or SAM.gov returns 403**
→ `API_KEY_ENCRYPTION_SECRET` mismatch between frontend and pipeline.
  Verify both Railway services have the exact same value. If you changed it,
  re-enter the API keys through the admin UI Sources page.

**Pipeline uses stub data instead of real SAM.gov data**
→ Either `SAM_GOV_API_KEY` is missing/invalid, or the DB-encrypted key can't be
  decrypted. Check the encryption secret and run **Test Key** on the Sources page.

**Admin UI shows "Not connectivity-tested" for API keys**
→ Go to Sources page, click **Test Key** next to each key. This verifies the
  stored key can actually reach the external API, not just that it exists.
