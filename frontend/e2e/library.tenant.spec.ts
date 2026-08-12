/**
 * Driven regression for library atom visibility/ownership enforcement (Batch 1):
 *   - an admin (tenant_admin) sees the whole tenant library;
 *   - a collaborator (partner_user) is FORBIDDEN the tenant library entirely (403). The atom READ
 *     routes are floored at tenant_user (the no-leakage-across-collaborators fix): a cross-company
 *     collaborator's tenant membership passes verifyTenantAccess, so without the floor they'd read
 *     the whole library beyond their section scope. Collaborators OFFER content UP via the write
 *     routes (atomize/capture stay partner_user); they do not pull from the library.
 *
 * Fixtures (seeded via SQL): A1 tenant-shared (admin), A2 admin owner_only,
 * A3 collaborator owner_only.
 */
import { test, expect, request as pwRequest } from '@playwright/test';

const SLUG = 'lighthouse';
const A1 = 'a1a1a1a1-0000-4000-8000-000000000001'; // tenant-shared, owner=admin
const A2 = 'a2a2a2a2-0000-4000-8000-000000000002'; // owner_only, owner=admin
const A3 = 'a3a3a3a3-0000-4000-8000-000000000003'; // owner_only, owner=collaborator

const idsOf = async (res: { json: () => Promise<unknown> }) =>
  new Set(((await res.json() as { data: { atoms: Array<{ id: string }> } }).data.atoms).map((a) => a.id));

test('atom visibility: admin sees the whole tenant library; a collaborator is forbidden it (leak fix)', async ({ request, baseURL }) => {
  // Admin (tenant_admin) — whole tenant library.
  const adminRes = await request.get(`/api/portal/${SLUG}/atoms`);
  expect(adminRes.status(), await adminRes.text()).toBe(200);
  const adminIds = await idsOf(adminRes);
  expect(adminIds.has(A1) && adminIds.has(A2) && adminIds.has(A3), 'admin sees all three').toBe(true);

  // Collaborator (partner_user) — the atom READ routes are floored at tenant_user, so a collaborator
  // cannot pull from the tenant library at all (403), even for tenant-shared atoms. This closes the
  // cross-collaborator leak; collaborators contribute UP through the write routes instead.
  const collabCtx = await pwRequest.newContext({ baseURL, storageState: 'e2e/.auth/collaborator.json' });
  try {
    const res = await collabCtx.get(`/api/portal/${SLUG}/atoms`);
    expect(res.status(), await res.text()).toBe(403);
  } finally {
    await collabCtx.dispose();
  }
});
