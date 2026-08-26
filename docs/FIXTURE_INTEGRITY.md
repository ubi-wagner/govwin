# Fixture Integrity — why a green suite kept hiding work that never ran

**One rule: a test must ESTABLISH the state it needs, or say precisely why it cannot.**

Nothing here is about product bugs. It is about a single defect class that, measured on this
checkout, accounted for **59 failing and 97 never-running e2e tests** — and made the suite report
coverage it did not have. Every instance had the same shape:

> a fixture that existed only as runtime state on a long-lived box.

The box resets. The fixture does not come back. The spec then fails somewhere far from the cause,
in a way that reads like a broken feature.

---

## The eight instances, and what each looked like

| Fixture that vanished | How it presented |
|---|---|
| the `lighthouse` tenant | `auth.setup` could not sign in → **13 passed / 59 failed / 97 never ran** |
| `command_seen_state` watermarks | a "new since you looked" dot lit → read as a Command Centre bug |
| `PORTAL_ID` env var | purchase 409 → "portalId" undefined → read as a broken comp purchase |
| `DRIVE_SOL_ID` (×6 specs) | `/api/…/undefined/…` 404 → `expect(false).toBeTruthy()` in six files |
| `c3db6000-…` section ids | navigation to a section that is not there → 60s `locator.click` timeout |
| Air Force CSO opportunity | the classifier's ambiguous band silently went **unexercised** |
| an unlocked proposal section | `expect(tech).toBeTruthy()` on `undefined` |
| the e2e fixture accounts, after every container reset | stack perfectly healthy, every drive spec dead |

Two more that are the same disease with a different host:

- **`scripts/sandbox-probe.sh` had no CLI dispatch.** Run as a command it defined its functions,
  hit EOF, and exited `0` — answering "healthy" to every question, including about a box on fire.
  Its `probe=0` was quoted as evidence repeatedly. It was evidence of nothing.
- **A tie-break I introduced.** Ordering candidate solicitations by text length alone, with two
  byte-identical ingests present, let the planner choose — consecutive runs of one spec resolved
  *different* solicitations in different states, and the phase machine looked non-deterministic.

---

## The cure, in the order to reach for it

**1 · Resolve from the data.** Ask the database for something with the property you need, never for
an id you remember. `e2e/resolve-solicitation.ts` and `e2e/resolve-proposal.ts` are the two in use;
both take an env override for pinning one specific record.

**Make the resolution deterministic.** Ties are not hypothetical — add `created_at DESC, id DESC`
after the ranking column. A fixture that varies between runs is worse than one that is missing.

**2 · Construct the case arithmetically when the assertion is about a band.** The scout classifier's
UNKNOWN band could not be hit by a hand-written title, because whether one lands there depends
entirely on what is in `opportunities` that day. Take a real record, keep half its distinctive
tokens, pad to a known Jaccard, and the score lands mid-band on *any* base:

```
inter = k, union = N + f, f = round(2.5k) − N  ⇒  J = 0.4  ⇒  score = 0.4×0.75 + 0.18 = 0.48
```

Then assert against the product's returned score. The construction builds the fixture; it does not
decide the answer.

**3 · Make the precondition, through the product's own controls.** If the spec needs an unlocked
section, unlock one — that is a first-class user action. Do not assert that some earlier run left
the door open.

**4 · Assert the END STATE when the transition is one-way.** Purchase, release, lock and advance can
each happen once. `expect(status).toBe(200)` fails forever after the first run. Verify the state the
transition *would have produced* — strictly stronger, since it also catches a 200 that did nothing.

**5 · Skip, loudly and specifically, when the product legitimately refuses.** A tenant may not
reopen a proposal after its solicitation closed. That is correct behaviour, and reporting it red
buries the failures that matter. `e2e/upload-fixtures.ts` made this argument first, for its absent
PDFs; `build-collab` B3 follows it.

---

## The two anti-patterns to grep for

**A no-op that reports success.** This shape appeared in three separate steps:

```ts
if (await button.isVisible().catch(() => false)) { await button.click(); }
// …no assertion on the outcome
```

When the control is absent the step does nothing and passes. The Foundation UI walk photographed a
**draft** proposal as "the completed proposal" for exactly this reason — and what the silence hid
was the product being *right*: submission-readiness was refusing a proposal missing two required
documents, with both named. A step that cannot tell whether it worked is worse than one that fails.

**An unbounded action inside a `.catch()`.** `dlBtn.click().catch(() => {})` looks defensive. With
no timeout, a click on a missing button waits the whole *test* budget, so the catch never runs and
the step dies on "Test timeout exceeded" instead of on what was wrong. Always bound the action.

And one Playwright trap worth naming: **`isVisible()` is true for a DISABLED button.** That cost a
wrong diagnosis here — export controls correctly disabled on a draft proposal (with a hint beside
them saying so) looked like a dead control. Ask `toBeEnabled()`; it is the question a user's hand
actually asks.

---

## Self-healing, so this stops recurring

Postgres survives a container reset, but its data directory rolls back to the image snapshot —
which predates the fixture accounts. The stack then comes up **perfectly healthy and undrivable**.

`probe_fixtures` (scripts/sandbox-probe.sh) detects that; `sandbox-up.sh` seeds it; the supervisor
closes the loop unattended — measured at **4 seconds** from detection to drivable. Verified in both
directions: silent when the fixtures are present, and naming what is missing when the `lighthouse`
tenant is renamed away.

---

## What remains genuinely un-runnable here

Four specs (`dow-ingest`, `dow-full-ingest`, `ingest-coverage`, `flex-midwindow`) need chat-uploaded
solicitation PDFs — the OSW T3CP component instructions and the Patent-Holiday topic call — that are
not in the repository and did not survive the container. They skip, naming the file and where to put
it. Downstream, `p2r-template` needs the topic `flex-midwindow` would create, and `t3cp-spine` needs
the same scenario.

That is an honest gap, not a defect, and it is the reason `scripts/drive-ingest-scenario.mjs` exists:
it stands a full scenario up from documents that ARE checked in (`docs/DoW 2026 SBIR BAA
FULL_R1_04132026.pdf`), so the ingest spine can be driven on a real government document on any
machine. Repointing those four specs at it is the outstanding work.
