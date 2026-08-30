-- 240_verdict_and_copy_split.sql
--
-- A VERDICT and a TRANSFER are two different facts. Split them.
--
-- ── WHAT ONE COLUMN WAS BEING ASKED TO MEAN ──────────────────────────────────────────────────
-- `is_pinned` carried three unrelated things at once:
--
--     1. the customer's VERDICT           "I'm interested in this"
--     2. a MATERIALIZATION state          "this tenant holds a local copy of the documents"
--     3. a SORT key                       pinned cards first, everywhere
--
-- They have different costs, different failure modes and different meanings, and every problem in
-- this area came from them sharing one click. A verdict is a pure state change that cannot fail. A
-- transfer moves bytes, talks to object storage, and is allowed to fail loudly. Sorting is a
-- consequence of the first and has nothing to do with the second.
--
-- The clearest symptom: `pinCard` had to REFUSE to record a pin when documents were published and
-- none copied — correct if a pin means "I need the files", indefensible if it means "I'm
-- interested", because a customer's opinion must never be lost to an object-store hiccup. That
-- refusal is not deleted here; it MOVES to the transfer, where refusing and saying so is exactly
-- right.
--
-- ── THE NEW SHAPE ────────────────────────────────────────────────────────────────────────────
--     thumb (up/down)      → pursuit_status + pursuit_set_at    verdict. Pure state. Cannot fail.
--     "View Solicitation"  → docs_copied* + copied_docs         transfer. Explicit. May fail.
--
-- A thumbs-up makes the "View Solicitation" action visible; the copy happens there, on genuine
-- intent, not on triage. That is what keeps the corpus off the boxes of customers who were only
-- skimming — migration 239 moved the copy off fan-out onto pin, which was right and incomplete,
-- because pin was still the only way to express interest at all.
--
-- ── WHAT DOES *NOT* CHANGE, AND MUST NOT ─────────────────────────────────────────────────────
-- The mirror is a 100% mirror. Every non-archived admin card exists as a row for every tenant, and
-- a verdict NEVER removes one. A thumbs-down sorts a card to the bottom and filters it out of the
-- default view; the row keeps receiving every RFP-admin republish — a moved close date, an
-- amendment, a completed build-out — exactly like any other. An advisor who later says "actually,
-- pursue this" must find it, and find it current.
--
-- Nor does a thumbs-down delete a copy that was already made. This codebase hard-deletes nothing
-- (docs/ARCHIVABLE_CONTRACT.md); a destructive write triggered by a filter toggle would be the only
-- one in the product, and it would teach customers to hesitate over the button whose entire value
-- is being cheap to press. Reclaiming storage, if it is ever wanted, belongs to the admin-level
-- cold-storage sweep `archived_at` already anticipates.
--
-- ── NO NEW VOCABULARY IS NEEDED ──────────────────────────────────────────────────────────────
-- `pursuit_status` was already CHECK-constrained to ('unreviewed','pursuing','monitoring','passed')
-- and the pursuit route already accepts all four — but nothing in the product has ever written
-- `pursuing` or `monitoring`. Two of the four states have been dead since they were defined. They
-- are exactly the two the thumb needs:
--
--     unreviewed   no verdict (default)
--     monitoring   THUMBS UP  — interested, watching, earns nudges
--     pursuing     actively pursuing (purchased, or explicitly declared)
--     passed       THUMBS DOWN — sorts last, filtered from the default view, feeds negative affinity
--
-- So this migration adds one timestamp and renames four columns. No CHECK change.

BEGIN;

-- ── 1 · The transfer columns say what they hold ──────────────────────────────────────────────
-- RENAME preserves the data and every index/constraint on these columns; only the names move.
ALTER TABLE tenant_opportunity_cards RENAME COLUMN is_pinned            TO docs_copied;
ALTER TABLE tenant_opportunity_cards RENAME COLUMN pinned_at            TO docs_copied_at;
ALTER TABLE tenant_opportunity_cards RENAME COLUMN pinned_docs          TO copied_docs;
ALTER TABLE tenant_opportunity_cards RENAME COLUMN pin_update_available TO docs_update_available;

ALTER INDEX idx_toc_tenant_pinned RENAME TO idx_toc_tenant_docs_copied;

COMMENT ON COLUMN tenant_opportunity_cards.docs_copied IS
  'TRANSFER state, not a verdict: this tenant holds a local copy of the solicitation documents, '
  'pulled by "View Solicitation". Set by lib/opportunity-pin.ts (copyCorpusInward). The customer''s '
  'opinion lives in pursuit_status.';
COMMENT ON COLUMN tenant_opportunity_cards.docs_copied_at IS
  'When the local copy was first made. NOT when interest was expressed — that is pursuit_set_at.';
COMMENT ON COLUMN tenant_opportunity_cards.copied_docs IS
  'Manifest of what actually landed locally: [{sourceDocumentId, filename, pinnedKey, charCount}].';
COMMENT ON COLUMN tenant_opportunity_cards.docs_update_available IS
  'The master republished after this tenant copied, so their local copy is stale. Keyed off '
  'docs_copied because "your copy is out of date" is a statement about people who have a copy.';

-- ── 2 · When the verdict was cast ────────────────────────────────────────────────────────────
-- `pursuit_status` had no timestamp; `pinned_at` was quietly serving as one and is about to mean
-- something else. Both the affinity signal (recent votes weigh more) and the admin demand queue
-- ("five thumbs-up this week, none opened the documents") need to know WHEN, not just WHAT.
ALTER TABLE tenant_opportunity_cards ADD COLUMN IF NOT EXISTS pursuit_set_at timestamptz;

COMMENT ON COLUMN tenant_opportunity_cards.pursuit_status IS
  'The customer''s VERDICT on this opportunity — unreviewed | monitoring (thumbs up) | pursuing | '
  'passed (thumbs down). Pure state: it sorts, filters and feeds affinity, and it never removes a '
  'row or deletes a byte. The mirror stays complete regardless of what a tenant thinks of a card.';
COMMENT ON COLUMN tenant_opportunity_cards.pursuit_set_at IS
  'When pursuit_status was last set by a person. NULL while unreviewed.';

-- ── 3 · Carry the existing pins forward as the up-votes they already were ────────────────────
-- Today a pin means BOTH "I am interested" and "I have the documents". The split must not lose the
-- first half: every currently-pinned card becomes an explicit thumbs-up, dated from the pin. A card
-- the customer already passed keeps that verdict — a down-vote outranks an inferred up-vote, and
-- (pinned AND passed) was representable before this migration precisely because the two facts were
-- never reconciled.
UPDATE tenant_opportunity_cards
   SET pursuit_status = 'monitoring',
       pursuit_set_at = COALESCE(docs_copied_at, updated_at, now())
 WHERE docs_copied = true
   AND COALESCE(pursuit_status, 'unreviewed') = 'unreviewed';

-- Any card already carrying a real verdict gets its timestamp backfilled too, so the demand queue
-- and the affinity signal are not blind to everything that happened before today.
UPDATE tenant_opportunity_cards
   SET pursuit_set_at = COALESCE(updated_at, now())
 WHERE pursuit_status IN ('monitoring', 'pursuing', 'passed')
   AND pursuit_set_at IS NULL;

-- ── 4 · The verdict is now a query predicate, so index it ────────────────────────────────────
-- The nudge sweep, the default feed filter, the verdict sort and the admin demand queue all filter
-- a tenant's cards by verdict. Partial: 'unreviewed' is the overwhelming majority and is never the
-- selective side of any of those queries.
CREATE INDEX IF NOT EXISTS idx_toc_tenant_pursuit
  ON tenant_opportunity_cards (tenant_id, pursuit_status)
  WHERE pursuit_status IN ('monitoring', 'pursuing', 'passed');

COMMIT;
