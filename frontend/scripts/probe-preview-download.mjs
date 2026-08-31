/** Two failures on the paths a customer actually cares about: seeing the assembled document, and
 * downloading it. Both time out rather than erroring, which tells you nothing about why.
 *
 *  A. hitl-tvsf-verify waits 60s for `button[name=/Preview/]` on a section page and never finds it.
 *     The button is real — canvas-sidebar renders every toolbox card as a <button> and lib/canvas/
 *     toolbox.ts titles this one "Preview" — so the interesting question is whether the editor
 *     rendered at all. Paul enters via the GENERIC /api/enter on a comment saying he has "no home
 *     tenant", which stopped being true when he became a partner_admin with his own org.
 *
 *  B. hitl-foundation-ui-walk step 11 waits 25s for a download event that never fires. Ask the
 *     package route directly: a 200 with docx bytes means the export works and the click wiring is
 *     the problem; anything else names the real failure.
 *
 * Prints where the browser actually ended up and what the page contains, instead of asserting.
 */
import { chromium } from 'playwright';

// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const P = 'c3db60b1-2f0e-4bc8-903c-1ec098906c58';       // Foundation TVSF proposal
const S = 'e43e02fd-798b-4d46-a95f-1e158ce67704';       // "#2 Overview of the Technology"

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

const signIn = async (email, pw) => {
  await page.context().clearCookies();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', pw);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }), page.click('button[type="submit"]')]);
};

// ── A. the section editor, entered the two different ways ───────────────────
for (const [label, enter] of [
  ['generic /api/enter (what the spec does)', `${BASE}/api/enter?slug=foundation&next=/portal/foundation/dashboard`],
  ['partner descend /api/partner/enter',      `${BASE}/api/partner/enter?slug=foundation&next=dashboard`],
]) {
  await signIn('pjackson@ecinnovates.com', process.env.FOUNDATION_PW || 'DemoPass123!');
  await page.goto(enter, { waitUntil: 'networkidle' });
  console.log(`\n── ${label} ──`);
  console.log(`  after enter      : ${new URL(page.url()).pathname}`);
  await page.goto(`${BASE}/portal/foundation/proposals/${P}/sections/${S}`, { waitUntil: 'networkidle', timeout: 45000 });
  console.log(`  section page     : ${new URL(page.url()).pathname}`);
  const n = await page.getByRole('button', { name: /Preview/ }).count();
  const toolbox = await page.getByText('Your toolbox').count();
  const body = ((await page.textContent('body')) ?? '').trim();
  console.log(`  Preview buttons  : ${n}   toolbox present: ${toolbox > 0}   body chars: ${body.length}`);
  if (n === 0) console.log(`  first 160 chars  : ${body.slice(0, 160).replace(/\s+/g, ' ')}`);
}

// ── B. the package route, asked directly ────────────────────────────────────
await signIn('kate.ulepic@foundation3dp.com', process.env.FOUNDATION_PW || 'DemoPass123!');
for (const fmt of ['docx', 'pdf', 'json']) {
  const r = await page.request.get(`${BASE}/api/portal/foundation/proposals/${P}/package?format=${fmt}`);
  const buf = r.ok() ? await r.body() : null;
  console.log(`\npackage?format=${fmt.padEnd(4)} → ${r.status()} ${r.headers()['content-type'] ?? ''} ${buf ? buf.length + ' bytes' : (await r.text()).slice(0, 120)}`);
}

await browser.close();
