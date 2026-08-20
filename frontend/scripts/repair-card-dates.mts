/** Rewrite card dates that were stored as Date.prototype.toString(), then rescore.
 *
 * buildCardSnapshot stringified date columns with a bare `String(v)`, so the card jsonb holds
 * "Fri Aug 28 2026 00:00:00 GMT+0000 (Coordinated Universal Time)" where it should hold
 * "2026-08-28T00:00:00.000Z". The TS scorer parses that by accident; the Python scorer does not,
 * and skips the timeline signal entirely — so across every stored bucket score there is not one
 * `timeline` factor. Opportunities were ranked on keywords alone.
 *
 * The serializer is fixed. This repairs what it already wrote, on BOTH sides of the bridge — the
 * mirror cards a tenant reads AND the forward-only bridge events they are replayed from, or a
 * reconcile would faithfully restore the bad format.
 *
 *   cd frontend && . ../scripts/sandbox-env.sh && npx tsx scripts/repair-card-dates.mts
 */
import { sqlBypass } from '../lib/db';

const DATE_FIELDS = ['postedDate', 'preReleaseDate', 'openDate', 'closeDate', 'awardDate', 'releasedAt', 'frozenAt'];
/** "Fri Aug 28 2026 00:00:00 GMT+0000 (…)" — a Date.toString(), not a date format. */
const LEGACY = /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{4}/;

function isoise(card: Record<string, unknown>): { changed: boolean; card: Record<string, unknown> } {
  let changed = false;
  const out = { ...card };
  for (const f of DATE_FIELDS) {
    const v = out[f];
    if (typeof v !== 'string' || !LEGACY.test(v)) continue;
    const t = new Date(v).getTime();
    if (!Number.isFinite(t)) continue;  // unparseable: leave it rather than invent a date
    out[f] = new Date(t).toISOString();
    changed = true;
  }
  return { changed, card: out };
}

let cards = 0;
let events = 0;

const rows = await sqlBypass<Array<{ tenantId: string; opportunityId: string; card: Record<string, unknown> }>>`
  SELECT tenant_id AS "tenantId", opportunity_id AS "opportunityId", card
  FROM tenant_opportunity_cards`;
for (const r of rows) {
  const { changed, card } = isoise(r.card ?? {});
  if (!changed) continue;
  await sqlBypass`
    UPDATE tenant_opportunity_cards SET card = ${sqlBypass.json(card)}, updated_at = now()
    WHERE tenant_id = ${r.tenantId}::uuid AND opportunity_id = ${r.opportunityId}::uuid`;
  cards++;
}

// The bridge is the source a reconcile replays from. Leaving it stale would silently undo this.
const bridge = await sqlBypass<Array<{ id: string; card: Record<string, unknown> }>>`
  SELECT id, card FROM opportunity_bridge`;
for (const b of bridge) {
  const { changed, card } = isoise(b.card ?? {});
  if (!changed) continue;
  await sqlBypass`UPDATE opportunity_bridge SET card = ${sqlBypass.json(card)} WHERE id = ${b.id}::uuid`;
  events++;
}

console.log(`\nrewrote ${cards} card(s) and ${events} bridge event(s) to ISO`);

const left = await sqlBypass<Array<{ n: number }>>`
  SELECT count(*)::int AS n FROM tenant_opportunity_cards
  WHERE card->>'closeDate' ~ '^[A-Z][a-z]{2} [A-Z][a-z]{2} [0-9]{2} [0-9]{4}'`;
console.log(`cards still holding a Date.toString(): ${left[0].n}`);

// Rescoring is the point — until it runs, the stored scores still have no timeline factor.
const before = await sqlBypass<Array<{ n: number }>>`
  SELECT count(*)::int AS n FROM tenant_bucket_scores WHERE factors ? 'timeline'`;
console.log(`\nbucket scores carrying a timeline factor, before rescore: ${before[0].n}`);
console.log('Run the per-bucket rank action (or POST /api/admin/reconcile-cards) to recompute.');
process.exit(0);
