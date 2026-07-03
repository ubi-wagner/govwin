/**
 * Driven regression for design "A" (Greenfield Cards canonical): pushing a
 * multi-topic solicitation must land ONE opportunity card per topic for the
 * tenant — previously the bridge fan-out published only the umbrella, so topics
 * never reached tenant_opportunity_cards.
 *
 * Admin pushes the seeded 2-topic approved solicitation; the Lighthouse tenant
 * then sees both topics as cards (cross-persona: a second request context uses
 * the tenant storageState).
 */
import { test, expect, request as pwRequest } from '@playwright/test';

const SOL = process.env.FIX_SOL_ID || 'c3000000-0000-4000-8000-000000000001';
const T1 = process.env.FIX_T1_ID || '91000000-0000-4000-8000-000000000001';
const T2 = process.env.FIX_T2_ID || '91000000-0000-4000-8000-000000000002';

test('multi-topic push fans out a card per topic to the tenant', async ({ request, baseURL }) => {
  // Admin: push the approved 2-topic solicitation (rfp_admin tool).
  const push = await request.post('/api/tools/solicitation.push', { data: { input: { solicitationId: SOL } } });
  expect(push.status(), await push.text()).toBe(200);

  // Tenant: the topics now appear as opportunity cards via the bridge fan-out.
  const tenantCtx = await pwRequest.newContext({ baseURL, storageState: 'e2e/.auth/lighthouse.json' });
  try {
    const res = await tenantCtx.get('/api/portal/lighthouse/cards');
    expect(res.status()).toBe(200);
    const cards = (await res.json()).data.cards as Array<{ opportunityId: string }>;
    const ids = new Set(cards.map((c) => c.opportunityId));
    expect(ids.has(T1), 'topic 1 should be a tenant card').toBe(true);
    expect(ids.has(T2), 'topic 2 should be a tenant card').toBe(true);
  } finally {
    await tenantCtx.dispose();
  }
});
