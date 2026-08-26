# CRM migration plan — giving the outbound engine a subject

**Status:** plan, not built. Companion to **docs/CRM_ANALYSIS.md** (the sweep) and
**docs/CRM_INVENTORY.md** (the generated inventory).

---

## The insight this plan turns on

The analysis ends on a hard question — contacts in `cms-postgres`, or in the main database? — and
notes that putting them in the main DB does not by itself fix the join, because `email_sends` would
still be on the other side of a database boundary.

**Except that the send record already moved.** `email_send_ledger` (migration 215, shipped this
cycle) lives in `govtech_intel` and carries `to_email`, `tenant_id`, `correlation_id`, `template`,
`status` and `provider_message_id`. Both halves of the CRM seam write it — the frontend directly,
the CRM through `SHARED_DATABASE_URL`.

So the architecture falls out:

| lives in the main DB | lives in `cms-postgres` |
|---|---|
| **who** — contacts, companies, deals, activities, segments, attribution | **how** — message bodies, templates, thread state, queue state, campaign and drip definitions, social |
| **that we contacted them** — `email_send_ledger` | **what we said** — `email_sends.body_html`, `email_threads` |

`cms-postgres` stops being the system of record for *who was contacted* and becomes what it already
is well: an outbound engine. The question "which leads did we mail and did any convert" becomes an
ordinary join inside one database.

That also means **no cross-database FK is required anywhere in this plan.**

---

## Scope: whose CRM is this?

**Ours.** These tables track *our* prospects and customers — the companies applying for portals, the
people at them, the campaigns that reached them. They are **platform-scope**, in the house sense:
`tenant_id IS NULL` is not a placeholder, it is the truth. A lead is not owned by a tenant; it is a
company that may become one.

That settles the isolation posture without inventing anything: the same shape migration 215 gave
`email_suppressions` — **RLS enabled and forced, with no policy**, so the tables are denied entirely
on the NOBYPASSRLS application role and reachable only through an explicit admin `sqlBypass` path.
CLAUDE.md already requires admin cross-tenant reads to go that way.

A tenant-facing CRM — a customer's own contacts — is a **different product** and is explicitly not
this. Building it later on these tables would be a mistake; it needs tenant scope from its first
migration, exactly as delivery did.

---

## Phase 1 — the subject (main DB, migration 218)

```sql
CREATE TABLE crm_companies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  domain        text,                       -- the join key that actually works in practice
  website       text,
  state         text,
  size_band     text,
  -- The link that makes "did they convert" answerable. NULL until they do.
  tenant_id     uuid REFERENCES tenants(id),
  lifecycle     text NOT NULL DEFAULT 'prospect'
                  CHECK (lifecycle IN ('prospect','applicant','customer','churned','disqualified')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crm_contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid REFERENCES crm_companies(id) ON DELETE SET NULL,
  email         text NOT NULL,
  name          text,
  title         text,
  phone         text,
  -- NULL until they have an account. This is the other half of the conversion join.
  user_id       uuid REFERENCES users(id),
  lifecycle     text NOT NULL DEFAULT 'lead'
                  CHECK (lifecycle IN ('lead','applicant','customer','inactive','unsubscribed')),
  source        text,                       -- 'application' | 'waitlist' | 'import' | 'referral' | …
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (email = lower(email))              -- same rule as email_suppressions, same reason
);
CREATE UNIQUE INDEX uq_crm_contacts_email ON crm_contacts (email);
```

**`CHECK (email = lower(email))` and a unique index, deliberately.** Migration 215 learned this on
`email_suppressions`: a mixed-case row never matches a normalised lookup, so the record silently
fails to match and a second one is created beside it. A CRM with two rows for the same person is a
CRM nobody trusts.

**`domain` on the company.** The only company-matching key that survives contact with reality — two
people from the same firm type its name three different ways, and both have `@theircompany.com`.

```sql
CREATE TABLE crm_deals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES crm_companies(id) ON DELETE CASCADE,
  contact_id    uuid REFERENCES crm_contacts(id) ON DELETE SET NULL,
  title         text NOT NULL,
  stage         text NOT NULL DEFAULT 'new'
                  CHECK (stage IN ('new','qualified','proposal_portal','negotiation','won','lost')),
  value_cents   bigint,
  owner_user_id uuid REFERENCES users(id),
  next_action   text,
  next_action_at date,
  -- The two ends the platform already has, linked rather than duplicated.
  application_id uuid REFERENCES applications(id),
  purchase_id    uuid REFERENCES purchases(id),
  closed_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crm_activities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    uuid REFERENCES crm_contacts(id) ON DELETE CASCADE,
  company_id    uuid REFERENCES crm_companies(id) ON DELETE CASCADE,
  deal_id       uuid REFERENCES crm_deals(id) ON DELETE SET NULL,
  kind          text NOT NULL,     -- email_sent | email_delivered | reply | call | note | meeting | …
  subject       text,
  body          text,
  -- The soft link back to whatever produced it. NOT an FK: system_events is a high-volume bus and
  -- a hard reference would make it undeletable.
  event_id      uuid,
  send_id       uuid,              -- → email_send_ledger.id
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users(id)
);

CREATE TABLE crm_segments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE,
  definition    jsonb NOT NULL,    -- the saved query, evaluated against crm_contacts
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

**`crm_activities` is the timeline, and most of it already exists.** `system_events` records
application submitted, purchase completed, portal provisioned, proposal locked; `email_send_ledger`
records every send; the CRM's inbox sweep records replies. What was missing was never the events —
it was **a contact to attach them to**. So the activity table is fed by projection, not by
double-entry.

### Attribution — both halves are already recorded and nothing carries them forward

```sql
CREATE TABLE crm_attribution (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    uuid NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  touch         text NOT NULL CHECK (touch IN ('first','last')),
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  referrer      text,
  session_id    text,              -- → visitor_sessions.session_id
  occurred_at   timestamptz NOT NULL,
  UNIQUE (contact_id, touch)
);
```

`page_views` already carries `utm_source` / `utm_medium` / `utm_campaign` and `visitor_sessions`
carries the referrer. The application form does not carry either forward, so *"which campaign
produced this customer"* is unanswerable today **despite both halves being recorded**. The
carry-forward is one hidden field on the apply form plus this table.

### RLS, in the same migration that creates the tables

Force-RLS with **no policy** on all six. Denied on `govtech_app`, reachable through `sqlBypass`.
Migrations 184, 212, 213 exist because tables shipped without a policy and had to be retrofitted;
216 and 215 did it in-file, and so does this.

---

## Phase 2 — the pointer swap (main DB + `cms-postgres` 013)

```sql
ALTER TABLE email_send_ledger ADD COLUMN contact_id uuid REFERENCES crm_contacts(id);
CREATE INDEX idx_email_send_ledger_contact ON email_send_ledger (contact_id) WHERE contact_id IS NOT NULL;
```

One column, and the central question becomes an ordinary join:

```sql
SELECT c.email, count(*) FILTER (WHERE l.status = 'sent') AS mailed, d.stage
  FROM crm_contacts c
  LEFT JOIN email_send_ledger l ON l.contact_id = c.id
  LEFT JOIN crm_deals d ON d.contact_id = c.id
 GROUP BY c.email, d.stage;
```

The seam resolves `contact_id` from the recipient address at send time — one lookup in the module
that already normalises the address for the suppression check, so it costs nothing new.

On the CRM side, `email_sends` gains `contact_id uuid` as a **plain column with no FK** (it points
across the boundary, exactly as `tenant_id` does today) — enough to render a thread against a
contact in the console without making the CRM the record of who was contacted.

---

## Phase 3 — isolation for `cms-postgres`

The database has no row-level security anywhere and seven tenant-bearing tables. It is not currently
a live leak — nothing tenant-facing reads it — and the correct response is not to leave that as the
protection.

Two options, and the choice depends on Phase 4:

**(a) Force-RLS with no policy**, like the phase-1 tables: the CRM connects as an admin-privileged
role and every table is deny-by-default to anything else. Cheap, and honest about what the service
is today — one internal console.

**(b) Full tenant policies**, if anything tenant-facing will ever read it.

**Recommendation: (a) now, with (b) as a precondition** written into the migration header — the
moment a tenant-facing surface reads this database, (b) becomes required, and the header is where
the next person will look.

---

## Phase 4 — retire the superseded half

Six content tables (`cms_posts`, `cms_media`, `cms_reviews`, `cms_generations`, `cms_events`,
`cms_config`) and their routers are superseded by the frontend content move. **Not a drop yet:**
CLAUDE.md's rule is drop only when superseded-with-a-successor AND zero live code refs, and *"empty
in the sandbox" is not a drop signal.*

The sequence is: confirm the frontend store holds everything these do → remove the routers → then
drop, in a migration that says what replaced them.

The 48 uncalled endpoints split the same way: some are dead with the content half, some are
**genuinely missing UI** — every drip enrolment control is built and unreachable, which is the
"unsurfaced capability" class `reconcile-capability` exists to catch, in a service that
reconciliation has never covered.

---

## Phase 5 — fold the CRM into the instruments

The deepest finding of the sweep is not any single defect. It is that **nothing was looking.**

- `inventory-crm.mjs` — shipped with this analysis, and the first CRM instrument in the repo.
- Extend `check-rls-posture.mjs` to accept a second connection, so `cms-postgres` appears in a
  posture number instead of being absent from one.
- Extend `reconcile-capability.mjs` across the service boundary — its "UNSURFACED" join is exactly
  the right instrument for 48 uncalled endpoints.
- Stand `cms-postgres` up in `sandbox-up.sh` so it exists by default. **This is the one that
  matters**: every other item on this list is optional while the database is absent, because an
  instrument that cannot connect reports nothing and reads like a pass.

---

## Sequencing, and what blocks what

| phase | blocks | blocked by |
|---|---|---|
| 1 · the subject | everything | nothing |
| 2 · pointer swap | attribution reporting | phase 1 |
| 3 · CRM isolation | any tenant-facing read of `cms-postgres` | nothing — can run first |
| 4 · retire superseded | nothing | confirming the frontend store is complete |
| 5 · instruments | future confidence in all of the above | **`cms-postgres` in the sandbox** |

Phase 5's last item is the cheapest and has the largest effect on everything after it. It should go
first regardless of when the rest is scheduled.

---

## One item that blocks something already shipped

`services/cms/src/mailer/ledger.py` writes `email_send_ledger`, which migration 215 gives **no write
policy** — the NOBYPASSRLS app role is refused by design. Nothing in the repository records which
role the CRM's `SHARED_DATABASE_URL` carries.

If it is not the owner, **every CRM send runs degraded**: mail goes out, but with no idempotency
reservation, and a `42501` is logged once per process naming the remedy. This is independent of the
plan above and should be checked before the Postmark cutover, not after.
