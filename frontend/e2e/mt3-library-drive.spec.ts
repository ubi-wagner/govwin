/**
 * MT-3 — each new tenant builds its OWN library, as its own admin.
 *
 * Reads the tenants MT-2 composed (mt2-applicants.json) and, for each one, walks the path a real
 * new customer walks: first sign-in with the issued temp password → the forced password reset →
 * upload that company's own documents → deconstruct → atomize → author a spotlight bucket.
 *
 * Nothing here is seeded. The atoms that exist at the end exist because this drive uploaded a PDF
 * and pressed the buttons, which is the point — and it is also what makes the isolation check
 * meaningful: three libraries whose contents are visibly about three different companies, so a
 * leak would be legible on sight rather than a UUID comparison.
 *
 * Run: npx playwright test --project=drive mt3-library
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const OUT = process.env.MT_DIR || '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/mt';
const SHOTS = path.join(OUT, 'shots', 'mt3');
const FIXTURES = path.join(__dirname, 'fixtures', 'companies');
/** What every tenant admin's password becomes once they clear the forced reset. */
const NEW_PW = process.env.MT_TENANT_PW || 'MidtermDrive2026!';

interface Applicant {
  slug: string; company: string; contact: string; email: string;
  tempPassword?: string; adminEmail?: string;
}

/** A bucket each company would plausibly author for itself — the scoring lens, in their words. */
const BUCKETS: Record<string, { name: string; keywords: string }> = {
  northwind: { name: 'Additive construction & expeditionary basing', keywords: 'additive construction, 3D concrete printing, expeditionary, basing, formwork' },
  kestrel: { name: 'Robotics & autonomy for the built environment', keywords: 'robotics, autonomy, SLAM, construction progress, as-built' },
  calcite: { name: 'Low-carbon cement & materials', keywords: 'low-carbon cement, clinker replacement, carbonation, embodied carbon, slag' },
};

async function signInFirstTime(page: Page, email: string, tempPw: string) {
  await page.context().clearCookies();
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', tempPw);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
  // The middleware forces a temp-password account to /change-password before anything else.
  if (new URL(page.url()).pathname.includes('change-password')) {
    const fields = page.locator('input[type="password"]');
    await fields.nth(0).fill(tempPw);
    await fields.nth(1).fill(NEW_PW);
    if (await fields.count() > 2) await fields.nth(2).fill(NEW_PW);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.includes('change-password'), { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ]);
  }
  expect(new URL(page.url()).pathname, 'still stuck on an auth screen').not.toMatch(/login|change-password/);
}

test('each tenant composes its own library from its own documents', async ({ page }) => {
  test.setTimeout(30 * 60_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  const manifestPath = path.join(OUT, 'mt2-applicants.json');
  expect(fs.existsSync(manifestPath), 'MT-2 has not composed any tenants yet').toBe(true);
  const applicants: Applicant[] = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const built: Array<{ slug: string; company: string; atoms: number; buckets: number }> = [];

  for (const a of applicants) {
    const email = a.adminEmail ?? a.email;
    const tempPw = a.tempPassword ?? '';
    expect(tempPw, `${a.company}: no temp password captured — MT-2 must record it`).toBeTruthy();
    console.error(`\n══ ${a.company} (${email})`);

    await signInFirstTime(page, email, tempPw);
    const slug = new URL(page.url()).pathname.split('/')[2] ?? a.slug;
    console.error(`   signed in, tenant slug = ${slug}`);
    await page.screenshot({ path: `${SHOTS}/${a.slug}-1-first-login.png`, fullPage: true });

    // ── the starter shelf should already have copied inward on tenant creation ──
    const before = await (await page.request.get(`/api/portal/${slug}/atoms`)).json().catch(() => ({}));
    const startedWith = (before?.data?.atoms ?? before?.data ?? []).length ?? 0;
    console.error(`   library before upload: ${startedWith} atom(s) (starter shelf copy-inward)`);

    // ── upload this company's own documents and atomize them ──
    await page.goto(`/portal/${slug}/atoms`, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.screenshot({ path: `${SHOTS}/${a.slug}-2-library-empty.png`, fullPage: true });

    for (const docName of ['capability-statement', 'key-personnel']) {
      const pdf = path.join(FIXTURES, `${a.slug}-${docName}.pdf`);
      expect(fs.existsSync(pdf), `missing fixture ${pdf}`).toBe(true);

      // `mode=auto` is the one-press path a customer uses: deconstruct and atomize at a sensible
      // grain rather than hand-picking every block.
      const fd = { name: 'file', mimeType: 'application/pdf', buffer: fs.readFileSync(pdf) };
      const res = await page.request.post(`/api/portal/${slug}/atoms/upload`, {
        multipart: { file: fd, mode: 'auto', context: JSON.stringify({ source: docName }) },
        timeout: 180_000,
      });
      const body = await res.json().catch(() => ({}));
      console.error(`   upload ${docName} → ${res.status()} blocks=${(body?.data?.blocks ?? []).length ?? 0}`);
      expect(res.status(), `${a.company}/${docName} upload failed`).toBeLessThan(300);
    }

    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${SHOTS}/${a.slug}-3-library-populated.png`, fullPage: true });

    const after = await (await page.request.get(`/api/portal/${slug}/atoms`)).json().catch(() => ({}));
    const atoms = (after?.data?.atoms ?? after?.data ?? []) as Array<Record<string, unknown>>;
    console.error(`   library after upload: ${atoms.length} atom(s)`);
    expect(atoms.length, `${a.company} gained no atoms from its own documents`).toBeGreaterThan(startedWith);

    // ── author a spotlight bucket: the tenant's own scoring lens ──
    const b = BUCKETS[a.slug];
    await page.goto(`/portal/${slug}/buckets`, { waitUntil: 'networkidle', timeout: 60_000 });
    const bres = await page.request.post(`/api/portal/${slug}/buckets`, {
      data: { name: b.name, keywords: b.keywords.split(',').map((s) => s.trim()) },
      timeout: 60_000,
    });
    console.error(`   bucket "${b.name}" → ${bres.status()}`);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${SHOTS}/${a.slug}-4-buckets.png`, fullPage: true });

    const bl = await (await page.request.get(`/api/portal/${slug}/buckets`)).json().catch(() => ({}));
    const buckets = (bl?.data?.buckets ?? bl?.data ?? []) as unknown[];
    built.push({ slug, company: a.company, atoms: atoms.length, buckets: buckets.length });
  }

  // ── isolation, checked from inside a tenant rather than asserted ──
  // Signed in as the LAST tenant, ask for each OTHER tenant's library. A tenant that can read a
  // peer's atoms is the failure this whole architecture exists to prevent.
  const me = built[built.length - 1];
  for (const other of built.filter((x) => x.slug !== me.slug)) {
    const r = await page.request.get(`/api/portal/${other.slug}/atoms`);
    const j = await r.json().catch(() => ({}));
    const leaked = (j?.data?.atoms ?? j?.data ?? []) as unknown[];
    console.error(`   ${me.slug} → ${other.slug}/atoms : HTTP ${r.status()}, ${leaked.length} atom(s) returned`);
    expect(r.status() >= 400 || leaked.length === 0,
      `ISOLATION BREACH — ${me.company} read ${leaked.length} of ${other.company}'s atoms`).toBe(true);
  }

  fs.writeFileSync(path.join(OUT, 'mt3-libraries.json'), JSON.stringify(built, null, 2));
  console.error('\n✓ libraries composed:');
  for (const x of built) console.error(`   ${x.company.padEnd(22)} ${x.atoms} atoms · ${x.buckets} bucket(s)`);
});
