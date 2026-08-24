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
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { CannotRun, type Scenario, type ScenarioTenant, type ScenarioBuild } from './scenario.mts';

export const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

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

/** Sign in through the real form. Throws CannotRun on failure — a drive that cannot authenticate
 *  measures nothing, and a logged-out browser 401s on everything, which reads like a deny-all. */
export async function signIn(browser: Browser, email: string, password: string): Promise<BrowserContext> {
  const bc = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await bc.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await p.fill('#email', email);
  await p.fill('#password', password);
  await p.click('button[type="submit"]');
  await p.waitForTimeout(2500);
  if (p.url().includes('/login')) {
    throw new CannotRun(`could not sign in as ${email} (still on /login)`);
  }
  return bc;
}

export const launch = () => chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

/** The session the server actually derived from the JWT — not what the URL suggests. */
export async function session(bc: BrowserContext): Promise<Record<string, unknown>> {
  const r = await bc.request.get(`${BASE}/api/auth/session`);
  const j = await r.json().catch(() => ({}));
  return (j?.user ?? {}) as Record<string, unknown>;
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
