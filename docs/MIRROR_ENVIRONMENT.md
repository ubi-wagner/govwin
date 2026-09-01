# Mirror environments and persistent repo access — what is actually possible

**Measured 2026-09-01** by doing it, not by reading documentation. Every capability below was
exercised from a live session; every limit was hit rather than assumed.

---

## 1. What is verified to work

| capability | evidence |
|---|---|
| **GitHub access from a session** | authenticated as `ubi-wagner`; branch listing returns `claude/nice-hamilton-kBqtD @ 687c1669`, matching the local push. Scoped to `ubi-wagner/govwin` — calls to any other repo are denied. |
| **Spawning a mirror session** | `create_session` into `env_01WeeRGAFXPJppQUBXDfHxZa` (GovWin, `anthropic_cloud`) returns a running session with `parent_session_id` set to the spawner. |
| **Reading a mirror's state** | `get_session` returns its status, its pending permission requests, and its rate-limit posture. |
| **Ending one** | `archive_session` transitions it to archived and releases the container. |
| **Scheduled wake-ups** | Routines (`create_trigger`) can fire into this session, a named session, or spawn a **fresh** session per firing. |

The environment is **`env_01WeeRGAFXPJppQUBXDfHxZa`**. A mirror is a full sibling container: same
repo, its own filesystem, its own Postgres, its own build.

---

## 2. The limits — found by hitting them

These are the parts that decide whether the idea is usable, and none of them are obvious from the
outside.

### 2a. ⛔ An unattended mirror stalls on its first permission prompt

**The first mirror I spawned died immediately.** It called `get_session` to orient itself, hit a
permission prompt, and went to `SESSION_STATUS_REQUIRES_ACTION` — *"Waiting on permission…"* — where
it would have sat forever. Nobody was watching it. It never ran a single command of its actual task.

This is the single most important fact about mirrors: **an autonomous session is only as autonomous
as its narrowest permission.** The mitigation is a prompt that forbids prompting tools outright and
supplies, in the prompt itself, everything the session would otherwise go looking for. Orientation
is what triggers the stall.

### 2b. ⛔ A spawned cloud mirror cannot be steered from the session that spawned it

`ListAgents` lists same-machine sessions. A cloud sibling does not appear there, so `SendMessage`
has no address for it. The parent can **create**, **read status**, and **archive** — it cannot
converse. A stalled mirror therefore cannot be rescued by its parent; it can only be archived and
replaced.

Consequence for design: **a mirror's whole task must fit in its opening prompt.** Anything
iterative belongs in the primary session.

### 2c. A mirror shares the repo, and nothing else

No shared database, no shared sandbox, no shared filesystem. Two mirrors cannot collaborate on one
box. This makes them good at **independent verification** (run the suite, run the lenses, review a
diff, cold-start) and useless for **collaborative driving**.

### 2d. Cost is real and multiplies

This primary session has spent **$6,168** to date. A mirror doing comparable work costs comparably.
Parallelism is a spend decision, not a free lunch.

### 2e. Containers are ephemeral

A mirror is an on-demand VM, not a standing one. It is reclaimed after inactivity. **What persists
is the repo and the Routines** — never a mirror's local state. Anything a mirror learns must be
pushed, or reported, or it is gone.

---

## 3. The architecture that follows

Given those limits, the shape that works:

```
   PRIMARY SESSION            MIRRORS (fan out, never converse)        ROUTINES
   ───────────────            ────────────────────────────────        ────────
   drives, decides,     ──▶   one bounded question per mirror,   ◀──  spawn a fresh
   iterates, fixes            answered in one shot, reported          session on a
                              back and archived                       schedule
        │                                                                  │
        └──────────────────── the repo is the only shared state ───────────┘
```

**What each is good for**

* **Primary** — anything iterative. Driving, diagnosing, deciding, fixing. Me, with you.
* **Mirror** — one closed question, phrased so completely that no orientation is needed:
  *"cold-start and report"*, *"run the 60 drives on this SHA and report"*,
  *"run the five lenses and report"*, *"review this diff adversarially and report"*.
  Parallel to the primary, never dependent on it.
* **Routine** — the unattended cadence. A fresh session per firing, which sidesteps 2e entirely
  because there is no state to keep.

**The rule that makes it airtight:** a mirror's prompt must contain every fact it would otherwise
look up, and must forbid the tools that prompt. Write it as if for someone with no context and no
way to ask a question — because that is exactly what it is.

---

## 4. What to actually set up for the first few weeks

Ordered by value per unit of risk.

1. **A nightly Routine on `main`** — fresh session, cold-start, `tsc` + `vitest` + the 60 branch
   drives, report. This is the strongest form of "airtight" available: it catches drift with zero
   human effort, and it re-proves the cold start every night, so the runbook cannot rot.
   ⚠️ It spends autonomously every night. That is a standing commitment and should be an explicit
   decision, not a side effect of this document.
2. **A PR watcher** — `subscribe_pr_activity` wakes a session on CI failures and review comments,
   so a red build is noticed rather than discovered.
3. **On-demand mirrors during a drive** — while the primary drives a lane, a mirror re-runs the
   suite on the same SHA. Verification in parallel with the work rather than after it.
4. **A weekly doc-currency Routine** — `audit-doc-currency` + `audit-producer-consumer` +
   `audit-dead-code`, reported. Cheap, and it is exactly the class of rot that goes unnoticed.

**What NOT to do:** a mirror that tries to fix what it finds. It cannot be steered, it cannot ask,
and an unattended session pushing code it decided on alone is how a Friday becomes a Saturday.
Mirrors report; the primary fixes.

---

## 5. Cold-start: the property everything depends on

If a fresh container cannot stand itself up, none of the above works — every mirror and every
Routine begins with exactly that step.

`frontend/scripts/rehydrate-sandbox.sh` is the one command that is supposed to do it: Postgres,
role and database, migrations, seed, build, staging, verify. It gained a rebuild-when-source-is-
newer check today, after a stale build faked a customer-facing 404.

**Mirror B was spawned to answer precisely this**, unattended, with a prompt written under the
rule in §3. Its report is the measurement, and the most valuable line in it will be any step that
needed a workaround — a step a human had to figure out is a step the runbook is missing, and it is
also the step that will silently break the nightly Routine at 3am.
