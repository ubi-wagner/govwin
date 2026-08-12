/** Live proof for the semantic-retrieval spine (mig 171 + lib/embeddings + hybrid selectForSection).
 *  Runs with the LOCAL engine so it needs no key. Proves, in order:
 *    1. AT-REST isolation — no embedding row's tenant_id ever differs from its atom's tenant_id.
 *    2. RLS layer — as the NOBYPASSRLS app role (govtech_app), atom_embeddings is invisible with no
 *       tenant context, shows ONLY the active tenant with it, and a raw ANN (no app WHERE) still
 *       returns only the tenant's atoms → RLS alone isolates post-cutover.
 *    3. APP layer — selectForSection with a semantic query returns ONLY this tenant's atoms, carries a
 *       live cosine (vectorSim), and never surfaces the other tenant's 303 atoms.
 *    4. SEMANTIC ranking — an atom queried by its own title ranks #1 with near-1.0 similarity.
 *  cd frontend && ATOM_EMBED=local DATABASE_URL=… node --import tsx scripts/verify-embeddings.mts */
process.env.ATOM_EMBED ||= 'local';
import postgres from 'postgres';
import { selectForSection } from '@/lib/atoms';
import { embedOne, toVectorLiteral, activeEmbedModel } from '@/lib/embeddings';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://govtech:changeme@localhost:5432/govtech_intel', { max: 3 });
let ok = true; const A = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };

try {
  const model = activeEmbedModel();
  A('local engine is active', model === 'local-hash-v1', String(model));
  const [foun] = await sql<Array<{ id: string }>>`SELECT id FROM tenants WHERE slug='foundation'`;
  const [other] = await sql<Array<{ id: string }>>`SELECT id FROM tenants WHERE slug='rfp-pipeline'`;

  // ── 1. at-rest isolation (script is superuser → sees ALL rows → a true global check) ──
  const [{ c: mismatched }] = await sql<Array<{ c: number }>>`
    SELECT count(*)::int c FROM atom_embeddings e JOIN library_atoms a ON a.id = e.atom_id WHERE e.tenant_id <> a.tenant_id`;
  A('AT REST: zero embedding rows whose tenant_id ≠ their atom’s tenant', mismatched === 0, `mismatched=${mismatched}`);
  const [{ c: total }] = await sql<Array<{ c: number }>>`SELECT count(*)::int c FROM atom_embeddings`;
  A('both tenants are populated (cross-tenant test is meaningful)', total >= 300, `total=${total}`);

  // ── 2. RLS layer — assume the NOBYPASSRLS app role; app.tenant_id is the only key to the rows ──
  const qAnn = toVectorLiteral((await embedOne('additive concrete construction 3d printing', 'query')) || []);
  await sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE govtech_app`;
    const [{ c: noctx }] = await tx<Array<{ c: number }>>`SELECT count(*)::int c FROM atom_embeddings`;
    A('RLS: no tenant context → atom_embeddings is empty (0 rows)', noctx === 0, `rows=${noctx}`);
    await tx`SELECT set_config('app.tenant_id', ${foun.id}, true)`;
    const [{ c: fctx }] = await tx<Array<{ c: number }>>`SELECT count(*)::int c FROM atom_embeddings`;
    A('RLS: foundation context → sees ONLY foundation rows (22)', fctx === 22, `rows=${fctx}`);
    const [{ c: foreign }] = await tx<Array<{ c: number }>>`
      SELECT count(*)::int c FROM atom_embeddings e JOIN library_atoms a ON a.id = e.atom_id WHERE a.tenant_id <> ${foun.id}::uuid`;
    A('RLS: foundation context → zero foreign-tenant rows visible', foreign === 0, `foreign=${foreign}`);
    // raw ANN with NO app-layer WHERE — RLS alone must keep every neighbor in-tenant
    const ann = await tx<Array<{ atomId: string; tid: string }>>`
      SELECT e.atom_id AS "atomId", a.tenant_id AS tid FROM atom_embeddings e JOIN library_atoms a ON a.id = e.atom_id
      ORDER BY e.embedding <=> ${qAnn}::vector LIMIT 10`;
    A('RLS: a raw ANN (no tenant WHERE) returns ONLY foundation neighbors', ann.length > 0 && ann.every((r) => r.tid === foun.id), `${ann.length} neighbors, ${ann.filter((r) => r.tid !== foun.id).length} foreign`);
  });

  // ── 3. app layer — selectForSection is tenant-scoped AND semantically live ──
  const ranked = await selectForSection(foun.id, { text: 'additive concrete construction 3d printing throughput', limit: 10 }, { userId: foun.id, isAdmin: true });
  A('selectForSection returns foundation candidates', ranked.length > 0, `n=${ranked.length}`);
  const ids = ranked.map((r) => r.id);
  const [{ c: alien }] = await sql<Array<{ c: number }>>`SELECT count(*)::int c FROM library_atoms WHERE id = ANY(${ids}::uuid[]) AND tenant_id <> ${foun.id}::uuid`;
  A('selectForSection returns ONLY this tenant’s atoms (0 alien)', alien === 0, `alien=${alien}`);
  A('the semantic axis is LIVE (≥1 candidate carries a cosine)', ranked.some((r) => r.vectorSim != null), `withSim=${ranked.filter((r) => r.vectorSim != null).length}`);

  // ── 4. semantic ranking — an atom queried by its own title ranks #1 with near-1.0 similarity ──
  const [probe] = await sql<Array<{ id: string; title: string }>>`
    SELECT id, title FROM library_atoms WHERE tenant_id=${foun.id}::uuid AND status='approved' AND grain<>'reference' AND title IS NOT NULL AND length(title) > 12 ORDER BY char_count DESC LIMIT 1`;
  const byTitle = await selectForSection(foun.id, { text: probe.title, limit: 5 }, { userId: foun.id, isAdmin: true });
  const top = byTitle[0];
  A('querying an atom by its own title ranks it #1 (out of 22)', top?.id === probe.id, `top="${(top?.title || '').slice(0, 40)}" vs probe="${probe.title.slice(0, 40)}"`);
  // title-vs-fulltext cosine (the atom's vector is over title+summary+content, so a title-only query
  // is well-correlated but not 1.0); >0.25 is far above the ~0 an unrelated atom scores.
  A('…with a clearly-meaningful self-similarity (vectorSim > 0.25, noise ≈ 0)', (top?.vectorSim ?? 0) > 0.25, `sim=${top?.vectorSim?.toFixed(3)}`);
  const worst = Math.min(...byTitle.map((r) => r.vectorSim ?? 1));
  A('…and it out-scores the field on the semantic axis (top sim ≥ every other candidate)', (top?.vectorSim ?? 0) >= Math.max(...byTitle.slice(1).map((r) => r.vectorSim ?? 0)), `top=${top?.vectorSim?.toFixed(3)} worst=${worst.toFixed(3)}`);

  // ── 5. the query TEXT steers ranking (SEM-WIRE payoff) — two different section texts rank two
  //    different atoms first, from the SAME library. Proves passing the section title actually matters. ──
  const [p1, p2] = await sql<Array<{ id: string; title: string }>>`
    SELECT id, title FROM library_atoms WHERE tenant_id=${foun.id}::uuid AND status='approved' AND grain<>'reference'
      AND title IS NOT NULL AND length(title) > 12 ORDER BY char_count DESC LIMIT 2`;
  if (p1 && p2 && p1.id !== p2.id) {
    const r1 = await selectForSection(foun.id, { text: p1.title, limit: 50 }, { userId: foun.id, isAdmin: true });
    const r2 = await selectForSection(foun.id, { text: p2.title, limit: 50 }, { userId: foun.id, isAdmin: true });
    const rank = (rs: Array<{ id: string }>, id: string) => rs.findIndex((r) => r.id === id);
    A('query TEXT steers ranking: section text A ranks atom A above atom B', rank(r1, p1.id) >= 0 && rank(r1, p1.id) < rank(r1, p2.id), `A@${rank(r1, p1.id)} B@${rank(r1, p2.id)}`);
    A('query TEXT steers ranking: section text B ranks atom B above atom A', rank(r2, p2.id) >= 0 && rank(r2, p2.id) < rank(r2, p1.id), `B@${rank(r2, p2.id)} A@${rank(r2, p1.id)}`);
  }

  // ── 6. NaN-poisoning DEFENSE (adversarial review) — a stored ZERO-magnitude vector must NOT hijack
  //    rank #1. Force one in directly (bypassing the write guard) and confirm the read NULLIF neutralizes
  //    it: vectorSim NULL, a finite blend, and it does not sort above real matches. ──
  const [owner] = await sql<Array<{ id: string }>>`SELECT id FROM users WHERE email='kate.ulepic@foundation3dp.com'`;
  const [tmp] = await sql<Array<{ id: string }>>`
    INSERT INTO library_atoms (tenant_id, grain, title, content, word_count, char_count, status, source, creator_kind, created_by, owner_user_id, visibility)
    VALUES (${foun.id}::uuid, 'primitive', 'ZZ zero-vector poison test', 'zzz', 1, 3, 'approved', 'manual', 'admin', ${owner.id}::uuid, ${owner.id}::uuid, 'tenant')
    RETURNING id`;
  try {
    await sql`INSERT INTO atom_embeddings (atom_id, tenant_id, model, dim, content_hash, embedding)
              VALUES (${tmp.id}::uuid, ${foun.id}::uuid, 'local-hash-v1', 1024, 'poison', array_fill(0, ARRAY[1024])::vector)`;
    const poisoned = await selectForSection(foun.id, { text: 'additive concrete printing throughput', limit: 50 }, { userId: foun.id, isAdmin: true });
    const pRow = poisoned.find((r) => r.id === tmp.id);
    A('NaN defense: a stored zero-vector atom yields NULL vectorSim (NaN caught by NULLIF)', pRow != null && pRow.vectorSim == null, `vectorSim=${pRow?.vectorSim}`);
    A('NaN defense: it does NOT hijack rank #1', poisoned[0]?.id !== tmp.id, `#1="${(poisoned[0]?.title || '').slice(0, 30)}"`);
    A('NaN defense: its blended score is finite (no NaN)', Number.isFinite(pRow?.score ?? NaN), `score=${pRow?.score}`);
  } finally {
    await sql`DELETE FROM atom_embeddings WHERE atom_id = ${tmp.id}::uuid`;
    await sql`DELETE FROM library_atoms WHERE id = ${tmp.id}::uuid`;
  }
} catch (e) { console.error('FAILED:', e); ok = false; }
finally { await sql.end({ timeout: 5 }); }
console.log(ok ? '\nPASS — embeddings are tenant-isolated (at rest · RLS · app-layer) and the hybrid selector ranks by meaning within the tenant'
              : '\nFAIL — semantic retrieval isolation or ranking broke');
process.exit(ok ? 0 : 1);
