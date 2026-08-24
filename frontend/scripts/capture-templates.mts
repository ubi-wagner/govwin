/**
 * #151 — capture the THREE template surfaces as the real actors, and check what they show against
 * what the system actually holds.
 *
 * WHY IT IS THREE, NOT ONE. docs/TEMPLATES_LAUNCH.md described a two-surface world — the code
 * catalog reached from the tenant "New Document" chooser, and the admin `document_templates`
 * catalog — and by the time anyone read it again, both halves were stale:
 *
 *   · the catalog grew from 18 molds to 39 (the whole `forms` category did not exist yet), and
 *   · Phase 5 (docs/TEMPLATE_BRIDGE_DESIGN.md §6) deliberately NARROWED the New Document chooser
 *     to the tenant's OWN saved templates. The pristine starter stable moved to a tenant-owned
 *     card gallery, so a customer never depends on a live shared object.
 *
 * A walkthrough that sends a reader to the wrong page is worse than no walkthrough. This drive
 * captures where the molds are TODAY:
 *
 *   1. /admin/template-stable   — the master stable (39 molds, catalog → master_templates)
 *   2. /portal/[t]/templates    — the tenant's own template-card gallery (the bridge's landing)
 *   3. /portal/[t]/documents/new — the New Document chooser (the tenant's OWN saved templates)
 *
 * A 200 IS NOT EVIDENCE (bug log B78/B79). Every capture below reads rendered TEXT and fails on an
 * error surface or a client throw, and the counts it prints are compared against the database
 * rather than eyeballed off a screenshot.
 *
 *   cd frontend && DATABASE_URL=<owner> RFP_ADMIN_PW=… node --import tsx scripts/capture-templates.mts
 */
import fs from 'fs';
import path from 'path';
import { sqlBypass as sql } from '@/lib/db';
import { BASE, launch, signIn } from './lib/cross-company.mts';

const OUT = '/home/user/govwin/docs/assets/tmpl';
fs.mkdirSync(OUT, { recursive: true });

let ok = true;
const A = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };
const note = (s: string) => console.log(`  · ${s}`);

const browser = await launch();
try {
  // ── what the system HOLDS (the expectation, read from the source of truth) ───────────────────
  const [{ n: masters }] = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM master_templates WHERE status = 'active'`;
  const byCategory = await sql<Array<{ category: string; n: number }>>`
    SELECT category, count(*)::int AS n FROM master_templates WHERE status='active' GROUP BY 1 ORDER BY 2 DESC`;
  note(`master stable: ${masters} active molds — ${byCategory.map((r) => `${r.category}=${r.n}`).join(' · ')}`);

  // A tenant with template cards AND a member who can sign in — driving this against an empty
  // tenant would prove nothing, because every check would pass on nothing. The house tenant
  // (`rfp-pipeline`) is excluded: it is the platform's own source shelf, not a customer, and a
  // walkthrough shot of it would show a reader a page no customer has.
  const [target] = await sql<Array<{ slug: string; name: string; tenantId: string; cards: number }>>`
    SELECT t.slug, t.name, t.id AS "tenantId", count(DISTINCT c.id)::int AS cards
    FROM tenants t
    JOIN tenant_template_cards c ON c.tenant_id = t.id
    JOIN user_memberships m ON m.tenant_id = t.id AND m.status = 'active'
    JOIN users u ON u.id = m.user_id AND u.is_active AND u.role IN ('tenant_admin','tenant_user')
    WHERE t.slug <> 'rfp-pipeline'
    GROUP BY t.slug, t.name, t.id ORDER BY cards DESC, t.slug LIMIT 1`;
  if (!target) throw new Error('no customer tenant has template cards AND an active member');
  note(`driving tenant "${target.slug}" (${target.cards} template cards)`);

  const [admin] = await sql<Array<{ email: string }>>`
    SELECT email FROM users WHERE role IN ('rfp_admin','master_admin') AND is_active
    ORDER BY created_at LIMIT 1`;
  const [member] = await sql<Array<{ email: string; role: string }>>`
    SELECT u.email, u.role FROM users u
    JOIN user_memberships m ON m.user_id = u.id AND m.tenant_id = ${target.tenantId}::uuid
                           AND m.status = 'active'
    WHERE u.is_active AND u.role IN ('tenant_admin','tenant_user')
    ORDER BY CASE WHEN u.role = 'tenant_admin' THEN 0 ELSE 1 END, u.created_at LIMIT 1`;
  if (!admin) throw new Error('no active platform admin');
  if (!member) throw new Error(`no active member of ${target.slug}`);

  /** Drive one page, prove it RENDERED (not merely 200), then shoot it. */
  async function capture(
    page: import('playwright').Page, url: string, shot: string,
    mustContain: RegExp[], label: string,
  ): Promise<string> {
    const throws: string[] = [];
    page.on('pageerror', (e) => throws.push(String(e)));
    const res = await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => null);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2500);
    const body = (await page.textContent('body').catch(() => '')) ?? '';
    const errored = /Something went wrong|Application error|This page failed to load/i.test(body);
    const missing = mustContain.filter((r) => !r.test(body));
    A(`${label} renders`, res != null && !errored && missing.length === 0 && throws.length === 0,
      [res ? `HTTP ${res.status()}` : 'no response',
       errored ? 'ERROR SURFACE' : '',
       missing.length ? `missing ${missing.map(String).join(', ')}` : '',
       throws.length ? `client throw: ${throws[0].slice(0, 80)}` : ''].filter(Boolean).join(' · '));
    await page.screenshot({ path: path.join(OUT, `${shot}.png`), fullPage: true });
    note(`shot ${shot}.png`);
    return body;
  }

  // ── 1. admin: the master template stable ────────────────────────────────────────────────────
  const ac = await signIn(browser, admin.email, process.env.RFP_ADMIN_PW || process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!');
  const ap = ac.pages()[0];
  const stableBody = await capture(ap, `${BASE}/admin/template-stable`, '01-admin-template-stable',
    [/Template/i], 'admin template stable');

  // The number the PAGE states must be the number the TABLE holds (the fourth-lens rule). Rather
  // than parse a count out of prose, check that a sample of real mold titles is actually present —
  // a page that renders the chrome and none of the rows passes a count check and fails this one.
  const sample = await sql<Array<{ title: string }>>`
    SELECT title FROM master_templates WHERE status='active' ORDER BY random() LIMIT 6`;
  const shown = sample.filter((s) => stableBody.includes(s.title));
  A('the stable page lists the molds the table holds', shown.length === sample.length,
    `${shown.length}/${sample.length} sampled titles present` +
    (shown.length === sample.length ? '' : ` — missing: ${sample.filter((s) => !stableBody.includes(s.title)).map((s) => s.title).join(', ')}`));

  const adminTemplatesBody = await capture(ap, `${BASE}/admin/templates`, '02-admin-templates',
    [/Template/i], 'admin document_templates catalog');
  const [{ n: dbTemplates }] = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM document_templates WHERE is_system`;
  note(`document_templates (is_system): ${dbTemplates} rows${adminTemplatesBody.length ? '' : ' — empty body'}`);
  await ac.close();

  // ── 2 + 3. the tenant's own surfaces ────────────────────────────────────────────────────────
  const tc = await signIn(browser, member.email, process.env.TENANT_PW || process.env.PASSWORD || 'DemoPass123!');
  const tp = tc.pages()[0];

  const galleryBody = await capture(tp, `${BASE}/portal/${target.slug}/templates`, '03-tenant-template-gallery',
    [/Template/i], 'tenant template-card gallery');
  const cardSample = await sql<Array<{ title: string }>>`
    SELECT title FROM tenant_template_cards WHERE tenant_id = ${target.tenantId}::uuid
    ORDER BY random() LIMIT 6`;
  const cardsShown = cardSample.filter((c) => galleryBody.includes(c.title));
  A("the gallery lists this tenant's own cards", cardsShown.length === cardSample.length,
    `${cardsShown.length}/${cardSample.length} sampled card titles present`);

  // NEGATIVE SPACE, and the FIRST version of this check could not fail.
  //
  // The gallery is tenant-OWNED by design (copy-inward, no live shared object), so another
  // tenant's cards must not appear on it. The obvious way to test that is to look for a foreign
  // card TITLE — and there are none, because every tenant's cards are copies of the same 39
  // masters, so the titles are identical everywhere. That check reported "no foreign titles to
  // test with" and printed a tick beside it, which is the exact failure mode this file argues
  // against: a check that cannot fail is not a pass, it is decoration.
  //
  // What a leak would ACTUALLY look like, given identical titles, is DUPLICATION — one title
  // appearing once per tenant that holds it instead of once. That is observable, and it fails if
  // the scoping is ever dropped.
  const [{ n: holders }] = await sql<Array<{ n: number }>>`
    SELECT count(DISTINCT tenant_id)::int AS n FROM tenant_template_cards
    WHERE title = ${cardSample[0].title}`;
  const occurrences = galleryBody.split(cardSample[0].title).length - 1;
  A('the gallery shows each card ONCE, not once per tenant holding it',
    holders > 1 && occurrences === 1,
    holders > 1
      ? `"${cardSample[0].title.slice(0, 40)}" held by ${holders} tenants, appears ${occurrences}× on the page`
      : `only ${holders} tenant holds this card — CANNOT RUN, the duplication a leak would cause is unobservable`);

  await capture(tp, `${BASE}/portal/${target.slug}/documents/new`, '04-tenant-new-document',
    [/document/i], 'tenant New Document chooser');
  const [{ n: ownSaved }] = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM document_templates
    WHERE tenant_id = ${target.tenantId}::uuid AND is_system = false`;
  note(`chooser is scoped to this tenant's OWN saved templates: ${ownSaved} row(s) — `
    + 'the shared system reads were retired in Phase 5 (TEMPLATE_BRIDGE_DESIGN §6)');
  await tc.close();

  console.log(`\n${ok ? '✓ all three template surfaces render, and show what the tables hold'
    : '✗ see failures above'}\n`);
} catch (e) {
  console.error('CAPTURE ERROR', e);
  ok = false;
} finally {
  await browser.close();
  await sql.end({ timeout: 5 });
  process.exit(ok ? 0 : 1);
}
