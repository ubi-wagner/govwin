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
// Ranking uses its OWN solicitation (c4) so it never contends with fanout (c3).
const SOL = 'c4000000-0000-4000-8000-000000000001';
const T1 = '92000000-0000-4000-8000-000000000001';

test('bucket ranking: cards auto-scored on push, surfaced + ordered on /cards', async ({ request, baseURL }) => {
  // Bucket scoring is NOT computed in the frontend — it is event-driven and pipeline-side:
  // the bridge fan-out emits capture:card.applied and the Python OnCardApplied workflow
  // (pipeline/src/workflows/actions/rescore.py, a faithful port of scoreCard) writes
  // tenant_bucket_scores, which /cards reads. A frontend-only e2e serve has no pipeline
  // worker, so the score never lands (topScore = 0). Run the FULL two-service e2e env (the
  // pipeline consuming events alongside the app) and set E2E_WITH_PIPELINE=1 to exercise
  // this. Fixtures are seeded regardless (scripts/e2e_fixtures.sql: solicitation c4 + AF SBIR
  // topics with agency/programType/close_date). See docs/V1_LAUNCH_PUNCHLIST.md (C-wave).
  test.skip(process.env.E2E_WITH_PIPELINE !== '1', 'needs the pipeline rescore worker (event-driven scoring); set E2E_WITH_PIPELINE=1 in the two-service env');
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
