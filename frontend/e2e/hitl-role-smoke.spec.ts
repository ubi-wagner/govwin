/**
 * HITL role smoke — every one of the five HITL roles authenticates through the real
 * Credentials form and lands with the correct session role. This is the role-routing
 * contract for all actors (master_admin, rfp_admin, tenant_admin, tenant_user, partner_user).
 *
 * Self-authenticating (the `hitl` project has no storageState) — each test logs in fresh as
 * an account seeded by scripts/seed-e2e-hitl.mjs. Requires a running, seeded instance at
 * TEST_BASE_URL. See docs/E2E_HITL_RUNBOOK.md.
 */
import { test, expect } from '@playwright/test';

const PW = process.env.E2E_PW || 'E2ETest!2026';

const ROLES = [
  { role: 'master_admin', email: 'e2e-master@rfppipeline.test',   tenantSlug: null },
  { role: 'rfp_admin',    email: 'e2e-rfpadmin@rfppipeline.test', tenantSlug: null },
  { role: 'tenant_admin', email: 'e2e-tadmin@acme-navy.test',     tenantSlug: 'acme-navy-systems' },
  { role: 'tenant_user',  email: 'e2e-tuser@acme-navy.test',      tenantSlug: 'acme-navy-systems' },
  { role: 'partner_user', email: 'e2e-partner@ext.test',          tenantSlug: null },
] as const;

async function login(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
}

for (const acct of ROLES) {
  test(`${acct.role} authenticates and carries the right session role`, async ({ page }) => {
    await login(page, acct.email);

    // The cookie must actually authenticate — not bounce back to /login.
    await expect(page, `${acct.role} bounced to /login`).not.toHaveURL(/\/login/);

    // The session's custom claims are the role-routing contract for every actor.
    const res = await page.request.get('/api/auth/session');
    expect(res.ok(), 'session endpoint should 200').toBeTruthy();
    const s = await res.json();
    const role = s?.role ?? s?.user?.role;
    expect(role, `${acct.email} should carry role ${acct.role}`).toBe(acct.role);

    if (acct.tenantSlug) {
      const slug = s?.tenantSlug ?? s?.user?.tenantSlug;
      expect(slug, `${acct.role} should be scoped to ${acct.tenantSlug}`).toBe(acct.tenantSlug);
    }
  });
}
