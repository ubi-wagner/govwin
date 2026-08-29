# Operating model — staging as the workshop, production on a gate

**Status:** proposed. **Decides:** who does what, unattended, once V1 is live.
**Instruments:** `frontend/scripts/classify-migrations.mjs` · `frontend/scripts/audit-env-parity.mjs`
**Companions:** `docs/STAGING_ENVIRONMENT.md` · `docs/TESTING_STRATEGY.md` · `RAILWAY.md`

The goal: **develop continuously on staging, and promote to production only what does not need a
migration window or a downtime.** That rule is an intention until two things exist — a definition of
"baselined" you can check, and a way to answer "does this need a window?" that is not a judgement
call made at the moment of shipping. This document supplies both, and proposes the autonomy
boundaries that follow.

---

## 1 · Two structural facts, established by reading the deploy path

Everything below follows from these. Neither is a problem; both are constraints that decide what is
safe.

### 1.1 Migrations run against the PREVIOUS release, live

`frontend/entrypoint.sh` runs `db/migrations/migrate.mjs` under `set -e`, then starts the server.
`railway.json` sets `healthcheckPath: /api/health`, so Railway holds traffic on the **old** container
until the new one answers healthy. The sequence on every deploy is therefore:

```
new container starts
  └── migrations applied          ← the schema changes HERE
      └── server.js listens
          └── /api/health passes
              └── traffic switches   ← the old release stops serving HERE
```

Between the migration and the switch, **the previous release is serving against the new schema.**
That is the whole basis of the "breaking" class in §3: a dropped column is not a lock problem, it is
a 500 on every request the old code makes in that window.

### 1.2 Every migration file runs inside one transaction

`migrate.mjs` does `sql.begin(tx => tx.unsafe(content))`. Atomicity per file, which is good — and it
makes `CREATE INDEX CONCURRENTLY` **impossible**, because Postgres refuses it inside a transaction
block.

That is not an oversight anywhere in the tree; it is a consequence. It is why **377 of 377 index
creations in this repo are non-concurrent**, and why 88 migrations classify as "locking" below. §6 is
the change that removes the constraint.

---

## 2 · What "baselined" has to mean

A baseline nobody can check is a feeling. This one is four recorded facts and one instrument run:

| | Recorded as |
|---|---|
| **Code** | an annotated git tag, `v1.0.0`, on the exact commit production is serving |
| **Schema** | the migration head at that tag — today **237** — plus `migrate.mjs --check` clean against production |
| **Build** | the `RAILWAY_GIT_COMMIT_SHA` each of the three services reports at `/api/health`, all three equal |
| **Config** | `audit-env-parity.mjs` clean, so staging and production are known to be separate systems |
| **Behaviour** | one recorded run of the full gate (§4) against production, with its output committed to `docs/` |

The last one is the point of the exercise. A baseline is not "it works" — it is a *recorded
measurement you can later diff against*. When something breaks in March, the question is "what
changed since the baseline", and that only has an answer if the baseline was written down.

**Production deploy freeze between the baseline run and the tag.** Otherwise the tag names a commit
that was never the thing measured.

---

## 3 · Change classes — and where this codebase actually sits

`classify-migrations.mjs` reads a migration and assigns the worst class in it. Run over all 237:

| Class | | What it is | Count |
|---|---|---|---:|
| **A** | code-only | no DDL. A container swap. | 61 |
| **B** | additive | new objects only; nothing existing locked or scanned | 51 |
| **C** | locking | locks an existing table for a duration that **scales with row count** | 88 |
| **D** | breaking | removes or renames something the running release may read | 36 |
| **E** | rewrite | rewrites the table under `ACCESS EXCLUSIVE` | 1 |

**125 of 237 — 53% — are class C or worse.** That is not alarming and it is not a criticism of the
work: every one of them ran against tables with tens of rows, where a `SHARE` lock is microseconds.
It matters only from the moment there is a production database with real volume, which is exactly
the moment this document is written for.

The distribution also says something useful about the *future*: class C is dominated by one pattern
(`CREATE INDEX` without `CONCURRENTLY`), and §6 converts that pattern wholesale.

`node frontend/scripts/classify-migrations.mjs --explain` carries the reasoning and the remedy for
each class. The short version:

- **C** → build indexes `CONCURRENTLY` (needs §6); add constraints `NOT VALID`, then `VALIDATE` in a
  later migration, which takes a weaker lock.
- **D** → expand/contract across three deploys: add and dual-write · switch reads · drop. Never one.
  There are **no down-migrations** — the runner is forward-only — so a bad contract step is fixed by
  rolling forward, which is a good reason not to take one casually.
- **E** → an announced window, or expand/contract with a backfill.

---

## 4 · The promotion gate

Nothing here is new. It is the existing verification backbone, pointed at staging, plus the
classifier.

```bash
# 1 · the build is sound
cd frontend && npx tsc --noEmit && npx vitest run && npx next build

# 2 · the change is classified
node scripts/classify-migrations.mjs --since <first new migration>

# 3 · staging agrees with reality
GUIDE_BASE=https://<staging> GUIDE_DB=<staging owner> node scripts/verify-surfaces.mjs
#   … verify-api-contract, verify-db-crud, verify-ui-vs-db, verify-write-contract
GUIDE_BASE=https://<staging> ./scripts/run-branch-drives.sh
node scripts/audit-automation-spine.mjs && node scripts/audit-pipeline-coherence.mjs

# 4 · the two environments are still separate systems
node scripts/audit-env-parity.mjs /tmp/envdump
```

**Promotion is allowed when:** every step green, the classifier says **A or B**, and the diff touches
nothing in the reserved list (§5.3).

**Promotion is a conversation when:** the classifier says C, D or E. Not a refusal — a class-C index
on a small table is fine, and only you know the row count. The gate's job is to make sure the
question gets asked.

---

## 5 · The autonomy ladder

Written conservatively on purpose. Every line can be widened once it has been boring for a while;
none of it should be widened because a particular change is in a hurry.

### 5.1 Unattended, on staging

Everything. Staging is disposable and rebuildable from `docs/STAGING_ENVIRONMENT.md` §10 — that is
what makes it the right place for me to work without asking. Implement, migrate, run the mutating
drives, break it, rebuild it. I report what I did; I do not ask first.

### 5.2 Unattended, to production — **only if you grant it**

My proposal: **class A and B only**, gate green, and merged through a PR that CI has passed. Even
then I would rather this be *you clicking merge* than me pushing, for one specific reason: the value
of a second pair of eyes is highest exactly where the change looks routine, and class A/B is where
"looks routine" lives.

If you do want it hands-off, the safe shape is: I open the PR with the gate output in the body, CI
gates it, and **auto-merge is enabled only for PRs the classifier marked A or B**. The classifier's
exit code makes that mechanical rather than a matter of trust.

### 5.3 Always yours, whatever else we agree

- Anything the classifier marks **C, D or E**
- Anything touching **auth, RLS policies, or the tenant boundary** — the blast radius is other
  people's data, and `docs/SECURITY_AND_SAFETY.md` treats these as a separate category for that reason
- Anything touching **billing or purchases**
- **Data backfills and destructive operations** on production, including archive cascades
- **Credential rotation**, and any new external service
- The production **deploy trigger** during the V1 stabilisation period

### 5.4 What I owe you either way

A short written record per change: what it does, its class, the gate output, and what I could not
verify. That last field is the one that matters — "uncovered is not passing" is the rule the whole
verification backbone is built on, and it applies to my own reports.

---

## 6 · The one change that moves the most future work into the safe class

**Add a per-file no-transaction marker to `migrate.mjs`**, so a migration that needs
`CREATE INDEX CONCURRENTLY` can opt out of the transaction wrapper:

```sql
-- migrate:no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_foo_bar ON foo (bar);
```

The runner reads the marker in the file header and applies that file with `sql.unsafe(content)`
outside `sql.begin`. Every other file is unchanged.

**The trade, stated plainly:** such a file is no longer atomic. A `CONCURRENTLY` build that fails
leaves an `INVALID` index behind, which you drop and retry. That is a known, recoverable state, and
it is a much better one than blocking writes on a large table for the length of a build. Every
mainstream migration tool — Rails, golang-migrate, sqlx — has this marker for exactly this reason.

Scope: ~20 lines in `migrate.mjs`, one self-test, and a note in `CLAUDE.md`. It is the highest-
leverage change available for the stated goal, because it converts the dominant cause of class C
into class B **for every migration written from here on**.

I have not made this change — it touches the migration runner, which is squarely in §5.3
territory. Say the word and it is a small, well-understood piece of work.

---

## 7 · Cadence

| | |
|---|---|
| **Continuous** | I work on staging; the gate runs on every change |
| **Per change** | a written record (§5.4), and a PR if it is destined for production |
| **Weekly** | a summary: what shipped to staging, what is queued for production, what is blocked and why |
| **Before any promotion** | the gate output, and the classifier's verdict, in the PR body |
| **Monthly** | re-run the baseline measurement and diff it against the recorded one — drift is only visible against a record |

---

## 8 · What I need from you to start

1. **The V1 baseline run** — production deploy freeze, run the gate, record it, tag `v1.0.0`.
2. **A decision on §5.2** — hands-off for class A/B, or PR-and-you-merge. Either works; I would
   start with the second and revisit after a month of it being boring.
3. **Production row counts for the ten largest tables.** Class C is a *size* question and I cannot
   see production. With those numbers I can tell you which existing index patterns would actually
   have hurt, rather than only that they are the risky shape.
4. **Confirmation of the reserved list** in §5.3 — add anything I have not thought of. It is easier
   to widen a boundary later than to discover one was missing.

---

## Related

- `docs/STAGING_ENVIRONMENT.md` — standing it up, the keys, the clean relaunch
- `docs/TESTING_STRATEGY.md` — the four verification rules and what each lens can and cannot see
- `docs/AGENT_SPEND_AND_CAPS.md` — what the AI costs per build, and the caps that bound it
- `RAILWAY.md` — deploy mechanics, the CI gate before, the verify gate after
