/** Seed a persisted librarian catalog result for Foundation, as if the pipeline agent had run
 *  (the sandbox LLM is sk-noop, so we hand-craft the exact wrapper it would write). References
 *  REAL Foundation atom ids so the review route's atom_id validation keeps them.
 *  node scripts/seed-librarian-catalog.mjs */
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel');

async function main() {
  const [t] = await sql`SELECT id FROM tenants WHERE slug='foundation'`;
  if (!t) throw new Error('no foundation tenant');
  const atoms = await sql`
    SELECT id, coalesce(title,'(untitled)') AS title FROM library_atoms
    WHERE tenant_id=${t.id} AND archived_at IS NULL AND vault_id IS NULL
    ORDER BY created_at DESC LIMIT 5`;
  if (atoms.length < 3) throw new Error('need ≥3 foundation atoms');

  const A = atoms.map((a) => a.id);
  // A varied, realistic catalog referencing the real atoms.
  const catalog = {
    assessments: [
      { atom_id: A[0], vol: 'technical', kind: 'narrative', quality_score: 0.91, relevance_score: 0.88, freshness: 'current',
        suggested_tags: ['tech:additive_construction'], duplicate_candidates: [], section_match: null, disqualifiers: [],
        recommendation: { action: 'keep', merge_into_atom_id: null, reason: 'Specific, quantified, and current — strong reuse.' }, summary: 'High-value technical narrative.' },
      { atom_id: A[1], vol: 'past_performance', kind: 'narrative', quality_score: 0.62, relevance_score: 0.55, freshness: 'aging',
        suggested_tags: ['vol:past_performance'], duplicate_candidates: [], section_match: null, disqualifiers: [],
        recommendation: { action: 'retag', merge_into_atom_id: null, reason: 'Solid but under-tagged; add a vol tag so it ranks for cost/PP sections.' }, summary: 'Good content, needs tagging.' },
      { atom_id: A[2], vol: 'supporting', kind: 'narrative', quality_score: 0.24, relevance_score: 0.18, freshness: 'stale',
        suggested_tags: [], duplicate_candidates: [], section_match: null, disqualifiers: ['boilerplate'],
        recommendation: { action: 'reject', merge_into_atom_id: null, reason: 'Generic boilerplate with no company-specific detail.' }, summary: 'Low-signal boilerplate.' },
      ...(A[3] ? [{ atom_id: A[3], vol: 'technical', kind: 'narrative', quality_score: 0.7, relevance_score: 0.66, freshness: 'current',
        suggested_tags: [], duplicate_candidates: [{ atom_id: A[0], similarity: 'partial' }], section_match: null, disqualifiers: [],
        recommendation: { action: 'merge', merge_into_atom_id: A[0], reason: 'Overlaps the stronger technical atom — merge to avoid a near-duplicate.' }, summary: 'Partial overlap.' }] : []),
    ],
    package_notes: 'Mostly strong technical content; one boilerplate atom to drop and one near-duplicate to merge.',
    recommended_rejects: [A[2]],
  };
  const wrapper = {
    status: 'completed', archetype: 'librarian',
    guardrail: { decision: 'allow', bounded: {}, reasons: [] },
    result: { text: JSON.stringify(catalog), summary: 'Cataloged ' + A.length + ' atoms; recommends reject 1, merge 1.', tool_results: [] },
    tokens: { input: 0, output: 0 }, cost_usd: 0, duration_ms: 0, rounds: 1,
  };

  const [q] = await sql`
    INSERT INTO agent_task_queue (tenant_id, agent_role, task_type, input, status, completed_at)
    VALUES (${t.id}, 'librarian', 'catalog', ${sql.json({ cocoonId: null, packageName: 'seed', atomCount: A.length })}, 'completed', now())
    RETURNING id`;
  await sql`INSERT INTO agent_task_results (task_id, output) VALUES (${q.id}, ${sql.json(wrapper)})`;
  console.log('SEEDED librarian catalog result for foundation — task', q.id, '· atoms', A.length);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
