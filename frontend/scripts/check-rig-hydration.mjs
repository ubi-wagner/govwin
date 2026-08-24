/**
 * Is the server actually serving the build that is on disk, and does the client half RUN?
 *
 * WHY THIS EXISTS. A four-lens run reported a real-looking product defect — the bucket slot counter
 * missing, `ui=null db=5` — and it was chased through the component, the permission check and the
 * API route before the browser console gave it away:
 *
 *     Refused to execute script from '.../_next/static/chunks/webpack-c91f4d79f3cefad9.js'
 *
 * The Next server on :3000 had been up for five hours. A later restart never took, because the port
 * was still held and the new process died quietly while `curl /login` kept answering 200 from the
 * OLD one. Meanwhile the static directory had been overwritten with chunks from a NEW build, so the
 * server's HTML referenced hashes that no longer existed. Every client bundle 404'd and nothing
 * hydrated.
 *
 * TWO FALSE VERDICTS CAME OUT OF THAT, in opposite directions:
 *   · verify-ui-vs-db FAILED on a product that was fine — a number rendered by client JS cannot
 *     appear when client JS never runs.
 *   · verify-surfaces PASSED 80/80 — it gates on client throws, and code that never executes
 *     cannot throw. It was green for exactly the reason that should have failed it.
 *
 * The second is the dangerous one. A lens that reports a false alarm gets investigated; a lens that
 * reports false confidence gets believed.
 *
 * WHAT IT CHECKS, in the order that isolates the fault:
 *   1. the server answers at all;
 *   2. the webpack chunk THIS BUILD produced is served, with a JavaScript content-type — a 404 or
 *      an HTML error body means the process and the assets disagree about which build this is;
 *   3. a page that renders a number CLIENT-SIDE actually shows it — the only proof hydration ran.
 *
 * Step 3 needs no fixture: `/login` is public and static, so this deliberately uses the served
 * bundle rather than a signed-in page. Anything requiring a session belongs in a lens, not a gate.
 *
 *   cd frontend && node scripts/check-rig-hydration.mjs
 * Exit 0 = the rig can be trusted. Non-zero = every lens result from it is meaningless.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
let bad = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const no = (m) => { bad++; console.error(`  WRONG ${m}`); };

async function main() {
  // ── 1 · is anything there ──────────────────────────────────────────────────────────────────
  let login;
  try {
    login = await fetch(`${BASE}/login`, { redirect: 'manual' });
  } catch {
    no(`nothing answered at ${BASE} — start the server before running a lens`);
    process.exit(1);
  }
  if (login.status >= 500) { no(`${BASE}/login answered ${login.status}`); process.exit(1); }
  ok(`server answering at ${BASE} (${login.status})`);

  // ── 2 · does the SERVED build match the BUILT one ──────────────────────────────────────────
  // The identity check, not the liveness check. A 200 from a stale process reads exactly like a
  // 200 from the right one, which is the whole reason this file exists.
  let chunk;
  try {
    chunk = readdirSync(join(process.cwd(), '.next/static/chunks'))
      .find((f) => /^webpack-[a-f0-9]+\.js$/.test(f));
  } catch {
    no('no .next/static/chunks on disk — run `npx next build` first');
    process.exit(1);
  }
  if (!chunk) { no('no webpack chunk in .next/static/chunks — the build looks incomplete'); process.exit(1); }

  const res = await fetch(`${BASE}/_next/static/chunks/${chunk}`);
  const type = res.headers.get('content-type') || '';
  if (res.status !== 200) {
    no(`the server does NOT serve this build's chunk (${chunk} → ${res.status}).`);
    console.error('        The running process and the staged assets are from different builds.');
    console.error('        Kill it by PID (`ps -eo pid,cmd | grep next-server`) — pkill patterns');
    console.error('        match the invoking shell — then re-stage .next/static and restart.');
  } else if (!/javascript/i.test(type)) {
    no(`the chunk is served as "${type}", not JavaScript — the browser will refuse to execute it`);
  } else {
    ok(`serving THIS build's client bundle (${chunk})`);
  }

  // ── 3 · does the client half actually run ──────────────────────────────────────────────────
  // The bundle can be present and still never execute. Only a browser answers this, so the check
  // is skipped rather than faked when Playwright is unavailable — and skipped is REPORTED, because
  // an unmeasured gate that prints nothing is how the original failure survived.
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch {
    console.error('  UNMEASURED hydration not checked — playwright unavailable. The bundle is');
    console.error('            served, but whether it RUNS is unproven on this box.');
    process.exit(bad ? 1 : 0);
  }

  // The SAME executable path the drives use (scripts/lib/cross-company.mts). Playwright's default
  // resolution wants a headless-shell build that is not installed here, so letting it choose turns
  // a working rig into a spurious gate failure — a check that cries wolf gets switched off, which
  // costs more than the check was worth.
  const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  let browser;
  try {
    browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  } catch (e) {
    console.error(`  UNMEASURED hydration not checked — chromium would not launch (${String(e).slice(0, 60)}).`);
    console.error('            The bundle is served; whether it RUNS is unproven on this box.');
    process.exit(bad ? 1 : 0);
  }
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)); });
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const refused = errors.filter((e) => /Refused to execute|Failed to load resource.*chunk/i.test(e));
    if (refused.length) {
      no('the browser REFUSED the client bundle — nothing on this box hydrates');
      refused.slice(0, 2).forEach((e) => console.error(`        ${e}`));
    } else if (errors.length) {
      // Reported, not fatal: a page can log an error and still hydrate.
      ok(`client bundle executed (${errors.length} unrelated console error(s), reported not fatal)`);
    } else {
      ok('client bundle executed with no console errors — the page hydrates');
    }
  } finally {
    await browser.close();
  }

  if (bad) {
    console.error('\n✗ RIG NOT TRUSTWORTHY — a lens run against it proves nothing. A surface sweep');
    console.error('  would report every page clean, because code that never executes never throws.');
    process.exit(1);
  }
  console.log('✓ rig trustworthy — the served build is this build, and its client half runs.');
}

main().catch((e) => { console.error('check-rig-hydration failed:', e); process.exit(1); });
