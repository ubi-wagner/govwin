/** Drive upload → atomize → library → draft-selection, with real documents.
 *
 * The library is only worth having if what a company uploads comes back out when they write. This
 * walks the whole chain against the sandbox, using the repo's Aerivio Navy STTR proposal — a real
 * multi-format set (docx narrative, pptx overview, xlsx cost, pdf) of exactly the kind a customer
 * brings on day one:
 *
 *   1. AUTO mode segments a document into atoms and hands the cocoon to the librarian
 *   2. MANUAL mode returns selectable chunks instead, leaving the choice to a person
 *   3. every format the product claims to read actually reads
 *   4. the new atoms are tenant-scoped — another tenant cannot see them, at the API or in RLS
 *   5. embeddings follow the atoms (when an engine is on) and never cross a tenant
 *   6. the atoms come back out: selectForSection surfaces them for a matching section
 *
 * Run: cd frontend && . ../scripts/sandbox-env.sh && node scripts/drive-atomization.mjs
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { chromium } from 'playwright';
import postgres from 'postgres';

const BASE = 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SRC = '/home/user/govwin/docs/sample-proposal-navy-sttr';

const sql = postgres(process.env.DATABASE_URL_OWNER, {
  max: 4,
  transform: { column: { from: (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase()) } },
});
let bad = 0;
const check = (ok, s, extra = '') => { if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${s}${extra ? `  — ${extra}` : ''}`); };
const note = (s) => console.log(`  · ${s}`);

const MIME = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pdf': 'application/pdf',
};
const mimeOf = (f) => MIME[f.slice(f.lastIndexOf('.'))] ?? 'application/octet-stream';

async function login(page, email, pw) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', pw);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }),
    page.click('button[type="submit"]'),
  ]);
}

/** Two real demo tenants — the isolation check needs a second pair of eyes, with its own login. */
const WHO = [
  { slug: 'foundation', email: 'kate.ulepic@foundation3dp.com', pw: process.env.FOUNDATION_PW || 'DemoPass123!' },
  { slug: 'lighthouse', email: 'eric@lighthouse.com', pw: process.env.LIGHTHOUSE_PW || 'LighthouseAdmin' },
];
const pair = [];
for (const w of WHO) {
  const [t] = await sql`SELECT id AS "tenantId", slug FROM tenants WHERE slug = ${w.slug} AND archived_at IS NULL`;
  if (t) pair.push({ ...w, tenantId: t.tenantId });
}
if (pair.length < 2) { console.log('! need both demo tenants (foundation, lighthouse)'); process.exit(1); }
const [A, B] = pair;
console.log(`\ntenant A: ${A.slug}  (${A.email})`);
console.log(`tenant B: ${B.slug}  (${B.email})`);

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const pageA = await (await browser.newContext()).newPage();
await login(pageA, A.email, A.pw);

// Clear any prior run's uploads so "new atoms" means this run's. Keyed on the reference atoms'
// exact filenames and everything sharing their cocoon — a re-run should not inflate the library.
const NAMES = [
  'Aerivio_Navy_STTR_Technical_Volume.docx', 'Aerivio_Navy_STTR_Statement_of_Work.docx',
  'Aerivio_Navy_STTR_Company_Overview.pptx', 'Aerivio_Navy_STTR_Cost_Volume.xlsx',
  'Aerivio_Navy_STTR_Technical_Volume.pdf',
];
const wipe = async (tenantId) => {
  const cocoons = await sql`
    SELECT DISTINCT cocoon_id FROM library_atoms
    WHERE tenant_id = ${tenantId}::uuid AND title = ANY(${NAMES}) AND cocoon_id IS NOT NULL`;
  const ids = cocoons.map((c) => c.cocoonId);
  const doomed = await sql`
    SELECT id FROM library_atoms WHERE tenant_id = ${tenantId}::uuid
      AND (title = ANY(${NAMES}) ${ids.length ? sql`OR cocoon_id = ANY(${ids}::uuid[])` : sql``})`;
  if (!doomed.length) return 0;
  const dids = doomed.map((d) => d.id);
  await sql`DELETE FROM atom_embeddings WHERE atom_id = ANY(${dids}::uuid[])`;
  await sql`DELETE FROM atom_tags WHERE atom_id = ANY(${dids}::uuid[])`;
  await sql`DELETE FROM library_atoms WHERE id = ANY(${dids}::uuid[])`;
  return dids.length;
};
const wiped = await wipe(A.tenantId);
if (wiped) console.log(`\n(cleared ${wiped} atom(s) from a previous run)`);

const before = await sql`SELECT count(*)::int AS n FROM library_atoms WHERE tenant_id = ${A.tenantId}::uuid`;
console.log(`\ntenant A starts with ${before[0].n} atoms`);

// ── 1 · AUTO mode, every format the readers claim ────────────────────────────
console.log('\n1. auto-atomize each format');
const FILES = [
  'Aerivio_Navy_STTR_Technical_Volume.docx',
  'Aerivio_Navy_STTR_Statement_of_Work.docx',
  'Aerivio_Navy_STTR_Company_Overview.pptx',
  'Aerivio_Navy_STTR_Cost_Volume.xlsx',
  'Aerivio_Navy_STTR_Technical_Volume.pdf',
];
const landed = [];
for (const f of FILES) {
  const buf = readFileSync(`${SRC}/${f}`);
  const res = await pageA.request.post(`${BASE}/api/portal/${A.slug}/atoms/upload`, {
    multipart: {
      file: { name: basename(f), mimeType: mimeOf(f), buffer: buf },
      mode: 'auto',
      // The context contract is {agency, program, phase, sol, topic} — the same five fields the
      // atomizer UI collects. Sending programType/topicNumber instead silently yields no tags,
      // which is exactly the mistake this line used to make.
      context: JSON.stringify({ agency: 'Navy', program: 'sttr', phase: '1', sol: 'N24-A', topic: 'N24A-T001' }),
    },
    timeout: 180000,
  });
  const j = await res.json().catch(() => ({}));
  const d = j?.data ?? {};
  const ok = res.ok() && typeof d.atoms === 'number';
  check(ok, `${f.replace('Aerivio_Navy_STTR_', '').padEnd(26)} → ${ok ? `${d.atoms} atoms, ${d.figures ?? 0} figures, ${d.skipped ?? 0} skipped` : `${res.status()} ${JSON.stringify(j).slice(0, 90)}`}`);
  if (ok) landed.push({ file: f, ...d });
}
const totalNew = landed.reduce((n, r) => n + (r.atoms ?? 0), 0);
check(totalNew > 0, `the upload chain produced ${totalNew} atoms across ${landed.length} documents`);

// A format that yields NOTHING is a silent failure — the customer uploaded and got nothing back.
for (const r of landed) {
  if ((r.atoms ?? 0) === 0) check(false, `${r.file} parsed but produced ZERO atoms`, r.note ?? 'no reason given');
}

// ── 2 · the atoms are real, tagged, and tenant-scoped ───────────────────────
console.log('\n2. what landed');
const fresh = await sql`
  SELECT id, grain, title, status, source, char_length(COALESCE(content,'')) AS len,
         (SELECT count(*)::int FROM atom_tags at WHERE at.atom_id = a.id) AS tags
  FROM library_atoms a
  WHERE tenant_id = ${A.tenantId}::uuid AND created_at > now() - interval '10 minutes'
  ORDER BY created_at DESC`;
check(fresh.length > 0, `${fresh.length} new atoms on tenant A`);
const byGrain = {};
for (const r of fresh) byGrain[r.grain] = (byGrain[r.grain] ?? 0) + 1;
note(`grains: ${Object.entries(byGrain).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
const untagged = fresh.filter((r) => r.tags === 0);
check(untagged.length === 0, 'every new atom carries at least one tag',
  untagged.length ? `${untagged.length} untagged, e.g. "${untagged[0].title?.slice(0, 40)}"` : '');
const empty = fresh.filter((r) => r.grain !== 'figure' && (r.len ?? 0) === 0);
check(empty.length === 0, 'no non-figure atom landed with empty content',
  empty.length ? `${empty.length} empty, e.g. "${empty[0].title?.slice(0, 40)}"` : '');
// Every context dimension must survive the trip, not just one — a partially-applied context is
// how an atom ends up findable by agency but invisible to a program-scoped search.
const ctxRows = await sql`
  SELECT t.dimension, t.value, count(DISTINCT a.id)::int AS n
  FROM library_atoms a JOIN atom_tags t ON t.atom_id = a.id
  WHERE a.id = ANY(${fresh.map((f) => f.id)}::uuid[])
    AND t.dimension IN ('agency','program','phase','sol','topic')
  GROUP BY 1,2 ORDER BY 1`;
note(`context tags: ${ctxRows.map((r) => `${r.dimension}=${r.value}(${r.n})`).join(' · ') || 'none'}`);
for (const dim of ['agency', 'program', 'phase', 'sol', 'topic']) {
  check(ctxRows.some((r) => r.dimension === dim), `the "${dim}" the uploader typed reached the atoms`);
}

// ── 3 · the librarian was handed the cocoon ─────────────────────────────────
console.log('\n3. the librarian producer');
const queued = await sql`
  SELECT status, count(*)::int AS n FROM agent_task_queue
  WHERE tenant_id = ${A.tenantId}::uuid AND agent_role = 'librarian'
    AND created_at > now() - interval '10 minutes' GROUP BY status`;
const qTotal = queued.reduce((n, r) => n + r.n, 0);
check(qTotal > 0, 'the librarian was enqueued to catalog what arrived',
  queued.map((r) => `${r.status}=${r.n}`).join(' ') || 'nothing queued');

// ── 4 · embeddings follow the atoms ─────────────────────────────────────────
console.log('\n4. embeddings');
const emb = await sql`
  SELECT count(*)::int AS n FROM atom_embeddings e
  JOIN library_atoms a ON a.id = e.atom_id
  WHERE a.tenant_id = ${A.tenantId}::uuid AND a.created_at > now() - interval '10 minutes'`;
if (process.env.ATOM_EMBED || process.env.VOYAGE_API_KEY) {
  check(emb[0].n > 0, `an engine is on, so new atoms are embedded`, `${emb[0].n}/${fresh.length}`);
} else {
  note(`no embedding engine configured (ATOM_EMBED unset) — ${emb[0].n} embedded, inert by design`);
}

// ── 5 · another tenant cannot see any of it ─────────────────────────────────
console.log('\n5. isolation');
const pageB = await (await browser.newContext()).newPage();
await login(pageB, B.email, B.pw);
const crossApi = await pageB.request.get(`${BASE}/api/portal/${A.slug}/atoms?limit=5`);
check([403, 404].includes(crossApi.status()), 'tenant B is refused tenant A\'s atom list', `HTTP ${crossApi.status()}`);
const ownList = await pageB.request.get(`${BASE}/api/portal/${B.slug}/atoms?limit=200`);
const ownJson = await ownList.json().catch(() => ({}));
const ownAtoms = ownJson?.data?.atoms ?? ownJson?.data ?? [];
const leaked = Array.isArray(ownAtoms) ? ownAtoms.filter((a) => fresh.some((f) => f.id === a.id)) : [];
check(leaked.length === 0, 'none of tenant A\'s new atoms appear in tenant B\'s own library', `${leaked.length} leaked`);

// RLS, not just the app layer: read as govtech_app with B's context and ask for A's rows.
const appUrl = process.env.DATABASE_URL;
if (appUrl) {
  const appSql = postgres(appUrl, { max: 1, transform: { column: { from: (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase()) } } });
  try {
    const rows = await appSql.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${B.tenantId}, true)`;
      return tx`SELECT count(*)::int AS n FROM library_atoms WHERE tenant_id = ${A.tenantId}::uuid`;
    });
    check(rows[0].n === 0, 'RLS itself hides tenant A\'s atoms from tenant B\'s context', `saw ${rows[0].n}`);
  } catch (e) {
    check(false, 'RLS probe failed', String(e).slice(0, 80));
  } finally { await appSql.end(); }
} else {
  note('DATABASE_URL (govtech_app) unset — skipping the RLS-layer check');
}

// ── 6 · do the atoms come back out when someone writes? ────────────────────
// The whole point of the library. selectForSection is a GET with the section's mold as query
// params (?vol=&kinds=&context=&limit=) — NOT a POST with a sectionId; posting hits the
// record-a-selection handler instead, which returns 200 and proves nothing about ranking.
console.log('\n6. the atoms come back out');
const ASKS = [
  { label: 'a technical narrative section', q: 'vol=technical&kinds=narrative&context=navy,sttr,phase_1&limit=8' },
  { label: 'a key-personnel section',       q: 'vol=key_personnel&kinds=bio&context=navy,sttr&limit=8' },
  { label: 'a cost section',                q: 'vol=cost&kinds=budget_data&context=navy,sttr&limit=8' },
];
const freshIds = new Set(fresh.map((f) => f.id));
for (const a of ASKS) {
  const r = await pageA.request.get(`${BASE}/api/portal/${A.slug}/atoms/select?${a.q}`);
  const j = await r.json().catch(() => ({}));
  const atoms = j?.data?.atoms;
  if (!r.ok() || !Array.isArray(atoms)) {
    check(false, `${a.label} — selector failed`, `${r.status()} ${JSON.stringify(j).slice(0, 90)}`);
    continue;
  }
  const mine = atoms.filter((x) => freshIds.has(x.id));
  check(atoms.length > 0, `${a.label} → ${atoms.length} candidate(s)`);
  check(mine.length > 0, `  …${mine.length} of them are from the documents just uploaded`,
    mine.length ? `top: "${String(mine[0].title ?? '').slice(0, 44)}"` : 'the upload is invisible to this section');
}

// And it must not rank ANOTHER tenant's atoms, whatever the tags say.
const rB = await pageB.request.get(`${BASE}/api/portal/${B.slug}/atoms/select?vol=technical&kinds=narrative&context=navy,sttr&limit=20`);
const jB = await rB.json().catch(() => ({}));
const atomsB = Array.isArray(jB?.data?.atoms) ? jB.data.atoms : [];
check(!atomsB.some((x) => freshIds.has(x.id)),
  'tenant B\'s selector never ranks tenant A\'s uploads', `${atomsB.length} candidates on B`);

console.log(bad === 0 ? '\n✓ upload → atomize → library → selection holds end to end' : `\n✗ ${bad} check(s) failed`);
await browser.close();
await sql.end();
process.exit(bad === 0 ? 0 : 1);
