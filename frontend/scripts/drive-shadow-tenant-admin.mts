/**
 * A SHADOW PLATFORM-ADMIN IS A TRUE IN-SESSION COMPANY ADMIN — with the customer-admin's authority,
 * but keeping their OWN identity for the audit trail.
 *
 * The design decision this guards: we DON'T rewrite the session role to `tenant_admin`. A platform
 * admin (rfp_admin / master_admin) already OUTRANKS tenant_admin in the RBAC hierarchy, and every
 * tenant-admin gate is `hasRoleAtLeast(role, 'tenant_admin')` (or explicitly lists the admin roles),
 * so the shadow admin can already perform every tenant_admin action. Rewriting the role WOULD ERASE
 * the "an RFP admin did this in shadow" provenance the audit trail depends on.
 *
 *   1. The shadow admin's session role stays a PLATFORM admin (never downgraded to tenant_admin).
 *   2. They hold NO membership at the target company — a genuine shadow, not a home member.
 *   3. They can perform a tenant_admin-GATED write inside the customer company (200).
 *   4. That write is AUDITED under the admin's real user id, scoped to the customer company.
 *
 * BUILDS ITS OWN SITUATION. It used to pin `eric@rfppipeline.com` and the tenant
 * `acme-navy-systems`; the company was rebuilt away, `SELECT id FROM tenants WHERE slug=…` came
 * back empty, and destructuring that empty result threw `Cannot read properties of undefined
 * (reading 'id')` — a drive-wide crash on line 37 that proved nothing about shadow access at all.
 *
 * The shape it needs is small and the factory makes it exactly: one customer company, and one
 * platform admin who by construction holds no membership there. Assertion 2 is then a real
 * measurement rather than a property of whichever seed happened to be loaded.
 *
 *   cd frontend && DATABASE_URL=<owner> node --import tsx scripts/drive-shadow-tenant-admin.mts
 */
import { sqlBypass as sql } from '@/lib/db';
import { runScenario } from './lib/scenario.mts';
import { BASE, launch, signIn } from './lib/cross-company.mts';

const ADMIN_PW = process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!';

// A tenant_admin-gated write with a clean audit signature. The PATCH emits
// `automation_preferences.updated`, scoped and attributed, which is what assertions 3 and 4 read.
const SCOPE = 'build';
const TRIGGER = 'proposal:document.locked';

await runScenario('shadow-tenant-admin', async (s) => {
  let ok = true;
  const A = (cond: boolean, label: string) => {
    console.log(`${cond ? '✅' : '❌ FAIL'}  ${label}`);
    if (!cond) ok = false;
  };

  const customer = await s.tenant({ label: 'customer' });
  const adminUser = await s.admin();

  const [{ member }] = await sql<{ member: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM user_memberships
                   WHERE user_id = ${adminUser.id}::uuid
                     AND tenant_id = ${customer.tenantId}::uuid
                     AND status = 'active') AS member`;
  A(member === false, 'admin holds NO membership at the target — a genuine shadow, not a home member');

  const browser = await launch();
  try {
    const bc = await signIn(browser, adminUser.email, ADMIN_PW);
    const page = bc.pages()[0];

    const before = await (async () => {
      const r = await bc.request.get(`${BASE}/api/auth/session`);
      return ((await r.json().catch(() => ({})))?.user ?? {}) as Record<string, unknown>;
    })();
    const isPlatformAdmin = before.role === 'rfp_admin' || before.role === 'master_admin';
    A(isPlatformAdmin, `session role is a platform admin (${before.role})`);

    // Descend into the customer company (shadow).
    await page.goto(`${BASE}/portal/${customer.slug}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    A(page.url().includes(`/portal/${customer.slug}`),
      `shadow descent into the customer portal (${page.url().replace(BASE, '')})`);

    // The role must NOT have been rewritten to tenant_admin by descending.
    const inTenant = await (async () => {
      const r = await bc.request.get(`${BASE}/api/auth/session`);
      return ((await r.json().catch(() => ({})))?.user ?? {}) as Record<string, unknown>;
    })();
    A(inTenant.role === before.role && isPlatformAdmin,
      `role stays the platform-admin identity inside the company — NOT downgraded to tenant_admin (${inTenant.role})`);

    const g = await bc.request.get(`${BASE}/api/portal/${customer.slug}/automation-policies`);
    A(g.ok(), `shadow admin can READ the tenant_admin-gated automation policies (${g.status()})`);
    const policies = ((await g.json())?.data?.policies ?? []) as Array<
      { scope?: string; triggerKey?: string; row?: { enabled?: boolean } | null }>;
    const prior = policies.find((p) => p.scope === SCOPE && p.triggerKey === TRIGGER)?.row?.enabled ?? true;

    const patch = await bc.request.fetch(`${BASE}/api/portal/${customer.slug}/automation-policies`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      data: { scope: SCOPE, triggerKey: TRIGGER, enabled: !prior },
    });
    A(patch.ok(), `shadow admin can WRITE a tenant_admin-gated action inside the customer company (${patch.status()})`);

    // The write must be AUDITED under the admin's real identity, scoped to the customer company.
    await page.waitForTimeout(600);
    const [ev] = await sql<{ actorId: string | null; tenantId: string | null }[]>`
      SELECT actor_id AS "actorId", tenant_id AS "tenantId"
      FROM system_events
      WHERE type = 'automation_preferences.updated'
        AND actor_id = ${adminUser.id}
        AND tenant_id = ${customer.tenantId}::uuid
      ORDER BY created_at DESC LIMIT 1`;
    A(!!ev, 'the shadow write emitted an audit event');
    A(ev?.actorId === adminUser.id, "audit event attributes to the ADMIN's real user id (not a tenant_admin stand-in)");
    A(ev?.tenantId === customer.tenantId, 'audit event is scoped to the CUSTOMER company');

    await bc.close();
  } finally {
    await browser.close();
  }
  // No restore step: the whole company goes away on dispose, so there is nothing to put back.
  console.log(`\n${ok ? '✅ ALL PASS' : '❌ FAILURES ABOVE'}\n`);
  return ok;
});
