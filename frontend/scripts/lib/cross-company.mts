/**
 * THE CROSS-COMPANY SHAPE — two companies, a person who belongs to both, and a control who does not.
 *
 * Four drives need exactly this situation and all four used to pin it: the tenants `beacon-labs`
 * and `acme-navy-systems`, the accounts `admin@acme-navy.test`, `expert@beacon-labs.test`,
 * `teammate@acme-navy.test`, and a proposal uuid. None of those exist any more — the database was
 * rebuilt and took the whole seeded scenario with it — and there is nothing equivalent to repoint
 * them at. Re-seeding would go green faster and rot again on the next rebuild.
 *
 * So the shape is CONSTRUCTED, through the product's own routes, and torn down after:
 *
 *   home ─── its tenant_admin ────┐                       (a membership at home, from tenant creation)
 *                                 ├── the MULTI person: two memberships, so login must offer a choice
 *   host ─── invited as an external collaborator on host's build (a membership at host, from the
 *            real collaborators route)
 *
 *   host ─── a tenant_user invited through the real team route ── the SINGLE control: one membership,
 *            so login must NOT offer a choice
 *
 * WHY THE MULTI PERSON IS THE HOME TENANT'S OWN ADMIN rather than a synthetic user: tenant creation
 * already gives them an active `tenant_admin` membership at home, which is a product-made membership
 * rather than one this file invented. The second membership then comes from the collaborators route
 * — the very path the invite drives are testing. Every membership in this shape was created by the
 * product, which is the only way a drive over it proves anything about the product.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { CannotRun, type Scenario, type ScenarioTenant, type ScenarioBuild } from './scenario.mts';
import { clientHeaders } from './client-ip.mts';

export const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/**
 * A browser for ONE simulated person — their own viewport, their own cookies, their own client
 * address. Use this instead of `browser.newContext()` anywhere a drive signs someone in: the
 * address is what keeps this person's auth traffic out of everyone else's rate-limit bucket
 * (see `client-ip.mts` for what happens without it).
 */
export function newDriveContext(browser: Browser) {
  return browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: clientHeaders() });
}

export interface CrossCompany {
  home: ScenarioTenant;
  host: ScenarioTenant;
  hostBuild: ScenarioBuild;
  /** A section of the host build, for a per-section collaborator grant. */
  hostSectionId: string | null;
  /** tenant_admin at `home` AND partner_user at `host` — two memberships. */
  multiEmail: string;
  multiPassword: string;
  /** tenant_user at `host` only — one membership. The control. */
  singleEmail: string;
  singlePassword: string;
}

/**
 * A URL THAT DISPATCHES IS NOT A URL THAT LANDED.
 *
 * `/portal`, `/go` and `/api/enter` decide where someone belongs and then redirect. In the App
 * Router the browser's URL becomes `/portal` *first* and the redirect resolves a beat later, so
 * "the URL is no longer /login" is satisfied while the person is still in mid-air.
 *
 * Waiting on that predicate is how `identity-deeplink` came to report six product failures: the
 * login returned at `/portal`, the assertion read "no company selector", the company was never
 * picked, and every case after it measured an unpinned session. The product was doing exactly the
 * right thing the whole time; the harness was reading the clock at the wrong moment.
 *
 * So the wait is for a DESTINATION. `/select-company` counts — it is where a multi-membership
 * person is supposed to come to rest. The bare dispatchers do not.
 */
const isDispatcher = (u: URL) =>
  u.pathname.startsWith('/login') || u.pathname === '/portal' || u.pathname === '/go'
  || u.pathname === '/api/enter';

export async function waitForLanding(page: Page): Promise<void> {
  // Leg 1: off the login form. Generous — this is the leg that involves a password round-trip.
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25000 }).catch(() => {});
  // Leg 2: through the dispatcher. Short, because a person with no workspace legitimately COMES TO
  // REST on `/portal` (the friendly no-workspace message) and there is nothing further to wait for.
  if (isDispatcher(new URL(page.url()))) {
    await page.waitForURL((u) => !isDispatcher(u), { timeout: 8000 }).catch(() => {});
  }
}

/** Sign in through the real form. Throws CannotRun on failure — a drive that cannot authenticate
 *  measures nothing, and a logged-out browser 401s on everything, which reads like a deny-all. */
export async function signIn(browser: Browser, email: string, password: string): Promise<BrowserContext> {
  const bc = await newDriveContext(browser);
  const p = await bc.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await p.fill('#email', email);
  await p.fill('#password', password);
  await p.click('button[type="submit"]');
  await waitForLanding(p);
  if (p.url().includes('/login')) {
    throw new CannotRun(`could not sign in as ${email} (still on /login after 25s)`);
  }
  return bc;
}

export const launch = () => chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

/**
 * The session the server actually derived from the JWT — not what the URL suggests.
 *
 * A REFUSED READ IS NOT AN EMPTY SESSION. Signed out, the endpoint answers `null`, and `j?.user`
 * is undefined. Rate limited, it answers `429 {code:'RATE_LIMITED'}`, and `j?.user` is *also*
 * undefined. The first version could not tell those apart, returned `{}` for both, and every
 * downstream assertion dutifully reported `tenant=undefined` — sixteen of them, as findings, on a
 * box where the product was fine and the harness had simply spent its auth budget. So the refusal
 * throws: a drive that cannot read the session has measured nothing, which is CANNOT-RUN, not FAIL.
 */
export async function session(bc: BrowserContext): Promise<Record<string, unknown>> {
  const r = await bc.request.get(`${BASE}/api/auth/session`);
  if (r.status() === 429) {
    throw new CannotRun('GET /api/auth/session → 429 RATE_LIMITED. The auth limiter is 20 requests '
      + 'per 15 minutes per client address; this browser context spent its budget. Every session '
      + 'assertion after this point would be UNMEASURED, not failed.');
  }
  const j = await r.json().catch(() => ({}));
  return (j?.user ?? {}) as Record<string, unknown>;
}

/**
 * WAIT FOR THE SESSION TO SETTLE, rather than sleeping and hoping.
 *
 * A fixed `waitForTimeout` after a login is the classic harness fragility: it passes on an idle box
 * and fails on a busy one, and the failure looks like a product bug. `identity-deeplink` passed
 * standalone and then failed inside the 27-drive suite with `tenant=undefined pinned=undefined` on
 * six assertions — not a session bug, just a login that had not finished yet.
 *
 * POLL COUNT IS A BUDGET, NOT A FREE PARAMETER. Each read spends one of this client's twenty
 * auth requests per fifteen minutes, and the first version of this function polled every 400ms for
 * twenty seconds — fifty reads for a single call, enough to lock the box out on its own. Eight
 * reads spaced 1.5s apart covers a slow login and still leaves the context most of its budget.
 *
 * Returns the last-seen session on timeout rather than throwing, so the assertion that follows
 * reports what it actually saw. (A REFUSED read still throws, from `session()` — see there.)
 */
export async function settledSession(
  bc: BrowserContext,
  want: (s: Record<string, unknown>) => boolean = (s) => !!s.id,
  attempts = 8,
  intervalMs = 1500,
): Promise<Record<string, unknown>> {
  let last: Record<string, unknown> = {};
  let sawAnyUser = false;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, intervalMs));
    last = await session(bc);
    if (last.id) sawAnyUser = true;
    if (want(last)) return last;
  }
  // "I could not read the session" is NOT "the session says undefined", and letting the second
  // stand in for the first is how a harness reports a product bug it did not observe. If no user
  // was EVER visible across the whole window, the read failed — say so on its own line, loudly, so
  // the assertions that follow are read as consequences rather than findings.
  if (!sawAnyUser) {
    console.error(`  ⚠ COULD NOT READ THE SESSION — ${attempts} reads of /api/auth/session over `
      + `${Math.round((attempts - 1) * intervalMs / 1000)}s returned no user at all. Every assertion `
      + 'below that reads the session is UNMEASURED, not failed.');
  }
  return last;
}

export async function buildCrossCompany(s: Scenario, browser: Browser): Promise<CrossCompany> {
  const home = await s.tenant({ label: 'home' });
  const host = await s.tenant({ label: 'host' });
  const hostBuild = await s.build({ tenant: host, label: 'xc' });

  const { sqlBypass } = await import('@/lib/db');
  const [sec] = await sqlBypass<{ id: string }[]>`
    SELECT id FROM proposal_sections WHERE proposal_id = ${hostBuild.proposalId}::uuid
    ORDER BY sort_index ASC NULLS LAST LIMIT 1`;

  const hostAdmin = await signIn(browser, host.adminEmail, host.password);

  // ── the SINGLE control: a tenant_user at host, through the real team route ──────────────────
  const single = await s.user({ label: 'single', role: 'tenant_user', homeTenant: host });
  const teamRes = await hostAdmin.request.post(`${BASE}/api/portal/${host.slug}/team`, {
    data: { email: single.email, name: `single ${s.tag}`, role: 'tenant_user' },
  });
  if (teamRes.status() >= 300) {
    throw new CannotRun(`the team route refused to add a tenant_user (${teamRes.status()}): `
      + `${(await teamRes.text()).slice(0, 140)}`);
  }

  // ── the MULTI person: home's admin, invited onto host's build as an external collaborator ───
  const inviteRes = await hostAdmin.request.post(
    `${BASE}/api/portal/${host.slug}/proposals/${hostBuild.proposalId}/collaborators`,
    { data: { email: home.adminEmail, name: `multi ${s.tag}`, role: 'external',
      permission: 'view', assignedSections: sec ? [sec.id] : [] } });
  if (inviteRes.status() >= 300) {
    throw new CannotRun(`the collaborators route refused the cross-company invite `
      + `(${inviteRes.status()}): ${(await inviteRes.text()).slice(0, 140)}`);
  }
  await hostAdmin.close();

  return {
    home, host, hostBuild, hostSectionId: sec?.id ?? null,
    multiEmail: home.adminEmail, multiPassword: home.password,
    singleEmail: single.email, singlePassword: single.password,
  };
}
