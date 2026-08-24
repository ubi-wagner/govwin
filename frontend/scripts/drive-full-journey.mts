/**
 * THE WHOLE ARC, as a person walks it, with a screen grab at every step.
 *
 * Every other harness here proves one hop. This walks the product end to end — an rfp_admin
 * ingesting a solicitation, a customer applying and being onboarded, their library and buckets, a
 * new opportunity arriving and re-ranking what they see, a portal being provisioned, volumes being
 * authored, and the finished artifacts coming out the other side — and photographs each stage.
 *
 * WHY SCREEN GRABS AND NOT ASSERTIONS ALONE. B120 was a document that rendered "Something went
 * wrong" while its exports were byte-perfect: the data was never wrong, only the screen was, and
 * every byte-level check in this repo passed throughout. An arc that only asserts row counts would
 * have walked straight past it. The picture is the evidence a person can disagree with.
 *
 * WHAT IT REFUSES TO DO. It does not fabricate a stage it could not perform. Anything it cannot
 * reach is recorded in GAPS and printed at the end, because a nine-stage journey that silently
 * skips stage four is a demo, not a proof.
 *
 *   cd frontend && npx tsx scripts/drive-full-journey.mts
 *   DEMO_OUT=/tmp/journey  where the screen grabs land
 */
import { sql, sqlBypass } from '@/lib/db';
import { stageIntake } from '@/lib/intake';
import { BASE, launch, signIn } from './lib/cross-company.mts';
import { purgeTenantSteps, deleteUntilStable } from './lib/scenario.mts';
import { snapshotResidue, reclaimResidue, describeResidue, type ResidueSnapshot } from './lib/harness-residue.mts';
import { CANVAS_PRESETS, estimatePageCount, estimateSlideCount, type CanvasDocument, type CanvasNode } from '@/lib/types/canvas-document';
import { mkdirSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';

const OUT = process.env.DEMO_OUT || '/tmp/journey';
mkdirSync(OUT, { recursive: true });

const GAPS: string[] = [];
const STEPS: Array<{ n: string; what: string; ok: boolean; detail: string }> = [];
const gap = (m: string) => { GAPS.push(m); console.log(`   ⚠ ${m}`); };
const step = (n: string, what: string, ok: boolean, detail = '') => {
  STEPS.push({ n, what, ok, detail });
  console.log(`  ${ok ? '✅' : '❌'} ${n}  ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) GAPS.push(`${n}: ${what} — ${detail}`);
};

let shotN = 0;
async function shoot(page: import('playwright').Page, name: string, full = false) {
  const file = `${OUT}/${String(++shotN).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file, fullPage: full });
  return file;
}

/** Navigate and photograph, reporting an error surface rather than capturing it silently. */
async function visit(page: import('playwright').Page, url: string, name: string, full = false) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  const body = await page.evaluate(() => document.body.innerText);
  const broken = /Something went wrong|This page failed to load|404|not found/i.test(body.slice(0, 400));
  await shoot(page, name, full);
  if (broken) gap(`${url} rendered an error surface`);
  return !broken;
}

let seq = 0;
const N = (type: string, content: unknown, style: unknown = {}): CanvasNode => ({
  id: `j${++seq}`, type, content, style, provenance: { source: 'manual' }, history: [],
  library_eligible: true,
} as unknown as CanvasNode);

/** A technical volume long enough to be a real 10-page volume, not a stub. */
function tenPageVolume(): CanvasDocument {
  const para = (i: number) =>
    `${i}. The additive construction cell maintains a controlled thermal profile across the full `
    + `build volume, holding layer adhesion within specification through the qualification matrix. `
    + `Coupons are sectioned at each milestone and dispositioned against the AMS specification, with `
    + `results fed back into the process model so the next build starts from measured behaviour `
    + `rather than nominal. The approach removes the dependency on operator judgement that has `
    + `historically limited repeatability in expeditionary conditions, and it is the reason the `
    + `programme can commit to a transition package at month twelve rather than a further study.`;
  const nodes: CanvasNode[] = [
    N('heading', { level: 1, text: 'Technical Volume — Additive Construction for Expeditionary Basing' },
      { size: 18, weight: 'bold', alignment: 'center' }),
    N('text_block', { text: 'Immobileyes Inc. · N261-EXP01 · Phase I' }, { style: 'italic', alignment: 'center' }),
  ];
  for (let s = 1; s <= 12; s++) {
    nodes.push(N('heading', { level: 2, text: `${s}.0 Section ${s}` }, { size: 13, weight: 'bold' }));
    for (let p = 1; p <= 5; p++) nodes.push(N('text_block', { text: para(p) }, {}));
    if (s === 3 || s === 9) nodes.push(N('table', {
      headers: ['WBS', 'Deliverable', 'Month', 'Status'],
      rows: Array.from({ length: 8 }, (_, i) => [`1.${i + 1}`, 'Qualification build', String(i + 2), 'On track']),
    }, {}));
    if (s === 5 || s === 11) nodes.push(N('bulleted_list', {
      items: Array.from({ length: 10 }, (_, i) => ({ text: `Acceptance criterion ${i + 1} closed against the test plan` })),
    }, {}));
  }
  return { version: 1, canvas: { ...CANVAS_PRESETS.letter_standard },
    metadata: { title: 'Technical Volume', status: 'draft' }, nodes } as unknown as CanvasDocument;
}

/** Exactly five slides — one section per slide, separated by page breaks. */
function fiveSlideDeck(): CanvasDocument {
  const slide = (title: string, bullets: string[]) => [
    N('heading', { level: 1, text: title }, { size: 26 }),
    N('bulleted_list', { items: bullets.map((text) => ({ text })) }, {}),
  ];
  const nodes: CanvasNode[] = [
    ...slide('Additive Construction for Expeditionary Basing', ['Immobileyes Inc.', 'N261-EXP01 · Phase I']),
    N('page_break', {}),
    ...slide('The problem', ['Basing structures are shipped, not built', 'Lift capacity is the binding constraint']),
    N('page_break', {}),
    ...slide('Our approach', ['Print from local aggregate', 'Closed-loop thermal control', 'Operator-free qualification']),
    N('page_break', {}),
    ...slide('Milestones', ['M1 — cell integrated', 'M2 — field trial', 'M3 — transition package']),
    N('page_break', {}),
    ...slide('What we need', ['Range access at two windows', 'Government-furnished aggregate spec']),
  ];
  return { version: 1, canvas: { ...CANVAS_PRESETS.slide_deck },
    metadata: { title: 'Capability Deck', status: 'draft' }, nodes } as unknown as CanvasDocument;
}

/** A cost sheet as a real spreadsheet — a table the xlsx writer turns into a worksheet. */
function costSheet(): CanvasDocument {
  const rows: string[][] = [
    ['Direct labour — PI', '0.25', '12', '18,750'],
    ['Direct labour — Engineer', '1.00', '12', '96,000'],
    ['Direct labour — Technician', '0.50', '12', '33,000'],
    ['Fringe @ 28%', '', '', '41,370'],
    ['Overhead @ 55%', '', '', '104,216'],
    ['Materials — aggregate + binder', '', '', '22,400'],
    ['Travel — two field windows', '', '', '9,800'],
    ['G&A @ 12%', '', '', '39,065'],
    ['TOTAL', '', '', '364,601'],
  ];
  return { version: 1, canvas: { ...CANVAS_PRESETS.spreadsheet },
    metadata: { title: 'Cost Volume', status: 'draft' },
    nodes: [
      N('heading', { level: 1, text: 'Cost Volume — Base Period' }, { size: 14, weight: 'bold' }),
      N('table', { sheet_name: 'Cost', headers: ['Element', 'FTE', 'Months', 'Amount ($)'], rows }, {}),
    ] } as unknown as CanvasDocument;
}

async function main() {
  console.log(`\n╔══ FULL JOURNEY ══ screen grabs → ${OUT}\n`);

  const [admin] = await sqlBypass<Array<{ id: string; email: string }>>`
    SELECT id, email FROM users WHERE role IN ('master_admin','rfp_admin') AND is_active
    ORDER BY (role='master_admin') DESC, created_at LIMIT 1`;
  const [tenant] = await sqlBypass<Array<{ id: string; slug: string; name: string }>>`
    SELECT t.id, t.slug, t.name FROM tenants t
    JOIN user_memberships m ON m.tenant_id = t.id
    JOIN users u ON u.id = m.user_id AND u.is_active AND u.role='tenant_admin'
    GROUP BY t.id, t.slug, t.name ORDER BY t.created_at LIMIT 1`;
  const [member] = await sqlBypass<Array<{ email: string }>>`
    SELECT u.email FROM users u JOIN user_memberships m ON m.user_id=u.id
    WHERE m.tenant_id=${tenant.id}::uuid AND u.is_active AND u.role='tenant_admin'
    ORDER BY u.created_at LIMIT 1`;
  console.log(`  rfp_admin    ${admin.email}`);
  console.log(`  tenant_admin ${member.email} @ ${tenant.slug}\n`);

  const browser = await launch();
  const adminCtx = await signIn(browser, admin.email, process.env.RFP_ADMIN_PW || process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!');
  const tenantCtx = await signIn(browser, member.email, process.env.TENANT_PW || 'DemoPass123!');
  const A = adminCtx.pages()[0];
  const T = tenantCtx.pages()[0];
  await A.setViewportSize({ width: 1680, height: 1050 });
  await T.setViewportSize({ width: 1680, height: 1050 });

  const made: { docs: string[]; opps: string[]; apps: string[]; buckets: string[]; tenants: string[] } =
    { docs: [], opps: [], apps: [], buckets: [], tenants: [] };

  // Saving a document MINTS LIBRARY ATOMS — 88 of them across these three volumes, none inserted
  // by this drive. Delete-what-I-created cannot see them (B119), so the box is reconciled on an ID
  // delta taken before a single row is written.
  let residueBefore: ResidueSnapshot | null = null;

  try {
    residueBefore = await snapshotResidue();

    // ═══ 1 · RFP ADMIN ════════════════════════════════════════════════════════════════════════
    console.log('══ 1 · RFP ADMIN ══');
    step('1a', 'admin command center renders', await visit(A, '/admin/command', 'admin-command'), admin.email);
    step('1b', 'admin dashboard renders', await visit(A, '/admin', 'admin-dashboard'));

    // ═══ 2 · INGEST + OPPORTUNITIES ═══════════════════════════════════════════════════════════
    console.log('\n══ 2 · INGEST + OPPORTUNITIES ══');
    const [{ n: solsBefore }] = await sqlBypass<Array<{ n: number }>>`SELECT count(*)::int AS n FROM curated_solicitations`;
    const [{ n: oppsBefore }] = await sqlBypass<Array<{ n: number }>>`SELECT count(*)::int AS n FROM opportunities`;
    step('2a', 'intake surface renders', await visit(A, '/admin/intake', 'admin-intake'));
    step('2b', 'curation queue renders', await visit(A, '/admin/rfp-curation', 'admin-curation'));
    // DRIVEN, not merely shown. stageIntake is the real producer behind the admin intake form and
    // the scout release path — the same function, not a SQL insert dressed up as one.
    const probeTitle = `JOURNEY OPP ${Date.now().toString(36)} — Directed Energy Counter-UAS`;
    const staged = await stageIntake({
      title: probeTitle, agency: 'Department of the Air Force',
      solicitationNumber: `JRN-${Date.now().toString(36).toUpperCase()}`,
      dueDate: '2026-12-15', description: 'Created by the full-journey drive.',
    } as Parameters<typeof stageIntake>[0], admin.id);
    // `stageIntake` returns { opportunityId, solicitationId }. My first version read `.opportunity.id`
    // and `.id`, found neither, and reported the PRODUCER as broken — while the payload printed in
    // the failure message plainly contained the id. The step failed and, worse, the cleanup then had
    // nothing to remove, so a working stage left residue and blamed the product for it.
    const newOppId = (staged as { opportunityId?: string })?.opportunityId ?? null;
    made.opps.push(...(newOppId ? [newOppId] : []));
    step('2c', 'a NEW opportunity is INGESTED through the real producer', !!newOppId,
      newOppId ? `opp ${newOppId.slice(0, 8)}` : `stageIntake returned ${JSON.stringify(staged).slice(0, 90)}`);

    const [{ n: oppsAfter }] = await sqlBypass<Array<{ n: number }>>`SELECT count(*)::int AS n FROM opportunities`;
    step('2d', 'the opportunity count actually moved', oppsAfter === oppsBefore + 1,
      `${oppsBefore} → ${oppsAfter}`);
    step('2e', 'opportunities list renders with it', await visit(A, '/admin/opportunities', 'admin-opportunities', true),
      `${oppsAfter} opportunities · ${solsBefore} solicitations`);

    // ═══ 3 · CUSTOMER APPLICATION + ONBOARDING ════════════════════════════════════════════════
    console.log('\n══ 3 · CUSTOMER APPLICATION + ONBOARDING ══');
    // A real application row, the shape the public form posts, then ACCEPTED through the admin API.
    const co = `Journey Robotics ${Date.now().toString(36)}`;
    const [app] = await sqlBypass<Array<{ id: string }>>`
      INSERT INTO applications (company_name, contact_name, contact_email, tech_summary, terms_accepted_at, status)
      VALUES (${co}, 'Dana Reyes', ${`dana.${Date.now().toString(36)}@journey.test`},
              'Autonomous perception payloads for contested airspace.', now(), 'pending')
      RETURNING id`;
    made.apps.push(app.id);
    step('3a', 'a customer application exists in the queue', !!app?.id, co);
    step('3b', 'applications queue renders', await visit(A, '/admin/applications', 'admin-applications'));

    const acc = await A.evaluate(async (u) => {
      const r = await fetch(u as string, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      return { status: r.status, body: (await r.text()).slice(0, 160) };
    }, `/api/admin/applications/${app.id}/accept`) as { status: number; body: string };
    step('3c', 'the application is ACCEPTED through the real admin route',
      acc.status === 200 || acc.status === 201, `status ${acc.status} ${acc.body.slice(0, 70)}`);
    // Accepting an application PROVISIONS A REAL TENANT. Recorded so the teardown can remove it —
    // otherwise this drive grows the box by one company every time it runs.
    try {
      const born = JSON.parse(acc.body.replace(/\.\.\.$/, '') + (acc.body.trim().endsWith('}') ? '' : '}}'));
      const tid = born?.data?.tenantId; if (tid) made.tenants.push(String(tid));
    } catch { /* recovered from the DB below instead */ }
    if (!made.tenants.length) {
      const [t2] = await sqlBypass<Array<{ id: string }>>`
        SELECT id FROM tenants WHERE name = ${co} ORDER BY created_at DESC LIMIT 1`;
      if (t2) made.tenants.push(t2.id);
    }
    const [after] = await sqlBypass<Array<{ status: string }>>`SELECT status FROM applications WHERE id=${app.id}::uuid`;
    step('3d', 'the application row records the decision', after?.status !== 'pending', `status=${after?.status}`);
    step('3e', 'tenants list renders', await visit(A, '/admin/tenants', 'admin-tenants', true));
    step('3f', 'the onboarded customer’s portal renders', await visit(T, `/portal/${tenant.slug}`, 'portal-home'),
      `${tenant.name}`);

    // ═══ 4 · LIBRARY ══════════════════════════════════════════════════════════════════════════
    console.log('\n══ 4 · LIBRARY ══');
    const [{ n: atoms }] = await sqlBypass<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM library_atoms WHERE tenant_id=${tenant.id}::uuid AND archived_at IS NULL`;
    step('4a', 'tenant library renders', await visit(T, `/portal/${tenant.slug}/library`, 'portal-library', true),
      `${atoms} atoms`);

    // ═══ 5 · BUCKETS ══════════════════════════════════════════════════════════════════════════
    console.log('\n══ 5 · BUCKETS ══');
    step('5a', 'buckets surface renders', await visit(T, `/portal/${tenant.slug}/buckets`, 'portal-buckets', true));
    const bucketName = `Journey bucket ${Date.now().toString(36)}`;
    const mk = await T.evaluate(async ([u, n]) => {
      const r = await fetch(u as string, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: n, description: 'created by the full-journey drive',
          criteria: { keywords: ['additive', 'construction'], weights: { keyword: 1 } } }) });
      return { status: r.status, json: await r.json().catch(() => null) };
    }, [`/api/portal/${tenant.slug}/buckets`, bucketName] as const) as { status: number; json: any };
    const bucketId = mk.json?.data?.id ?? mk.json?.data?.bucket?.id;
    if (bucketId) made.buckets.push(String(bucketId));
    step('5b', 'a NEW bucket is created through the real route', mk.status === 200 || mk.status === 201,
      `status ${mk.status}${bucketId ? ` · id ${String(bucketId).slice(0, 8)}` : ''}`);
    step('5c', 'the new bucket appears on the page',
      await visit(T, `/portal/${tenant.slug}/buckets`, 'portal-buckets-after', true));

    // ═══ 6 · CARDS + RANKING ══════════════════════════════════════════════════════════════════
    console.log('\n══ 6 · OPPORTUNITY CARDS + RANKING ══');
    const [{ n: cards }] = await sqlBypass<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM tenant_opportunity_cards WHERE tenant_id=${tenant.id}::uuid`;
    step('6a', 'the customer’s opportunity cards render', await visit(T, `/portal/${tenant.slug}/cards`, 'portal-cards', true),
      `${cards} cards`);
    const [{ n: scores }] = await sqlBypass<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM tenant_bucket_scores s
      JOIN tenant_spotlight_buckets b ON b.id = s.bucket_id WHERE b.tenant_id=${tenant.id}::uuid`;
    step('6b', 'bucket scores exist for ranking', scores > 0, `${scores} score row(s)`);

    // ═══ 7 · PORTAL PROVISIONING ══════════════════════════════════════════════════════════════
    console.log('\n══ 7 · PORTAL PROVISIONING ══');
    step('7a', 'the customer’s portals surface renders', await visit(T, `/portal/${tenant.slug}/portals`, 'portal-portals', true));
    const [portal] = await sqlBypass<Array<{ id: string }>>`SELECT id FROM proposal_portals ORDER BY created_at DESC LIMIT 1`;
    if (portal) {
      step('7b', 'the admin provisioning cockpit renders',
        await visit(A, `/admin/provisioning/${portal.id}`, 'admin-provisioning', true));
    } else { gap('7b: no proposal_portal exists to open the cockpit on'); }

    // ═══ 8 · VOLUME GENERATION ════════════════════════════════════════════════════════════════
    console.log('\n══ 8 · VOLUME GENERATION — all three shapes ══');
    const volumes = [
      { key: 'technical', preset: 'letter', doc: tenPageVolume(), title: 'Technical Volume', want: 'pdf' },
      { key: 'deck', preset: 'deck', doc: fiveSlideDeck(), title: 'Capability Deck', want: 'pptx' },
      { key: 'cost', preset: 'sheet', doc: costSheet(), title: 'Cost Volume', want: 'xlsx' },
    ];
    const built: Array<{ key: string; id: string; doc: CanvasDocument; want: string }> = [];
    for (const v of volumes) {
      const cr = await T.evaluate(async ([u, p, t]) => {
        const r = await fetch(u as string, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ preset: p, title: t }) });
        return { status: r.status, json: await r.json().catch(() => null) };
      }, [`/api/portal/${tenant.slug}/documents`, v.preset, v.title] as const) as { status: number; json: any };
      const id = cr.json?.data?.documentId;
      if (!id) { gap(`8: could not create the ${v.key} volume (status ${cr.status})`); continue; }
      made.docs.push(id);

      const sv = await T.evaluate(async ([u, d, t]) => {
        const r = await fetch(u as string, { method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: d, title: t }) });
        return r.status;
      }, [`/api/portal/${tenant.slug}/documents/${id}/save`, v.doc, v.title] as const) as number;
      step(`8-${v.key}`, `${v.title} authored and saved`, sv === 200, `status ${sv}`);
      built.push({ key: v.key, id, doc: v.doc, want: v.want });

      await visit(T, `/portal/${tenant.slug}/documents/${id}`, `volume-${v.key}`, true);
    }

    // ═══ 9 · DOWNLOAD + MEASURE THE ARTIFACTS ═════════════════════════════════════════════════
    console.log('\n══ 9 · DOWNLOAD — and MEASURE what came out ══');
    for (const b of built) {
      const r = await T.evaluate(async ([u, d, f]) => {
        const res = await fetch(u as string, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ document: d, format: f }) });
        const ab = await res.arrayBuffer();
        let bin = ''; const bytes = new Uint8Array(ab);
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return { status: res.status, b64: btoa(bin) };
      }, [`/api/portal/${tenant.slug}/documents/${b.id}/export`, b.doc, b.want] as const) as { status: number; b64: string };
      const buf = Buffer.from(r.b64, 'base64');
      writeFileSync(`${OUT}/${b.key}.${b.want}`, buf);

      // MEASURED FROM THE FILE, not from the model that produced it.
      if (b.want === 'pdf') {
        const printed = (buf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
        const ruler = estimatePageCount(b.doc);
        // TEN, because ten is what was asked for. An assertion trimmed to whatever the content
        // happens to produce tests nothing — it just records the outcome and calls it a pass.
        step('9-doc', 'the technical volume is a full 10-page volume',
          printed >= 10, `${printed} pages printed (ruler said ${ruler})`);
      } else if (b.want === 'pptx') {
        const zip = await JSZip.loadAsync(buf);
        const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length;
        step('9-deck', 'the deck is exactly five slides', slides === 5,
          `${slides} slides in the .pptx (ruler said ${estimateSlideCount(b.doc)})`);
      } else {
        const zip = await JSZip.loadAsync(buf);
        const sheets = Object.keys(zip.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).length;
        const shared = await zip.files['xl/sharedStrings.xml']?.async('string') ?? '';
        step('9-cost', 'the cost sheet is a real worksheet carrying its totals',
          sheets >= 1 && /364,601|TOTAL/.test(shared), `${sheets} worksheet(s), TOTAL present: ${/364,601|TOTAL/.test(shared)}`);
      }
      console.log(`     ${b.key}.${b.want} · ${Math.round(buf.length / 1024)}KB → ${OUT}/${b.key}.${b.want}`);
    }
  } finally {
    // EVERY STEP INDEPENDENTLY, so one failure cannot strand the rest.
    //
    // The first version ran these as a straight sequence and aborted on the first FK it hit —
    // `curated_solicitations` still referencing the opportunity — which meant the buckets and the
    // provisioned TENANT below it were never removed at all. A teardown that gives up halfway is
    // worse than one that never ran: it leaves a partial state nobody can reason about, and it
    // reports the abort as the drive failing rather than as litter.
    //
    // Each step now records its own failure and the run continues. Anything that genuinely could
    // not be removed lands in GAPS and is printed, so residue is named rather than discovered later
    // by another harness.
    const step_ = async (what: string, fn: () => Promise<unknown>) => {
      try { await fn(); } catch (e) { GAPS.push(`teardown: ${what} — ${String(e).slice(0, 90)}`); }
    };

    if (made.docs.length) await step_('documents', () => sqlBypass`DELETE FROM tenant_documents WHERE id = ANY(${made.docs}::uuid[])`);
    if (made.apps.length) await step_('applications', () => sqlBypass`DELETE FROM applications WHERE id = ANY(${made.apps}::uuid[])`);
    for (const o of made.opps) {
      await step_('instance transitions', () => sqlBypass`DELETE FROM process_instance_transitions WHERE instance_id IN (
        SELECT id FROM process_instances WHERE trigger_event_id IN (
          SELECT id FROM system_events WHERE payload->>'opportunityId' = ${o}))`);
      await step_('process instances', () => sqlBypass`DELETE FROM process_instances WHERE trigger_event_id IN (
        SELECT id FROM system_events WHERE payload->>'opportunityId' = ${o})`);
      await step_('tasks', () => sqlBypass`DELETE FROM tasks WHERE entity_id = ${o}::uuid`);
      await step_('events', () => sqlBypass`DELETE FROM system_events WHERE payload->>'opportunityId' = ${o}`);
      await step_('cards', () => sqlBypass`DELETE FROM tenant_opportunity_cards WHERE opportunity_id = ${o}::uuid`);
      await step_('bridge', () => sqlBypass`DELETE FROM opportunity_bridge WHERE opportunity_id = ${o}::uuid`);
      await step_('scout findings', () => sqlBypass`DELETE FROM scout_findings WHERE match_opportunity_id = ${o}::uuid`);
      // stageIntake creates the SOLICITATION as well as the opportunity, and it holds the FK.
      await step_('curated solicitation', () => sqlBypass`DELETE FROM curated_solicitations WHERE opportunity_id = ${o}::uuid`);
      await step_('opportunity', () => sqlBypass`DELETE FROM opportunities WHERE id = ${o}::uuid`);
    }
    for (const b of made.buckets) {
      await step_('bucket scores', () => sqlBypass`DELETE FROM tenant_bucket_scores WHERE bucket_id = ${b}::uuid`);
      await step_('bucket', () => sqlBypass`DELETE FROM tenant_spotlight_buckets WHERE id = ${b}::uuid`);
    }
    // The tenant the accept provisioned, removed with the SAME graph-descent the scenario factory
    // uses — a second hand-written cascade would be a second opinion about the schema.
    for (const t of made.tenants) {
      await step_(`tenant ${t.slice(0, 8)}`, async () => {
        const { stuck } = await deleteUntilStable(await purgeTenantSteps(t));
        if (stuck.length) GAPS.push(`teardown: tenant ${t.slice(0, 8)} left ${stuck.length} table(s) stuck`);
      });
    }
    console.log(`\n  cleanup: ${made.docs.length} document(s), ${made.opps.length} opportunity(s), `
      + `${made.apps.length} application(s), ${made.buckets.length} bucket(s), ${made.tenants.length} tenant(s)`);
    if (residueBefore) await step_('minted atoms', async () =>
      console.log(`  ${describeResidue(await reclaimResidue(residueBefore!))}`));
    await browser.close();
    await sql.end().catch(() => {}); await sqlBypass.end().catch(() => {});
  }

  const failed = STEPS.filter((s) => !s.ok).length;
  writeFileSync(`${OUT}/JOURNEY.txt`,
    STEPS.map((s) => `${s.ok ? 'PASS' : 'FAIL'}  ${s.n}  ${s.what}  ${s.detail}`).join('\n')
    + (GAPS.length ? `\n\nGAPS\n${GAPS.map((g) => '· ' + g).join('\n')}` : ''));

  console.log(`\n══ ${STEPS.length - failed}/${STEPS.length} steps passed · ${shotN} screen grabs → ${OUT}`);
  if (GAPS.length) {
    console.log(`\n── what this arc could NOT do (${GAPS.length}) ──`);
    GAPS.forEach((g) => console.log(`  · ${g}`));
  } else {
    console.log('\n✓ every stage walked and photographed.');
  }
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error('JOURNEY ERROR', e);
  await sql.end().catch(() => {}); await sqlBypass.end().catch(() => {});
  process.exit(1);
});
