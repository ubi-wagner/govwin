-- 243 · `contacts` — the subject the CRM never had.
--
-- ── WHY THIS TABLE EXISTS ────────────────────────────────────────────────────────────────────
-- docs/CRM_ANALYSIS §2 put it plainly: there is no CRM in the CRM. Twenty-four tables over in
-- `cms-postgres` and not one of them holds a PERSON. What lives there is a competent outbound
-- engine — templates, bodies, threads, queues, sequences — with nothing to aim at.
--
-- Meanwhile the main database already holds every endpoint of the funnel: who looked
-- (`visitor_sessions`), who raised a hand (`waitlist`, `applications`), who became a customer
-- (`tenants`), who paid (`purchases`), and what we sent them (`email_send_ledger`). Migration 242
-- joined the two halves. What is still missing is the thing all of those are ABOUT: a person,
-- identified once, whether or not they ever convert.
--
-- ── WHY THERE IS NO tenant_id HERE ───────────────────────────────────────────────────────────
-- The obvious design puts `tenant_id` on this table, set when a contact converts. It is wrong for
-- two reasons, one of which migration 242 taught the hard way.
--
-- First: it duplicates a fact `applications.tenant_id` already holds, and two places for one fact
-- drift. "Which company did this person become" has one answer and one writer.
--
-- Second: a `tenant_id` here would make the RLS posture checker classify contacts as tenant-owned,
-- and scoping by it would be actively dangerous — `tenant_isolation_select` carries an
-- `OR tenant_id IS NULL` arm, so every prospect still in the funnel (the ones with no tenant yet,
-- i.e. most of them) would become readable from EVERY tenant context. That is the whole prospect
-- list, leaked to customers, by a column added for tidiness.
--
-- So conversion is DERIVED: contacts → applications.contact_id → applications.tenant_id. This
-- table is platform scope, admin-only, protected the way `users` and `applications` are — by the
-- app-layer gate, with the exemption recorded in check-rls-posture.mjs.

CREATE TABLE IF NOT EXISTS contacts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The identity. Lower-cased on write by the app; unique so a person is one row however many
  -- times they touch us.
  email             text NOT NULL UNIQUE,
  name              text,
  company_name      text,

  -- FIRST touch, never overwritten. Somebody who signs up, comes back through a different
  -- campaign and then applies was BROUGHT here once; crediting the last campaign they happened to
  -- arrive through is the attribution error most worth avoiding. Nullable for the same reason
  -- migration 242's columns are: a person who phones has no session, and inventing one would be
  -- worse than leaving it absent.
  first_session_id  text,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),

  -- How they entered our world: 'waitlist' | 'application' | 'manual' | 'import'.
  -- Deliberately free text rather than a CHECK: this vocabulary will grow with the first campaign
  -- that has its own landing page, and a CHECK constraint would turn that into a migration.
  source            text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE contacts IS
  'A person, by email, whether or not they ever become a customer. PLATFORM SCOPE: deliberately '
  'has no tenant_id — conversion is derived through applications.contact_id → applications.'
  'tenant_id, because a tenant_id here would both duplicate that fact and (via the OR tenant_id '
  'IS NULL arm of tenant_isolation_select) expose every un-converted prospect to every tenant.';
COMMENT ON COLUMN contacts.first_session_id IS
  'The analytics session at FIRST touch, never overwritten. NULL is legal — see migration 242.';

CREATE INDEX IF NOT EXISTS idx_contacts_session ON contacts(first_session_id)
  WHERE first_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_seen    ON contacts(first_seen_at DESC);

-- ── the join back to where they raised a hand ────────────────────────────────────────────────
-- ON DELETE SET NULL: removing a contact must not delete the record that somebody applied.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS contact_id uuid
  REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE waitlist     ADD COLUMN IF NOT EXISTS contact_id uuid
  REFERENCES contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_applications_contact ON applications(contact_id)
  WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_waitlist_contact     ON waitlist(contact_id)
  WHERE contact_id IS NOT NULL;

-- ── backfill ─────────────────────────────────────────────────────────────────────────────────
-- From the two places a person RAISED A HAND, and nowhere else.
--
-- ⚠️ `users` is deliberately NOT a source, and this is the load-bearing decision in the migration.
-- The obvious backfill folds in every user row, and on this box that is 47 people: master_admins,
-- rfp_admins, every seeded account, and every colleague a tenant_admin ever invited. None of them
-- is a lead. Fold them in and the funnel view opens on "48 contacts → 1 application", a 2%
-- conversion rate computed against a denominator that is 98% staff — a number that is confidently
-- wrong, which is the one failure mode this whole capability is being built to avoid.
--
-- The 7 customers on this box who predate `applications` therefore have NO contact and read as
-- unattributed. That is the truth: they arrived before we recorded leads. Manufacturing a contact
-- row to cover the gap would make an unattributed customer indistinguishable from an attributed
-- one — the same rule as migration 242's nullable session, and the ingest-provenance rule behind
-- both: a value the product did not observe must never look like one it did.
--
-- "Everyone we hold an email address for" is a different question and is answered by a union at
-- read time. It is not this table.
--
-- Order matters within the two real sources: earliest touch wins `first_seen_at` and the session,
-- because a person brought here by one campaign who returns through another was BROUGHT here once.
INSERT INTO contacts (email, name, company_name, first_session_id, first_seen_at, source)
SELECT DISTINCT ON (LOWER(t.email))
       LOWER(t.email), t.name, t.company_name, t.session_id, t.seen, t.source
  FROM (
    SELECT email, NULL::text AS name, company_name, session_id, created_at AS seen,
           'waitlist'::text AS source
      FROM waitlist
    UNION ALL
    SELECT contact_email, contact_name, company_name, session_id, created_at, 'application'
      FROM applications
  ) t
 WHERE t.email IS NOT NULL AND t.email <> ''
 ORDER BY LOWER(t.email), t.seen
ON CONFLICT (email) DO NOTHING;

UPDATE applications a SET contact_id = c.id
  FROM contacts c WHERE a.contact_id IS NULL AND LOWER(a.contact_email) = c.email;
UPDATE waitlist w SET contact_id = c.id
  FROM contacts c WHERE w.contact_id IS NULL AND LOWER(w.email) = c.email;
