# Claude VM — setup & replication (V1 baseline)

One command rebuilds the dev VM to the canonical V1 baseline:

```bash
bash scripts/replicate-vm.sh
```

It is **idempotent and restart-safe** — run it after every container reclaim. It does only what's
stale, and finishes with a served app + a login smoke test.

## What the VM is

- **One repo**, three services (`frontend/` Next 15, `pipeline/` Python, `services/cms/` FastAPI).
  Frontend + Pipeline share one PostgreSQL DB (`govtech_intel`); CMS has its own.
- **Sandbox Postgres** at `127.0.0.1:5433` (data dir `/tmp/pgs_gov/data`, socket `/tmp/pgs_gov`,
  superuser role `claude`). `DATABASE_URL=postgresql://claude@127.0.0.1:5433/govtech_intel`.
- The app is served **standalone** (`output:'standalone'`): `next start` is broken, so we run
  `node .next/standalone/server.js` after staging `.next/static` + `public`. **Auth is host-bound** —
  sign in at `http://localhost:3000`, never `127.0.0.1:3000`, or NextAuth bounces to `/login`.

## What `replicate-vm.sh` does (5 steps)

1. **Sync git** — a reclaim reverts local HEAD; it fetches + hard-resets to
   `origin/claude/nice-hamilton-kBqtD` (all work is pushed, so nothing is lost).
2. **Postgres** — starts the cluster (initdb + createdb if the data dir is gone).
3. **Migrations** — `node db/migrations/migrate.mjs` (idempotent; tracks by filename+sha256). This
   restores the **schema + all seeds**, including the two partner-managers. A reclaim can revert the
   sandbox DB to an older snapshot; re-running migrate simply applies the pending ones.
4. **Dev passwords** — sets a known password (`DemoPass123!`) on the demo actors (their
   `temp_password` would otherwise force a reset). **DEV ONLY.**
5. **Build + serve + smoke** — `next build`, stage, serve on `:3000`, then run the
   `hitl-partner-manager` Playwright project as a login/flow smoke test.

## The seeded V1 demo state (pure migrations — replicates identically)

| Actor | Login | Role | Notes |
|---|---|---|---|
| Paul Jackson | `pjackson@ecinnovates.com` | `partner_admin` | Own org **Entrepreneurs' Center** (mig 159); owns client **Foundation** with a submitted TVSF proposal |
| Stephanie Gaffney | `sgaffney@ybi.org` | `partner_admin` | Own org **Youngstown Business Incubator** (mig 162) |
| RFP admin | `e2e-rfpadmin@rfppipeline.test` | `rfp_admin` | approves partner registrations, releases portals |
| Master admin | `e2e-master@rfppipeline.test` | `master_admin` | full system |

> **Prod** never gets dev passwords or these throwaway logins — only the committed migrations
> (partners seeded with a bcrypt hash + `temp_password=true`; plaintext delivered out-of-band).

## Migration numbering (partner-manager V1)

`158` foundations (membership source, `tenants.kind`, `applications.source`, trgm index) ·
`159` Entrepreneurs' Center seed · `160` backfill partner owner memberships ·
`161` normalize legacy partner source · `162` YBI/Stephanie seed.

## Common recovery cues

- **`db/migrations/*.sql` missing / HEAD on an old commit** → reclaim reverted the tree. Re-run the
  script (step 1 fixes it), or `git fetch origin <branch> && git reset --hard origin/<branch>`.
- **`_migration_history` maxes below the latest file** → the DB snapshot reverted; re-run migrate.
- **Login bounces to `/login`** → you hit `127.0.0.1:3000`; use `localhost:3000`.
- **Page renders unstyled** → static not staged: `cp -r .next/static .next/standalone/.next/static`
  (remove any nested `static/static` first) and restart the server.

Full sandbox/PDF-tooling recipes: `docs/CONTINUATION.md §2`.
