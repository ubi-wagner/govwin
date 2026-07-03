/**
 * Driven regression for the WHOLE greenfield atom loop, end to end, in one flow:
 *
 *   upload → library → mold → draft → **atoms back in the library**
 *
 *   1. UPLOAD a document (atoms/upload) → registers a `reference` atom in the
 *      unified library + returns the deconstructed blocks (the atomizer surface).
 *   2. REGISTER a `primitive` atom from that content (POST /atoms), tagged by vol,
 *      anchored (source_anchor) back to the uploaded reference.
 *   3. MOLD: the scored selector (/atoms/select) ranks that primitive for a
 *      technical section AND records it as the section's source atom.
 *   4. DRAFT + LOCK the section → the S4 return sends the finalized content back
 *      to the library as a DERIVATIVE atom with lineage (derived_from) to the
 *      uploaded primitive — the "child that can become a parent."
 *
 * This proves every leg is on the SAME (greenfield `library_atoms`) surface and
 * that the loop actually closes. Runs as the Lighthouse tenant admin against a
 * dedicated fixture proposal/section (scripts/e2e_fixtures.sql: Fullloop Section).
 */
import { test, expect } from '@playwright/test';

const SLUG = 'lighthouse';
const PID = 'd3000000-0000-4000-8000-000000000001';
const SID = 'd3000000-0000-4000-8000-000000000002';
const SECTION_TITLE = 'Fullloop Section';
const base = `/api/portal/${SLUG}/proposals/${PID}`;

interface AtomRow { id: string; title: string | null; source: string; grain: string; tags: string[]; childCount: number }

test('full greenfield loop: upload → primitive → mold → lock → return with lineage', async ({ request }) => {
  // ── 1. Upload → reference atom + deconstructed blocks ──────────────────────
  const md =
    '# Technical Approach\n\n' +
    'Our autonomous ISR pipeline fuses edge inference with a resilient mesh network ' +
    'so tasking survives contested, comms-degraded environments.\n';
  const up = await request.post(`/api/portal/${SLUG}/atoms/upload`, {
    multipart: { file: { name: 'approach.md', mimeType: 'text/markdown', buffer: Buffer.from(md) } },
  });
  expect(up.status(), await up.text()).toBe(200);
  const upData = (await up.json()).data as { referenceAtomId: string | null; blocks: Array<{ text: string }> };
  expect(upData.referenceAtomId, 'upload registered a reference atom').toBeTruthy();
  expect(upData.blocks.length, 'upload deconstructed the doc into blocks').toBeGreaterThan(0);
  const refId = upData.referenceAtomId!;
  const uploadedText = upData.blocks.map((b) => b.text).join('\n\n').trim();

  // ── 2. Register a primitive from the uploaded content (vol=technical) ───────
  const mk = await request.post(`/api/portal/${SLUG}/atoms`, {
    data: {
      grain: 'primitive',
      title: 'Uploaded Technical Approach',
      content: uploadedText || md,
      source: 'upload',
      status: 'approved',
      tags: [
        { dimension: 'vol', value: 'technical' },
        { dimension: 'kind', value: 'narrative' },
      ],
      sourceAnchor: [{ sourceAtomId: refId }], // provenance: cut from the uploaded doc
    },
  });
  expect(mk.status(), await mk.text()).toBe(200);
  const primitiveId = (await mk.json()).data.atomId as string;

  // ── 3. Mold: the selector ranks the primitive AND records it as the section's
  //        source atom (meta.sourceAtomIds) so the return can set lineage. ─────
  const sel = await request.get(`/api/portal/${SLUG}/atoms/select?vol=technical&sectionId=${SID}`);
  expect(sel.status(), await sel.text()).toBe(200);
  const ranked = (await sel.json()).data.atoms as Array<{ id: string }>;
  expect(ranked.some((a) => a.id === primitiveId), 'mold selector ranks the uploaded primitive').toBe(true);

  // ── 4. Draft + lock → S4 return closes the loop ────────────────────────────
  await request.delete(`${base}/sections/${SID}/lock`); // ensure unlocked
  const save = await request.put(`${base}/sections/${SID}/save`, {
    data: { content: { version: 1, nodes: [{ id: 'n1', type: 'text_block', content: { text: `Final: ${uploadedText || md}` } }] }, status: 'in_progress' },
  });
  expect(save.status(), await save.text()).toBe(200);
  const lock = await request.post(`${base}/sections/${SID}/lock`);
  expect(lock.status(), await lock.text()).toBe(200);
  expect((await lock.json()).data.isLocked).toBe(true);

  // ── 5. The loop closed: a derivative atom is back in the library, with lineage
  //        derived_from the uploaded primitive. ────────────────────────────────
  const listRes = await request.get(`/api/portal/${SLUG}/atoms?limit=500`);
  expect(listRes.status(), await listRes.text()).toBe(200);
  const all = (await listRes.json()).data.atoms as AtomRow[];

  const derivatives = all.filter((a) => a.source === 'download_derivative' && a.title === SECTION_TITLE);
  expect(derivatives.length, 'a derivative atom returned to the library').toBe(1);
  expect(derivatives[0].tags, 'returned atom is labeled for the next mold').toEqual(
    expect.arrayContaining(['kind:narrative', 'vol:technical']),
  );

  const primitive = all.find((a) => a.id === primitiveId);
  expect(primitive, 'the uploaded primitive is in the library').toBeTruthy();
  expect(primitive!.childCount, 'the uploaded primitive gained a lineage child (the returned atom)').toBeGreaterThanOrEqual(1);

  // Leave the fixture unlocked for re-runs.
  await request.delete(`${base}/sections/${SID}/lock`);
});
