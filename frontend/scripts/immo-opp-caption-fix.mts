/** Root-cause fixes: (1) the OPP card carried the wrong Phase I ceiling ($200K base + $115K option);
 *  correct it to the $250,000 Phase I limit on the master opp + the mirror card. (2) The figure
 *  caption nodes were 9pt (below the 10pt DSIP floor) — bump to 10pt so readiness is GO.
 *
 *  cd frontend && node --import tsx scripts/immo-opp-caption-fix.mts */
import { sqlBypass as sql } from '@/lib/db';
const P = 'd4b6de67-eb3a-482b-84eb-4b0457687f19';
const OPP = 'e84c5bd2-0a7e-487a-a1fd-c7dc76027f4c';

const NEW_SUMMARY = 'NAVAIR/NAVSEA Counter-UAS Open Topic (CSO). Phase I: single base period, not to exceed $250,000. 10-page white paper, CMMC L2, ITAR. Fits AI sensor-fusion / C-UAS detect-track-defeat.';

// Every mirror card's spotlightSummary (jsonb) → $250K framing. (The spotlight one-liner lives in the
// card snapshot, not an opp column; the long objective/description on the opp is unchanged.)
const cards = await sql<{ tenantId: string; card: Record<string, unknown> }[]>`
  SELECT tenant_id AS "tenantId", card FROM tenant_opportunity_cards WHERE opportunity_id = ${OPP}::uuid`;
for (const c of cards) {
  const card = { ...c.card, spotlightSummary: NEW_SUMMARY };
  await sql`UPDATE tenant_opportunity_cards SET card = ${sql.json(card)}, updated_at = now()
            WHERE opportunity_id = ${OPP}::uuid AND tenant_id = ${c.tenantId}::uuid`;
}
console.log(`✓ OPP spotlight summary → $250K on ${cards.length} mirror cards`);

// 2 · Bump figure caption nodes (size 9 italic) to 10pt in §2 and §10.
for (const secNum of ['2', '10']) {
  const [sec] = await sql<{ id: string; content: string }[]>`
    SELECT id, content FROM proposal_sections WHERE proposal_id = ${P} AND section_number = ${secNum} LIMIT 1`;
  const doc = JSON.parse(sec.content);
  let bumped = 0;
  for (const n of doc.nodes ?? []) {
    if (n.type === 'text_block' && n.style && n.style.size === 9) { n.style.size = 10; bumped++; }
  }
  await sql`UPDATE proposal_sections SET content = ${JSON.stringify(doc)}, updated_at = now() WHERE id = ${sec.id}::uuid`;
  console.log(`✓ §${secNum}: bumped ${bumped} caption nodes to 10pt`);
}
await sql.end();
