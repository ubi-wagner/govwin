# Email interface — build log

The as-built record of the send-seam build. Design: **docs/EMAIL_INTERFACE_DESIGN.md** (the
decisions). This file is what actually happened, including the places the design was wrong and the
things that only showed up once a database was involved.

Build order and task ids are the register in the V1 close-out plan: **E1 … E9**.

---

## E1 · The ledger and the suppression list — migration 215

**Shipped:** `db/migrations/215_email_send_ledger.sql`, `frontend/scripts/verify-email-ledger-rls.mjs`.

Two tables, both of which have to exist before the first message goes through the new seam.
`email_sends` carries the correlation contract, and that is the part that cannot be retrofitted:
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
| **`email_sends` (mig 215)** | **`tenant_id = ctx` only** | a platform notification's recipient list is not a tenant's business |

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
| 1 | before mig 215 | `WRONG email_sends does not exist` — exit 1 |
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

*E2 onward appended as built.*
