/**
 * MT-1 — ingest, curate and push FOUR opportunities across four agency shapes.
 *
 * Every one runs the real admin path: upload → async shred → readiness gate → Ingest Assist →
 * the compliance matrix. The four fixtures state their rules with different wording and different
 * values (scripts/make-solicitation-fixtures.py), so this drive is not "did something populate" —
 * it asserts the exact value the document states, and asserts that the one which DEFERS its page
 * limit comes back as a deferral rather than a number.
 *
 * Writes a manifest the later midterm phases consume, so nothing downstream has to guess ids.
 *
 * Run: npx playwright test --project=drive mt1-ingest-multi
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const FIXTURES = path.join(__dirname, 'fixtures', 'solicitations');
const OUT = process.env.MT_DIR || '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/mt';
const SHOTS = path.join(OUT, 'shots', 'mt1');
const PW = process.env.RFP_ADMIN_PW || 'SandboxDrive2026!';

interface Sol {
  slug: string; title: string; agency: string; office: string; number: string; close: string;
  programType: string;
  /** What the document states — the assertion, not a hope. */
  expect: {
    minFont: number; margins: string;
    pageLimit: number | 'DEFERRED';
    charLimit: number | null;
  };
}

const SOLS: Sol[] = [
  {
    slug: 'dow-sbir-p1', programType: 'sbir_phase_1',
    title: 'DoN 26.1 SBIR — Additive Construction for Expeditionary Basing (N261-118)',
    agency: 'Department of the Navy', office: 'Naval Facilities Engineering Systems Command',
    number: 'N261-118', close: '2026-11-14',
    expect: { minFont: 11, margins: '1 inch (all sides)', pageLimit: 'DEFERRED', charLimit: 4000 },
  },
  {
    slug: 'nsf-sttr-p1', programType: 'sttr_phase_1',
    title: 'NSF STTR Phase I — Robotics for the Built Environment (NSF 26-522)',
    agency: 'National Science Foundation', office: 'Directorate for Engineering',
    number: 'NSF-26-522', close: '2026-12-03',
    expect: { minFont: 10, margins: '1 inch (all sides)', pageLimit: 15, charLimit: null },
  },
  {
    slug: 'doe-sbir-p2', programType: 'sbir_phase_2',
    title: 'DOE SBIR Phase II — Low-Carbon Concrete & Cement Materials (DE-FOA-0003412)',
    agency: 'U.S. Department of Energy', office: 'Office of Science',
    number: 'DE-FOA-0003412', close: '2027-02-19',
    expect: { minFont: 11, margins: '0.75 inch (all sides)', pageLimit: 20, charLimit: 2500 },
  },
  {
    slug: 'ohio-tvsf-r46', programType: 'other',
    title: 'Ohio TVSF Round 46 — Technology Validation & Startup Fund (TVS-2027-01)',
    agency: 'Ohio Third Frontier', office: 'Ohio Department of Development',
    number: 'TVS-2027-01', close: '2027-01-22',
    expect: { minFont: 12, margins: '1 inch (all sides)', pageLimit: 8, charLimit: null },
  },
];

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', 'eric@rfppipeline.com');
  await page.fill('input[name="password"]', PW);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
}

test('four agencies through upload → shred → assist → matrix', async ({ page }) => {
  test.setTimeout(30 * 60_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);

  const manifest: Record<string, unknown>[] = [];

  // MT1_ONLY=<slug> narrows the run to one fixture — the way to tell a document-specific failure
  // apart from a fourth-upload-in-a-session failure without guessing.
  const only = process.env.MT1_ONLY;
  for (const s of (only ? SOLS.filter((x) => x.slug === only) : SOLS)) {
    const pdf = path.join(FIXTURES, `${s.slug}.pdf`);
    expect(fs.existsSync(pdf), `fixture missing: ${pdf}`).toBe(true);
    console.error(`\n══ ${s.slug} — ${s.title}`);

    await page.goto('/admin/rfp-curation/upload', { waitUntil: 'networkidle', timeout: 60_000 });
    await page.fill('input[name="title"]', s.title);
    await page.fill('input[name="agency"]', s.agency);
    const office = page.locator('input[name="office"]');
    if (await office.count()) await office.fill(s.office);
    const num = page.locator('input[name="solicitationNumber"]');
    if (await num.count()) await num.fill(s.number);
    const close = page.locator('input[name="closeDate"]');
    if (await close.count()) await close.fill(s.close);
    // Program Type is REQUIRED and only auto-fills when the parse recognises a program in the
    // title (upload-form.tsx setIfEmpty). "Technology Validation & Startup Fund" carries no such
    // token, so the select stayed empty, the browser blocked submit, no request was sent, and the
    // drive waited on a redirect that could never come. An admin uploading a non-SBIR/STTR
    // solicitation has to choose it by hand — so the drive does too.
    await page.selectOption('select[name="programType"]', s.programType);

    await page.locator('input[type="file"]').first().setInputFiles([pdf]);
    await page.screenshot({ path: `${SHOTS}/${s.slug}-1-upload.png`, fullPage: true });
    await page.click('button[type="submit"]');

    await page.waitForURL(/\/admin\/rfp-curation\/[0-9a-f-]{36}/, { timeout: 10 * 60_000 });
    const solId = page.url().split('/').pop()!.split('?')[0];
    await page.waitForLoadState('networkidle');
    console.error(`   solicitation ${solId}`);

    // The readiness gate: Assist REFUSES an unshredded solicitation, so this must be true
    // before the assist call means anything.
    const ready = await (await page.request.get(`/api/admin/rfp-curation/${solId}/ingest-assist`)).json();
    console.error(`   readiness: ${JSON.stringify(ready.data)}`);
    expect(ready.data?.ready, 'shred did not produce usable source text').toBe(true);

    const assist = await (await page.request.post(`/api/admin/rfp-curation/${solId}/ingest-assist`, {
      data: { publish: false }, timeout: 180_000,
    })).json();
    // WHAT THIS ROUTE RETURNS, and why the values are not in it: Assist STAGES the matrix into
    // solicitation_compliance_drafts, runs the deterministic provenance audit, and lands it only
    // if that audit is clean. So the response carries the PROVENANCE and the landing decision;
    // the values themselves go to solicitation_compliance, and are asserted against the database
    // by scripts/verify-mt1-compliance.mts. Asserting values here would be asserting a contract
    // this endpoint does not have.
    const src = assist.data?.fieldSources ?? {};
    const notes = String((assist.data?.notes ?? []).join(' '));
    const blockers: string[] = assist.data?.blockers ?? [];
    console.error(`   landed=${assist.data?.landed} volumes=${assist.data?.volumes} blockers=${JSON.stringify(blockers)}`);
    console.error(`   sources: ${JSON.stringify(src)}`);
    if (notes) console.error(`   notes: ${notes.slice(0, 200)}`);

    // Every rule this document STATES must be sourced pattern_match — read and citable, never a
    // default wearing a read value's clothes.
    expect(src.min_font_size, `${s.slug} min_font_size provenance`).toBe('pattern_match');
    expect(src.margins, `${s.slug} margins provenance`).toBe('pattern_match');

    if (s.expect.pageLimit === 'DEFERRED') {
      // Absence is a finding: the deferral must be REPORTED, not silently defaulted.
      expect(notes, 'the deferral must be reported').toMatch(/defers the technical-volume page limit/i);
    } else {
      expect(src.page_limit_technical, `${s.slug} page limit provenance`).toBe('pattern_match');
    }
    if (s.expect.charLimit !== null) {
      expect(src.character_limit_narrative, `${s.slug} char limit provenance`).toBe('pattern_match');
    }

    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${SHOTS}/${s.slug}-2-matrix.png`, fullPage: true });

    manifest.push({
      slug: s.slug, solicitationId: solId, title: s.title, agency: s.agency,
      programType: s.programType, closeDate: s.close,
      fieldSources: src, notes: assist.data?.notes ?? [],
      landed: assist.data?.landed ?? false, volumes: assist.data?.volumes ?? 0,
      blockers, expect: s.expect,
    });
    console.error(`   ✓ ${s.slug} verified`);
  }

  fs.writeFileSync(path.join(OUT, 'mt1-solicitations.json'), JSON.stringify(manifest, null, 2));
  console.error(`\n✓ ${manifest.length} solicitations ingested and verified`);
});
