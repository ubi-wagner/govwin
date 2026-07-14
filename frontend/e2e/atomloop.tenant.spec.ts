/**
 * Driven regression for the S4 atom-return loop — the closing leg of
 *   atomize → library → mold → draft → **back into the library**.
 *
 * On section lock the finalized content returns to the unified library as a
 * DERIVATIVE atom (source='download_derivative') bound to the proposal's document
 * cocoon, tagged by vol, with lineage (derived_from) back to the source atoms it
 * was drafted from (seeded on the section as meta.sourceAtomIds = [A1]).
 *
 * Asserts (API-only, self-baselining):
 *   1. locking returns a derivative atom into the tenant library (the loop closes);
 *   2. it's labeled kind=narrative + vol=technical (findable for the next mold);
 *   3. the source atom A1 gains a lineage child (the "child that can become a parent");
 *   4. unlock → re-lock is IDEMPOTENT — the same one atom is refreshed in place,
 *      never duplicated (matched on origin_section_id + source).
 *
 * Runs as the Lighthouse tenant admin against the lock fixture (see
 * scripts/e2e_fixtures.sql: section carries section_type='technical' +
 * meta.sourceAtomIds=[A1]). IDs overridable via env.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';

const SLUG = process.env.FIX_TENANT_SLUG || 'lighthouse';
const PID = process.env.FIX_PROPOSAL_ID || 'd0000000-0000-4000-8000-000000000002';
const SID = process.env.FIX_SECTION_ID || 'd0000000-0000-4000-8000-000000000003';
const A1 = 'a1a1a1a1-0000-4000-8000-000000000001'; // the seeded source atom (parent)
const SECTION_TITLE = 'Lock Fixture Section';
const base = `/api/portal/${SLUG}/proposals/${PID}`;

interface AtomRow { id: string; title: string | null; source: string; tags: string[]; childCount: number }

const save = (request: APIRequestContext, text: string) =>
  request.put(`${base}/sections/${SID}/save`, {
    data: { content: { version: 1, nodes: [{ id: 'n1', type: 'text_block', content: { text } }] }, status: 'in_progress' },
  });

async function atoms(request: APIRequestContext): Promise<AtomRow[]> {
  const res = await request.get(`/api/portal/${SLUG}/atoms?limit=500`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).data.atoms as AtomRow[];
}

// The section's returned derivative(s): source='download_derivative' + section title.
const derivativesFor = (all: AtomRow[]) =>
  all.filter((a) => a.source === 'download_derivative' && a.title === SECTION_TITLE);

test('locking returns a labeled derivative atom to the library, idempotently (S4)', async ({ request }) => {
  // Fresh start: unlocked with real drafted content to harvest.
  await request.delete(`${base}/sections/${SID}/lock`);
  const s1 = await save(request, 'Our autonomous ISR approach leverages edge inference and a resilient mesh.');
  expect(s1.status(), await s1.text()).toBe(200);

  // Lock #1 — the loop closes: a derivative atom returns to the library.
  const lock1 = await request.post(`${base}/sections/${SID}/lock`);
  expect(lock1.status(), await lock1.text()).toBe(200);
  expect((await lock1.json()).data.isLocked).toBe(true);

  const afterLock = await atoms(request);
  const derivs = derivativesFor(afterLock);
  expect(derivs.length, 'exactly one derivative atom for the section').toBe(1);

  // (2) labeled for the next mold: kind=narrative + vol=technical.
  expect(derivs[0].tags).toEqual(expect.arrayContaining(['kind:narrative', 'vol:technical']));

  // (3) lineage: the source atom A1 gained a child (derived_from A1).
  const a1 = afterLock.find((a) => a.id === A1);
  expect(a1, 'source atom A1 present in library').toBeTruthy();
  expect(a1!.childCount, 'A1 has a lineage child (the returned atom)').toBeGreaterThanOrEqual(1);

  const firstId = derivs[0].id;
  const a1Children = a1!.childCount;

  // (4) idempotency: unlock, revise, re-lock → the SAME atom is refreshed in place,
  //     not duplicated, and A1's child count doesn't inflate.
  const unlock = await request.delete(`${base}/sections/${SID}/lock`);
  expect(unlock.status(), await unlock.text()).toBe(200);
  const s2 = await save(request, 'Revised: our ISR approach adds on-orbit tasking and a secure downlink.');
  expect(s2.status(), await s2.text()).toBe(200);
  const lock2 = await request.post(`${base}/sections/${SID}/lock`);
  expect(lock2.status(), await lock2.text()).toBe(200);

  const afterRelock = await atoms(request);
  const derivs2 = derivativesFor(afterRelock);
  expect(derivs2.length, 're-lock did NOT create a second derivative').toBe(1);
  expect(derivs2[0].id, 're-lock refreshed the same atom in place').toBe(firstId);
  const a1b = afterRelock.find((a) => a.id === A1);
  expect(a1b!.childCount, 're-lock did not inflate A1 lineage').toBe(a1Children);

  // Leave the fixture unlocked for other specs.
  await request.delete(`${base}/sections/${SID}/lock`);
});
