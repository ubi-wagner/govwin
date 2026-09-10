/**
 * CAPTURE THE UNMINIFIED HYDRATION DIFF — the step the #418 entries kept naming and nobody could run.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
 * React #418 (hydration mismatch) has been recorded four times against four unrelated routes —
 * `/admin`, `/admin/pipeline`, `/admin/analytics`, `/partner` — and three of those entries close
 * with the same sentence: *"I have not reproduced #418 on a dev build where React names the
 * component."* (docs/BUG_LOG_2026-08-19.md B92, docs/PROJECT_BUILD_LOG.md P3.) In a production
 * build React prints `Minified React error #418` and nothing else: no component, no server-vs-client
 * diff, no stack. In a dev build it prints all three, and the bug becomes a one-shot diagnosis.
 *
 * Nobody ran that step because it was structurally impossible here. `next dev` writes into the same
 * `.next` that `output:'standalone'` owns — it deletes `required-server-files.json` and the whole
 * `standalone/` directory, fails to boot itself on `EvalError: Code generation from strings
 * disallowed` from the prebuilt edge middleware, and the already-running server keeps answering 200
 * the entire time because it holds its files open. So the attempt looks like it merely failed, and
 * silently destroys the deployable build. `next.config.mjs` now takes `NEXT_DIST_DIR`, which is what
 * makes this script runnable at all.
 *
 * ── RUNNING IT ─────────────────────────────────────────────────────────────────────────────────
 * NOTE THE `NODE_ENV=development`. `scripts/sandbox-env.sh` exports `NODE_ENV=production` for the
 * drives, and a sourced shell carries it into whatever you launch next — which makes `next dev`
 * build the edge-middleware sandbox in production mode (code generation from strings DISALLOWED)
 * while webpack still wraps every dev module in `eval("…")`. Every request then 500s with
 * `EvalError: Code generation from strings disallowed for this context`, pointing at Next's own
 * `next-middleware-loader.js`, which reads like a framework bug and is an environment variable.
 *
 *   source scripts/sandbox-env.sh
 *   cd frontend && env NODE_ENV=development NEXT_DIST_DIR=.next-dev \
 *     DATABASE_URL="$DATABASE_URL" AUTH_SECRET="$AUTH_SECRET" AUTH_TRUST_HOST=true \
 *     NEXTAUTH_URL=http://localhost:3001 AUTH_URL=http://localhost:3001 \
 *     npx next dev -p 3001                                         # leave running
 *   node scripts/capture-hydration-diff.mjs                        # in another shell
 *
 * Env: BASE (default http://localhost:3001) · ROUTES (comma-separated) · PASSES (default 2) ·
 * BROWSER_TZ (default America/New_York — see below; a UTC-against-UTC run cannot see B156).
 *
 * DELIBERATELY NOT REGISTERED in `run-branch-drives.sh`. The suite serves the standalone build on
 * :3000; this needs a second, dev server on :3001, and a drive that silently finds nothing because
 * the thing it measures is not running is worse than no drive. Run it by hand when #418 shows up.
 *
 * ── THE TWO GUARDS, AND WHY BOTH REFUSE A VERDICT ──────────────────────────────────────────────
 * Exit 2 is a HARNESS DEFECT, distinct from exit 0 (nothing fired) and exit 1 (a diff captured).
 *
 *   1. NOT AUTHENTICATED. An earlier version of this probe reported "0 client errors" three runs in
 *      a row while measuring the LOGIN page, because the credential was wrong and it followed the
 *      redirect without noticing. A clean run against the wrong page is worse than no run.
 *
 *   2. NOT A DEV BUILD. This is the guard that matters. Pointed at the production server on :3000
 *      this script would find zero hydration diagnostics on a route that is genuinely broken —
 *      because production React does not emit them — and report a clean sweep. That is the exact
 *      shape of instrument this repo refuses to keep: one that cannot detect the thing it exists
 *      for, and so reports a clean run. It checks for the dev-only react-refresh runtime and exits
 *      2 if it is absent.
 */
import { chromium } from 'playwright';

const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:3001';
const PASSES = Number(process.env.PASSES || 2);
const ROUTES = (process.env.ROUTES
  // The five routes #418 has actually been seen on. `/admin/sources` leads because it is the one
  // that was REPRODUCED and named its component (B156) — a default route list that omits the only
  // proven case is a default that cannot re-prove the bug it was written for.
  || '/admin/sources,/admin/dashboard,/admin/pipeline,/admin/analytics,/admin/events,/partner').split(',');
const EMAIL = process.env.DRIVE_ADMIN_EMAIL || 'eric@rfppipeline.com';
const PW = process.env.SANDBOX_PASSWORD;

const HYDRATION = /[Hh]ydrat|did not match|server rendered|server-rendered|#418|#419|#421|#422|#423|#425/;

if (!PW) { console.error('✗ HARNESS DEFECT — SANDBOX_PASSWORD not set; source scripts/sandbox-env.sh'); process.exit(2); }

const br = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
/**
 * TZ IS A FIRST-CLASS KNOB, not a detail. React's own hydration-mismatch list names *"date
 * formatting in a user's locale which doesn't match the server"* as a cause, and this sandbox runs
 * the server AND the browser in UTC — so a `toLocaleString` with no `timeZone` renders identically
 * on both sides here and is invisible, while firing for every customer whose browser is not UTC.
 * A UTC-only sweep is therefore structurally blind to the single most common cause. Default to a
 * non-UTC zone; `BROWSER_TZ=UTC` to measure the sandbox's own default.
 *
 * `BROWSER_TZ`, not `TZ`: `TZ` is read by Node itself, so reusing it would silently move THIS
 * process's clock as well as the browser's — and the whole point is to make the two differ
 * deliberately, not to move both together and see nothing.
 */
const ctx = await br.newContext({
  viewport: { width: 1440, height: 1000 },
  timezoneId: process.env.BROWSER_TZ || 'America/New_York',
});
const page = await ctx.newPage();
const seen = [];
page.on('pageerror', (e) => seen.push({ kind: 'pageerror', text: e.message }));
page.on('console', (m) => {
  const t = m.type();
  // React emits the dev hydration diff as console.error, and some variants as a warning.
  if (t === 'error' || t === 'warning') seen.push({ kind: t, text: m.text() });
});

const die = async (msg) => { console.error(`✗ HARNESS DEFECT — ${msg}`); await br.close(); process.exit(2); };

// GUARD 2 first: cheapest, and it invalidates everything below if it fails.
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' }).catch(() => {});
// `page.content()` throws "the page is navigating" if it races a redirect, so settle first. A
// harness that dies on a race reports nothing, which is the same outcome as a clean run.
await page.waitForLoadState('load').catch(() => {});
const loginHtml = await page.content().catch(() => '');
/**
 * The discriminator, VALIDATED BOTH WAYS rather than guessed: dev emits UNHASHED bootstrap chunks
 * (`app-pages-internals.js`, `chunks/webpack.js`), production emits content-hashed ones. Measured
 * on this box — 0 matches against the standalone build on :3000, 1 against `next dev` on :3001.
 * The first version of this guard looked for `react-refresh` / `webpack-hmr` / `static/development`
 * and matched NONE of them on a real dev build, i.e. it would have refused every legitimate run.
 */
if (!/app-pages-internals\.js|\/_next\/static\/chunks\/webpack\.js/.test(loginHtml)) {
  await die(`${BASE} is not serving a DEV build (no unhashed dev bootstrap chunks). Production React `
    + 'prints only "Minified React error #418" — every clean result below would be unearned. See the '
    + 'header of this file for the correct dev invocation.');
}

await page.fill('#email', EMAIL);
await page.fill('#password', PW);
await page.click('button[type="submit"]');
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(1500);
// GUARD 1.
if (page.url().includes('/login')) await die(`not authenticated as ${EMAIL} — measured the login page, not the app`);

let captured = 0;
for (const route of ROUTES) {
  for (let pass = 1; pass <= PASSES; pass++) {
    seen.length = 0;
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    // Dev compiles a route on first hit; a short wait here measures the compiler, not the app.
    await page.waitForTimeout(pass === 1 ? 6000 : 3500);
    const hits = seen.filter((e) => HYDRATION.test(e.text));
    console.log(`${route.padEnd(22)} pass ${pass}: ${String(seen.length).padStart(3)} console/page errors, ${hits.length} hydration`);
    for (const h of hits) {
      captured += 1;
      console.log('  ' + '─'.repeat(76));
      console.log(h.text.split('\n').map((l) => '  ' + l).join('\n'));
    }
  }
}

await br.close();
if (captured) {
  console.log(`\n❌ ${captured} hydration diagnostic(s) captured — the diff above names the component.`);
  process.exit(1);
}
/**
 * SAY WHAT THE ZONE WAS. A clean run means nothing without it: B156 was invisible for months
 * precisely because every sweep compared UTC against UTC, and the summary line that used to sit
 * here blamed "mid-suite, with the workflow engine writing" — a theory the diff later disproved.
 * A green line that carries a wrong explanation is worse than one that carries none, because the
 * next reader inherits the explanation and not the doubt.
 */
console.log('\n✅ no hydration mismatch on a DEV build across '
  + `${ROUTES.length} route(s) × ${PASSES} pass(es), browser zone ${process.env.BROWSER_TZ || 'America/New_York'} `
  + 'vs the server\'s. Evidence for THESE routes at THIS zone pair — not for every route, and not '
  + 'for a viewer in a zone whose offset differs from this one at a different time of year.');
process.exit(0);
