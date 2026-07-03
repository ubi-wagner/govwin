/**
 * Driven regression for Batch 2 canvas/project P0:
 *   #3 save authorization — an admin can save a section; a collaborator who is
 *      NOT assigned to it is rejected (was: any edit-collaborator could PUT any
 *      section). resolveUserAccess.editableSections is now the gate.
 *   #1 editor comments — posting a section comment and reading it back works
 *      (was: node-id vs section-id mismatch → GET empty / POST 404).
 *
 * Fixtures (seeded via SQL): proposal P + section S owned by the Lighthouse tenant;
 * the collaborator (partner_user) is NOT a collaborator on P.
 */
import { test, expect, request as pwRequest } from '@playwright/test';

const SLUG = 'lighthouse';
const PID = 'd2000000-0000-4000-8000-000000000001';
const SID = 'd2000000-0000-4000-8000-000000000002';
const base = `/api/portal/${SLUG}/proposals/${PID}`;

const saveBody = (text: string) => ({
  content: { version: 1, nodes: [{ id: 'n1', type: 'text_block', content: { text } }] },
  status: 'in_progress',
});

test('save auth (#3): admin can save; unassigned collaborator is rejected', async ({ request, baseURL }) => {
  const ok = await request.put(`${base}/sections/${SID}/save`, { data: saveBody('admin edit') });
  expect(ok.status(), await ok.text()).toBe(200);

  const collabCtx = await pwRequest.newContext({ baseURL, storageState: 'e2e/.auth/collaborator.json' });
  try {
    const denied = await collabCtx.put(`${base}/sections/${SID}/save`, { data: saveBody('collab edit') });
    expect(denied.status(), 'unassigned collaborator must be denied').toBe(403);
  } finally {
    await collabCtx.dispose();
  }
});

test('optimistic lock (#2): a save on a stale base version is rejected (409)', async ({ request }) => {
  // Learn the current version (a save without baseVersion falls back + returns the new one).
  const s0 = await request.put(`${base}/sections/${SID}/save`, { data: saveBody('sync') });
  expect(s0.status(), await s0.text()).toBe(200);
  const v = (await s0.json()).data.version as number;
  // A save on the correct base advances the version.
  const s1 = await request.put(`${base}/sections/${SID}/save`, { data: { ...saveBody('edit on base'), baseVersion: v } });
  expect(s1.status()).toBe(200);
  // A second save on the now-stale base must be rejected — the lost-update guard.
  const s2 = await request.put(`${base}/sections/${SID}/save`, { data: { ...saveBody('stale edit'), baseVersion: v } });
  expect(s2.status(), 'stale base version must 409').toBe(409);
  expect((await s2.json()).code).toBe('CONFLICT');
});

test('editor comments (#1): post a section comment and read it back', async ({ request }) => {
  const text = `review note ${Date.now() % 100000}`;
  const post = await request.post(`${base}/comments`, { data: { nodeId: SID, text } });
  expect(post.status(), await post.text()).toBeLessThan(300);

  const list = await request.get(`${base}/comments?nodeId=${SID}`);
  expect(list.status()).toBe(200);
  const bodies = ((await list.json()).data as Array<{ text: string }>).map((c) => c.text);
  expect(bodies).toContain(text);
});
