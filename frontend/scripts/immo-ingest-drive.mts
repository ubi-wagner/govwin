/** HITL Immobileyes-admin ingestion drive — the four REAL DSIP proposals through the LIVE
 *  system process (login → Add Content API → PREVIEW gate → human review → COMMIT), so any
 *  error in any layer (route, analyzer, atoms, events, librarian enqueue) surfaces.
 *
 *  Package 1 (Navy N26BX GHOST) uploads the merged Full_Proposal + its 13 DSIP sidecars as
 *  ONE package — sidecars join the proposal cocoon volume-tagged by DSIP's own filenames.
 *  The other three upload as single-merged-PDF packages.
 *
 *  cd frontend && node --import tsx scripts/immo-ingest-drive.mts */
import { chromium, type APIRequestContext } from 'playwright';
import { readFileSync } from 'fs';
import { join } from 'path';

const U = '/root/.claude/uploads/34d597b2-183f-5787-9057-fc7251e3f9ff';
const BASE = 'http://localhost:3000';
const SLUG = 'immobileyes';

interface Pack { name: string; files: string[]; ctx: Record<string, string> }
const PACKS: Pack[] = [
  {
    name: 'N26BX-NP002 GHOST — Navy SBIR Phase I (DSIP package)',
    files: [
      '75ed5b3c-N26BXNP0020450_Full_Proposal.pdf',
      '27a137b7-N26BXNP0020450CoverSheet.pdf',
      'f98e59d4-N26BXNP0020450_SBC_748198.pdf',
      'b1b01b31-N26BXNP0020450_SBC_1050921.pdf',
      'fd1e2482-N26BXNP0020450_SBC_681402.pdf',
      'f4b1f8fd-N26BXNP0020450Proposal.pdf',
      'a7935797-N26BXNP0020450Budget.pdf',
      'f7dc60b5-N26BXNP0020450_Addt_Cost_Info_1816592.pdf',
      '9ba4fdb6-N26BXNP0020450CCR.pdf',
      '4c7eb6de-N26BXNP0020450_Fund_Agrmnt_Cert_1817601.pdf',
      '4986080b-N26BXNP0020450_Lifecycle_Cert_1817605.pdf',
      '1e764f3c-N26BXNP0020450Foreign_Affiliations.pdf',
      '28b39a77-N26BXNP0020450_Other_1817608.pdf',
      '07b85f3f-N26BXNP0020450FWA.pdf',
    ],
    ctx: { docType: 'past_proposal', program: 'sbir', phase: '1', agency: 'Navy', topic: 'DON26BX03-NP002', sol: 'N26B-X' },
  },
  {
    name: 'N254-P01 LEOPARD — Navy SBIR Phase I',
    files: ['81aa921d-N254P010421_Full_Proposal.pdf'],
    ctx: { docType: 'past_proposal', program: 'sbir', phase: '1', agency: 'Navy', topic: 'N254-P01' },
  },
  {
    name: 'FX23.5 CSO HALAR — Air Force SBIR Phase I',
    files: ['93414b44-FX235CSO10859_Full_Proposal.pdf'],
    ctx: { docType: 'past_proposal', program: 'sbir', phase: '1', agency: 'Air Force', topic: 'AFX235-CSO1' },
  },
  {
    name: 'AFX23D-TCSO1 Directed Energy — Air Force STTR Phase II',
    files: ['b7b2a387-F217528_Full_Proposal.pdf'],
    ctx: { docType: 'past_proposal', program: 'sttr', phase: '2', agency: 'Air Force', topic: 'AFX23D-TCSO1' },
  },
];

function multipart(pack: Pack, preview: boolean) {
  const fd: Record<string, unknown> = {
    context: JSON.stringify(pack.ctx),
    packageName: pack.name,
    ...(preview ? { preview: '1' } : {}),
  };
  return fd;
}

async function post(api: APIRequestContext, pack: Pack, preview: boolean) {
  // Repeated same-name file fields need a real FormData (Node 22 global File).
  const fd = new FormData();
  for (const [k, v] of Object.entries(multipart(pack, preview))) fd.append(k, String(v));
  for (const f of pack.files) {
    const buf = readFileSync(join(U, f));
    fd.append('files', new File([new Uint8Array(buf)], f.replace(/^[0-9a-f]{8}-/, ''), { type: 'application/pdf' }));
  }
  return api.post(`${BASE}/api/portal/${SLUG}/atoms/atomize-package`, {
    multipart: fd, timeout: 300_000,
  });
}

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await b.newContext()).newPage();
await page.goto(`${BASE}/login`);
await page.fill('input[type="email"]', 'admin@immobileyes.test');
await page.fill('input[type="password"]', 'DemoPass123!');
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }),
  page.click('button[type="submit"]'),
]);
console.log('✓ logged in as admin@immobileyes.test →', new URL(page.url()).pathname);
const api = page.request;

let failures = 0;
const only = process.argv[2] != null ? Number(process.argv[2]) : null;
for (const [pi, pack] of PACKS.entries()) {
  if (only != null && pi !== only) continue;
  console.log(`\n══════ ${pack.name} (${pack.files.length} file${pack.files.length > 1 ? 's' : ''})`);

  // ── PREVIEW (the HITL gate: review the volume plan before anything writes) ──
  const pv = await post(api, pack, true);
  if (pv.status() !== 200) { console.log(`  ✗ preview HTTP ${pv.status()}: ${(await pv.text()).slice(0, 300)}`); failures++; continue; }
  const pvDocs = (await pv.json()).data.docs as Array<{ file: string; dsip?: { volumes: Array<{ volume: number; name: string; words: number; blocks: number }> }; planned: unknown[]; error?: string }>;
  const main = pvDocs.find((d) => /full_proposal/i.test(d.file));
  if (!main?.dsip) { console.log('  ✗ preview: Full_Proposal not recognized as a DSIP proposal'); failures++; continue; }
  console.log('  PREVIEW plan (human review):');
  for (const v of main.dsip.volumes) console.log(`    Vol ${v.volume} · ${v.name} — ${v.words} words, ${v.blocks} page atoms`);
  const volNums = main.dsip.volumes.map((v) => v.volume);
  const reviewOk = volNums.includes(2) && volNums.includes(3) && volNums.includes(4) && main.dsip.volumes.every((v) => v.words > 0);
  console.log(`  HITL verdict: ${reviewOk ? 'plan matches the document — APPROVE & COMMIT' : 'plan rejected'}`);
  if (!reviewOk) { failures++; continue; }

  // ── COMMIT ──
  const cm = await post(api, pack, false);
  if (cm.status() !== 200) { console.log(`  ✗ commit HTTP ${cm.status()}: ${(await cm.text()).slice(0, 300)}`); failures++; continue; }
  const data = (await cm.json()).data as { totalAtoms: number; docs: Array<{ file: string; atoms: number; cocoonId: string | null; volumes?: number; error?: string }> };
  const mainDoc = data.docs.find((d) => /full_proposal/i.test(d.file))!;
  const cocoons = new Set(data.docs.map((d) => d.cocoonId).filter(Boolean));
  const errs = data.docs.filter((d) => d.error);
  console.log(`  COMMIT: ${data.totalAtoms} atoms · ${mainDoc.volumes ?? 0} volume foundations · cocoons=${cocoons.size} (${[...cocoons][0]})`);
  for (const d of data.docs) console.log(`    · ${d.file}: ${d.atoms} atoms${d.volumes ? ` + ${d.volumes} volumes` : ''}${d.error ? ` ✗ ${d.error}` : ''}${d.cocoonId === mainDoc.cocoonId ? '' : ' [OWN COCOON?]'}`);
  if (errs.length > 0 || (mainDoc.volumes ?? 0) < 4 || cocoons.size !== 1) { console.log('  ✗ commit inconsistencies above'); failures++; }
}

await b.close();
console.log(`\n${failures === 0 ? '✅ ALL PACKAGES INGESTED THROUGH THE LIVE SYSTEM' : `❌ ${failures} package(s) had problems`}`);
process.exit(failures === 0 ? 0 : 1);
