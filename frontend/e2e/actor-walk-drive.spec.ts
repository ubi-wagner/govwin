/**
 * ACTOR WALK — every role walks its own surfaces, and each surface is SCREENSHOT
 * so the picture (not a query) is the verification instrument.
 *
 * The point is not that the routes return 200. It is that a human looking at the
 * rendered page would accept it: no empty interpolation, no zeroed tile that
 * should have data, no test rows in a production-shaped queue, no duplicate
 * flood. Those are the defects a DB query reports as healthy.
 *
 * Run: npx playwright test --project=drive actor-walk
 * Shots land in $WALK_DIR (default below); walk-manifest.json indexes them.
 */
import { test, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const DIR = process.env.WALK_DIR || '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/actor-walk';
const VIEWPORT = { width: 1440, height: 900 };

const PW = {
  admin: process.env.RFP_ADMIN_PW || 'SandboxDrive2026!',
  lighthouse: process.env.LIGHTHOUSE_PW || 'LighthouseAdmin',
  demo: 'DemoPass123!',
};

type Surface = { slug: string; url: string; note: string };
type Row = Surface & {
  actor: string; status: number | null; finalPath: string;
  chars: number; shot: string; bounced: boolean; visibleError: string | null;
};

const manifest: Row[] = [];
test.beforeAll(() => { fs.mkdirSync(DIR, { recursive: true }); });
test.afterAll(() => {
  fs.writeFileSync(path.join(DIR, 'walk-manifest.json'), JSON.stringify(manifest, null, 2));
});

async function login(page: Page, email: string, pw: string) {
  await page.context().clearCookies();
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', pw);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
  if (new URL(page.url()).pathname.startsWith('/login')) {
    throw new Error(`login bounced for ${email} — check the credential`);
  }
}

/** Walk one actor's surfaces. Never throws on a bad page — a broken surface is a
 *  FINDING to be photographed, not a reason to abandon the rest of the walk. */
async function walk(page: Page, actor: string, surfaces: Surface[]) {
  await page.setViewportSize(VIEWPORT);
  for (const s of surfaces) {
    const shot = path.join(DIR, `${actor}--${s.slug}.png`);
    let status: number | null = null;
    try {
      const resp = await page.goto(s.url, { waitUntil: 'networkidle', timeout: 45_000 });
      status = resp?.status() ?? null;
    } catch {
      try { await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 20_000 }); } catch { /* photograph whatever rendered */ }
    }
    await page.waitForTimeout(700);
    const body = (await page.textContent('body').catch(() => '')) || '';
    // Surface-level error text a human would see immediately.
    const m = body.match(/(Application error[^\n]{0,120}|Something went wrong[^\n]{0,120}|Unhandled Runtime Error|500 - |Internal Server Error|Access denied[^\n]{0,80})/);
    try { await page.screenshot({ path: shot, fullPage: true }); } catch { /* keep walking */ }
    manifest.push({
      ...s, actor, status,
      finalPath: new URL(page.url()).pathname,
      chars: body.length,
      shot: path.basename(shot),
      bounced: new URL(page.url()).pathname.startsWith('/login'),
      visibleError: m ? m[1] : null,
    });
  }
}

test('rfp_admin walks the admin spine', async ({ page }) => {
  test.setTimeout(15 * 60_000);
  await login(page, 'eric@rfppipeline.com', PW.admin);
  await walk(page, 'rfpadmin', [
    { slug: '01-dashboard', url: '/admin', note: 'landing — stat tiles + work queue' },
    { slug: '02-command', url: '/admin/command', note: 'Command Center, new-since-you-looked' },
    { slug: '03-applications', url: '/admin/applications', note: 'inbound applications queue' },
    { slug: '04-curation', url: '/admin/rfp-curation', note: 'triage + curation workspace' },
    { slug: '05-provisioning', url: '/admin/provisioning', note: 'provisioning cockpit list (72h SLA)' },
    { slug: '06-opportunities', url: '/admin/opportunities', note: 'master opportunity list' },
    { slug: '07-workflows', url: '/admin/workflows', note: 'workflow map + live monitor' },
    { slug: '08-agents', url: '/admin/agents', note: 'agent workforce roster + doorbell' },
    { slug: '09-scouts', url: '/admin/scouts', note: 'scout intake candidate queue' },
    { slug: '10-tenants', url: '/admin/tenants', note: 'tenant roster' },
    { slug: '11-automation', url: '/admin/automation', note: 'automation rules (the {company_name} rule)' },
    { slug: '12-site', url: '/admin/site', note: 'content studio' },
    { slug: '13-events', url: '/admin/events', note: 'system event stream' },
    { slug: '14-purchases', url: '/admin/purchases', note: 'purchases + comp codes' },
    { slug: '15-templates', url: '/admin/templates', note: 'master template catalog' },
    { slug: '16-storage', url: '/admin/storage', note: 'object storage browser' },
  ]);
});

test('tenant_admin walks the customer spine', async ({ page }) => {
  test.setTimeout(15 * 60_000);
  await login(page, 'kate.ulepic@foundation3dp.com', PW.demo);
  const t = '/portal/foundation';
  await walk(page, 'tenantadmin', [
    { slug: '01-command', url: `${t}/command`, note: 'tenant Command Center' },
    { slug: '02-dashboard', url: `${t}/dashboard`, note: 'tenant dashboard' },
    { slug: '03-cards', url: `${t}/cards`, note: 'opportunity cards (the canonical surface)' },
    { slug: '04-buckets', url: `${t}/buckets`, note: 'spotlight buckets / ranking lens' },
    { slug: '05-proposals', url: `${t}/proposals`, note: 'proposal portals' },
    { slug: '06-library', url: `${t}/library`, note: 'library atoms' },
    { slug: '07-todos', url: `${t}/todos`, note: 'tenant ToDo inbox' },
    { slug: '08-processes', url: `${t}/processes`, note: 'live workflows' },
    { slug: '09-team', url: `${t}/team`, note: 'team + invitations' },
    { slug: '10-documents', url: `${t}/documents`, note: 'standalone documents' },
    { slug: '11-activity', url: `${t}/activity`, note: 'activity feed' },
    { slug: '12-contracts', url: `${t}/contracts`, note: 'awarded contracts' },
    { slug: '13-spotlights-redirect', url: `${t}/spotlights`, note: 'RETIRED surface — must redirect to /cards' },
    { slug: '14-pipeline-redirect', url: `${t}/pipeline`, note: 'RETIRED surface — must redirect to /cards' },
  ]);
});

test('tenant_user sees its scoped surface', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await login(page, 'connor.casey@foundation3dp.com', PW.demo);
  const t = '/portal/foundation';
  await walk(page, 'tenantuser', [
    { slug: '01-command', url: `${t}/command`, note: 'does a tenant_user get the console?' },
    { slug: '02-cards', url: `${t}/cards`, note: 'cards as a non-admin' },
    { slug: '03-proposals', url: `${t}/proposals`, note: 'proposals as a non-admin' },
    { slug: '04-todos', url: `${t}/todos`, note: 'own ToDos' },
    { slug: '05-library', url: `${t}/library`, note: 'library as a non-admin' },
    { slug: '06-team-gate', url: `${t}/team`, note: 'ADMIN surface — must be gated' },
    { slug: '07-admin-gate', url: '/admin', note: 'ADMIN spine — must be denied' },
    { slug: '08-crosstenant-gate', url: '/portal/lighthouse/cards', note: 'OTHER TENANT — must be denied' },
  ]);
});

test('partner_admin walks the console', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await login(page, 'pjackson@ecinnovates.com', PW.demo);
  await walk(page, 'partneradmin', [
    { slug: '01-console', url: '/partner', note: 'partner-manager console over the stable' },
    { slug: '02-command', url: '/portal/entrepreneurs-center/command', note: 'own higher-order tenant' },
    { slug: '03-admin-gate', url: '/admin', note: 'rank 50 — must have NO /admin reach' },
  ]);
});

test('partner_user sees only its stage-scoped surface', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await login(page, 'collab@lighthouse.com', PW.demo);
  const t = '/portal/lighthouse';
  await walk(page, 'partneruser', [
    { slug: '01-landing', url: t, note: 'where does a collaborator land?' },
    { slug: '02-todos', url: `${t}/todos`, note: 'own ToDos (HITL-POLISH-1)' },
    { slug: '03-proposals', url: `${t}/proposals`, note: 'stage-scoped proposal access' },
    { slug: '04-library-gate', url: `${t}/library`, note: 'library — scoped or gated?' },
    { slug: '05-team-gate', url: `${t}/team`, note: 'ADMIN surface — must be gated' },
  ]);
});
