# SESSION LIFECYCLE — the sweep, the gaps, and the plan

**2026-09-03.** Every actor, every session state, what actually ends a session, and what is left
behind when one ends. Measured on a running box (`frontend/scripts/probe-session-lifecycle.mts`),
not read off the config.

Related: **docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md** (who a session acts as),
**docs/PARTNER_MANAGER_DESIGN.md** (descent), migs 246/247 (`space_presence`),
**docs/DEPLOYMENT_READINESS_2026-09-03.md** §2e (the staff-revocation gap).

---

## 0. The three risks this exists to answer

1. A **collaborator** signed in and never forced out, timed out, or logged out.
2. A **tenant employee**, the same.
3. Worst: a **partner-manager or shadow admin** who drops into a customer's workspace to do one
   task, never ascends, is never pushed back up on inactivity, and whose home session then never
   ends either. That one writes into *someone else's* audit trail the entire time.

And underneath all three: when a session does break, **is the machine's state knowable and
actionable** — or does the interrupted work simply have to start over?

---

## 1. What a session actually is here — MEASURED

`auth.config.ts` says `session: { strategy: 'jwt', maxAge: 8 * 60 * 60 }`. That one line has two
opposite meanings, and the difference is the whole posture:

* **ABSOLUTE** — dead 8 hours after sign-in, whatever you do.
* **SLIDING** — dead 8 hours after the *last request*; an active session renews forever.

It is **SLIDING**. Measured, with a control that proves a refresh is detectable at all:

```
CONTROL  /api/auth/session                                        +3s   ← refresh is visible
         a PAGE render (server component calling auth())          +2s   SLIDES
         an API route calling auth() → its own NextResponse       +2s   SLIDES
         POST /api/presence/heartbeat (unattended 2-min timer)     +1s   SLIDES
```

Every request re-signs the cookie with a fresh 8-hour deadline. The `updateAge` throttle that would
prevent this applies only to the **database** strategy; the JWT branch of `@auth/core`'s session
action re-signs unconditionally.

**There is no absolute session cap anywhere in this system.**

### 1a. The heartbeat renews the session of the actor it is watching

`PresenceHeartbeat` is mounted **only** for an rfp_admin shadowing or a partner-manager descended
into a client company. It POSTs `/api/presence/heartbeat` every 2 minutes while the tab is visible.
That route calls `auth()`. Therefore, for an outside actor inside a customer's workspace:

* the **session** never expires — the heartbeat renews it every 2 minutes, and
* the **bracket** never times out — `last_seen_at` advances every 2 minutes, well inside the
  45-minute idle floor.

A visible-but-unattended tab — a monitor left on over a weekend — holds **both** open indefinitely,
and the customer's audit trail asserts an RFP administrator is in their account the whole time.

This is not a criticism of the heartbeat, which was built to stop the sweep writing a *false*
departure while somebody was still working (a real defect, correctly fixed). It is that liveness of
a **tab** was made to stand for presence of a **person**, and those diverge exactly when it matters.

---

## 2. The matrix — every actor × every session state

`✓` handled · `—` not applicable · `⚠` gap.

| state | tenant_user / tenant_admin | partner_user (collaborator) | partner_admin descended | rfp/master_admin shadowing |
| --- | --- | --- | --- | --- |
| active | ✓ renews | ✓ renews | ✓ renews, bracket open (correct) | ✓ renews, bracket open (correct) |
| idle < 8h | ✓ | ✓ | ✓ | ✓ |
| **idle ≥ 8h, no requests** | ✓ token expires | ✓ token expires | ✓ expires; sweep closes bracket at 45m | ✓ expires; sweep closes bracket at 45m |
| **idle, tab VISIBLE** | ⚠ renews forever (no heartbeat, but any polling does it) | ⚠ same | ⚠ **never ends** — heartbeat renews session *and* bracket | ⚠ **never ends** — same |
| tab closed | ✓ expires after 8h idle | ✓ | ✓ sweep at 45m **if enabled** | ✓ sweep at 45m **if enabled** |
| explicit sign-out | ✓ | ✓ | ✓ `signed_out` closer | ✓ `signed_out` closer |
| explicit exit / ascend | — | — | ✓ `explicit` | ✓ `explicit` |
| moved A → B | — | — | ✓ `moved` closes A | ✓ `moved` |
| membership revoked | ✓ denied next request | ✓ denied next request | ✓ | — (derived, see below) |
| tenant archived | ✓ denied next request | ✓ | ✓ | — |
| role downgraded | ✓ capped next request | ✓ capped | ✓ capped | ⚠ **not re-read** |
| **staff account disabled** | — | — | — | ⚠ **up to 8h idle; no in-product way to do it at all** |

**Customer-side revocation is immediate** and that is worth stating plainly: `verifyTenantAccess`
reads `user_memberships JOIN tenants` on every request and fails closed on role escalation, so
revoking a membership or archiving a tenant bites on the **next request**, not at token expiry.

**Two gaps are structural, not bugs:**

* An **rfp_admin has nothing to ascend from.** `isShadowAdmin` is computed per render as
  `isAdmin && !hasActiveMembership(...)` — being on a portal URL *is* the descent. There is no flag
  to clear, so "force them back up" cannot be a state reset; it has to be a **gate that refuses**.
* `closePresence` **closes the row only** — it touches no session state. The sweep evicts the
  *record*, not the *actor*. After a timeout close, the same admin's next hard portal load calls
  `syncPortalPresence` and opens a fresh bracket. The customer sees enter → exit → enter with nobody
  having done anything.

---

## 3. What is left behind when a session breaks

The user's scenario: *the ToDo may have started, then distraction, then a push-up-and-out — and then
it has to start over again.* Here is what each kind of in-flight work actually does.

| in-flight work | survives a session break? | why |
| --- | --- | --- |
| **A platform ToDo** | ✓ claimable (P3) — was: **no record it was ever started** | `tasks.status` allows `in_progress` and **nothing writes it.** Live distribution on this box: `open: 47 · completed: 65 · expired: 2` — zero `in_progress`, ever. A ToDo is binary |
| **A section being edited** | ✓ recovered | `canvas-editor.tsx` autosaves to `localStorage` and offers recovery on return; `canvas_versions` holds the last committed state |
| **A locked section** | ✓ correctly kept | CORRECTED: this is not an editing lock. Locking is the deliberate accept stricture — it advances the compliance matrix, snapshots the canvas and harvests to the library. It SHOULD survive. `editing_by`/`editing_since` exist but are set nowhere and read by nothing; the editor uses optimistic concurrency instead |
| **An agent task** | ✓ reaped (P4) | Was stuck: nothing ever moved a `running` row back. Now failed with a stated reason after 30m, by the consumer itself before it claims anything new |
| **A paused workflow instance** | ✓ by design | HITL instances wait for a human indefinitely — correct, but see §5 |
| **A presence bracket** | ✓ *if the sweep is enabled* | gated on `SPACE_PRESENCE_SWEEP_URL` + `CRON_SECRET`, both unset today |

The ToDo row is the important one, and it is worth being precise about *why* it hurts. Because
nothing claims a ToDo:

* the person who comes back cannot tell which of the 47 open items they had already started,
* two people can start the same one with no signal,
* an operator reading the queue cannot distinguish *untouched* from *half-done*, and
* the "started" work leaves no trace to resume from — hence "start over again".

---

## 4. What already exists — do not rebuild it

* **`space_presence` (migs 246/247)** — a real bracket with five closers (`explicit`, `left_space`,
  `moved`, `timeout`, `signed_out`), all wired, 4–5 call sites each.
* **`/admin/workspace-access`** — the operator surface. *Who is inside a customer's workspace right
  now, and for how long*, with a bracket past the idle floor sorted to the top so a sweep that is
  not running has a visible face.
* **`verifyTenantAccess`** — per-request authority, fail-closed on escalation.
* **`drive-space-presence.mts`** — 28 checks over all five closers plus the heartbeat.

The gap is **not** presence. Presence is well built. The gap is that presence is a *record* and
nothing turns it into a *decision*, plus there is no equivalent record for an ordinary session at
all.

---

## 5. The plan

Ordered by who is harmed, worst first. Each step names the check that would prove it.

### P1 — An absolute cap, and a real idle timeout (highest value, smallest change)

Two separate numbers, because they answer different questions:

* **Idle timeout** — the sliding `maxAge`, shortened. 8 hours of *idle* is too long for a
  workspace holding other companies' unreleased solicitations. Propose **2h** for tenant actors,
  **30m while descended**.
* **Absolute cap** — stamp `iat` on the JWT at sign-in and refuse a token older than **12h**
  regardless of activity. This is the one that does not exist at all today, and it is the only thing
  that bounds a session in the limit.

Implement in the `jwt` callback (return `null` past the cap → the session ends). No migration.

*Check:* extend `probe-session-lifecycle.mts` — an old `iat` must be refused even on an active
session.

### P2 — The descent expires before the session does

Inside a customer's workspace, inactivity should end the **descent** first and the session second.
Since an rfp_admin has no descent flag, this is a gate:

* Record `descended_at` / `last_interaction_at` on the presence bracket (it is already there —
  `last_seen_at`).
* In the portal layout's admin branch, if the bracket's `last_seen_at` is older than the descent
  idle window, **refuse and redirect to `/admin`** with "your access to this workspace timed out —
  re-enter to continue", and close the bracket as `timeout`.
* **The heartbeat must stop counting as interaction.** Split the two: a `last_seen_at` (tab alive,
  what the sweep reads) and a `last_interaction_at` (a request the person actually caused, what the
  descent gate reads). This is the one change that closes §1a — today they are the same column, and
  that is precisely why an unattended tab reads as a working admin.

*Check:* a drive that opens a bracket, pings only the heartbeat for the window, and asserts the
descent is refused while the *session* remains valid.

### P3 — A ToDo can be claimed, and a claim expires

Use the `in_progress` state that already exists in the CHECK constraint and has never been written.

* `POST …/tasks/[id]/claim` → `in_progress`, `claimed_by`, `claimed_at`.
* Opening the work surface from the ToDo claims it.
* A claim older than the idle window **reverts to `open`** on the same sweep that closes brackets,
  emitting `system:task.claim_expired` so it is visible rather than silent.
* The ToDo carries a `resume_href` — the section, the solicitation, the milestone — so coming back
  lands where the person left rather than at the top of the queue.

This is the direct answer to *"have to start over again"*: the claim is what records that work
started, and the resume link is what makes returning cheap.

*Check:* claim → let it expire → assert it is `open` again, with the event, and that a second person
could not claim it while it was held.

### P4 — Release what a dead session was holding  ✅ SHIPPED, and one third of it was wrong

**Corrected on contact with the code.** This step listed three things; only two were real.

* ~~**Section locks** whose holder has no live session → released.~~ **Wrong, and dangerous.** A
  section lock is not an editing lock — it is the deliberate accept/lock stricture
  (`lib/proposal/lock-section.ts`): it advances the compliance matrix, snapshots the canvas version,
  harvests to the atom library and rolls up the volume. The 65 locked sections on the sandbox, oldest
  from 2026-08-01, are *correctly* locked. Reaping them would have destroyed accepted work. This is
  verification rule 4 — *assert the contract the system HAS* — and the plan asserted one it does not.
* **There is no editing lock to reap either.** `proposal_sections` carries `editing_by` /
  `editing_since`, cleared in five places and **set nowhere**, read by nothing, held by zero rows —
  the same declared-and-never-written shape `in_progress` had. The editor uses optimistic
  concurrency instead (local autosave plus a 409 on a stale `baseVersion`), which needs no reaper.
  Left as a documented dead pair rather than built on.
* **Agent tasks** `running` past a ceiling → `failed` with a reason. **This one was real and is
  done.** Nothing ever moved a `running` row back, so a worker that died mid-task left it there
  forever — no error, no retry, the work simply never finished. `failed` rather than re-queued to
  `pending`: an invocation costs money and may already have had side effects, so silently re-running
  would bill twice and could land two drafts.
* **Claims**, per P3 — shipped with it, since a claim without an expiry is a stalled queue.

*Proven:* `pipeline/tests/verify_stale_task_reaper.py`, red then green, driving the REAL consumer
rather than a copy of its SQL. Its second check is the pairing that matters — a task still inside the
ceiling must be **left alone**, or an inverted comparison would pass every other check while killing
the live queue.

### P5 — Make the state knowable: extend the operator surface

`/admin/workspace-access` answers the descent question well. Extend the same page (do not build a
second one) with:

* **Live sessions** — actor, role, where, idle for how long, absolute age. There is no session table
  today, and a JWT strategy has none by definition — so this reads `space_presence` for outside
  actors plus a lightweight `last_interaction_at` per user for everyone else.
* **Held work** — claimed ToDos, locked sections, `running` agent tasks, each with its age, so an
  operator can see what a break stranded.
* **Act on it** — force-ascend an actor (close the bracket + refuse the descent until re-entry), and
  release a held claim or lock. Today the page can only *observe*.

### P6 — Agents are sessions too

An agent has no session, but it has the same lifecycle question: *issued → running → completed*, and
the same failure — issued work with nothing watching it. P4 gives it a reaper. Beyond that, the
correlation an operator needs is **which human's action issued this agent task**, so a task orphaned
by a session break is attributable. `agent_task_queue` should carry the issuing actor and the ToDo it
came from.

---

## 6. What ships first

P1 and P2 are the security answer and are small: a cap in the `jwt` callback, and one column split
plus a gate in the portal layout. P3 is the autonomy answer the user actually described, and it needs
no migration either (`in_progress` is already legal; `claimed_by`/`claimed_at` are the only new
columns).

P4–P6 are the "state of the machine is knowable" half and should follow immediately, because P1–P3
create *more* interrupted work by design — a session that ends on time strands more than one that
never ends.

---

## 7. Honest notes on this sweep

* The session behaviour in §1 is **measured**, with a control that fails the probe rather than
  reporting a comfortable answer it could not earn.
* The `in_progress`, lock, and agent-reaper findings are **absence** findings, verified by querying
  the live distribution and by searching for a writer, not by reading a design doc.
* Not covered: concurrent sessions per user across devices (no session table, so not observable
  today — P5 would make it so), and CSRF/cookie flags, which are NextAuth defaults and were not
  re-audited here.
