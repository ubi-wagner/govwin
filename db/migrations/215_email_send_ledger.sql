-- 215_email_send_ledger.sql
--
-- The outbound-mail ledger and the suppression list. Both must exist BEFORE the first message is
-- sent through the new seam, because the one thing this table records cannot be added afterwards:
-- you cannot put a correlation token on mail that has already left.
--
-- ── WHAT THIS IS FOR ─────────────────────────────────────────────────────────────────────────
-- One row per outbound message, doing three jobs (docs/EMAIL_INTERFACE_DESIGN.md):
--
--   1. IDEMPOTENCY. `idempotency_key` is UNIQUE and is the trigger event id the CRM listener
--      already threads through. Postmark has no native idempotency, so this is it. The seam
--      RESERVES the row (status 'pending') before dispatch and CONFIRMS it after, which is why
--      there is a `status` column the design sketch did not have: a reservation that precedes the
--      send is the only shape in which a replay can be refused, and a reservation is
--      indistinguishable from a completed send without one.
--
--   2. WEBHOOK ASSOCIATION. Postmark echoes `metadata` back, so a delivery or bounce resolves to
--      `correlation_id` and therefore to the workflow step that caused the send.
--
--   3. REPLY ASSOCIATION, LATER. `provider_message_id` is the RFC 5322 Message-ID. An inbound
--      reply carries `In-Reply-To: <that id>` automatically, from every mail client, so a future
--      consumer resolves a reply to its originating nudge with no token in the body and no
--      plus-addressing. NOTHING READS THIS YET. It is recorded now because a feature that can only
--      work for mail sent after it shipped is a feature with a hole in its history.
--
-- ── TENANCY: the column the design sketch omitted ────────────────────────────────────────────
-- The sketch had no `tenant_id`, and the table holds recipient addresses — a tenant's contact list
-- by another name. `tenant_id uuid NULL` follows the house platform-scope rule (NULL = platform,
-- owned by no tenant), the same way `tasks`, `process_instances` and `episodic_memories` model it.
--
-- The SELECT policy is deliberately the STRICTER of the two house shapes. `tasks` (mig 185) carries
-- an `OR (tenant_id IS NULL)` read arm so a tenant can see platform work assigned to it;
-- `episodic_memories` (mig 186) deliberately does NOT, because platform curation memory is not a
-- tenant's to read. Mail follows 186: a platform notification is not a tenant's business, and the
-- recipient list of one is exactly the kind of thing that must not be readable sideways. A tenant
-- context therefore sees ITS OWN sends and nothing else.
--
-- ── WRITES ARE DENIED UNDER `govtech_app`, ON PURPOSE ────────────────────────────────────────
-- There is a SELECT policy and no INSERT/UPDATE/DELETE policy at all, so on the NOBYPASSRLS
-- application role this ledger is READ-ONLY. That is not an oversight and not a gap to be filled
-- later:
--
--   • The ledger is written in exactly one place — the driver seam — and a send happens from a
--     request, a cron, a queue worker and a webhook. `app.tenant_id` is reliably set in only the
--     first of those, so a ledger whose correctness depended on request context would be wrong in
--     three cases out of four. The seam writes through the owner connection deliberately.
--   • Denying the write outright is a stronger guarantee than a permissive UPDATE policy would be.
--     The alternative — allowing UPDATE so the confirm step can run under tenant context — needs an
--     `OR tenant_id IS NULL` arm to cover platform sends, and that arm's only protection is that a
--     caller cannot guess a uuid. "Unguessable" is not an isolation boundary.
--
-- ── SUPPRESSION IS PLATFORM-SCOPE WITH NO TENANT DIMENSION ───────────────────────────────────
-- A hard bounce is a property of the ADDRESS, not of whoever happened to mail it. Scoping it per
-- tenant would let tenant B keep mailing an address that already bounced for tenant A, and the
-- reputation damage is shared. So `email_suppressions` has no `tenant_id` — and consequently RLS
-- with NO policy, i.e. denied entirely on `govtech_app`. The seam's pre-send check runs through the
-- owner connection like the ledger write. Without that denial, any tenant context could read every
-- address that has ever bounced anywhere on the platform, which is a contact-list leak wearing a
-- deliverability hat.
--
-- ── WHY `email = lower(email)` IS A CHECK AND NOT A CONVENTION ───────────────────────────────
-- The unique constraint is on the literal text. If one writer stores `Kate@x.com` and another looks
-- up `kate@x.com`, the suppression silently does not match and the address is mailed again — which
-- is precisely the failure the table exists to prevent, in the form that is hardest to notice. The
-- CHECK turns that into an error at the write instead of a bounce at the recipient.
--
-- Idempotent / re-runnable. (The migrate runner wraps each file in its own transaction — no
-- explicit BEGIN/COMMIT, matching every other migration in this tree.)

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- email_sends — one row per outbound message
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS email_sends (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  correlation_id       uuid NOT NULL,
  idempotency_key      text NOT NULL,
  tenant_id            uuid REFERENCES tenants(id),

  provider             text NOT NULL,
  provider_message_id  text,

  kind                 text NOT NULL CHECK (kind IN ('transactional', 'correspondence')),
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'sent', 'failed', 'suppressed')),

  to_email             text NOT NULL,
  subject              text,
  template             text,
  error                text,

  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at           timestamptz NOT NULL DEFAULT now(),
  sent_at              timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_sends_idempotency
  ON email_sends (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_email_sends_correlation
  ON email_sends (correlation_id);

-- Partial: only confirmed sends carry a provider id, and this index exists for the future
-- In-Reply-To lookup, which will only ever probe non-null values.
CREATE INDEX IF NOT EXISTS idx_email_sends_provider_message
  ON email_sends (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_sends_tenant_recent
  ON email_sends (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_sends_recipient_recent
  ON email_sends (to_email, created_at DESC);

COMMENT ON TABLE email_sends IS
  'Outbound mail ledger: idempotency, webhook correlation, and the Message-ID that lets a future '
  'inbound reply resolve to the nudge that caused it. Written ONLY by the driver seam, through the '
  'owner connection. Read-only on govtech_app by design — see migration 215.';

COMMENT ON COLUMN email_sends.tenant_id IS
  'Owning tenant. NULL = PLATFORM scope (a notification owned by no tenant). Readable only via '
  'sqlBypass: the SELECT policy is strict equality with no NULL arm, following episodic_memories '
  '(mig 186) rather than tasks (mig 185).';

COMMENT ON COLUMN email_sends.idempotency_key IS
  'The originating trigger event id. UNIQUE — a replayed event reserves nothing and re-sends '
  'nothing. This is the whole idempotency mechanism; Postmark has none of its own.';

COMMENT ON COLUMN email_sends.status IS
  'pending = reserved before dispatch · sent = provider accepted · failed = provider refused, '
  'reclaimable by a retry · suppressed = refused before dispatch by email_suppressions, which is '
  'the system working and NOT an error.';

COMMENT ON COLUMN email_sends.provider IS
  'Open vocabulary by design — the point of the seam is that transports come and go. Known values: '
  'gmail · postmark · resend · skipped. Deliberately not a CHECK: a constraint that rejects a real '
  'provider turns a working send into a 500.';

-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE email_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_sends FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON email_sends;
CREATE POLICY tenant_isolation_select ON email_sends
  FOR SELECT
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- No INSERT / UPDATE / DELETE policy. See the header: the seam writes through the owner
-- connection, and denying the write on the application role is the guarantee, not a gap.

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- email_suppressions — platform-scope, no tenant dimension
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS email_suppressions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text NOT NULL UNIQUE CHECK (email = lower(email)),
  reason       text NOT NULL CHECK (reason IN ('hard_bounce', 'spam_complaint', 'manual')),
  source       text NOT NULL CHECK (source IN ('postmark_webhook', 'operator')),
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE email_suppressions IS
  'Addresses that must not be mailed again. Platform-scope with no tenant column on purpose: a '
  'hard bounce belongs to the address, and the reputation cost is shared. RLS enabled with NO '
  'policy — denied entirely on govtech_app, reachable only through the owner connection, because '
  'the full list is every bounced contact across every tenant. See migration 215.';

COMMENT ON COLUMN email_suppressions.email IS
  'Stored lower-cased, enforced by CHECK. A mixed-case row would never match a normalised lookup, '
  'so the suppression would silently fail open — the exact failure this table exists to prevent.';

ALTER TABLE email_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_suppressions FORCE ROW LEVEL SECURITY;

-- Intentionally no policies. Any access from the application role is denied.
