/**
 * Driven regression for Batch 4 (rankings): a customer's spotlight bucket ranks
 * their pipeline. Cards are auto-scored on arrival (bridge fan-out), and /cards
 * returns each card's best bucket score and orders by it — so the "ranked by your
 * spotlight buckets" pipeline is actually ranked, not recency with a label.
 *
 * Flow: tenant creates a bucket matching AF SBIR → admin pushes the 2-topic AF
 * SBIR solicitation (fan-out auto-scores the new cards) → the topic cards show a
 * bucket score on /cards.
 */
import { test, expect, request as pwRequest } from '@playwright/test';

const SLUG = 'lighthouse';
const SOL = 'c3000000-0000-4000-8000-000000000001';
const T1 = '91000000-0000-4000-8000-000000000001';

test('bucket ranking: cards auto-scored on push, surfaced + ordered on /cards', async ({ request, baseURL }) => {
  // Tenant creates a bucket that matches AF SBIR opportunities.
  const create = await request.post(`/api/portal/${SLUG}/buckets`, {
    data: { name: 'AF SBIR', criteria: { agencies: ['Air Force'], programTypes: ['sbir'] } },
  });
  expect(create.status(), await create.text()).toBeLessThan(300);

  // Admin pushes the 2-topic AF SBIR solicitation → fan-out auto-scores the cards.
  const adminCtx = await pwRequest.newContext({ baseURL, storageState: 'e2e/.auth/admin.json' });
  try {
    const push = await adminCtx.post('/api/tools/solicitation.push', { data: { input: { solicitationId: SOL } } });
    expect(push.status(), await push.text()).toBe(200);
  } finally {
    await adminCtx.dispose();
  }

  // The tenant pipeline now carries a bucket score per topic card.
  const res = await request.get(`/api/portal/${SLUG}/cards`);
  expect(res.status()).toBe(200);
  const cards = (await res.json()).data.cards as Array<{ opportunityId: string; topScore: number | null }>;
  const t1 = cards.find((c) => c.opportunityId === T1);
  expect(t1, 'topic card present in pipeline').toBeTruthy();
  expect(t1!.topScore ?? 0, 'topic card is auto-scored > 0 by the AF SBIR bucket').toBeGreaterThan(0);
});
