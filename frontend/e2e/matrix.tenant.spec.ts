/**
 * Driven regression for the compliance MATRIX build:
 *   - provisioning a proposal populates proposal_compliance_matrix from the
 *     solicitation's required items (previously never populated — card % always 0);
 *   - locking a section advances its requirements to 'satisfied' (card % climbs),
 *     and unlocking resets them.
 *
 * Drives the admin-granted provision path (no Stripe) as the Lighthouse tenant
 * admin against a seeded RFP chain (solicitation + 1 volume + 2 required items +
 * topic opportunity).
 */
import { test, expect } from '@playwright/test';

const SLUG = process.env.FIX_TENANT_SLUG || 'lighthouse';
const TOPIC = process.env.FIX_TOPIC_ID || 'e0000000-0000-4000-8000-000000000001';

interface Item { id: string; requirementText: string; status: string; sectionId: string | null }

test('provision builds a real compliance matrix that advances on section lock', async ({ request }) => {
  const prov = await request.post(`/api/portal/${SLUG}/proposals/create`, { data: { topicId: TOPIC } });
  expect(prov.status(), await prov.text()).toBe(200);
  const { proposalId, sectionCount } = (await prov.json()).data as { proposalId: string; sectionCount: number };
  expect(sectionCount).toBeGreaterThanOrEqual(2);

  const base = `/api/portal/${SLUG}/proposals/${proposalId}`;

  // Matrix populated at provision — non-empty, everything not_addressed.
  const c0 = (await (await request.get(`${base}/compliance`)).json()).data as { source: string; items: Item[] };
  expect(c0.source).toBe('database');
  expect(c0.items.length).toBeGreaterThanOrEqual(2);
  expect(c0.items.every((i) => i.status === 'not_addressed')).toBe(true);
  const target = c0.items.find((i) => i.sectionId);
  expect(target?.sectionId, 'a requirement should link to a section').toBeTruthy();

  // Lock the section addressing that requirement → it becomes satisfied.
  const lock = await request.post(`${base}/sections/${target!.sectionId}/lock`);
  expect(lock.status(), await lock.text()).toBe(200);

  const c1 = (await (await request.get(`${base}/compliance`)).json()).data as { items: Item[] };
  expect(c1.items.find((i) => i.id === target!.id)?.status).toBe('satisfied');

  // Unlock resets it (mirror).
  const unlock = await request.delete(`${base}/sections/${target!.sectionId}/lock`);
  expect(unlock.status()).toBe(200);
  const c2 = (await (await request.get(`${base}/compliance`)).json()).data as { items: Item[] };
  expect(c2.items.find((i) => i.id === target!.id)?.status).toBe('not_addressed');
});
