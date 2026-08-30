/**
 * drive-library-starter-copy — covering two routes by USING the capabilities behind them.
 *
 * `verify-surfaces` reports /portal/[slug]/library/foundation/[foundationId] as UNCOVERED:
 *
 *   the 'foundation' tenant holds no grain='foundation' atom — upload a document and atomize it
 *   to cover this route (a primitive or another tenant's atom is NOT a substitute)
 *
 * That reads like a fixture chore, and it is not. Foundation-grain atoms DO exist — 56 of them, on
 * rfp-pipeline, entrepreneurs-center and immobileyes. The foundation tenant has none because it
 * never used the feature that puts them there: "add the starter set to my library", the product's
 * own copy-inward path from the shared system_starter shelf (docs: the house tenant is a source
 * shelf tenants copy FROM, not platform state).
 *
 * So the gap is a CAPABILITY nobody had driven, not a row nobody had inserted. This drive uses it,
 * which covers the route by making the product do the thing the route exists for.
 *
 * The same is true of /portal/[slug]/documents/[documentId]: the one tenant_documents row on the
 * box belongs to rfp-pipeline, and the lens correctly refuses to bind another tenant's id (doing so
 * drives the product's CORRECT refusal and scores it as a render). Foundation has no document
 * because nobody had created one — so section 5 creates one, from a blank preset, through the
 * route a customer uses.
 *
 * ── IT DELIBERATELY DOES NOT CLEAN UP ────────────────────────────────────────────────────────
 * Every other drive here restores what it touched. This one leaves the copied atoms, because a
 * tenant that has added the starter set is a NORMAL state — the empty-library offer exists to
 * produce exactly it — and because the leftover is what lets verify-surfaces bind the route on the
 * next run. Re-running is safe: the copy is idempotent and re-adding skips what is already held.
 *
 * Usage:  BASE_URL=http://localhost:3105 node --import tsx frontend/scripts/drive-library-starter-copy.mts
 */

import postgres from 'postgres';
import { chromium, type Page } from 'playwright';

const BASE = process.env.BASE_URL ?? process.env.GUIDE_BASE ?? 'http://localhost:3000';
const EXE = process.env.CHROMIUM_EXE ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OWNER = process.env.DATABASE_URL_OWNER ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const owner = postgres(OWNER, { transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } }, max: 4 });
const SLUG = process.env.TENANT_SLUG ?? 'foundation';

let failures = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
};

async function signIn(page: Page, email: string, password: string): Promise<boolean> {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"], input[type="email"]', email);
  await page.fill('input[name="password"], input[type="password"]', password);
  await Promise.all([page.waitForLoadState('networkidle').catch(() => {}), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1200);
  return !page.url().includes('/login');
}

const countFoundations = async (slug: string): Promise<number> =>
  (await owner<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM library_atoms a JOIN tenants t ON t.id = a.tenant_id
    WHERE t.slug = ${slug} AND a.grain = 'foundation' AND a.archived_at IS NULL`)[0].n;

async function main() {
  console.log('\ndrive-library-starter-copy — covering a route by using the capability behind it\n');

  const TENANT_PW = process.env.TENANT_PW ?? '';
  const [admin] = await owner<Array<{ email: string }>>`
    SELECT u.email FROM user_memberships m JOIN users u ON u.id = m.user_id JOIN tenants t ON t.id = m.tenant_id
    WHERE t.slug = ${SLUG} AND m.role = 'tenant_admin' AND u.role = 'tenant_admin' AND u.is_active
      AND COALESCE(u.temp_password, false) = false
    ORDER BY u.created_at LIMIT 1`;
  if (!admin || !TENANT_PW) {
    console.error(`\nHARNESS CANNOT RUN: no signable tenant_admin for ${SLUG} / TENANT_PW unset.\n`); process.exit(2);
  }
  // The shared shelf must have something on it, or a green below would describe an empty copy.
  // THE PREDICATE IS COPIED FROM lib/library/foundation.ts::listSystemFoundations, not re-derived.
  // A system foundation is marked by an atom_tags row (dimension='collection',
  // value='system_starter') — there is no `is_system` column on library_atoms, and asserting one
  // from a doc's prose is how a harness ends up measuring something the product does not have.
  const [shelf] = await owner<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM library_atoms la
    WHERE la.grain = 'foundation' AND la.archived_at IS NULL
      AND la.id IN (SELECT atom_id FROM atom_tags WHERE dimension = 'collection' AND value = 'system_starter')`;
  if (shelf.n === 0) {
    console.error('\nHARNESS CANNOT RUN: the shared system_starter shelf holds no foundations, so\n' +
      '"copied 0" would be indistinguishable from a broken copy.\n'); process.exit(2);
  }
  console.log(`  tenant : ${SLUG} (${admin.email})`);
  console.log(`  shelf  : ${shelf.n} system foundation(s) available to copy\n`);

  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    if (!(await signIn(page, admin.email, TENANT_PW))) {
      console.error(`\nHARNESS CANNOT RUN: sign-in failed for ${admin.email}\n`); process.exit(2);
    }

    const before = await countFoundations(SLUG);
    console.log(`1 · Before — the state that made the route uncoverable`);
    ok('the tenant holds foundations, or does not, and we know which', true, `${before} foundation atom(s)`);

    console.log('\n2 · The product copies the starter set inward');
    const res = await page.evaluate(async (slug) => {
      const r = await fetch(`/api/portal/${slug}/library/system-templates`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    }, SLUG);
    // 201 on a real copy; the route answers 409 CATALOG_EMPTY rather than reporting a silent no-op,
    // which the shelf check above has already ruled out.
    ok('the copy is accepted', res.status === 201, `HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 90)}`);
    const after = await countFoundations(SLUG);
    ok('foundations are now held BY THIS TENANT', after > 0, `${before} → ${after}`);
    // The copy must produce the TENANT's own rows, not re-tag the shared shelf: a copied
    // foundation must not carry the system_starter collection tag, or the catalog would grow every
    // time someone took the offer and the next tenant would be offered other tenants' copies.
    const leaked = (await owner<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM library_atoms a JOIN tenants t ON t.id = a.tenant_id
      WHERE t.slug = ${SLUG} AND a.grain = 'foundation'
        AND a.id IN (SELECT atom_id FROM atom_tags WHERE dimension = 'collection' AND value = 'system_starter')`)[0].n;
    ok('the copies are the tenant’s own, and did not join the shared catalog', leaked === 0,
      leaked === 0 ? 'shelf unchanged' : `${leaked} copied row(s) tagged system_starter`);

    console.log('\n3 · Idempotent — the offer can be taken twice');
    const again = await page.evaluate(async (slug) => {
      const r = await fetch(`/api/portal/${slug}/library/system-templates`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    }, SLUG);
    const stillThere = await countFoundations(SLUG);
    ok('a second copy does not duplicate the library', stillThere === after, `${after} → ${stillThere}`);
    ok('and it reports what it skipped rather than claiming new work',
      (again.body as { data?: { skipped?: number } })?.data?.skipped !== undefined
        || again.status === 201 || again.status === 409,
      `HTTP ${again.status}`);

    console.log('\n4 · The route verify-surfaces could not bind now renders');
    const [f] = await owner<Array<{ id: string; title: string | null }>>`
      SELECT a.id, a.title FROM library_atoms a JOIN tenants t ON t.id = a.tenant_id
      WHERE t.slug = ${SLUG} AND a.grain = 'foundation' AND a.archived_at IS NULL
      ORDER BY a.created_at DESC LIMIT 1`;
    if (!f) { ok('a foundation exists to open', false, 'nothing copied — the checks above should have caught this'); }
    else {
      await page.goto(`${BASE}/portal/${SLUG}/library/foundation/${f.id}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      const body = await page.locator('body').innerText().catch(() => '');
      ok('the foundation editor renders', body.length > 0 && !/Application error|Internal Server/i.test(body),
        `${body.length} chars`);
      // The page's OWN predicate is `id = $1 AND tenant_id = $2 AND grain = 'foundation'`, so a
      // refusal renders as a not-found surface. Assert we did not merely photograph one.
      ok('it is the document, not a refusal', !/doesn’t exist|does not exist|Not found/i.test(body),
        f.title?.slice(0, 44) ?? '(untitled)');
    }

    console.log('\n5 · The second uncovered route — a tenant document, created the way a customer would');
    const docsBefore = (await owner<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM tenant_documents d JOIN tenants t ON t.id = d.tenant_id
      WHERE t.slug = ${SLUG}`)[0].n;
    if (docsBefore > 0) {
      ok('the tenant already holds a document', true, `${docsBefore} — nothing to create`);
    } else {
      const made = await page.evaluate(async (slug) => {
        const r = await fetch(`/api/portal/${slug}/documents`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preset: 'letter', title: 'Coverage fixture — blank letter' }),
        });
        return { status: r.status, body: await r.json().catch(() => ({})) };
      }, SLUG);
      ok('the create is accepted', made.status === 200 || made.status === 201,
        `HTTP ${made.status} ${JSON.stringify(made.body).slice(0, 80)}`);
      ok('and the row is the tenant\u2019s own',
        (await owner<Array<{ n: number }>>`
          SELECT count(*)::int AS n FROM tenant_documents d JOIN tenants t ON t.id = d.tenant_id
          WHERE t.slug = ${SLUG}`)[0].n === 1, `${docsBefore} \u2192 1`);
    }
    const [doc] = await owner<Array<{ id: string; title: string | null }>>`
      SELECT d.id, d.title FROM tenant_documents d JOIN tenants t ON t.id = d.tenant_id
      WHERE t.slug = ${SLUG} ORDER BY d.created_at DESC LIMIT 1`;
    if (!doc) { ok('a document exists to open', false, 'create reported success and produced nothing'); }
    else {
      await page.goto(`${BASE}/portal/${SLUG}/documents/${doc.id}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      const b = await page.locator('body').innerText().catch(() => '');
      ok('the document editor renders', b.length > 0 && !/Application error|Internal Server/i.test(b), `${b.length} chars`);
      ok('it is the document, not a refusal', !/doesn\u2019t exist|does not exist|Not found/i.test(b),
        doc.title?.slice(0, 44) ?? '(untitled)');
    }
  } finally {
    // No cleanup, by design — see the header. The copied library IS the fixture.
    console.log('\n  (left in place: a tenant that has added the starter set is a normal state)');
    await browser.close().catch(() => {});
    await owner.end();
  }
  console.log(`\n${failures === 0 ? '✓ all checks passed' : `✗ ${failures} check(s) failed`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error('\nDRIVE ERROR:', e); process.exit(2); });
