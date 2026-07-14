/**
 * Driven regression for the section lock lifecycle (the build→lock loop):
 *   D1 — a locked section must be read-only through the SAVE API (not just the UI).
 *   D2 — lock/unlock are compare-and-swap: a double submit is an idempotent no-op.
 *
 * Runs as the Lighthouse tenant admin against a seeded proposal+section fixture
 * (see the e2e seed in the audit run). IDs overridable via env.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';

const SLUG = process.env.FIX_TENANT_SLUG || 'lighthouse';
const PID = process.env.FIX_PROPOSAL_ID || 'd0000000-0000-4000-8000-000000000002';
const SID = process.env.FIX_SECTION_ID || 'd0000000-0000-4000-8000-000000000003';
const base = `/api/portal/${SLUG}/proposals/${PID}`;

const body = (text: string) => ({
  content: { version: 1, nodes: [{ id: 'n1', type: 'text_block', content: { text } }] },
  status: 'in_progress',
});

async function save(request: APIRequestContext, text: string) {
  return request.put(`${base}/sections/${SID}/save`, { data: body(text) });
}

test('locked section rejects save (D1) and lock/unlock are idempotent (D2)', async ({ request }) => {
  // Baseline: unlocked section is editable.
  const first = await save(request, 'round 1');
  expect(first.status(), await first.text()).toBe(200);

  // Lock it.
  const lock = await request.post(`${base}/sections/${SID}/lock`);
  expect(lock.status(), await lock.text()).toBe(200);
  expect((await lock.json()).data.isLocked).toBe(true);

  // D1: save against a locked section must be rejected by the API.
  const blocked = await save(request, 'should be rejected');
  expect(blocked.status()).toBe(423);
  expect((await blocked.json()).code).toBe('SECTION_LOCKED');

  // D2: locking again is an idempotent no-op (not a re-run of side effects).
  const relock = await request.post(`${base}/sections/${SID}/lock`);
  expect(relock.status()).toBe(200);
  expect((await relock.json()).data.alreadyLocked).toBe(true);

  // Unlock, then unlocking again is idempotent.
  const unlock = await request.delete(`${base}/sections/${SID}/lock`);
  expect(unlock.status(), await unlock.text()).toBe(200);
  const reunlock = await request.delete(`${base}/sections/${SID}/lock`);
  expect(reunlock.status()).toBe(200);
  expect((await reunlock.json()).data.alreadyUnlocked).toBe(true);

  // Editable again after unlock.
  const again = await save(request, 'round 2');
  expect(again.status(), await again.text()).toBe(200);
});
