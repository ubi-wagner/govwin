# Producer / consumer asymmetry — the "works by itself but does nothing for the system" sweep

**First run 2026-09-01.** Instrument: `frontend/scripts/audit-producer-consumer.mjs`.
Regenerate with `source scripts/sandbox-env.sh && cd frontend && node scripts/audit-producer-consumer.mjs`.

---

## Why this exists

Every other instrument here asks whether what the product does, it does **correctly**. None asked
whether the two halves of a thing are actually **joined**. That gap has produced the same defect
repeatedly, and it is the most expensive class in this codebase because nothing else can see it:

| | what was correct | what was missing |
|---|---|---|
| `applications.session_id` | the column, the route, `contacts`, `/admin/funnel`, the drive | no form ever sent it |
| `tenant_profiles` | the Profile page wrote it, the bucket prefill read it | the accept route never wrote it |
| the domain audit trail | 45 call sites, all correct | the table was dropped 74 migrations earlier |
| `billableHours` | computed correctly | never once called |
| suppression list | enforced correctly | no way to lift an entry |

Each was found by accident, months apart. **They are one shape: a producer with no consumer, or a
consumer with no producer.** A correctness lens cannot see it — the code is correct. A coverage lens
cannot see it — the code is covered. Only asking *"is the other half there"* finds it.

## What it checks

1. Every table column, classified WRITTEN / READ from the source of all three services (plus
   migrations, which are a real if one-time writer), crossed with whether the column holds data.
2. Environment variables read by code, against every deploy document.

**A finding is a question, not a defect.** A column written only by a migration, or by Python while
its reader is TypeScript, legitimately lands in an asymmetric cell. The report says which evidence
produced each cell, and the audit excludes what it cannot honestly judge: 50 ambiguous column names
(`status`, `value`, `id` — a hit says nothing), NextAuth's adapter tables and generated `_tsv`
columns (the writer is a library or Postgres, invisible to a source scan), and the meta-instruments
themselves — this file's own scanner read its own source on the first run and failed its control
case, which is exactly what the control case is for.

---

## Standing findings

### Confirmed — a capability that looks live and is not

**`rate_limit_state`** — three sources configured (`sam_gov` 100/hr, `sbir_gov` 30/hr, `grants_gov`
50/hr), `hourly_used`/`daily_used` at zero, and **no code reads or writes the table**. Its only
mention in the tree is a comment in `frontend/lib/rate-limit.ts`: *"For multi-container: migrate to
rate_limit_state table or Redis."* The table is a PLAN. Live rate limiting is per-container and
in-memory, which means it does not hold across containers and does not protect a third-party quota
the way the configured numbers imply. Nothing is broken; the risk is that somebody reads those rows
and believes the SAM.gov quota is defended.

**`system_health_snapshots`** — zero rows, and referenced by **nothing in any of the three
services**. Dead schema: no writer, no reader, no surface.

**`api_key_registry.encrypted_key` · `key_hint`** — the reader half is live
(`pipeline/src/crypto.py` → `sam_gov.py`); nothing ever writes it; all rows are NULL and the
documented `SAM_GOV_API_KEY` env fallback is the real path. Documented in `frontend/lib/crypto.ts`.

### Already decided — the instrument found an existing answer

**`source_health.*`** — written once by the pipeline, deliberately NOT read by `/admin/scouts`,
which explains why in its own header (bug log B53). Correct behaviour, correctly documented; listed
here so a future run does not re-open it.

### Worth a look, not yet judged

* `scout_runs.found_count` · `new_count` · `acted_count` — the scout records what it found and no
  surface displays it.
* `agent_performance.avg_cost_usd` — cost per agent computed, never surfaced.
* `contracts.award_amount_cents` — read, never written; the contract value is not recorded anywhere.
* `canvas_versions.parent_version_id` — version lineage has a column and no writer.
* `proposals.stripe_payment_id` — written; nothing reads it (self-serve checkout is descoped).
* 23 columns touched by no code at all (§3 of the report) — schema that was declared and never used.

---

## How to read a run

* **§1 read, never written** — the dangerous cell. A consumer waiting for a producer. Check whether
  the column is also EMPTY: unwritten *and* empty means nothing has ever filled it.
* **§2 written, never read** — work the system does for nobody. Either a missing surface or a dead
  write. Cheaper to fix, less dangerous to leave.
* **§3 touched by nothing** — declared schema that was never wired at either end.
* **§4 env vars** — a variable nobody documents is a variable nobody sets, and code that reads one
  takes its fallback silently. Same shape as an unwritten column.
