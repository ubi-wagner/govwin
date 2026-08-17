// SPINE-T7 live drive — span/node-anchored comments, against the REAL DB (owner escape hatch).
// Proves the exact write+read shapes the comments route uses:
//   • INSERT proposal_comments(..., anchor) VALUES(..., ${sql.json(anchor)}) — jsonb write
//   • SELECT pc.anchor — reads back as an OBJECT {nodeId, quote} (NOT a JSON string: the #1 pg bug class)
//   • a NULL anchor round-trips as null (a plain section comment)
//   • the partial index (anchor->>'nodeId') is used for a node-anchor filter
// Run: DATABASE_URL_OWNER=<owner> node --import tsx scripts/drive-spine-t7-anchor.mts
import { sqlBypass } from '@/lib/db';

const FND = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';
const KATE = 'bd101904-582d-44db-ac2e-ce63eb341979';
const BLOCK = 'node-abc-123';                                  // a canvas block id (anchor.nodeId)

let pass = 0, fail = 0;
const check = (label: string, b: boolean) => { if (b) pass++; else fail++; console.log(`${b ? '✅' : '❌'} ${label}`); };

// Hoisted so the finally teardown can see them.
let PROP = '', SEC = '';

try {
  // Resolve a real (proposal, section) pair for Foundation at runtime — survives sandbox rehydrates
  // (hardcoded ids drift). Lock state is irrelevant to a comment's anchor round-trip.
  const [pick] = await sqlBypass<Array<{ proposalId: string; sectionId: string }>>`
    SELECT ps.proposal_id AS "proposalId", ps.id AS "sectionId"
    FROM proposal_sections ps JOIN proposals p ON p.id = ps.proposal_id
    WHERE p.tenant_id = ${FND}::uuid ORDER BY ps.created_at DESC LIMIT 1`;
  if (!pick) { console.error('no foundation section found — cannot drive'); process.exit(2); }
  PROP = pick.proposalId; SEC = pick.sectionId;
  console.log(`(driving on proposal ${PROP.slice(0, 8)} · section ${SEC.slice(0, 8)})`);
  // Clean slate.
  await sqlBypass`DELETE FROM proposal_comments WHERE section_id=${SEC}::uuid AND content LIKE 'T7-DRIVE%'`;

  // 1. Insert an ANCHORED comment exactly as the route does (sql.json write).
  const anchor = { nodeId: BLOCK, quote: 'the highlighted sentence' };
  const [ins] = await sqlBypass<Array<{ id: string }>>`
    INSERT INTO proposal_comments (proposal_id, section_id, user_id, content, anchor)
    VALUES (${PROP}::uuid, ${SEC}::uuid, ${KATE}::uuid, 'T7-DRIVE anchored', ${sqlBypass.json(anchor)})
    RETURNING id`;
  check('insert anchored comment ok', !!ins?.id);

  // 2. Read it back via the GET's select shape — anchor must be an OBJECT, not a string.
  const [row] = await sqlBypass<Array<{ id: string; anchor: { nodeId?: string; quote?: string } | null }>>`
    SELECT pc.id, pc.anchor FROM proposal_comments pc WHERE pc.id=${ins.id}::uuid`;
  check('anchor reads back as an OBJECT (not a JSON string)', !!row.anchor && typeof row.anchor === 'object' && !Array.isArray(row.anchor));
  check('  …anchor.nodeId === the block id', row.anchor?.nodeId === BLOCK);
  check('  …anchor.quote === the highlighted span', row.anchor?.quote === 'the highlighted sentence');

  // 3. A plain (un-anchored) section comment round-trips anchor=null.
  const [ins2] = await sqlBypass<Array<{ id: string }>>`
    INSERT INTO proposal_comments (proposal_id, section_id, user_id, content, anchor)
    VALUES (${PROP}::uuid, ${SEC}::uuid, ${KATE}::uuid, 'T7-DRIVE plain', ${null})
    RETURNING id`;
  const [row2] = await sqlBypass<Array<{ anchor: unknown }>>`SELECT anchor FROM proposal_comments WHERE id=${ins2.id}::uuid`;
  check('plain comment round-trips anchor = null', row2.anchor === null);

  // 4. The section-scoped fetch (what the sidebar runs: WHERE section_id=$1) returns BOTH,
  //    and only the anchored one carries a quote → the amber blockquote renders for it alone.
  const thread = await sqlBypass<Array<{ id: string; content: string; anchor: { quote?: string } | null }>>`
    SELECT id, content, anchor FROM proposal_comments
    WHERE proposal_id=${PROP}::uuid AND section_id=${SEC}::uuid AND content LIKE 'T7-DRIVE%'
    ORDER BY created_at`;
  check('section-scoped thread returns both comments', thread.length === 2);
  check('  …exactly one carries an anchor.quote (renders the blockquote)',
    thread.filter((c) => c.anchor?.quote).length === 1);

  // 5. The node-anchor filter (anchor->>'nodeId') finds the anchored comment by its block id.
  const byNode = await sqlBypass<Array<{ id: string }>>`
    SELECT id FROM proposal_comments
    WHERE section_id=${SEC}::uuid AND anchor->>'nodeId' = ${BLOCK}`;
  check('node-anchor filter (anchor->>nodeId) finds it', byNode.length === 1 && byNode[0].id === ins.id);

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : `❌ ${fail} FAIL`} — SPINE-T7 anchored-comments spine (${pass} checks)`);
} finally {
  await sqlBypass`DELETE FROM proposal_comments WHERE section_id=${SEC}::uuid AND content LIKE 'T7-DRIVE%'`;
  await sqlBypass.end();
}
process.exit(fail === 0 ? 0 : 1);
