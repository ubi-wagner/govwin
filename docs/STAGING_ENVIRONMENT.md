# Staging environment — scope, keys, bootstrap, verification

**Status:** scoped, not yet built. **Owner:** master_admin.
**Companion documents:** `docs/SECRETS_INVENTORY.md` (what every variable is for) ·
`docs/RAILWAY_ENV_VARS.md` (the per-service reference) · `RAILWAY.md` (the deploy mechanics) ·
`docs/RLS_CUTOVER.md` (the two-role posture) · `docs/AGENT_SPEND_AND_CAPS.md` (what the AI costs).

This document adds what those do not: the **staging-specific** decisions, the **external accounts and
keys to obtain**, the **two bootstrap steps no migration performs**, and the **verification gate**
that says whether the environment is real.

---

## 1 · What staging is for

The sandbox already emulates production closely: same build, same migrations, same
`govtech_app` NOBYPASSRLS posture, RLS enforced, and a committed emulator standing in for Claude so
every AI-gated path runs end to end. Forty-one branch drives, five lenses and 2,484 unit tests pass
against it.

So staging is not for "does it work". It exists to answer the four questions **a keyed environment
is the only place to ask**:

| Question | Why the sandbox cannot answer it |
|---|---|
| **Is the drafted prose any good?** | the emulator returns canned text — it proves wiring, never writing |
| **What does a build actually cost?** | the emulator returns a constant usage block, so the ledger measures call count, not spend (`docs/AGENT_SPEND_AND_CAPS.md`) |
| **Does mail leave, arrive, and bounce correctly?** | the local harness accepts everything; SPF/DKIM/DMARC and real bounce webhooks are only exercisable against a real transport |
| **Is it usable at real model latency?** | a build that finishes in 2 s emulated takes minutes live. Nothing about the UX of waiting has been tested. |

Two secondary jobs: R2 round-trips against real object storage, and a safe place to rehearse the
first production deploy end to end.

**What staging is NOT:** a second production. It holds no customer data, it is disposable, and
mutating drives are welcome there precisely because it is.

---

## 2 · Topology

Mirror production's six nodes. Prefer a **separate Railway environment inside the existing project**
over a separate project: it inherits the repo connection and per-directory build triggers, and the
variable sets stay side by side for comparison.

```
Railway Project → environment: staging
├── govtech-frontend-staging   Next.js, /frontend/Dockerfile
├── pipeline-staging           Python worker, /pipeline/Dockerfile
├── rfp-crm-staging            FastAPI, /services/cms/Dockerfile
├── Postgres-staging           MAIN DB, pgvector — frontend + pipeline
└── cms-postgres-staging       rfp-crm's own DB

rfp-pipeline-bucket-staging    Cloudflare R2 — separate bucket, separate token
```

**Every backing store is separate.** Sharing the production bucket or either database with staging
is the one shortcut that turns a disposable environment into a second production — a staging worker
running the nudge sweep against production rows will email production customers.

---

## 3 · External accounts and keys to obtain

This is the acquisition list. **Every key is staging-specific** — never reuse a production
credential, because the whole point is that staging can be wrong without consequence, and a shared
key removes exactly that property.

### 3.1 Must obtain

| # | Service | What to create | Settings that matter | Set on |
|---|---|---|---|---|
| 1 | **Anthropic** — console.anthropic.com | A **separate Workspace** named `staging`, and an API key inside it | Set the workspace **monthly spend limit to $50**. That makes the provider's cap and the platform cap (`platform_agent_config.platform_monthly_cap`) agree, so a runaway is stopped twice by two independent mechanisms. | `ANTHROPIC_API_KEY` on **all three** services |
| 2 | **Cloudflare R2** | A new bucket `rfp-pipeline-bucket-staging` and an **API token scoped to that bucket only** | Permission: *Object Read & Write*. Scope: this bucket. Not an account-wide token — a staging token that can reach the production bucket is a production credential wearing a different name. | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL`, `AWS_S3_BUCKET`, `AWS_DEFAULT_REGION=auto` on frontend + pipeline (+ rfp-crm if it serves media) |
| 3 | **Postmark** — postmarkapp.com | A **second Server** in the existing account, named `staging` | Create it as a **Sandbox server** first: it accepts every message and delivers none, which is exactly what you want while seeded data may still contain real addresses. Copy the **Server API Token**, not the Account token — that mix-up is documented in the driver's own header. Flip to a live server only for step 8.4. | `POSTMARK_SERVER_TOKEN` on frontend + rfp-crm |
| 4 | **Railway** | The `staging` environment, plus two Postgres services and the R2 link | Enable **pgvector** on the main staging DB (mig 171 needs it) | — |

### 3.2 Obtain only if you want that capability on staging

| Service | What to create | Needed for | Skip by |
|---|---|---|---|
| **Google Workspace / GCP** | A second service account + domain-wide delegation (`gmail.send`, `gmail.readonly`, `gmail.modify`) | send-as and the inbox sweep across multiple mailboxes; `correspondence`-kind mail is pinned to Gmail and ignores `EMAIL_DRIVER` | `EMAIL_DRIVER=postmark` — covers the transactional seam, the ledger and suppressions; only the human-voice correspondence path stays untested |
| **Voyage AI** | A staging API key | semantic atom retrieval at production quality | `ATOM_EMBED=local` — the dependency-free local-hash embedder, no key, byte-identical selector behaviour |
| **ipinfo.io** | Free-tier token | geo enrichment on sign-in events | leave unset — the feature no-ops |
| **OpenAI** | — | only if `EMBEDDINGS_PROVIDER=openai` | leave the provider unset |

### 3.3 Explicitly NOT needed

- **SAM.gov** — `SAM_GOV_API_KEY` is dropped. ⚠️ The `sam_gov` schedule is **enabled** in the
  sandbox fixture; **disable it on staging** or it fails daily against a missing key and fills the
  event log with noise. `grants_gov` is already disabled.
- **Stripe** — self-serve checkout is descoped; the comp-code path (`rfppipelinetest`) is the launch
  mechanism.
- **DSIP · sbir.gov · grants.gov** — public APIs, keyless. DSIP is the recommended discovery source
  and needs nothing but a schedule.

### 3.4 Generated, not obtained

Create these fresh for staging. Do not copy production values.

```bash
openssl rand -base64 32   # AUTH_SECRET
openssl rand -base64 32   # API_KEY_ENCRYPTION_SECRET   ← IDENTICAL on frontend and pipeline
openssl rand -base64 32   # CRON_SECRET
openssl rand -base64 32   # CMS_API_KEY
openssl rand -base64 32   # CMS_JWT_SECRET
openssl rand -base64 32   # REVALIDATE_SECRET           ← IDENTICAL on frontend and rfp-crm
openssl rand -base64 32   # POSTMARK_WEBHOOK_SECRET
openssl rand -base64 24   # the govtech_app role password (see §5)
openssl rand -base64 18   # INITIAL_MASTER_ADMIN_PASSWORD (forced reset on first login)
```

`API_KEY_ENCRYPTION_SECRET` differing between frontend and pipeline is the classic silent failure:
the frontend encrypts a stored key, the pipeline cannot decrypt it, and the symptom is an AI feature
that does nothing with no error worth reading.

---

## 4 · Variable matrix

89 variables are read across the three services; all 89 are documented, and
`node frontend/scripts/audit-env-inventory.mjs` fails the build if that stops being true. Below is
only what is **staging-specific or boot-critical**. The full reference is
`docs/RAILWAY_ENV_VARS.md`.

### govtech-frontend-staging

| Variable | Value | Note |
|---|---|---|
| `DATABASE_URL` | `postgresql://govtech_app:<pw>@…/govtech_intel` | the **NOBYPASSRLS** role — this is the posture under test |
| `DATABASE_URL_OWNER` | the Railway-injected owner URL | migrations + the legitimate cross-tenant admin reads |
| `AUTH_SECRET` · `API_KEY_ENCRYPTION_SECRET` | generated | §3.4 |
| `AUTH_URL` · `NEXTAUTH_URL` · `NEXT_PUBLIC_APP_URL` | the staging domain | must be the real URL or auth redirects break |
| `ANTHROPIC_API_KEY` | staging key | leave `ANTHROPIC_BASE_URL` **unset** — that is the emulator switch |
| `EMAIL_DRIVER` | `postmark` | §7 |
| `POSTMARK_SERVER_TOKEN` · `POSTMARK_WEBHOOK_SECRET` | staging server | |
| `CRON_SECRET` | generated | the `Bearer` token for the sweep endpoints in the middleware allowlist |
| `AWS_*` | staging R2 | leave `STORAGE_DRIVER` **unset** — `local` is the sandbox switch |
| `ATOM_EMBED` | `local`, or unset with `VOYAGE_API_KEY` set | |
| `ADMIN_NOTIFICATION_EMAIL` | a mailbox you own | |

### pipeline-staging

| Variable | Value | Note |
|---|---|---|
| `DATABASE_URL` | owner URL | the worker runs as owner today; `AGENT_DATABASE_URL` (`rfp_agent`) is the deploy-gated successor |
| `API_KEY_ENCRYPTION_SECRET` | **the same string as the frontend** | |
| `ANTHROPIC_API_KEY` | staging key | |
| `PORTAL_BASE_URL` | the staging domain | baked into every nudge link — a production URL here sends staging traffic to production |
| `MASTER_ADMIN_EMAIL` · `INITIAL_MASTER_ADMIN_PASSWORD` | set once | seeds the first admin; mig 124 forces a reset |
| `AWS_*` | staging R2 | |

### rfp-crm-staging

| Variable | Value |
|---|---|
| `CRM_DATABASE` | the staging cms-postgres URL (private network, no public proxy) |
| `SHARED_DATABASE_URL` | the staging **main** DB — the `system_events` bridge |
| `CMS_API_KEY` · `CMS_JWT_SECRET` · `REVALIDATE_SECRET` | generated |
| `ANTHROPIC_API_KEY` · `POSTMARK_SERVER_TOKEN` | staging |
| `ALLOWED_ORIGINS` · `CMS_PUBLIC_URL` · `FRONTEND_URL` | staging domains |

---

## 5 · The two steps no migration performs

Both are easy to miss because the deploy succeeds without them and fails later in a way that reads
like a different problem.

### 5.1 `govtech_app` has no login

Mig 094 creates the role `NOLOGIN`; mig 136 grants it everything it needs and installs the
`tenant_isolation` policies. Neither gives it a password, because a password cannot live in a
committed migration. Until you run this, the frontend's `DATABASE_URL` cannot connect and the
service crash-loops on authentication failure:

```sql
-- as the OWNER, once per environment
ALTER ROLE govtech_app LOGIN PASSWORD '<the generated password>';
```

Then set the frontend's `DATABASE_URL` to that role. **Serving as the owner instead is the one
mistake that invalidates every isolation result the environment will ever produce** — a superuser
connection bypasses RLS entirely, and the output is indistinguishable from perfect isolation. The
branch runner detects this and marks the isolation drives CANT-RUN rather than letting them report a
verdict they cannot earn.

### 5.2 The first admin

`MASTER_ADMIN_EMAIL` + `INITIAL_MASTER_ADMIN_PASSWORD` on the pipeline service seed it on first
boot. Mig 124 marks it `temp_password`, so the first login forces a reset. There is no committed
credential to fall back on — the `.test` seed accounts are deactivated and hash-invalidated.

---

## 6 · Bootstrap order

Migrations run **inside the deployment** — the frontend's `entrypoint.sh` runs
`db/migrations/migrate.mjs` as `DATABASE_URL_OWNER` under `set -e`, and rfp-crm's `CMD` runs
`services/cms/db/run.sh`, which exits 1 rather than boot on an unmigrated schema. Do **not** run
migrations by hand: two runners against one database is the race the in-deployment path exists to
avoid.

1. Create the `staging` environment, both Postgres services, and the R2 bucket + token. The main
   staging DB must run a **Postgres image that ships pgvector, pg_trgm and uuid-ossp** — migration
   001 does `CREATE EXTENSION IF NOT EXISTS "vector"`, which fails on an image that does not have
   it, and a failed migration aborts the boot by design.
2. Set every variable from §4 — including **`DATABASE_URL_OWNER` on the frontend service.** The
   entrypoint migrates as `DATABASE_URL_OWNER` and falls back to `DATABASE_URL` with a warning if
   it is unset; that fallback is the app role, which does not own `tenants`, so migrations 215–217
   fail with `permission denied for table tenants` — a message that reads like a problem with
   `tenants` and is actually a missing variable. Deploy nothing yet.
3. Deploy **frontend** first — its entrypoint carries the migrations. Watch for head **237**.
4. `ALTER ROLE govtech_app LOGIN PASSWORD …` (§5.1), then point `DATABASE_URL` at it and redeploy.
5. Deploy **pipeline** and **rfp-crm**.
6. Confirm the first admin exists; log in and complete the forced password reset.
7. Set the safety switches in §7 **before** anything is scheduled.
8. Seed content: enable + schedule **DSIP** on the admin Sources page, and disable `sam_gov`.
   Alternatively upload a solicitation via `/api/admin/upload-topic-files` to have something to
   build against on day one.
9. Run the verification gate (§8).

---

## 7 · Safety switches — set these before the first schedule fires

**There is no global "do not send" flag.** `EMAIL_DRIVER` selects `gmail` or `postmark`; both
deliver. The nudge sweeper, the amendment fan-out and the ToDo projections all send real mail, and
they run on a schedule. Three layers, in order of reliability:

1. **A Postmark Sandbox server** (§3.1). It accepts and discards. This is the only layer that holds
   regardless of what is in the database.
2. **Synthetic data only.** Do not restore a production dump into staging. If you must, rewrite
   every address first.
3. **Pre-seed `email_suppressions`** with your real domains as a belt.

Also:
- `PORTAL_BASE_URL` must be the staging domain, or every nudge link points at production.
- `ANTHROPIC_BASE_URL` and `STORAGE_DRIVER` must be **unset**. Both are sandbox switches; leaving
  either set gives you a staging environment quietly running the emulator or the local filesystem,
  and everything will look fine.
- Disable the `sam_gov` schedule.

---

## 8 · The verification gate

Point the existing instruments at staging. Nothing new needs writing.

### 8.0 If staging was REPLICATED from production, run this first

Duplicating an environment is the fastest way to get the topology right and the most dangerous way
to get the variables wrong: services, volumes **and every variable** come across. The result boots,
reports Online on every node, and holds production's Anthropic key, production's Postmark server,
and a `PORTAL_BASE_URL` naming `www.rfppipeline.com`. Nothing about that is an error — every value
is valid, just pointed at the wrong world — so it has to be asked about rather than waited for.

```bash
mkdir -p /tmp/envdump && cd /tmp/envdump
for env in production staging; do
  railway variables --environment $env --service govtech-frontend --json > $env.frontend.json
  railway variables --environment $env --service pipeline         --json > $env.pipeline.json
  railway variables --environment $env --service rfp-crm          --json > $env.rfp-crm.json
done
cd - && node frontend/scripts/audit-env-parity.mjs /tmp/envdump
rm -rf /tmp/envdump        # they contain live secrets
```

It reports five classes and **never prints a value** — `same`/`differs` and a sha256 prefix only, so
the output is safe to paste into a ticket:

| Class | Meaning |
|---|---|
| **SHARED WITH PRODUCTION** | byte-identical where it must differ — each row names what goes wrong |
| **POINTS AT PRODUCTION** | a staging URL naming the production host, whatever else is set |
| **SANDBOX SWITCH IS SET** | `ANTHROPIC_BASE_URL`, `STORAGE_DRIVER` — staging quietly not being staging |
| **DISAGREES WITHIN STAGING** | `API_KEY_ENCRYPTION_SECRET` frontend ≠ pipeline, `REVALIDATE_SECRET` frontend ≠ rfp-crm |
| **UNCHECKED** | a service dumped for only one environment — uncovered, not clean |

It self-tests against twelve hand-verified answers before reading anything real, and exits 2 as a
harness defect if any fails.

> **The bucket deserves a look by hand as well.** A duplicated environment may show an empty bucket
> in the Railway graph while `AWS_S3_BUCKET` and `AWS_ENDPOINT_URL` still resolve to production's.
> Compare both values across environments; the size shown in the dashboard is the service wrapper,
> not proof of a separate store.

### 8.1 Schema and posture

```bash
DATABASE_URL=<staging owner> node db/migrations/migrate.mjs --check   # head 237, zero drift
psql "<staging app url>" -c "select current_user"                     # must be govtech_app
```

### 8.2 The five lenses and the branch suite

All of them take `GUIDE_BASE` (the URL) and `GUIDE_DB` / `DATABASE_URL_OWNER`:

```bash
cd frontend
GUIDE_BASE=https://<staging> GUIDE_DB=<staging owner> node scripts/verify-surfaces.mjs
#   … verify-api-contract, verify-db-crud, verify-ui-vs-db, verify-write-contract
GUIDE_BASE=https://<staging> ./scripts/run-branch-drives.sh
```

`verify-write-contract` and several drives **mutate**; they print their footprint every run. On
staging that is fine — it is the environment's purpose. Never point them at production.

Expected, matching the sandbox: surfaces 82/82 · api-contract 133 graded, 0 violations ·
write-contract 255/255 · branch suite 41 passed / 0 failed. Any divergence is an
environment difference, and finding those is the point.

### 8.3 The first keyed build — the measurement that replaces the estimate

```bash
cd frontend
BASE_URL=https://<staging> node --import tsx scripts/estimate-full-build-cost.mts \
  --source <a Phase I proposal id>
```

The prior to beat, from three emulated builds with measured prompt sizes
(`docs/AGENT_SPEND_AND_CAPS.md`): **$1.00–$1.40 for a Phase I, $1.20–$2.30 for a Phase II**, with
input at 93–95 % of cost. The script refuses a verdict if the run drafts zero sections, so a green
result means the drafting cohort actually fired.

Then read the drafted prose. That is the judgement no instrument makes.

### 8.4 Email, for real

Flip the Postmark server from Sandbox to live, with one allowlisted recipient you own:

- send one transactional message → `email_send_ledger` shows reserve → dispatch → confirm
- bounce it deliberately (Postmark's test addresses) → `POST /api/webhooks/postmark` writes an
  `email_suppressions` row → the next send to that address is refused, and a **soft** bounce is not
  suppressed
- check SPF/DKIM/DMARC alignment in the received headers

### 8.5 Spend caps against a real provider

```bash
cd pipeline && python3 tests/verify_spend_guardrails.py     # 11 cases, both directions
```

Then confirm the Anthropic workspace spend limit and `platform_agent_config.platform_monthly_cap`
agree. Two independent stops for one runaway.

---

## 9 · What it costs to run

| | Monthly |
|---|---|
| Railway — 3 services + 2 Postgres, staging-sized | ~$20–40 |
| Cloudflare R2 | ~$0–1 at staging volumes |
| Postmark | free tier covers staging (sandbox sends are free) |
| Anthropic | capped at $50 by the workspace limit; the verification pass itself is **under $20** |

Call it **$40–60/month**, dominated by the Railway plan. The AI cost of standing it up and verifying
it once is under $20.

---

## 10 · Clean relaunch

Staging is disposable, and a staging environment assembled by **replication** or carrying state from
an earlier attempt is worth rebuilding rather than reasoning about. Inherited state is the thing you
cannot audit: you can check the variables you thought to check, and the one you did not think of is
the one that matters.

> ### ⛔ PRODUCTION IS OUT OF SCOPE FOR EVERY STEP BELOW
> `Postgres`, `cms-postgres` and `rfp-pipeline-bucket` in the **production** environment are live —
> the bucket alone holds 817 MB of customer artifacts, and the databases hold everything else.
> Nothing here touches them. Confirm the environment selector reads **staging** before each
> destructive step; Railway's environment switcher is the only thing standing between the two, and
> it is one click.

### 10.1 What to destroy

| Target | How | Why not something gentler |
|---|---|---|
| staging `Postgres` | delete the service, recreate it | `DROP SCHEMA` leaves roles, extensions, `_migration_history` and the `govtech_app` grant state behind — a fresh service is the only way to know what you have |
| staging `cms-postgres` | delete the service, recreate it | same |
| staging `rfp-pipeline-bucket` | empty it | already shows empty; confirm rather than assume (§10.4) |

Deleting a Railway Postgres service deletes its volume with it. **Both new services get new
connection strings**, so these four variables must be re-pointed afterwards — a relaunch that leaves
any of them stale is a staging service quietly talking to a database that no longer exists, or to
one that does:

`DATABASE_URL` · `DATABASE_URL_OWNER` (frontend) · `SHARED_DATABASE_URL` (rfp-crm) · `CRM_DATABASE`
(rfp-crm)

### 10.2 The order

1. **Delete** both staging Postgres services. Recreate them; confirm the image ships pgvector.
2. **Re-point** the four connection variables above.
3. **Set the rest of the variables from §4 explicitly** — do not inherit. If the environment was
   replicated, run §8.0 first so you know what you are correcting, then set every row it flagged.
4. **Redeploy frontend.** Its entrypoint runs `migrate.mjs` as `DATABASE_URL_OWNER` under `set -e`;
   watch for head **237**. Nothing else needs to run migrations — see §10.3.
5. **Re-do §5.1** — `ALTER ROLE govtech_app LOGIN PASSWORD …`. A fresh database recreates the role
   `NOLOGIN` from migration 094, so this does **not** survive a relaunch. Then point `DATABASE_URL`
   at it and redeploy.
6. **Re-do §5.2** — the master admin seed re-runs from the two pipeline variables. Also does not
   survive a relaunch.
7. **Redeploy** pipeline and rfp-crm.
8. Re-apply the §7 safety switches, re-enable DSIP, re-disable `sam_gov`, then run §8.

Steps 5 and 6 are the two that catch people out on a rebuild specifically, because both succeeded
the first time and neither is in the database any more.

### 10.3 Do not use the migration workflow for this

`.github/workflows/migrate.yml` already carries staging jobs (`Main DB → Staging`,
`CRM DB → Staging`), gated on the repo secrets `STAGING_DATABASE_URL`, `CRM_STAGING_DATABASE` and
`CMS_STAGING_DATABASE_URL`. It is **break-glass only** — `workflow_dispatch`, for ad-hoc recovery —
and the in-deployment path handles a relaunch on its own. Running it during a deploy is two runners
against one database, which is the race the in-deployment path exists to avoid.

⚠️ **Those three repo secrets are exactly the kind of leftover this relaunch is about.** If they
were set for an earlier staging attempt they now name a database that no longer exists — or one that
does and should not be touched. After step 1, either update them to the new staging connection
strings or delete them. A break-glass path pointed at the wrong database is worse than no
break-glass path.

It also cannot reach a database with no public endpoint, and the CRM database is internal by
design — so its CRM jobs will fail to connect, and the right response to that failure is to migrate
from inside the deployment, not to open the database.

### 10.4 Confirm the bucket is actually separate

The Railway graph showing production at 817 MB and staging as *empty* is good evidence, but the size
readout is the service wrapper, not proof of a separate store. Compare the injected values across
environments:

```bash
for env in production staging; do
  echo "── $env"
  railway variables --environment $env --service govtech-frontend --json \
    | grep -E 'AWS_S3_BUCKET|AWS_ENDPOINT_URL'
done
```

If both the bucket name **and** the endpoint are identical, the two environments share one store and
a staging export or atomize run will write into production's objects. §8.0 flags an identical bucket
name on its own, because the name matching is the signal worth stopping on even when the endpoint
differs.

### 10.5 Afterwards

Rotate the staging Anthropic and R2 keys on the same schedule as production. A staging key that
leaks is a smaller problem than a production key, but only if it was never a production key.

---

## Open questions for the operator

1. **Domain.** A Railway-generated subdomain is enough for everything except DMARC alignment. If
   email deliverability matters, a `staging.rfppipeline.com` CNAME makes §8.4 meaningful.
2. **Data.** Recommendation: build staging from the seed path plus one real ingested solicitation,
   not from a production dump. §7 explains why.
3. **Who can reach it.** Nothing in the app gates on environment. If staging should not be publicly
   reachable, put it behind Railway's private networking or an edge auth layer — that is a platform
   decision, not a code change.
