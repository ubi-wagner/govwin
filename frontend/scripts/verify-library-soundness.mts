/** Non-destructive soundness check for the library + atom→OPP-structure path (the gate before the
 *  embeddings iteration). Proves the DATA invariants that keep insert/reuse airtight — no mutation.
 *  cd frontend && node --import tsx scripts/verify-library-soundness.mts */
import { chromium } from 'playwright';
import postgres from 'postgres';

const BASE = process.env.BASE || 'http://localhost:3000';
const sql = postgres('postgresql://govtech:changeme@localhost:5432/govtech_intel', { max: 3 });
let ok = true; const A = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };
const n = (r: Array<{ c: number | string }>) => Number(r[0]?.c ?? 0);

try {
  // ── 1) Version-numbering content-loss guard: proposal_sections.version must stay AHEAD of the
  //       highest archived canvas_versions.version_number, or the next save's archive collides on
  //       ON CONFLICT(section_id,version_number) DO NOTHING → silent history/content loss. ──
  const vbad = await sql<Array<{ c: number }>>`
    SELECT count(*)::int AS c FROM proposal_sections ps
    WHERE ps.version <= (SELECT COALESCE(MAX(cv.version_number), -1) FROM canvas_versions cv WHERE cv.section_id = ps.id)`;
  A('every section.version is ahead of its archived versions (no archive-collision content loss)', n(vbad) === 0, `${n(vbad)} violation(s)`);

  // ── 2) Cross-tenant integrity — atoms only compose/derive within their own tenant ──
  const memX = await sql<Array<{ c: number }>>`
    SELECT count(*)::int AS c FROM atom_members m
    JOIN library_atoms g ON g.id = m.group_atom_id JOIN library_atoms mem ON mem.id = m.member_atom_id
    WHERE g.tenant_id <> mem.tenant_id`;
  A('no cross-tenant atom membership', n(memX) === 0, `${n(memX)} leak(s)`);
  const linX = await sql<Array<{ c: number }>>`
    SELECT count(*)::int AS c FROM atom_lineage l
    JOIN library_atoms p ON p.id = l.parent_atom_id JOIN library_atoms c2 ON c2.id = l.child_atom_id
    WHERE p.tenant_id <> c2.tenant_id`;
  A('no cross-tenant atom lineage', n(linX) === 0, `${n(linX)} leak(s)`);

  // ── 3) No orphaned dependents (tags/members/lineage pointing at missing atoms) ──
  const tOrph = await sql<Array<{ c: number }>>`SELECT count(*)::int AS c FROM atom_tags t LEFT JOIN library_atoms a ON a.id = t.atom_id WHERE a.id IS NULL`;
  const mOrph = await sql<Array<{ c: number }>>`SELECT count(*)::int AS c FROM atom_members m LEFT JOIN library_atoms a ON a.id = m.group_atom_id LEFT JOIN library_atoms b ON b.id = m.member_atom_id WHERE a.id IS NULL OR b.id IS NULL`;
  const lOrph = await sql<Array<{ c: number }>>`SELECT count(*)::int AS c FROM atom_lineage l LEFT JOIN library_atoms a ON a.id = l.parent_atom_id LEFT JOIN library_atoms b ON b.id = l.child_atom_id WHERE a.id IS NULL OR b.id IS NULL`;
  A('no orphaned atom_tags / atom_members / atom_lineage', n(tOrph) + n(mOrph) + n(lOrph) === 0, `tags=${n(tOrph)} members=${n(mOrph)} lineage=${n(lOrph)}`);

  // ── 4) Every atom is tenant-scoped; leaf atoms carry content or canvas_nodes (not empty shells) ──
  const noTenant = await sql<Array<{ c: number }>>`SELECT count(*)::int AS c FROM library_atoms WHERE tenant_id IS NULL`;
  A('every atom is tenant-scoped', n(noTenant) === 0, `${n(noTenant)} tenantless`);
  const emptyLeaf = await sql<Array<{ c: number }>>`
    SELECT count(*)::int AS c FROM library_atoms
    WHERE grain = 'primitive' AND archived_at IS NULL
      AND (content IS NULL OR content = '') AND (canvas_nodes IS NULL OR canvas_nodes = '[]'::jsonb OR jsonb_array_length(canvas_nodes) = 0)`;
  A('no empty-shell primitive atoms (each has content or canvas nodes)', n(emptyLeaf) === 0, `${n(emptyLeaf)} empty`);

  // ── 5) Foundation library health + the section→atom insert has produced traceable lineage ──
  const [{ atoms }] = await sql<Array<{ atoms: number }>>`SELECT count(*)::int AS atoms FROM library_atoms a JOIN tenants t ON t.id=a.tenant_id WHERE t.slug='foundation' AND a.archived_at IS NULL`;
  A('Foundation library is populated', atoms > 0, `${atoms} atoms`);
  const [{ derived }] = await sql<Array<{ derived: number }>>`SELECT count(*)::int AS derived FROM atom_lineage WHERE relation='derived_from'`;
  console.log(`  (reuse lineage edges recorded: ${derived})`);

  // ── 6) LIVE: the scored selector returns ONLY this tenant's atoms (no cross-tenant candidates) ──
  const [sec] = await sql<Array<{ id: string; vol: string | null }>>`
    SELECT ps.id, (SELECT t.value FROM atom_tags t WHERE t.atom_id IS NOT NULL LIMIT 0) AS vol
    FROM proposal_sections ps JOIN proposals p ON p.id=ps.proposal_id JOIN tenants tn ON tn.id=p.tenant_id
    WHERE tn.slug='foundation' LIMIT 1`;
  const foundationAtomIds = new Set((await sql<Array<{ id: string }>>`SELECT a.id FROM library_atoms a JOIN tenants t ON t.id=a.tenant_id WHERE t.slug='foundation'`).map((r) => r.id));
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const p = await (await b.newContext()).newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name=email]', 'kate.ulepic@foundation3dp.com');
  await p.fill('input[name=password]', 'DemoPass123!');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]);
  await p.waitForTimeout(1000);
  const selRes = await p.evaluate(async (sid) => {
    const r = await fetch(`/api/portal/foundation/atoms/select?kinds=narrative,bio,figure,table&limit=20${sid ? `&sectionId=${sid}` : ''}`);
    return { status: r.status, body: await r.text() };
  }, sec?.id ?? '');
  await b.close();
  A('scored selector responds 200', selRes.status === 200, `status=${selRes.status}`);
  const returned: Array<{ id: string }> = (() => { try { return JSON.parse(selRes.body).data.atoms; } catch { return []; } })();
  const alien = returned.filter((a) => !foundationAtomIds.has(a.id));
  A('selector returns ONLY this tenant’s atoms (no cross-tenant candidates)', alien.length === 0, `${returned.length} returned, ${alien.length} alien`);
} catch (e) { console.error('FAILED:', e); ok = false; }
finally { await sql.end({ timeout: 5 }); }
console.log(ok ? '\nPASS — library + atom→OPP-structure invariants hold (foundation is sound)' : '\nFAIL — a soundness invariant is violated');
process.exit(ok ? 0 : 1);
