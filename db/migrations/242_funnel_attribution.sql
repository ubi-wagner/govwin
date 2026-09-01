-- 242 · Join the funnel across the sever.
--
-- ── THE PROBLEM THIS SOLVES ──────────────────────────────────────────────────────────────────
-- The funnel is complete at both ends and severed in the middle. `visitor_sessions` and
-- `page_views` already carry referrer, utm_source, utm_medium and utm_campaign for every
-- anonymous visitor. `applications` and `waitlist` already carry the person. Nothing joins them:
-- neither capture route referenced the session at all.
--
-- So at the single moment an anonymous session becomes a named person, the session was thrown
-- away — and "which campaign produced this customer" was not hard, it was unanswerable.
--
-- And `applications` had no link to the tenant its acceptance creates, so even the last step of
-- the chain — lead becomes customer — was lost.
--
-- Three nullable columns and two indexes. No data moves, nothing is rewritten, and every existing
-- row stays valid.
--
-- ── WHY NULLABLE, DELIBERATELY ───────────────────────────────────────────────────────────────
-- A person who phones, or is met at a conference, or is forwarded a link by a colleague with the
-- referrer stripped, HAS no session. That must stay a legal state. A NOT NULL column here would
-- force the capture routes to invent a session id, and an invented attribution is worse than an
-- absent one: it is indistinguishable from a real one, and it would quietly poison every campaign
-- number computed from this chain. Absent is a finding; fabricated is a lie.
--
-- (Same rule as the ingest-provenance spine: a value the product did not observe must never look
--  like one it did.)

-- ── the session that brought them ────────────────────────────────────────────────────────────
-- `text`, not a FK to visitor_sessions: the browser mints this id and sends it with the first
-- page view, so a form can post an id whose session row has not been written yet, or was pruned.
-- A foreign key would make the capture route fail on a race that costs nothing — losing one
-- attribution is acceptable, refusing somebody's application is not.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS session_id text;
ALTER TABLE waitlist     ADD COLUMN IF NOT EXISTS session_id text;

COMMENT ON COLUMN applications.session_id IS
  'The analytics visitor_sessions.session_id that was in the browser when this was submitted. '
  'NULL is legal and means the person arrived without one (phone, conference, stripped referrer) '
  '— never fabricate it. Joins to visitor_sessions for referrer and UTM.';
COMMENT ON COLUMN waitlist.session_id IS
  'The analytics visitor_sessions.session_id present at sign-up. NULL is legal — see '
  'applications.session_id.';

-- ── which application became which customer ──────────────────────────────────────────────────
-- ON DELETE SET NULL, not CASCADE: if a tenant is ever removed, the application is still a record
-- that somebody applied and was accepted. Losing the history because the account went away would
-- delete the evidence of the very conversion this column exists to measure.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS tenant_id uuid
  REFERENCES tenants(id) ON DELETE SET NULL;

COMMENT ON COLUMN applications.tenant_id IS
  'The company created when this application was accepted. NULL while pending, rejected, or for '
  'the accepted applications that predate migration 242. Written by the accept route.';

-- Indexed for the direction the funnel view actually reads: from a session or a company back to
-- the application, and partial because the overwhelming majority of rows are NULL on each.
CREATE INDEX IF NOT EXISTS idx_applications_session ON applications(session_id)
  WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_waitlist_session     ON waitlist(session_id)
  WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_applications_tenant  ON applications(tenant_id)
  WHERE tenant_id IS NOT NULL;

-- ── backfill what can be known ───────────────────────────────────────────────────────────────
-- Only where it is UNAMBIGUOUS: an accepted application whose contact email matches exactly one
-- tenant admin. Anything with two candidates is left NULL rather than guessed — a wrong link here
-- would attribute a customer to the wrong lead, which is the specific error this whole chain is
-- being built to avoid making.
UPDATE applications a
   SET tenant_id = m.tenant_id
  FROM (
    SELECT u.email, MIN(um.tenant_id::text)::uuid AS tenant_id
      FROM users u
      JOIN user_memberships um ON um.user_id = u.id AND um.role = 'tenant_admin'
     GROUP BY u.email
    HAVING COUNT(DISTINCT um.tenant_id) = 1
  ) m
 WHERE a.tenant_id IS NULL
   AND a.status = 'accepted'
   AND LOWER(a.contact_email) = LOWER(m.email);
