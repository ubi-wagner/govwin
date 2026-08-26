# Email interface — build log

The as-built record of the send-seam build. Design: **docs/EMAIL_INTERFACE_DESIGN.md** (the
decisions). This file is what actually happened, including the places the design was wrong and the
things that only showed up once a database was involved.

Build order and task ids are the register in the V1 close-out plan: **E1 … E9**.

---

## E1 · The ledger and the suppression list — migration 215

**Shipped:** `db/migrations/215_email_send_ledger.sql`, `frontend/scripts/verify-email-ledger-rls.mjs`.

Two tables, both of which have to exist before the first message goes through the new seam.
`email_send_ledger` carries the correlation contract, and that is the part that cannot be retrofitted:
you cannot put a token on mail that has already left.

### Three departures from the design sketch, each with a reason

**1. `tenant_id uuid NULL` — a column the sketch did not have.** The table holds recipient
addresses, which is a tenant's contact list under a different name. Platform scope follows the house
rule (`NULL` = owned by no tenant), the same shape `tasks`, `process_instances` and
`episodic_memories` already use.

The SELECT policy is the **stricter** of the two house shapes, and the choice is load-bearing:

| precedent | shape | why it is that way |
|---|---|---|
| `tasks` (mig 185) | `tenant_id = ctx OR tenant_id IS NULL` | a tenant must see platform work assigned to it |
| `episodic_memories` (mig 186) | `tenant_id = ctx` only | platform curation memory is not a tenant's to read |
| **`email_send_ledger` (mig 215)** | **`tenant_id = ctx` only** | a platform notification's recipient list is not a tenant's business |

**2. A `status` column — also not in the sketch, and required by the sketch's own idempotency
claim.** "A replay cannot double-send" only works if the row is RESERVED before dispatch, and a
reservation is indistinguishable from a completed send unless something says which it is.
`pending → sent | failed | suppressed`. `suppressed` is deliberately not a failure: a send refused
because the address hard-bounced last week is the system working, and collapsing it into `error`
would make the suppression list look like an outage in every dashboard that counts failures.

**3. No INSERT / UPDATE / DELETE policy at all**, so the ledger is read-only on `govtech_app`. This
is the decision most likely to look like an omission later, so the reasoning is in the migration
header as well as here:

- A send happens from a request, a cron, a queue worker and a webhook. `app.tenant_id` is reliably
  set in exactly one of those four. A ledger whose correctness depended on request context would be
  wrong three times out of four, so the seam writes through the owner connection on purpose.
- The alternative — an UPDATE policy so the confirm step can run under tenant context — needs an
  `OR tenant_id IS NULL` arm to cover platform sends, and that arm's only protection is that a
  caller cannot guess a uuid. **Unguessable is not an isolation boundary.**

Checked, not assumed: `govtech` holds `DEFAULT PRIVILEGES` granting `govtech_app` `arwd` on every
new table it owns, so `govtech_app` *does* have the INSERT grant here. The refusal measured below is
RLS doing the work, not a missing GRANT — which matters, because the two produce the same SQLSTATE
and only one of them is the claim being made.

### `email = lower(email)` is a CHECK, not a convention

The unique constraint is on the literal text. One writer storing `Kate@x.com` while another looks up
`kate@x.com` means the suppression silently does not match and the address is mailed again — the
exact failure the table exists to prevent, in the form that is hardest to notice. The CHECK turns it
into an error at the write instead of a bounce at the recipient.

### Red first

`verify-email-ledger-rls.mjs` was run three times on the same build:

| run | state | result |
|---|---|---|
| 1 | before mig 215 | `WRONG email_send_ledger does not exist` — exit 1 |
| 2 | after mig 215 | 11 assertions, all ok — exit 0 |
| 3 | mig 215 applied, then the SELECT policy swapped for the **tasks-style `OR NULL`** arm | `WRONG tenant 'rfp-pipeline' can see the PLATFORM send row` — exit 1 |

Run 3 is the one that matters. Run 1 only proves the lens notices a missing table; the structural
check short-circuits there and no behavioural assertion executes. Run 3 leaves the structure valid
(one policy, `FOR SELECT`) so the *behavioural* assertion is the only thing that can catch the
defect — and it did, then went green again on restore.

The lens asserts own-rows-visible **before** foreign-rows-invisible, because a deny-all satisfies
every "no leak" assertion trivially. That ordering is B86's lesson and `check-rls-posture.mjs`
carries the same one.

Eleven assertions: role posture · structure ×2 · own rows visible · foreign rows invisible ·
platform rows invisible · suppression list denied · INSERT refused ×2 (42501) · replayed
idempotency key refused (23505) · mixed-case suppression refused (23514).

### The house lens still holds

`check-rls-posture.mjs` — 59 policies over 36 force-RLS tables, 45 tenant-owned tables partitioning
cleanly across 7 contexts. The new table's strict policy does **not** trip its partition assertion:
that check fails on `sum > expected` (a leak), and a platform row invisible everywhere produces
`sum < expected`, which it reports as a note rather than a failure. Worth knowing before someone
reads the note and "fixes" it.

### Found on the way: `migrate.mjs` runs as whatever `DATABASE_URL` says

`source scripts/sandbox-env.sh && node db/migrations/migrate.mjs` connects as **`govtech_app`**,
because that is what `DATABASE_URL` correctly points at — it is what the app runs as and what any
RLS measurement must use. Migrations need the owner. The failure mode is nasty: most migrations
apply fine as the app role, and the first one needing an owner privilege fails with

```
[migrate] ✗ 215_email_send_ledger.sql FAILED: permission denied for table tenants
```

which reads as a problem with `tenants`. `migrate.mjs` now recognises `42501` and prints the actual
remedy (`DATABASE_URL="$DATABASE_URL_OWNER" node db/migrations/migrate.mjs`).

---

## E2 · The seam — `lib/email/`

**Shipped:** `lib/email/{index,types,ledger,sender-identity}.ts`, `lib/email/drivers/gmail.ts`,
`lib/google-calendar.ts`. `lib/email.ts` is gone; `@/lib/email` now resolves to the directory.

`send()` owns four things no transport may reimplement — suppression, idempotency, the ledger,
sender resolution — and a driver's whole job is to hand bytes to a provider and say what happened.
That split is what makes Postmark additive rather than a second implementation of the same four
concerns with its own bugs.

### The order is the contract

```
1  validate the recipient       ← before any DB call, so a typo costs nothing
2  resolve sender / text / ids  ← a message is never half-specified past here
3  suppression check            ← a refused send still gets a ledger row
4  RESERVE the ledger row       ← BEFORE dispatch. This is the idempotency mechanism.
5  dispatch
6  confirm the outcome
```

Step 4 before step 5 is the load-bearing part. Send-then-record means a crash in between re-sends
on replay, and a duplicate nudge to a government customer is worse than a missing one. The unit
test asserts the *sequence*, not just the return value — a test that only checked the result would
pass against exactly the implementation this is meant to forbid.

### Three preservation details, each a place the refactor could have stopped being one

| found | decision |
|---|---|
| The pre-seam Resend fallback defaulted to `noreply@` while the Gmail path defaulted to `platform@` — two From addresses for the same message, chosen by which transport fired | preserved via `isDefaultPlatformSender()`. Almost certainly a latent bug, but nothing establishes `platform@` is a verified Resend sender, and it disappears with Resend at the cutover |
| The Gmail MIME is a `multipart/alternative` carrying only an HTML part | left alone. Adding the text part changes what every recipient receives. The seam still RESOLVES `text` so Postmark can send both |
| An unconditionally quoted display name is valid RFC 5322 and would have changed the bytes of every message | quoting is conditional on the name actually containing a special. `RFP Pipeline <platform@rfppipeline.com>` is byte-identical to before, and `Ulepic, Kate via RFP Pipeline` is correctly quoted |

### `lib/calendar.ts` already existed, and I overwrote it

The Google Calendar helpers needed a home outside a module named `email`. `lib/calendar.ts` was the
obvious name and is **already taken** — by the expert-time scheduling primitive (Terms §7), a
database feature with no connection to Google. Writing it clobbered 230 lines; `tsc` caught it
immediately (`Module '@/lib/calendar' has no exported member 'listAdminAvailability'`) and
`git checkout` restored it. The Google helpers now live in `lib/google-calendar.ts`, which says
which calendar it means.

Two different calendars in one codebase is a naming hazard, not a mistake anyone made: the header of
each now names the other.

---

## E3 · The call sites — eleven, not eight

**The register said eight.** It was counted with `grep -l "from '@/lib/email'"`, which cannot see

```ts
const { sendEmail } = await import('@/lib/email');
```

and three of the eleven are exactly that shape — `team`, `proposals/create`, `proposals/[p]/lock`.
Those three matter most: a dynamic destructuring import of a name the module no longer exports is
**not a type error**. It resolves to `undefined`, throws a `TypeError` at the call, and every one of
those three sites is wrapped in a best-effort `catch`. The mail simply stops, silently. The boundary
test now greps for that shape specifically.

The same defect appeared in the test suite. `proposals-create.test.ts` mocks `@/lib/email`; the mock
still exported `sendEmail`, so after conversion `send` was `undefined`, the route threw into its own
catch, and **all 1,975 tests kept passing** while the admin-alert path was no longer exercised at
all. A mock that names an export the module no longer has does not fail — it quietly stops testing
something.

### Idempotency keys: which sends get one, and which must not

A natural key means a replay sends nothing. That is right for a lifecycle fact and **wrong** for a
request a person can legitimately repeat:

| call site | key | why |
|---|---|---|
| application accepted / rejected | `application_accepted:<applicationId>` | a replayed accept must not mail a second temp password |
| tenant admin welcome / added | `…:<tenantId>:<email>` | |
| collaborator invite | `collaborator_invite:<proposalId>:<email>` | |
| vault invite | `vault_invite:<memberId>` | keyed on the membership row, so a different address to the same vault still sends |
| proposal ready | `proposal_ready:<proposalId>:<email>` | a repeated unlock is the same fact |
| admin proposal-locked alert | `admin_proposal_locked:<proposalId>:<email>` | |
| manager request | `manager_request:<taskId>` | the caller already refuses a duplicate open request |
| **password reset** | **none** | asking twice is what a person does when the first mail does not arrive. A natural key would make the product silently refuse while still answering `{ sent: true }` |
| **team invite** | **none** | re-inviting a member who never got the first mail is a thing an admin does |

### Tenancy at each site, which is not always the obvious one

`tenantId: null` is a real answer, not a missing value. A rejected application never became a
tenant. A password reset belongs to no tenant, because identity is global — auth resolves a user
before any tenant context exists. And the **admin proposal-locked alert goes to rfp_admins about a
tenant, not to the tenant**, so filing it under that tenant would put platform staffing traffic in a
customer's own send history.

### One deliberate behaviour change

`emailSent` in the accept route was `emailResult.provider !== 'skipped'`, which reports a **failed
Resend send as sent** — provider is `resend`, error is set, and the expression is true. It is now
`emailResult.accepted`. The neighbouring `emailFailed: !!emailResult.error` already carried the
truth, so the two fields disagreed. Preserving a known-wrong value is not what "provably a refactor"
is protecting.

---

## E5 · The boundary tests — frontend half

**Shipped:** `__tests__/email-transport-boundary.test.ts` (7 assertions),
`__tests__/email-seam.test.ts` (19).

A seam nothing is forced through is a suggestion. The storage abstraction was written with the same
intent and was bypassed by two routes, one customer-facing, because nothing enforced it. Email gets
its guard on day one.

The scanner's **first** test asserts it can see the codebase at all (>200 files, and the two files
it must contain by name), and its second asserts each rule against a string that IS a violation. A
scanner with a wrong root reports "no offenders" and looks exactly like a clean codebase.

### Red first, on the same build

| probe | result |
|---|---|
| a module importing `googleapis` and calling `google.gmail(...)` plus a raw `email_send_ledger` query | **3 rules fired** — transport, googleapis importer, ledger table. Green on removal |
| `driver.send()` hoisted above `reserve()` in the seam | **5 assertions fired** — the ordering contract, the duplicate refusal, the ledger-unavailable refusal, the throw-still-closes-the-row case, and never-throws. Green on restore |

The second probe is the meaningful one: it leaves the code type-correct and every return value
plausible, so only the sequencing assertion can catch it.

`tsc` 0 · vitest **2003 passed** (1977 before, +26 new). The two counted as "skipped" in the earlier
run are `skipIf` tests keyed on `ANTHROPIC_API_KEY` / `ATOM_EMBED`, which differ by whether
`sandbox-env.sh` was sourced — not by anything in this change.

---

## E4 · The CRM half — `services/cms/src/mailer/`

**Shipped:** `src/mailer/{__init__,types,ledger}.py`, `src/mailer/drivers/gmail.py`, six converted
call sites in `event_listener.py`, a suppression gate on the campaign queue and the template
test-send, `tests/test_mailer_seam.py` (17), `tests/test_email_transport_boundary.py` (6).

This is the half that carries the **nudges**. A seam covering only the frontend would leave exactly
the mail that matters outside the ledger.

### The table had to be renamed, and finding out why was the useful part

`email_sends` **already exists** — in `cms-postgres`, created by `services/cms/db/002_email_engine.sql`,
and read or written in more than twenty places across `routers/email.py`, `email_sweep.py`,
`email_queue.py` and `content.py`. It is the campaign / HITL send **queue**: `campaign_id`,
`template_id`, `gmail_thread_id`, `in_reply_to`, `retry_count`, a six-state status machine.

`rfp-crm` holds pools to **both** databases at once. Two tables of the same name and different shape,
one mistyped pool variable apart, is not a hazard to document — it is a hazard to remove. An INSERT
against the wrong one fails on unknown columns, which is survivable. A **SELECT against the wrong one
returns real rows of the wrong thing**, which is not.

Migration 215's table is now **`email_send_ledger`**. The names should have differed anyway: one is a
ledger (append, correlate, never dequeue) and the other is a queue. Migration 215 was amended rather
than followed by a rename migration — it has never been applied anywhere but this sandbox, so a
rename in the history would be ceremony rather than record.

### The campaign engine keeps its own transport — with an obligation

Two files still call `gmail_client.send_email` directly, and that is deliberate. The campaign / HITL
engine is a **mailbox client**, not a notification sender: it threads replies (`in_reply_to`,
`thread_id`), sweeps an inbox, counts per-account daily sends, and keeps its own queue with its own
status machine. Forcing it through a seam whose driver has no concept of a thread would lose
threading to buy a ledger row it already has.

But an exemption that only says "these files may" is the shape of a leak that becomes permanent. So
each exempt file carries an **obligation asserted by the boundary test**: it must consult the shared
suppression list before dispatch. A hard bounce belongs to the address, the domain reputation is
shared with the notification stream, and a campaign that ignored it would burn what both depend on.
`email_queue.py` now marks such a send `failed` with the reason and dequeues it; the template
test-send returns **409** naming the suppression, which is more use to an admin than a "sent" that
quietly bounces again.

### The one behaviour change I nearly made by accident

The pre-seam wrapper was `sender or _SEND_AS` — no resolution. My first version of `_identity_for()`
called `resolve_identity(default=sender, template=template)`, which looks harmless and is not:
`resolve_sender()` ranks an explicit identity hint and the originating namespace **above** its
template heuristic, so feeding an already-resolved address back in with the template still attached
lets the heuristic override a decision made with more context. A message deliberately sent as
`automation@` whose template name contains "welcome" comes back out as `engagement@` — a silent
change of sender, on exactly the mail a customer sees.

`identity_from_address()` exists to make that impossible, and
`test_an_already_resolved_address_is_not_re_resolved` asserts both halves: that the wrapper preserves
the address, **and** that the resolver really would have moved it. The second assertion is what keeps
the first from being vacuous.

### One deliberate difference between the two seams

| | ledger unreachable |
|---|---|
| frontend `send()` | **REFUSES.** Without the reservation it cannot tell a first send from a replay, and there is no other guard |
| CRM `mailer.send()` | **DEGRADES** — sends, sets `degraded=True`, logs. `_check_dedup()` on `automation_log` has always been the CRM's replay guard, so a ledger failure costs the new layer, not the only one. Failing closed would let one wrong connection string silence every notification on the platform |

Each behaviour is asserted in its own suite, so a future change that quietly aligns them has to
delete a test that says why they differ.

**The privilege this needs is not established.** Migration 215 denies writes on `govtech_app`, and
nothing in the repo records which role `SHARED_DATABASE_URL` carries — the bridge has only ever
written `system_events` and `cms_content`, neither of which has RLS. So the 42501 branch names the
remedy explicitly instead of logging "permission denied", and prints once per process rather than
once per send. **This is an open item for deployment** (see the close-out plan).

### The tests failed, which was the right outcome

Thirteen existing CMS tests broke immediately:
`TypeError: cap() got an unexpected keyword argument 'template'`. Their `send_email` doubles have
narrow signatures, so they caught the changed call shape the moment it changed — the opposite of the
frontend mock, which named an export that no longer existed and went on passing. The doubles now
accept `**contract` and **record** it rather than swallowing it: a double that quietly accepts
anything stops the test noticing when a call site drops the correlation id.

### Red first, and the first probe found a weak instrument

| probe | result |
|---|---|
| a module importing `gmail_client.send_email` and querying the ledger | **2 rules fired**; green on removal |
| replace the queue's `from ..mailer.ledger import suppression_for` with `suppression_for = None` | **PASSED — a miss.** The rule scanned for the substring `suppression_for`, which was still present |
| after strengthening the rule to `await\s+suppression_for\s*\(` — neuter the call, keep the name | **fired**; green on restore |
| `driver.send()` hoisted above `ledger.reserve()` in the seam | **5 assertions fired**; green on restore |

The second row is the useful one. *A check that a symbol is imported is not a check that it runs* —
and the only reason it surfaced is that the probe was run at all.

`python -m pytest` **157 passed**, 3 skipped (134 before, +23). Frontend `tsc` 0 · vitest 2003.

---

*E6 onward appended as built.*
