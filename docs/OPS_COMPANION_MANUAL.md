# The Ops Companion — an operator's manual

**For whoever is driving the product, not for whoever built it.** The argument for building it, and
what was decided along the way, is in `docs/ADMIN_COMPANION_DESIGN.md`; the invariants every agent
inherits are in `docs/AGENT_WORKFORCE.md`. This is how to use the thing.

Every claim in this file is checked against the code by
`frontend/__tests__/agent-roster-complete.test.ts`. A manual written once against code that keeps
moving is worse than none — you would act on it.

---

## 1. What it is, in one paragraph

You are driving the live product. The companion reads what the system **actually did** in a window
of time — the events, the work items, the mail, the agent calls, the workflows, which tables
anything is writing or reading — plus the findings the deterministic arithmetic already
established, and it tells you **why each one happens and what to change**.

It is not a monitor and not a chatbot. It is the colleague you would turn to and say *"that
finished, but something feels off — what am I not seeing?"*

## 2. Where to ask, and which to use

| where | use it when |
|---|---|
| `/admin/observe` → **Ask the companion** | you just did something and want to know what it actually caused |
| `/admin/architecture` → **Live** tab | you are looking at the map and something about a table or an edge looks wrong |

Both post to the same doorbell. The Live tab is the better door when your question is *structural*
("nothing is writing this") and `/admin/observe` when it is *temporal* ("what did that button do").

## 3. How to ask well

**Fill in the "what you were just doing" box.** It is optional and it is the single most useful
input on the page. The gap between what you believe you did and what the telemetry shows is where
every defect this platform has shipped has lived.

It is treated as a **claim to check**, never as a description to accept. If you say "I released a
portal" and the window shows no provisioning, the companion is instructed to say so.

Good: `released the Foundation portal and expected the workflow to start`
Useless: `testing`

**Pick the window deliberately.** 5 · 15 · 60 · 240 minutes; 240 is the maximum the tool will read
(`get_observation_window` clamps to 1–240). A window is `[now-N, now]`, so an operation still in
flight looks exactly like one that crashed — the findings now carry **how long** something has been
open so you can tell, because no threshold in the code honestly can.

## 4. How to read what comes back

| field | what it means | what to do with it |
|---|---|---|
| `observed` | what happened in the window, in two or three sentences | orientation, nothing more |
| **`fixes[]`** | **the point of the report.** Each carries `what` · `where` (the mechanism) · `why_it_happens` · `change` · `confidence` · `how_to_settle_it` | act on it, or hand `change` to an engineer |
| `unexplained[]` | a finding it could **not** reach the mechanism for | this is honest, not a failure — it is your list to chase |
| `recency` | is the customer seeing current information? | `"no evidence"` is a valid answer and means exactly that |
| `effectiveness` | did the *customer's* job get done, or did the system merely finish? | the two are different claims |
| `finish` | does what they see read as finished? | the countable half is already measured (§6) |
| `could_not_see` | what the window does **not** cover | read this one. It is where silence gets mistaken for health |
| `worth_keeping` | `{note, anchor}` — one sentence you might put on the shared board | **you** decide. See §7 |
| `summary` | one line, leading with the defect | for scanning, not for deciding |

**`where` is a mechanism, never a filename.** The companion has no source tree, and is instructed
never to invent a path — a plausible wrong `lib/x.ts:214` reads as authoritative and sends you
somewhere unrelated. You will get "the step that waits on `proposal.section_locked`" instead, which
is enough to act on and cannot be wrong about a line number.

## 5. What it will not do

- **It will not tell you things are fine.** By design. An empty window means nothing happened, not
  that nothing is wrong, and it is instructed to say that in those words.
- **It writes nothing.** No business table, no gate advanced, no task completed. It proposes the
  change; you make it. That boundary is what lets it be specific — a suggestion cannot break
  production, so there is no reason for it to hedge one.
- **It never descends into a tenant.** Platform scope. Its window carries `in_tenant` — *was this
  tenant work* — and never `tenant_id`, and never a recipient's email address. It reads our
  telemetry, not our customers.
- **It treats everything it reads as untrusted.** Task titles and event payloads can contain text a
  customer typed. It is fenced against instructions hidden there.

## 6. What it cannot see — read this before trusting a clean report

- **Anything outside the window.** A cause 20 minutes before a 5-minute window is invisible.
- **The source tree.** It reasons from event types, workflow steps, tables and roles.
- **The rendered page.** `scripts/probe-customer-finish.mts` measures that separately — seven
  checks across four actor lanes, 89 routes — and it is *that* probe, not the companion, that will
  catch a `NaN` on a page or a button with no name.
- **Any state behind a control that writes.** The finish probe opens 25 of 1,303 candidate controls
  on the tenant lane, because it refuses to click anything that mutates. That gap is real and is
  reported as a number rather than an impression.
- **Whether the wording is *wrong*** — only whether it is malformed. Copy that is grammatical,
  finished, and says the wrong thing passes every instrument here.

## 7. What to do with `worth_keeping`

The shared board at `/admin/notes` is where you, a Claude Code session, and the companion meet.
Nothing writes to it automatically, and that is deliberate: a machine writing into a curated
surface buries the two notes a week that matter under thirty green reports. **You are not overhead
in that loop — you are the integrity mechanism.**

So the companion drafts; you decide. If a note is worth keeping, put it on the board with the
anchor it suggested. If it is not, it costs nothing to drop.

## 8. Cost, limits and how to stop it

It is an archetype, not a bespoke integration, which is what buys all of this for free: the
platform spend caps, the rate limits, the kill switch, `tool_invocation_metrics`, and the roster
entry at `/admin/agents`. One model call per ask — it calls `get_observation_window` once.

- **Every ask is audited.** `system:observation.requested`, with your identity, the window, your
  "doing" line and the findings handed over. It is in the event stream like everything else.
- **To stop it**, use the platform kill switch that stops any archetype. There is no separate
  mechanism to remember.
- **It cannot run without `ANTHROPIC_API_KEY` on the environment.** Until that is set, the doorbell
  fires, the event is recorded, and nothing reads it. The button will report success — which is the
  one thing this agent exists to refuse, so it is worth knowing.

## 9. If the report is wrong

Two failure modes, and they need opposite responses.

**It named a mechanism that is not real.** Check `how_to_settle_it` first — it is required output
for exactly this. If the check kills the finding, the interesting question is what in the window
misled it; that is usually a defect in the telemetry, not in the agent. The bracket-convention
false positive (`docs/ADMIN_COMPANION_DESIGN.md` §4d) was found precisely this way.

**It reassured you.** That is a prompt defect and a serious one. The whole posture is that it never
certifies. Say so, with the report, on the board.

---

## 10. For whoever extends it

- The archetype is `pipeline/src/agents/archetypes/ops_companion.py`; the doorbell is
  `frontend/app/api/admin/observe/route.ts`.
- **The arithmetic lives in TypeScript and is handed over in the event payload.** Do not recompute
  it in Python. One implementation, so the agent can never contradict the admin's own screen.
- `pipeline/tests/test_ops_companion_scope.py` holds the scope boundary: no `tenant_id`, no
  recipient addresses, no `SELECT *`, no write verb, the fence present, the three dimensions
  required, the `no evidence` escape available.
- This file is reconciled against the code by `frontend/__tests__/agent-roster-complete.test.ts`.
  If you change the window bound, the tool list, the human gate or the required output fields, that
  test will tell you the manual is now lying.
