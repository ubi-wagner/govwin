# The admin companion — a plan for live driving with a real key

**Written 2026-09-01**, ahead of the staging session. Companion documents: docs/ADMIN_AGENT_DESIGN.md
(the `rfp_ingest_manager` pattern this follows), docs/AGENT_WORKFORCE.md (the invariants any new
archetype inherits), docs/LAUNCH_GAPS_2026-09-01.md.

---

## 0. Three things are being asked for, and only one of them is software

It is worth separating them, because the cheapest has the highest value and the most expensive has
the least.

| | what it is | cost | when it helps |
|---|---|---|---|
| **A driving plan** | a procedure for exercising every surface with a live key | none — writing | the staging session, immediately |
| **An observation window** | a read-only admin surface showing what an action ACTUALLY did | small | every live session, forever |
| **A companion agent** | an advisory pass over those observations | medium | when nobody is watching closely |
| **A chat companion** | ask it follow-up questions | large | rarely, honestly |

**The recommendation is to do them in that order, and to decide after the second whether the third
is still wanted.** By then we will have driven a real session and will know.

### The thing worth saying out loud

For the staging session itself, *I am the companion*. Everything this document proposes building —
diagnose, evaluate, improve — is what this session has been doing, and a live drive with me in the
loop needs no new software at all. What in-product software buys is the moment **I am not in the
loop**: the admin alone, at 11pm, wondering why a portal did not release.

Building a Claude-in-the-product to do what a Claude-in-a-session already does better is duplicated
effort. Building the thing that makes a *solo* admin as observant as a paired one is not.

---

## 1. What actually goes wrong, and what would have caught it

This is not speculation — it is the defect list from this week, with the honest question of what
would have surfaced each one during a live drive.

| defect | would a chat companion have caught it? | would an observation window? |
|---|---|---|
| No form sent `_rfp_sid`; the whole funnel inert | no — nothing looked wrong | **yes** — "column written: none" |
| Accept never wrote `tenant_profiles` | no | **yes** — the write simply is not in the list |
| `terms_version` recorded `v1` for a v4 signature | no | **yes** — stored value ≠ the version on screen |
| Waitlist raised no ToDo | no | **yes** — an event with no consequent row |
| A stale build serving a 404 | no | **yes** — route missing from the build |
| 429 retried in 10s | no | **yes** — the same job re-queued immediately |

**Every one is a discrepancy between what happened and what should have happened — and none of them
looked wrong.** A conversational assistant answers questions you know to ask. The defects that
matter are the ones you do not know to ask about.

That is the whole argument for ordering: **observation before conversation.**

---

## 2. Phase 0 — the driving plan (no code, do this first)

A live drive is only evidence if it is systematic. The plan is a **lane per actor**, each with a
route to walk and a state to check afterwards, run in an order where each lane's output feeds the
next.

```
  LANE A · anonymous     marketing site → apply → waitlist → the two ToDos land
  LANE B · rfp_admin     intake → curate → shred → compliance → publish → fan-out
  LANE C · tenant_admin  cards → bucket → purchase (comp code) → provision → workflow accept
  LANE D · tenant_user   library upload → atomize → draft → section lock → package → download
  LANE E · rfp_admin     provisioning cockpit → complete & release → SLA
  LANE F · post-award    outcome=awarded → contract → project → CLIN → baseline → deliverable
  LANE G · reverse       amendment → fan-out → acknowledge; archive → restore
```

**Rules that make it evidence rather than anecdote:**

1. **One mutating action at a time.** Concurrency has manufactured false findings three times in
   one week (a rebuild during a capture sweep; a mutating suite beside a lens). Live driving is the
   worst place to repeat it.
2. **Snapshot before each lane** — `pg_dump` — so a lane can be re-run from the same start.
3. **After each action, three questions**: what event fired, what row changed, what does the page
   say. Disagreement between any two is the finding. This is what Phase 1 automates.
4. **Set a platform spend cap before the first AI action.** `spend-guardrails` and
   `full-build-cost` are in the suite but have only ever run against the emulator. A runaway should
   be a refusal, not a bill.
5. **Postmark on before the key.** Otherwise every notification in every lane lands as
   `status=failed` and the half of the system that reaches a human is untested. The production gate
   in `drive-application-intake` flips from `failed` to `sent`; that is the first thing to look at.

---

## 3. Phase 1 — the observation window (small, read-only, no AI)

**`/admin/observe`** — the surface that makes a live drive evidential.

Given a time window (default: the last 5 minutes) and optionally an entity, it assembles what the
system ACTUALLY did:

* **events** — `system_events` in the window, with their start/end bracket status, so an operation
  that opened and never closed is visible as itself
* **writes** — which tables changed and how many rows, from the audit trail and the event payloads
* **work items** — `tasks` raised, and who can see them
* **mail** — `email_send_ledger` rows reserved, sent, failed, suppressed
* **agents** — `tool_invocation_metrics`: which archetype ran, cost, duration
* **workflows** — `process_instances` started, advanced, stuck
* **errors** — anything the request logger recorded in the window

Then the part that matters: **the discrepancy list.** Not AI — arithmetic:

```
  an event with no consequent row          →  a producer with no consumer
  a row written with no event              →  an unaudited write
  a reserved ledger row never confirmed    →  a crash mid-send
  a workflow started and not advanced      →  a stuck instance
  a task created into a role nobody queries→  a notification nobody receives
```

**Why this is the right first build.** It is read-only, needs no key, costs nothing per use, works
when the AI is down, and — per §1 — would have caught every defect from this week. It is also the
input the companion needs, so it is not throwaway.

**Effort:** one page, one lib module, a handful of queries. It reuses `lib/event-labels.ts` so
events read as sentences rather than identifiers.

---

## 4. Phase 2 — `ops_companion`, the actual Claude companion

A new archetype, platform scope, following `rfp_ingest_manager` exactly.

**Input:** the structured observation window from Phase 1 — *not* free chat. That is deliberate:

* it is **testable** — same window in, same shape of report out;
* it is **injection-safe by construction** — the input is our own telemetry, not customer content,
  and any customer text in it is fenced;
* it is **cheap** — one call per invocation, not one per message;
* it **cannot drift into acting** — it receives a description of the past and returns prose.

**Output:** one advisory report — *what I observed · what looks wrong · what I would check next* —
rendered beside the window, and nothing else. It writes no business table, advances no gate, and
completes no task. Exactly the `AdvisoryOverlay` posture the fabric already enforces.

**Invocation:** a button on `/admin/observe`, and the doorbell pattern for a scripted drive.

**What it inherits for free** by being an archetype rather than a bespoke integration: the spend
caps, the kill switch, the rate limits, `tool_invocation_metrics`, the `/admin/agents` roster, and
the guardrail gate. A bespoke chat endpoint would have to re-earn every one of those.

---

## 4b. The curation loop — the machine reports, the human curates, the board keeps

**Decided 2026-09-01.** The nightly verification run and the notes board are deliberately NOT
wired together, and the human is the only path between them.

```
   NIGHTLY RUN                    YOU                       THE BOARD
   ───────────                    ───                       ─────────
   cold-start, tsc, vitest,  ──▶  read it over coffee  ──▶  add the one or two things
   60 drives, 2 audits            decide what matters       worth remembering
        │                                                        │
   push + email                                          survives every session
   raw, complete, unfiltered                             anchored · stated · audited
```

**Why not automate the last arrow.** It is the obvious next step and it is the wrong one. A machine
writing into the board floods a curated surface with raw output, and the signal — the two notes a
week that actually matter — gets buried under 30 green reports. The board's whole value is that
everything on it was worth someone's judgement. Automating entry destroys exactly that.

It also keeps the human as the integrity mechanism, which is the same argument that made one ledger
right instead of two mailboxes (§0). A note nobody chose to write is a note nobody has read.

**What is actually enforced, stated honestly.** The separation today is **by instruction**, not by
construction: the nightly's prompt tells it to report and stop, and never mentions the board — but
it has Bash, so it *could* write one if some future prompt told it to. The real guarantee is the
practice, not a lock. If that ever stops being enough, the fix is a narrower author check, not a
more elaborate prompt.

**Cadence is set by attention, not by cron.** Read the report daily to start. After a week you will
know which three lines you actually look at, and *then* the run can be narrowed to those — which is
the right order, because neither of us knows yet what a useful nightly report contains.

---

## 5. Phase 3 — conversational, and why it is last

Follow-up questions over the same window. Genuinely useful, and the least valuable per unit of
effort: it needs session state, a token budget per conversation, an injection boundary that now
includes *the admin's own free text*, and a UI. Decide after Phase 2, on evidence from a real
session rather than on how appealing it sounds now.

---

## 6. What I would do, concretely

1. **Now, no key needed:** Phase 1. It is small and it is the instrument the drive depends on.
2. **You: Postmark on, then the key, then a low platform spend cap.**
3. **Then drive Lanes A–G together**, one action at a time, with the observation window open. I sit
   in the session as the companion — which is Phase 2's job done by hand, and the honest way to
   learn what Phase 2 should actually say.
4. **Then decide on Phase 2** with a real session behind us, and Phase 3 probably never.

The risk worth naming: it is tempting to build the companion first because it is the interesting
part. The companion is only as good as the observations it reads, and we do not have those yet.
