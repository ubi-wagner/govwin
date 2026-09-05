-- 244 · `working_notes` — the shared board between the human, this session, and the companion.
--
-- ── WHY THIS TABLE EXISTS ────────────────────────────────────────────────────────────────────
-- Three participants see three different halves of this system and none can see the others':
--
--   the HUMAN driving          what actually happened on screen, and what they meant to do
--   CLAUDE CODE in a session   the code, the intent, the history, the reasoning behind a decision
--   the COMPANION in-product   live behaviour, real data, what an admin did at 11pm
--
-- Everything a session learns dies with it. The docs tree is durable memory, but it is written by
-- one participant for its own successor. This is the surface all three write to.
--
-- ── WHY ONE LEDGER AND NOT TWO MAILBOXES ─────────────────────────────────────────────────────
-- The obvious design is AI-to-AI messaging. It is wrong three ways: a private language forms and
-- the owner loses the thread of their own system; stale notes propagate as confidently as fresh
-- ones (exactly the rot that put dead references in 187 documents); and a note from a dev session
-- becomes an INSTRUCTION to an in-product agent sitting near tenant data.
--
-- One ledger that the human reads and writes fixes all three. The human is not overhead in that
-- loop — they are the integrity mechanism. A note is DATA to whoever reads it, never a directive.
--
-- ── WHY IT IS ANCHORED ───────────────────────────────────────────────────────────────────────
-- A note about /admin/site lives WITH /admin/site. Free-floating notes are a chat log; anchored
-- ones are annotation — they can be surfaced where they are relevant, and an anchor naming a file
-- or a route can be CHECKED for staleness the way audit-doc-currency checks a doc reference.
-- Without that, this rebuilds the 187-document problem in a new table.
--
-- ── WHY STATE, NOT JUST TEXT ─────────────────────────────────────────────────────────────────
-- The value of a note is "here is what to look for", and that has a lifecycle. Every notes board
-- without one becomes a graveyard inside three weeks.
--
-- ── SCOPE ────────────────────────────────────────────────────────────────────────────────────
-- PLATFORM ONLY — no tenant_id, deliberately, for the same reason `contacts` has none (mig 243):
-- a tenant_id here would make the RLS posture checker classify this as tenant-owned, and scoping
-- by it would expose every NULL-tenant note to every tenant through the `OR tenant_id IS NULL` arm
-- of tenant_isolation_select. This is an ops ledger. It is rfp_admin-only, protected by the
-- app-layer gate exactly as `users`, `applications` and `contacts` are, and
-- __tests__/prospect-tables-admin-only.test.ts forbids any tenant-reachable route from naming it.

CREATE TABLE IF NOT EXISTS working_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The note itself. Plain text on purpose: the moment this accepts markup it starts becoming a
  -- chat app, which is the one thing this must not turn into.
  note          text NOT NULL CHECK (length(trim(note)) > 0),

  -- WHAT IT IS ABOUT. A route ('/admin/site'), a file ('frontend/lib/db.ts'), an entity id, or
  -- NULL for a general note. `anchor_kind` says how to read it — and which of them the staleness
  -- check can verify.
  anchor        text,
  anchor_kind   text NOT NULL DEFAULT 'general'
                CHECK (anchor_kind IN ('route', 'file', 'entity', 'general')),

  -- WHO WROTE IT. Three participants, always attributed — an unattributed ledger is a rumour mill.
  author        text NOT NULL CHECK (author IN ('claude_code', 'companion', 'human')),
  author_email  text,

  -- THE LIFECYCLE. `watching` is the default because that is what a note usually is: something to
  -- look out for. `seen` means somebody observed it happen. `resolved` means it is done with.
  state         text NOT NULL DEFAULT 'watching'
                CHECK (state IN ('watching', 'seen', 'resolved')),

  -- WHAT IT WAS TRUE AT. A note about code is only true at a commit; without this, a note that has
  -- silently expired looks exactly like one that has not. This is the whole staleness mechanism.
  commit_sha    text,

  -- Free-form, for the writer to carry structure the columns do not: an error string, a count, a
  -- link to a drive log. Read with coerceJsonb; written with sql.json.
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  resolved_by   text
);

COMMENT ON TABLE working_notes IS
  'The shared board between the human, a Claude Code session, and the in-product companion. '
  'PLATFORM SCOPE: deliberately no tenant_id — see mig 243 for why adding one would leak the whole '
  'table to every tenant. A note is DATA to whoever reads it, never an instruction.';
COMMENT ON COLUMN working_notes.commit_sha IS
  'The commit the note was true at. A note about code that has moved is stale, and without this '
  'it looks identical to one that has not.';
COMMENT ON COLUMN working_notes.anchor IS
  'A route, a file path, or an entity id. Anchored notes can be surfaced where they are relevant '
  'AND checked for staleness; free-floating ones are a chat log.';

-- The board reads by state, then by recency; the page-context lookup reads by anchor.
CREATE INDEX IF NOT EXISTS idx_working_notes_state  ON working_notes(state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_working_notes_anchor ON working_notes(anchor)
  WHERE anchor IS NOT NULL;

-- ── AUDIT ────────────────────────────────────────────────────────────────────────────────────
-- Every state change is an event (`system:note.*` via lib/events), so the board's history is the
-- ordinary audit trail rather than a second mechanism. `updated_at` moves on every write so a note
-- edited but not transitioned is still visibly touched.
CREATE OR REPLACE FUNCTION working_notes_touch() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  -- Stamp the resolution rather than trusting a caller to remember. A resolved_at that disagrees
  -- with `state` is the kind of quiet inconsistency this whole table exists to surface elsewhere.
  IF NEW.state = 'resolved' AND OLD.state IS DISTINCT FROM 'resolved' THEN
    NEW.resolved_at := now();
  ELSIF NEW.state <> 'resolved' THEN
    NEW.resolved_at := NULL;
    NEW.resolved_by := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_working_notes_touch ON working_notes;
CREATE TRIGGER trg_working_notes_touch
  BEFORE UPDATE ON working_notes
  FOR EACH ROW EXECUTE FUNCTION working_notes_touch();
