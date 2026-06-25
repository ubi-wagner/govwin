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

beforeEach(() => {
  sqlMock.mockReset();
  emitEventSingleMock.mockReset().mockResolvedValue(undefined);
  getNodeTextMock.mockReset().mockReturnValue('This is a sufficiently long accepted content block.');
});

describe('harvestSectionToLibrary', () => {
  it('harvests a new node and emits section.harvested', async () => {
    sqlMock
      .mockImplementationOnce(() => Promise.resolve([{ id: SECTION, title: 'Technical Approach', content: canvas([node]), volumeName: 'Technical Volume' }])) // load section
      .mockImplementationOnce(() => Promise.resolve([]))  // existing-atom check → none
      .mockImplementationOnce(() => Promise.resolve([]))  // INSERT library_units
      .mockImplementationOnce(() => Promise.resolve([])); // INSERT library_harvest_log

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

  it('dedups when the atom hash already exists (usage bump, no insert)', async () => {
    sqlMock
      .mockImplementationOnce(() => Promise.resolve([{ id: SECTION, title: 'X', content: canvas([node]), volumeName: null }])) // load section
      .mockImplementationOnce(() => Promise.resolve([{ id: 'existing-atom' }])) // existing-atom check → hit
      .mockImplementationOnce(() => Promise.resolve([])); // UPDATE usage_count

    const res = await harvestSectionToLibrary(TENANT, PROPOSAL, SECTION, 'user-1');
    expect(res.atomsHarvested).toBe(0);
    expect(res.atomsSkipped).toBe(1);
  });

  it('is a no-op when the section is missing', async () => {
    sqlMock.mockImplementationOnce(() => Promise.resolve([])); // no section row
    const res = await harvestSectionToLibrary(TENANT, PROPOSAL, SECTION, 'user-1');
    expect(res).toEqual({ atomsHarvested: 0, atomsSkipped: 0 });
    expect(emitEventSingleMock).not.toHaveBeenCalled();
  });
});
