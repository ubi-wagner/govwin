/**
 * Per-section library harvest (Option 1) — harvestSectionToLibrary.
 * Verifies a new node is harvested, duplicate content is deduped (usage bump,
 * not re-inserted), a missing section is a no-op, and section.harvested fires.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sqlMock, emitEventSingleMock, getNodeTextMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  emitEventSingleMock: vi.fn(),
  getNodeTextMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ sql: sqlMock }));
vi.mock('@/lib/events', () => ({
  emitEventSingle: emitEventSingleMock,
  systemActor: (s: string) => ({ type: 'system', id: s }),
}));
vi.mock('@/lib/types/canvas-document', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/types/canvas-document')>();
  return { ...actual, getNodeText: getNodeTextMock };
});

import { harvestSectionToLibrary } from '@/lib/proposal-harvest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const PROPOSAL = '33333333-3333-4333-8333-333333333333';
const SECTION = '44444444-4444-4444-8444-444444444444';

const node = { id: 'n1', type: 'text_block', provenance: { source: 'ai' }, history: [] };
const canvas = (nodes: unknown[]) => JSON.stringify({ nodes });

// Query-aware sql mock — robust to the context/author lookups the harvest now does
// (loadHarvestContext + resolveAuthor) instead of brittle call-order counting.
let sectionRows: unknown[];
let existingRows: unknown[];

beforeEach(() => {
  sectionRows = [];
  existingRows = [];
  sqlMock.mockReset();
  // sql.json(x) — pass-through so the value flows into the tagged-template args (mirrors the real wrapper).
  (sqlMock as unknown as { json: (v: unknown) => unknown }).json = (v) => v;
  sqlMock.mockImplementation((strings: TemplateStringsArray) => {
    const q = Array.isArray(strings) ? strings.join(' ? ') : String(strings);
    if (q.includes('FROM proposal_sections')) return Promise.resolve(sectionRows);
    if (q.includes('FROM library_units') && q.includes('atom_hash')) return Promise.resolve(existingRows);
    return Promise.resolve([]);
  });
  emitEventSingleMock.mockReset().mockResolvedValue(undefined);
  getNodeTextMock.mockReset().mockReturnValue('This is a sufficiently long accepted content block.');
});

describe('harvestSectionToLibrary', () => {
  it('harvests a new node and emits section.harvested', async () => {
    sectionRows = [{ id: SECTION, title: 'Technical Approach', content: canvas([node]), volumeName: 'Technical Volume', sectionType: 'technical.innovation', standardCategory: 'technical' }];

    const res = await harvestSectionToLibrary(TENANT, PROPOSAL, SECTION, 'user-1');
    expect(res.atomsHarvested).toBe(1);
    expect(emitEventSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'library',
        type: 'section.harvested',
        tenantId: TENANT,
        payload: expect.objectContaining({ proposalId: PROPOSAL, sectionId: SECTION, atomsHarvested: 1 }),
      }),
    );
  });

  it('classifies the harvested atom with the C1 standard bucket (C2)', async () => {
    sectionRows = [{ id: SECTION, title: 'Technical Approach', content: canvas([node]), volumeName: 'Technical Volume', sectionType: 'technical.innovation', standardCategory: 'technical' }];

    await harvestSectionToLibrary(TENANT, PROPOSAL, SECTION, 'user-1');

    // Find the library_units INSERT and assert it carries subcategory + meta + the type: tag.
    const insertCall = sqlMock.mock.calls.find((c) => {
      const q = Array.isArray(c[0]) ? c[0].join('?') : String(c[0]);
      return q.includes('INSERT INTO library_units');
    });
    expect(insertCall).toBeDefined();
    const values = (insertCall as unknown[]).slice(1);
    // subcategory = the standard bucket
    expect(values).toContain('technical');
    // tags include the section_type tag
    const tagsArg = values.find((v) => Array.isArray(v)) as string[] | undefined;
    expect(tagsArg).toContain('type:technical.innovation');
    // meta carries the structured classification (now written via sql.json → an object)
    const metaArg = values.find(
      (v) => v && typeof v === 'object' && !Array.isArray(v) && 'standardCategory' in (v as Record<string, unknown>),
    ) as Record<string, unknown> | undefined;
    expect(metaArg).toBeDefined();
    expect(metaArg).toMatchObject({ sectionType: 'technical.innovation', standardCategory: 'technical' });
  });

  it('dedups when the atom hash already exists (usage bump, no insert)', async () => {
    sectionRows = [{ id: SECTION, title: 'X', content: canvas([node]), volumeName: null }];
    existingRows = [{ id: 'existing-atom' }]; // existing-atom check → hit → usage bump, no insert

    const res = await harvestSectionToLibrary(TENANT, PROPOSAL, SECTION, 'user-1');
    expect(res.atomsHarvested).toBe(0);
    expect(res.atomsSkipped).toBe(1);
  });

  it('is a no-op when the section is missing', async () => {
    sectionRows = []; // no section row (default)
    const res = await harvestSectionToLibrary(TENANT, PROPOSAL, SECTION, 'user-1');
    expect(res).toEqual({ atomsHarvested: 0, atomsSkipped: 0 });
    expect(emitEventSingleMock).not.toHaveBeenCalled();
  });
});
