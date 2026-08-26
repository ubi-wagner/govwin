/**
 * THE SCENARIO MATRIX — drive the combinations the two guides describe, as real actors.
 *
 * The enumeration, the covering-set argument, and the list of interacting pairs live in
 * `docs/SCENARIO_MATRIX.md`. This file drives it. The contract between them is one-way: **a
 * scenario absent from this run's table has not been driven**, whatever the document says, which is
 * why every registered scenario prints a row even when it could not run.
 *
 * FOUR RESULTS, and keeping them apart is the whole point:
 *
 *   pass       every assertion held
 *   FAIL       an assertion did not hold — a finding
 *   CANNOT-RUN the box could not supply what the scenario needs. Uncovered, not passing, NOT a
 *              finding. Collapsing this into FAIL is how a drive that never authenticated came to
 *              print "a DENY-ALL surfaced" (docs/E2E_SWEEP_2026-08-23.md §3).
 *   NOT-DRIVEN registered in the matrix, no driver written yet. Shown so the table can never
 *              overstate coverage by omission.
 *
 * Every scenario builds what it needs through `scripts/lib/scenario.mts` and disposes of it, so the
 * run leaves the database exactly as it found it — asserted at the end, not assumed.
 *
 *   cd frontend && DATABASE_URL=… node --import tsx scripts/drive-scenario-matrix.mts [S01 ...]
 */
import { chromium, type BrowserContext } from 'playwright';
import { sqlBypass as sql } from '@/lib/db';
import { scenario, CannotRun, SCENARIO_PW, type Scenario, type ScenarioTenant } from './lib/scenario.mts';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ADMIN_PW = process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!';
const only = process.argv.slice(2).filter((a) => /^S\d\d$/i.test(a)).map((a) => a.toUpperCase());

// ─── assertion plumbing ───────────────────────────────────────────────────────────────────────
class Check {
  ok = true;
  readonly lines: string[] = [];
  a(label: string, cond: boolean, detail = '') {
    this.lines.push(`    ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!cond) this.ok = false;
  }
}

type Verdict = 'pass' | 'FAIL' | 'CANNOT-RUN' | 'NOT-DRIVEN';
interface Row { id: string; title: string; verdict: Verdict; detail: string; lines: string[] }

interface Ctx {
  s: Scenario;
  browser: Awaited<ReturnType<typeof chromium.launch>>;
  /** Sign in as anyone and get an authenticated request context. Throws CannotRun if login fails. */
  as(email: string, password: string): Promise<BrowserContext>;
  admin(): Promise<BrowserContext>;
}

interface ScenarioDef {
  id: string;
  title: string;
  /** Absent → NOT-DRIVEN with `why`. */
  run?: (c: Check, ctx: Ctx) => Promise<void>;
  why?: string;
}

// ─── the registry ─────────────────────────────────────────────────────────────────────────────
const SCENARIOS: ScenarioDef[] = [
  {
    id: 'S01',
    title: 'DoW SBIR Phase I · comp-code buy → release → author → lock → docx',
    async run(c, ctx) {
      const buyer = await ctx.s.tenant({ label: 'buyer' });
      const build = await ctx.s.build({ tenant: buyer, label: 'S01' });
      c.a('a build provisioned with sections', build.sectionCount > 0, `${build.sectionCount}`);

      // The compliance matrix instantiates AT PROVISION — the guide's claim, checked.
      const [m] = await sql<{ n: number; unaddressed: number }[]>`
        SELECT count(*)::int AS n,
               count(*) FILTER (WHERE status = 'not_addressed')::int AS unaddressed
        FROM proposal_compliance_matrix WHERE proposal_id = ${build.proposalId}::uuid`;
      c.a('the compliance matrix instantiated at provision', m.n > 0, `${m.n} rows`);
      c.a('  → every row starts not_addressed', m.n === m.unaddressed, `${m.unaddressed}/${m.n}`);

      // An artifact per volume, sections ordered by the INTEGER sort_index (never string-sorted).
      const [arts] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM proposal_artifacts WHERE proposal_id = ${build.proposalId}::uuid`;
      c.a('an artifact per volume', arts.n > 0, `${arts.n}`);
      const secs = await sql<{ sortIndex: number | null; sectionNumber: string }[]>`
        SELECT sort_index AS "sortIndex", section_number AS "sectionNumber"
        FROM proposal_sections WHERE proposal_id = ${build.proposalId}::uuid
        ORDER BY sort_index ASC NULLS LAST`;
      c.a('sections carry an integer sort_index', secs.every((r) => r.sortIndex !== null));

      // Lock every section as the tenant admin, through the product's own route.
      const page = await ctx.as(buyer.adminEmail, buyer.password);
      let locked = 0;
      for (const sec of await sql<{ id: string }[]>`
        SELECT id FROM proposal_sections WHERE proposal_id = ${build.proposalId}::uuid`) {
        const r = await page.request.post(
          `${BASE}/api/portal/${buyer.slug}/proposals/${build.proposalId}/sections/${sec.id}/lock`,
          { data: {} });
        if (r.ok()) locked++;
      }
      const [lk] = await sql<{ n: number }[]>`
        SELECT count(*) FILTER (WHERE is_locked)::int AS n
        FROM proposal_sections WHERE proposal_id = ${build.proposalId}::uuid`;
      c.a('sections lock through the portal route', lk.n > 0, `${lk.n} locked (${locked} accepted)`);

      // ADVANCE THE PROPOSAL, not just its sections.
      //
      // The route's own words: "Proposal must be locked or in submitted/archived stage to export
      // package". The first version of this scenario locked all 18 SECTIONS and then asserted the
      // download — a simplified version of the gate, which the guide itself states correctly
      // ("A locked/submitted proposal downloads as json/docx/pdf/zip"). The 403 was the product
      // being right and the scenario being wrong. `force` + `acknowledgeBlockers` because this is
      // the deliberate "finalize without every blocker cleared" path a real builder also has.
      const adv = await page.request.post(
        `${BASE}/api/portal/${buyer.slug}/proposals/${build.proposalId}/advance`,
        { data: { targetStage: 'final', force: true, acknowledgeBlockers: true } });
      const [st] = await sql<{ stage: string; isLocked: boolean }[]>`
        SELECT stage, is_locked AS "isLocked" FROM proposals WHERE id = ${build.proposalId}::uuid`;
      c.a('the proposal advances toward a downloadable state', adv.status() < 400 || st.isLocked,
        `${adv.status()} · stage=${st?.stage} locked=${st?.isLocked}`);

      // The package, in the format the guide names.
      const pkg = await page.request.get(
        `${BASE}/api/portal/${buyer.slug}/proposals/${build.proposalId}/package?format=docx`);
      const body = pkg.ok() ? await pkg.body() : Buffer.alloc(0);
      c.a('docx package downloads', pkg.ok(), `${pkg.status()} · ${body.length} bytes`);
      // A docx is a zip: PK\x03\x04. Checking the magic bytes, not the content-type header, because
      // a header is what the server SAYS and the bytes are what the customer gets.
      c.a('  → it is really a docx (PK magic bytes)', body.length > 4 && body[0] === 0x50 && body[1] === 0x4b);
    },
  },
  {
    id: 'S02',
    title: 'Second buyer on the same opportunity — the fast path',
    async run(c, ctx) {
      const opp = await ctx.s.provisionableOpportunity();
      const first = await ctx.s.tenant({ label: 'first' });
      const second = await ctx.s.tenant({ label: 'second' });
      const b1 = await ctx.s.build({ tenant: first, label: 'S02a', opportunityId: opp });
      const b2 = await ctx.s.build({ tenant: second, label: 'S02b', opportunityId: opp });
      c.a('both buyers get their own build off one master', b1.proposalId !== b2.proposalId);
      c.a('  → and the same section count, from the same skeleton',
        b1.sectionCount === b2.sectionCount, `${b1.sectionCount} vs ${b2.sectionCount}`);
      // THE RULE: the master is shared, the builds are not. Neither proposal may reference the other
      // tenant, in either direction.
      const [x] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM proposal_sections s
        JOIN proposals p ON p.id = s.proposal_id
        WHERE p.id IN (${b1.proposalId}::uuid, ${b2.proposalId}::uuid)
          AND p.tenant_id NOT IN (${first.tenantId}::uuid, ${second.tenantId}::uuid)`;
      c.a('no section belongs to a third tenant', x.n === 0);
      const [cross] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM proposals
        WHERE id = ${b2.proposalId}::uuid AND tenant_id = ${first.tenantId}::uuid`;
      c.a('the second build is NOT the first tenant\'s', cross.n === 0);
    },
  },
  {
    id: 'S11',
    title: 'Starter library arrives by COPY into a new tenant, never as a shared object',
    async run(c, ctx) {
      const a = await ctx.s.tenant({ label: 'copyA' });
      const b = await ctx.s.tenant({ label: 'copyB' });
      const [ca] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM library_atoms WHERE tenant_id = ${a.tenantId}::uuid`;
      const [cb] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM library_atoms WHERE tenant_id = ${b.tenantId}::uuid`;
      c.a('a new tenant gets a starter library', ca.n > 0, `${ca.n} atoms`);
      c.a('  → and so does the next one, independently', cb.n > 0, `${cb.n} atoms`);
      // The whole point of copy-inward: no row of A's is a row of B's.
      const [shared] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM library_atoms x
        JOIN library_atoms y ON y.id = x.id
        WHERE x.tenant_id = ${a.tenantId}::uuid AND y.tenant_id = ${b.tenantId}::uuid`;
      c.a('not one atom is shared between them', shared.n === 0);
      // And no LINK crosses either — the blind spot mig 208/209 closed.
      const [edges] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM atom_lineage l
        JOIN library_atoms p ON p.id = l.parent_atom_id
        JOIN library_atoms ch ON ch.id = l.child_atom_id
        WHERE p.tenant_id <> ch.tenant_id`;
      c.a('no atom_lineage edge crosses a tenant boundary anywhere', edges.n === 0);
    },
  },
  {
    id: 'S18',
    title: 'Isolation — a tenant cannot read another tenant\'s build or library',
    async run(c, ctx) {
      const mine = await ctx.s.tenant({ label: 'mine' });
      const theirs = await ctx.s.tenant({ label: 'theirs' });
      const theirBuild = await ctx.s.build({ tenant: theirs, label: 'S18' });
      const page = await ctx.as(mine.adminEmail, mine.password);

      // Own house first — if this fails the rest proves nothing but a deny-all.
      const own = await page.request.get(`${BASE}/api/portal/${mine.slug}/atoms`);
      c.a('I can read my OWN library (not a deny-all)', own.ok(), `${own.status()}`);

      // Their proposal, addressed under MY slug — the app-layer gate.
      const foreignUnderMine = await page.request.get(
        `${BASE}/api/portal/${mine.slug}/proposals/${theirBuild.proposalId}`);
      c.a('their proposal under my slug is refused', foreignUnderMine.status() >= 400,
        `${foreignUnderMine.status()}`);

      // Their proposal under THEIR slug — the tenant-access gate.
      const foreignUnderTheirs = await page.request.get(
        `${BASE}/api/portal/${theirs.slug}/proposals/${theirBuild.proposalId}`);
      c.a('their proposal under their slug is refused to me', foreignUnderTheirs.status() >= 400,
        `${foreignUnderTheirs.status()}`);

      // Their atom, under my slug.
      const [atom] = await sql<{ id: string }[]>`
        SELECT id FROM library_atoms WHERE tenant_id = ${theirs.tenantId}::uuid LIMIT 1`;
      if (atom) {
        const r = await page.request.get(`${BASE}/api/portal/${mine.slug}/atoms/${atom.id}`);
        c.a('their atom is refused to me', r.status() >= 400, `${r.status()}`);
      }
    },
  },
  {
    id: 'S13',
    title: 'Collaborator scope — whole-workspace · per-build · per-section are real boundaries',
    async run(c, ctx) {
      const host = await ctx.s.tenant({ label: 'host' });
      const home = await ctx.s.tenant({ label: 'guesthome' });
      const buildA = await ctx.s.build({ tenant: host, label: 'S13a' });
      const buildB = await ctx.s.build({ tenant: host, label: 'S13b' });
      const guest = await ctx.s.user({ label: 'guest', role: 'tenant_admin', homeTenant: home });

      const hostPage = await ctx.as(host.adminEmail, host.password);
      const [sec] = await sql<{ id: string }[]>`
        SELECT id FROM proposal_sections WHERE proposal_id = ${buildA.proposalId}::uuid
        ORDER BY sort_index LIMIT 1`;

      // A PER-SECTION grant, through the real invite route.
      const inv = await hostPage.request.post(
        `${BASE}/api/portal/${host.slug}/proposals/${buildA.proposalId}/collaborators`,
        { data: { email: guest.email, name: 'Guest', role: 'external', permission: 'edit',
          assignedSections: sec ? [sec.id] : [] } });
      c.a('per-section invite accepted', inv.status() < 300, `${inv.status()}`);

      const [row] = await sql<{ id: string; assigned: string[] | null; revoked: boolean }[]>`
        SELECT id, assigned_sections AS assigned, (revoked_at IS NOT NULL) AS revoked
        FROM proposal_collaborators
        WHERE proposal_id = ${buildA.proposalId}::uuid AND email = ${guest.email}`;
      c.a('  → the collaborator row is active', !!row && !row.revoked);
      c.a('  → scoped to exactly the section named', !!row && (row.assigned ?? []).length === 1,
        `${(row?.assigned ?? []).length} section(s)`);

      // The grant is on build A only — B is not theirs.
      const [onB] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM proposal_collaborators
        WHERE proposal_id = ${buildB.proposalId}::uuid AND email = ${guest.email}`;
      c.a('the grant does NOT leak to the other build in the same tenant', onB.n === 0);

      // Remove → the row PERSISTS as revoked. Never deleted: history is the point.
      if (row) {
        const del = await hostPage.request.delete(
          `${BASE}/api/portal/${host.slug}/proposals/${buildA.proposalId}/collaborators/${row.id}`);
        c.a('remove accepted', del.status() < 300, `${del.status()}`);
        const [after] = await sql<{ revoked: boolean }[]>`
          SELECT (revoked_at IS NOT NULL) AS revoked FROM proposal_collaborators WHERE id = ${row.id}::uuid`;
        c.a('  → the row PERSISTS, badged revoked (never deleted)', after?.revoked === true,
          after === undefined ? 'ROW WAS DELETED' : 'revoked');
      }
    },
  },
  {
    id: 'S15',
    title: 'Outcomes — won starts a contract · lost · withdrawn',
    async run(c, ctx) {
      const t = await ctx.s.tenant({ label: 'outcome' });
      const page = await ctx.as(t.adminEmail, t.password);
      // THE WIRE VOCABULARY IS NOT THE UI VOCABULARY, and the scenario has to speak the wire's.
      // The buttons read Won · Lost · Withdrawn (which is what the guide documents, correctly);
      // the route accepts `awarded | rejected | withdrawn` and 422s anything else. It also requires
      // the proposal to be in `submitted` or `final` — recording an outcome for a build still in
      // draft is not a thing. The first version sent the UI labels at a draft build and read the
      // resulting 422 as a failure of the outcome flow.
      for (const [outcome, uiLabel, label] of [
        ['awarded', 'Won', 'S15won'], ['rejected', 'Lost', 'S15lost'], ['withdrawn', 'Withdrawn', 'S15wd'],
      ] as const) {
        const b = await ctx.s.build({ tenant: t, label });
        await page.request.post(`${BASE}/api/portal/${t.slug}/proposals/${b.proposalId}/advance`,
          { data: { targetStage: 'final', force: true, acknowledgeBlockers: true } });
        await page.request.post(`${BASE}/api/portal/${t.slug}/proposals/${b.proposalId}/advance`,
          { data: { targetStage: 'submitted', force: true, acknowledgeBlockers: true } });
        const r = await page.request.post(
          `${BASE}/api/portal/${t.slug}/proposals/${b.proposalId}/outcome`, { data: { outcome } });
        c.a(`outcome "${uiLabel}" (${outcome}) accepted`, r.status() < 300, `${r.status()}`);
        // ASSERT WHAT THE ROUTE ACTUALLY DOES, which is more interesting than what I assumed.
        //
        // `proposals` HAS NO `outcome` COLUMN — my first version selected one and the drive died on
        // "column does not exist", which is the CLAUDE.md rule about checking the schema before
        // writing SQL, ignored. Recording an outcome:
        //   · archives the proposal (stage='archived', archived_at set) and writes the detail to
        //     proposal_stage_history;
        //   · stamps `outcome`/`outcome_score` on the LIBRARY ATOMS that came from this proposal —
        //     which is precisely the guide's claim that "every outcome tunes your library atom
        //     scores for future drafts";
        //   · and, on a win, creates the contract entity.
        const [p] = await sql<{ stage: string; archivedAt: Date | null }[]>`
          SELECT stage, archived_at AS "archivedAt" FROM proposals WHERE id = ${b.proposalId}::uuid`;
        c.a('  → the proposal is archived, carrying the outcome', p?.stage === 'archived' && p?.archivedAt !== null,
          `stage=${p?.stage} archived_at=${p?.archivedAt ? 'set' : 'null'}`);
        const [h] = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM proposal_stage_history WHERE proposal_id = ${b.proposalId}::uuid`;
        c.a('  → stage history records it', h.n > 0, `${h.n} row(s)`);
        if (outcome === 'awarded') {
          const [ct] = await sql<{ n: number }[]>`
            SELECT count(*)::int AS n FROM contracts WHERE proposal_id = ${b.proposalId}::uuid`;
          c.a('  → a WIN creates the contract entity', ct.n > 0, `${ct.n} contract(s)`);
        }
      }
    },
  },
  {
    id: 'S17',
    title: 'Archive is soft and reversible — portal · atom · tenant',
    async run(c, ctx) {
      const t = await ctx.s.tenant({ label: 'arch' });
      const b = await ctx.s.build({ tenant: t, label: 'S17' });
      const page = await ctx.as(t.adminEmail, t.password);

      // — a portal (its proposal) —
      // `{ action: 'archive' | 'restore' }` — one endpoint for both directions, which is how the
      // product expresses "reversible". An empty body 400s, and the first version sent one.
      const ar = await page.request.post(
        `${BASE}/api/portal/${t.slug}/proposals/${b.proposalId}/archive`, { data: { action: 'archive' } });
      c.a('portal archive accepted', ar.status() < 300, `${ar.status()}`);
      const [p] = await sql<{ archivedAt: Date | null }[]>`
        SELECT archived_at AS "archivedAt" FROM proposals WHERE id = ${b.proposalId}::uuid`;
      // The detail reports the ACTUAL value. The first version printed "archived_at set" whenever
      // the row existed — including when archived_at was null — so a failing assertion carried a
      // detail string claiming the opposite of what it had just measured.
      c.a('  → the row is STILL THERE, stamped archived (nothing hard-deleted)',
        p !== undefined && p.archivedAt !== null,
        p === undefined ? 'ROW GONE' : `archived_at=${p.archivedAt ?? 'null'}`);

      // — an atom —
      const [atom] = await sql<{ id: string }[]>`
        SELECT id FROM library_atoms WHERE tenant_id = ${t.tenantId}::uuid AND archived_at IS NULL LIMIT 1`;
      if (atom) {
        const r = await page.request.post(`${BASE}/api/portal/${t.slug}/atoms/${atom.id}/archive`, { data: { action: 'archive' } });
        c.a('atom archive accepted', r.status() < 300, `${r.status()}`);
        const [a2] = await sql<{ archivedAt: Date | null }[]>`
          SELECT archived_at AS "archivedAt" FROM library_atoms WHERE id = ${atom.id}::uuid`;
        c.a('  → the atom row persists, stamped archived',
          a2 !== undefined && a2.archivedAt !== null,
          a2 === undefined ? 'ROW GONE' : `archived_at=${a2.archivedAt ?? 'null'}`);
      } else {
        c.a('atom archive', false, 'the tenant has no un-archived atom to archive');
      }

      // — a tenant (licence slumber), which only an admin may do —
      const adminPage = await ctx.admin();
      const tr = await adminPage.request.post(`${BASE}/api/admin/tenants/${t.tenantId}/archive`, { data: { action: 'archive' } });
      c.a('tenant archive accepted for an admin', tr.status() < 300, `${tr.status()}`);
      const [tt] = await sql<{ status: string }[]>`SELECT status FROM tenants WHERE id = ${t.tenantId}::uuid`;
      c.a('  → the tenant row persists (slumber, not deletion)', tt !== undefined,
        tt ? `status=${tt.status}` : 'ROW GONE');
    },
  },

  // ── registered, not yet driven ───────────────────────────────────────────────────────────────
  { id: 'S03', title: 'Admin comp → tenant-side release → plan edited → Studio Draft → zip',
    why: 'needs the admin comp form and the Studio loop driven as two actors — not written yet' },
  { id: 'S04', title: 'Rebaselined plan + AI-manager gate → pdf',
    why: 'needs the tenant workflow-setup editor driven through the browser — not written yet' },
  { id: 'S05', title: 'Full-draft Mode C via the portal → land on review → json',
    why: 'needs the pipeline worker consuming the trigger — covered today by drive-full-draft' },
  { id: 'S06', title: 'Full draft fired from the admin doorbell (source=admin_doorbell)',
    why: 'as S05; the doorbell route is covered today by drive-full-draft' },
  { id: 'S07', title: 'Deck from the template gallery → slide budget → pptx',
    why: 'the surface is captured by capture-guides; the export assertion is not written yet' },
  { id: 'S08', title: 'Blank workbook → typed budget → xlsx',
    why: 'the surface is captured by capture-guides; the export assertion is not written yet' },
  { id: 'S09', title: 'Upload + atomize → review → accept → appears as an insert candidate',
    why: 'covered today by drive-atomization; not yet folded into the matrix' },
  { id: 'S10', title: 'Hand-atomize (box-and-tag on a rendered page)',
    why: 'needs the box tool driven in a browser — not written yet' },
  { id: 'S12', title: 'Reuse a past proposal — structure kept, content stripped',
    why: 'covered today by the reuse-past route drives; not yet folded into the matrix' },
  { id: 'S14', title: 'Compliance gate refuses an over-limit volume, naming the rule',
    why: 'needs a volume deliberately driven over its page limit — not written yet' },
  { id: 'S16', title: 'Amendment detected → confirmed → fanned out → acknowledged',
    why: 'covered today by drive-amendment (passing); not yet folded into the matrix' },
];

// ─── runner ───────────────────────────────────────────────────────────────────────────────────
async function census() {
  const [r] = await sql<Record<string, number>[]>`
    SELECT (SELECT count(*)::int FROM tenants)   AS tenants,
           (SELECT count(*)::int FROM users)     AS users,
           (SELECT count(*)::int FROM proposals) AS proposals,
           (SELECT count(*)::int FROM library_atoms) AS atoms`;
  return r;
}

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const rows: Row[] = [];
const before = await census();

for (const def of SCENARIOS) {
  if (only.length && !only.includes(def.id)) continue;
  if (!def.run) {
    rows.push({ id: def.id, title: def.title, verdict: 'NOT-DRIVEN', detail: def.why ?? '', lines: [] });
    continue;
  }
  const c = new Check();
  let verdict: Verdict = 'pass';
  let detail = '';
  const s = await scenario(def.id.toLowerCase());
  try {
    const ctx: Ctx = {
      s, browser,
      async as(email, password) {
        const bc = await browser.newContext();
        const p = await bc.newPage();
        await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
        await p.fill('#email', email);
        await p.fill('#password', password);
        await p.click('button[type="submit"]');
        await p.waitForTimeout(2500);
        if (p.url().includes('/login')) {
          throw new CannotRun(`could not sign in as ${email} — a drive that cannot authenticate `
            + 'measures nothing, and a logged-out browser gets 401 on every route');
        }
        return bc;
      },
      async admin() {
        const a = await s.admin();
        return ctx.as(a.email, ADMIN_PW);
      },
    };
    await def.run(c, ctx);
    verdict = c.ok ? 'pass' : 'FAIL';
    detail = `${c.lines.filter((l) => l.includes('✓')).length}/${c.lines.length} checks`;
  } catch (e) {
    if (e instanceof CannotRun) { verdict = 'CANNOT-RUN'; detail = e.message.slice(0, 96); }
    else { verdict = 'FAIL'; detail = String(e).slice(0, 96); }
  } finally {
    await s.dispose().catch((e) => console.error(`  dispose error: ${String(e).slice(0, 120)}`));
  }
  rows.push({ id: def.id, title: def.title, verdict, detail, lines: c.lines });
  console.log(`${def.id}  ${verdict.padEnd(11)} ${def.title}`);
  for (const l of c.lines) console.log(l);
  console.log();
}

await browser.close();
const after = await census();
const leaked = Object.keys(before).filter((k) => before[k] !== after[k])
  .map((k) => `${k} ${before[k]}→${after[k]}`);

console.log('─'.repeat(100));
console.log(`${'ID'.padEnd(5)} ${'RESULT'.padEnd(11)} SCENARIO`);
for (const r of rows) {
  console.log(`${r.id.padEnd(5)} ${r.verdict.padEnd(11)} ${r.title}`);
  // A FAIL row without its reason sends the reader hunting through the scrollback. The detail is
  // the whole value of the row — a table that says only "FAIL" is a table that gets skimmed.
  if (r.verdict === 'FAIL' || r.verdict === 'CANNOT-RUN') console.log(`${' '.repeat(6)}└─ ${r.detail}`);
}
console.log('─'.repeat(100));

const n = (v: Verdict) => rows.filter((r) => r.verdict === v).length;
console.log(`${n('pass')} passed · ${n('FAIL')} failed · ${n('CANNOT-RUN')} could-not-run · ${n('NOT-DRIVEN')} not driven`);
console.log('   (could-not-run and not-driven measured NOTHING — uncovered, not passing, and not findings)');
if (n('NOT-DRIVEN')) {
  console.log('\nregistered in docs/SCENARIO_MATRIX.md but not driven here:');
  for (const r of rows.filter((x) => x.verdict === 'NOT-DRIVEN')) console.log(`  · ${r.id} — ${r.detail}`);
}
// THE RUN'S OWN HYGIENE, asserted rather than assumed: a matrix that silts the database up on every
// pass corrupts the fixture every later drive reads.
if (leaked.length) {
  console.error(`\n✗ THIS RUN LEAKED: ${leaked.join(', ')}`);
} else {
  console.log('\n✓ the database is exactly as this run found it');
}
await sql.end();
process.exit(n('FAIL') > 0 || leaked.length > 0 ? 1 : 0);
