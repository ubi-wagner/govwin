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

## 4a. Where it lives: on the architecture map

**Decided and built 2026-09-02.** The companion's home is `/admin/architecture` → **Live**, not a
button on a page of its own.

The reason is that everything this companion notices is a fact about an **edge or a node on that
map**. A producer with no consumer is a one-way edge. A table taking writes nobody reads is a node
with one wire. A workflow that started and never advanced is a stalled trace. Put the ask button
anywhere else and it is a chat box; put it on the map and the question has a subject.

The explorer had three layers, all of which describe what the system **is**: the extracted schema
(140 tables, 309 FKs), the curated meaning (subsystems, traces, the UI map), and the deep links
between them. None of them said whether any of it was **doing anything**. The Live layer is the
fourth, and it is the one the companion and the human share:

```
   /api/admin/architecture/live  ──┬──▶  the Live tab       (a human reads the map)
   pg_stat_user_tables            └──▶  ops_companion       (the agent reads the same numbers)
```

**One picture, two readers.** That is the "you hear like we do" principle made literal: the agent is
not given a private view it can report from and nobody can check. Its window carries the same
per-table write/read counts, the same epoch, and the same `anchored` flag the tab renders.

**But only one of them classifies.** The four-class rule — live / read only / written-never-read /
untouched — is computed once, in `frontend/lib/architecture-live.ts`, and shown to the human. The
agent gets ordered facts and does its own noticing. Re-deriving the classification in Python would
give the platform two implementations of one judgement that can drift apart, and an assistant that
disagrees with the screen it is assisting with is worse than none. `test_ops_companion_scope.py`
asserts the Python side stays fact-only.

**What the map refuses to say.** The counters run from an epoch that Postgres often does not know,
so the tab renders "not touched in this reading" rather than "nothing writes this", and when the
epoch IS known it states the span and judges nothing — a first draft called a quiet table a finding
"in a span this long", and the very first anchored reading was one minute old with 121 quiet tables
sitting under that sentence. There is no principled threshold: whether silence means anything
depends entirely on what was driven. The prompt carries the same instruction.

---

## 4d. Detection is counted; diagnosis is the agent

**Changed 2026-09-02.** The cut between the arithmetic and the companion was in the wrong place.

The first version told the agent to **ignore** the deterministic findings and notice something
else. But counting is good at establishing *that* something is wrong and has nothing whatever to
say about *why* or *what to change* — and that is the whole of the work. It is exactly what a
person does with those findings by hand.

So the doorbell route (`POST /api/admin/observe`, which both the `/admin/observe` button and the
architecture map's **Live** tab post to) now runs `observe(minutes)` itself and **hands the
findings over in the event payload**:

```
  lib/observe.ts  ──arithmetic──▶  the admin's screen
        │                                              ONE implementation, so the agent
        └──────event payload──────▶  ops_companion      can never contradict the screen
```

The report's required output is a **fix**, not another observation:

```json
"fixes": [{ "what": …, "where": "the mechanism — an event type, a workflow step, a table,
                                  a task role. NEVER a filename you were not shown",
            "why_it_happens": "the mechanism, not the symptom",
            "change": "concrete enough to act on without a second conversation",
            "confidence": …, "how_to_settle_it": "the one check that would confirm or kill this" }],
"unexplained": ["a finding it could NOT reach the mechanism for — naming it beats a guess"]
```

**It has no source tree, and that is stated rather than papered over.** A fix that names
`lib/proposal-advance.ts:214` reads as authoritative and may send the reader to an unrelated line.
The telemetry carries enough to name a mechanism precisely — so "the step that waits on
`proposal.section_locked`" is required and a guessed path is forbidden.

**An empty findings list is not health, and neither is a failed one.** Three states, three
messages: findings handed over as settled facts; "the deterministic checks found nothing — that
means nothing they can *count* went wrong"; and "the findings could not be computed, which is a gap
in what you can see". `test_ops_companion_scope.py` asserts all three, red-tested against the
previous agent.

### The first thing the loop caught was the loop itself

Wiring the doorbell to hand findings over immediately surfaced one — `finder:ingest.run.start`
"started and never finished" — and it was **false**. There are two bracket conventions in this
codebase:

| | shape | where |
|---|---|---|
| one type, two phases | `type='x'`, `phase` start\|end | the TS spine (`withEventBracket`) |
| two types, two phases | `x.start` / `x.end` | `pipeline/src/ingest/base.py` |

`findDiscrepancies` keyed on `namespace:type` and knew only the first, so **all 28 balanced
`finder:ingest.run` pairs read as 28 unclosed brackets** — and had, for as long as the check
existed. Noise on a screen; a *false fact stated with authority* the moment it started feeding an
agent that would then diagnose a mechanism for it. **An instrument that feeds another instrument
has to be right about more than the average case.**

Fixed by normalising the `.start`/`.end` suffix, with a control test proving a genuinely open
bracket still reports. The same finding also now carries **how long it has been open**, because a
window is `[now-N, now]` and an operation still in flight is indistinguishable from one that threw
— there is no honest threshold (a 6-minute export in a 5-minute window is legitimately open), so
the age is stated and the reader judges. Same rule as the Live tab's epoch.

---

## 4c. The two halves: never-trust on our side, luxury on theirs

**Decided and built 2026-09-02.** Leakproof is table stakes — a hull that does not leak is what
makes a ship a ship, not what makes it worth boarding. The companion's other half is whether this
is the **luxury choice**, and that half had been one closing paragraph in its brief ("also notice
what would make this better"), which is exactly the shape of an instruction a model satisfies with
a sentence of praise and moves on.

It is now **three named dimensions with required output fields**, and each can answer
`"no evidence"` — which is a report, where an omission would have read as approval:

| dimension | the question | who counts it |
|---|---|---|
| **recency** | is what the customer sees current? | partly the observation window; the rest is judgement |
| **effectiveness** | did the *customer's* job get done, or did the system merely finish? | the window's arithmetic covers the countable half |
| **finish** | does what they see read as finished? | `scripts/probe-customer-finish.mts`, deterministically |

`test_ops_companion_scope.py` asserts all three are named in the brief, are required output fields,
and that the `no evidence` escape exists — because without it the pressure runs the other way: a
required field with nothing to say gets filled with something reassuring, and reassurance is the
one output this role exists to refuse.

### The finish probe, and why it is not a SQL lens

**Two database-shaped versions were written first and both were phantom.** Cards past their close
date still marked open: 21 rows, and the cards API says in its own comment that the date-derived
closure is filtered client-side, which `pipeline-cards.tsx:393` does. Tenants holding opportunities
with no ranking lens: 6 rows, and `spotlight-buckets.tsx:339` carries an empty state written for
exactly that customer, explaining what a bucket is and stating the fallback.

Both were the places somebody had already thought hardest about. That is the same shape CLAUDE.md
records for text-searching a bug pattern — **an instrument aimed at the wrong layer reports the most
defects exactly where the most care was taken.** Luxury is a property of the rendered page, so it is
measured on the rendered page.

`scripts/probe-customer-finish.mts` reads prose off 32 customer-facing routes as a tenant_admin and
counts four things: `brokenValue` (NaN · undefined · null · [object Object] · Invalid Date),
`identifier` (a UUID a customer can read), `jargon` (a raw `snake_case` token in prose), `deadEnd`
(a main region that says there is nothing here and offers no way to change that).

**First run: 116 findings.** All fixed, all in one class — a customer's own activity stream naming
them `bd101904-582d-44db-ac2e-ce63eb341979` and `workflow_manager`, their agent panel listing
`outcome_analyst` (a display-name map written for 10 archetypes, four behind a roster of 39, with a
silent `?? role` fallback), their opportunity card reading `· sbir_phase_1`, and their process
monitor showing `wait_deadline_exceeded` as the entire error message. Four files, one rule, now one
implementation: `lib/humanize.ts` (+ `lib/agent-labels.ts`, `describeActor` in `lib/event-labels.ts`).

**Two guards, both added after the thing they guard against had already happened here:**

* the **self-test** plants a defect every detector must see, *and* a control every detector must
  ignore — a `<pre>` holding a real JSON payload with a literal `null`, a `<code>` holding an event
  type, a mono span holding a UUID. It caught a defect in the detector before a single real page was
  opened (`textContent` concatenates across elements, so `<h1>Documents</h1><p>No documents…` reads
  `DocumentsNo documents…` and the word boundary fails).
* the **build guard** refuses a verdict when the app is not serving the build on disk. A fix landed,
  the staging step was killed mid-chain, and the re-run measured the old bundle: the counts moved
  99 → 46 purely because the activity feed shows "the last N hours" and time had passed. **That
  drift read exactly like a partial fix.** A measurement of an unknown build is not a weaker
  measurement — it is a measurement of something else.

### Driven to the ground — four lanes, seven checks, overlays open

The first pass measured 32 tenant routes at rest. The second closed every gap the first one
reported about itself:

| | first pass | now |
|---|---|---|
| lanes | tenant only | **tenant · top-up tenant · admin · partner** |
| routes | 32 | **89** |
| states | at rest | at rest **and with every disclosure, tab and read-only modal opened** |
| checks | 4 | **7** — added `rawTimestamp`, `unlabeledControl`, `brokenLink` |
| tenant choice | hardcoded `foundation` | **chosen by coverage**, with a top-up lane per unbound param |

**The lane decides the severity, and that is not a softening.** `/admin/events` exists to show you
`proposal.section_saved` and a row id; grading that like a customer's activity feed would bury the
real findings under the consoles built to display exactly this — the same failure B127 records for
error text and `probe-project-mobile` records for touch targets. So `identifier` · `jargon` ·
`rawTimestamp` are **defects on a customer surface, informational on an operator console**;
`brokenValue` · `deadEnd` · `unlabeledControl` · `brokenLink` are defects everywhere, because
nobody at any privilege level benefits from a `NaN`, a link that 404s, or a button with no name.

**Second-pass findings, all fixed:** an auto-refresh toggle on four pages that was a bare `<button>`
whose only state signal was colour (now `role="switch"` + `aria-checked` + a name); six identical
`×` buttons in one workflow list that a screen reader read identically (now named by which to-do);
a modal close that was a glyph; and a `role="switch"` on the source crawl setting that announced
its state and never its subject — "switch, off" tells you nothing about what is off.

**Three things the second pass taught the instrument, each by being wrong first:**

* **`e.g.` is prose.** The jargon detector reported it three times, from our own template
  placeholder copy — the one place on the tenant surface where guidance text lives. A rule that
  fires on good writing is not stricter, it is broken: it would have pushed the next person to
  reword a helpful placeholder to satisfy a check.
* **`data-user-content` is a structural marker, not a convenience.** The detector read this
  session's own notes — prose that legitimately discusses `NaN` and `null` — as defects on
  `/admin/notes`. B127's lesson one surface over: the discriminator has to be structural. The
  marker now sits on the notes board, project comments and application answers, and it doubles as
  the trust boundary those strings sit on. **A surface that renders user text and does not say so
  is itself the finding** — nobody downstream can tell our prose from theirs, and neither can an
  injection fence.
* **A tenant lane can only address its own rows.** Pinning `foundation` reported three routes as
  "no value for `[documentId]`/`[vaultId]`/`[foundationId]`" while every one of those rows existed,
  in a different tenant. Uncovered was true and the reason was wrong — the kind of finding that
  gets closed as a fixture problem and never looked at again.

Widening `openEverything` with `[role="tab"]` (a tab switch shows a panel that already exists and
writes nothing) lifted the tenant lane from 19 to 25 opened controls and the admin lane from 32 to
36. Both probes that share it were re-run and still pass.

### What it cannot see, stated so nobody mistakes silence for health

Copy that is wrong rather than malformed, a layout that is ugly, a flow that asks for something
twice, and any state behind a control `openEverything` declines to click **because clicking it
would write** — the open rate is 25 of 1,303 candidates on the tenant lane, and that second number
exists so the gap is a number rather than an impression. One route stays unaddressable:
`/portal/[tenantSlug]/documents/[documentId]`, because no tenant with a signed-in-able admin owns a
`tenant_documents` row. Uncovered, not passing.

That residue is the companion's half of the job: the page that is technically finished and still
reads as unfinished.

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
