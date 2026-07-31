/**
 * ingest-topic-files — unit tests for the "N topic files → N topic
 * opportunities" ingest. Hermetic: sql + events mocked, storage injected.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({
  sqlMock: Object.assign(vi.fn(), { json: (v: unknown) => v }),
}));
const { emitSingleMock } = vi.hoisted(() => ({ emitSingleMock: vi.fn() }));

vi.mock('@/lib/db', () => ({ enterTenant: () => {}, enterBypass: () => {}, sql: sqlMock }));
vi.mock('@/lib/events', () => ({ emitEventSingle: emitSingleMock }));
vi.mock('@/lib/storage/s3-client', () => ({ putObject: vi.fn(async () => undefined) }));

import {
  ingestTopicFilesForSolicitation,
  SolicitationNotFoundError,
  type TopicFileInput,
} from '@/lib/ingest/ingest-topic-files';

const SOL = '22222222-2222-4222-8222-222222222222';
const LANDING = '33333333-3333-4333-8333-333333333333';

function txt(name: string, body: string): TopicFileInput {
  return { name, type: 'text/plain', size: body.length, buffer: Buffer.from(body, 'utf8') };
}

const solLookupRow = {
  id: SOL,
  opportunityId: LANDING,
  inheritSource: 'manual_upload',
  inheritAgency: 'DoD',
  inheritOffice: null,
  inheritProgramType: 'sbir_phase_1',
};

beforeEach(() => {
  sqlMock.mockReset();
  emitSingleMock.mockReset();
  emitSingleMock.mockResolvedValue(undefined);
});

describe('ingestTopicFilesForSolicitation', () => {
  it('creates one topic opportunity per file', async () => {
    sqlMock
      .mockResolvedValueOnce([solLookupRow]) // sol lookup
      // file A: dupe check, existing-topic check, doc insert, opp insert
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'docA' }])
      .mockResolvedValueOnce([{ id: 'oppA' }])
      // file B
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'docB' }])
      .mockResolvedValueOnce([{ id: 'oppB' }])
      // multi_topic flip
      .mockResolvedValueOnce([]);

    const res = await ingestTopicFilesForSolicitation({
      solicitationId: SOL,
      files: [
        txt('AF251-001.txt', 'Topic AF251-001: autonomous ISR payload feasibility study.'),
        txt('AF251-002.txt', 'Topic AF251-002: low-SWaP sensor fusion prototype design.'),
      ],
      userId: null,
    });

    expect(res.created).toHaveLength(2);
    expect(res.skipped).toHaveLength(0);
    expect(res.failed).toHaveLength(0);
    expect(res.created[0]).toMatchObject({ opportunityId: 'oppA', documentId: 'docA', topicNumber: 'AF251-001', textExtracted: true });
    expect(res.created[1].topicNumber).toBe('AF251-002');
    // batch topic.imported event emitted once with the two opp ids
    expect(emitSingleMock).toHaveBeenCalledTimes(1);
    expect(emitSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'topic.imported', payload: expect.objectContaining({ topicCount: 2 }) }),
    );
  });

  it('skips a file whose content_hash already exists (global dedup)', async () => {
    sqlMock
      .mockResolvedValueOnce([solLookupRow]) // sol lookup
      .mockResolvedValueOnce([{ id: 'existing-doc' }]); // dupe check hits

    const res = await ingestTopicFilesForSolicitation({
      solicitationId: SOL,
      files: [txt('AF251-001.txt', 'dupe body')],
      userId: null,
    });

    expect(res.created).toHaveLength(0);
    expect(res.skipped).toEqual([{ filename: 'AF251-001.txt', reason: 'duplicate_file' }]);
    // no opportunity created ⇒ no multi_topic flip, no event
    expect(emitSingleMock).not.toHaveBeenCalled();
  });

  it('skips a second file that resolves to the same topic number (within-batch)', async () => {
    sqlMock
      .mockResolvedValueOnce([solLookupRow]) // sol lookup
      // file A creates
      .mockResolvedValueOnce([]) // dupe
      .mockResolvedValueOnce([]) // existing topic
      .mockResolvedValueOnce([{ id: 'docA' }]) // doc insert
      .mockResolvedValueOnce([{ id: 'oppA' }]) // opp insert
      // file B: different content (passes file dedup) but same topic number
      .mockResolvedValueOnce([]) // dupe
      .mockResolvedValueOnce([]) // (not reached — claimed set short-circuits) but safe
      .mockResolvedValueOnce([]); // multi_topic flip

    const res = await ingestTopicFilesForSolicitation({
      solicitationId: SOL,
      files: [
        txt('AF251-001.txt', 'first body for AF251-001'),
        txt('AF251-001-copy.txt', 'DIFFERENT body but filename maps to AF251-001'),
      ],
      userId: null,
    });

    expect(res.created).toHaveLength(1);
    expect(res.skipped).toEqual([{ filename: 'AF251-001-copy.txt', reason: 'duplicate_topic' }]);
  });

  it('throws SolicitationNotFoundError when the umbrella is missing', async () => {
    sqlMock.mockResolvedValueOnce([]); // sol lookup empty
    await expect(
      ingestTopicFilesForSolicitation({ solicitationId: SOL, files: [txt('t.txt', 'x')], userId: null }),
    ).rejects.toBeInstanceOf(SolicitationNotFoundError);
  });

  it('records a per-file failure without aborting the batch', async () => {
    sqlMock
      .mockResolvedValueOnce([solLookupRow]) // sol lookup
      // file A: dupe check throws
      .mockRejectedValueOnce(new Error('db blip'))
      // file B: succeeds
      .mockResolvedValueOnce([]) // dupe
      .mockResolvedValueOnce([]) // existing
      .mockResolvedValueOnce([{ id: 'docB' }]) // doc
      .mockResolvedValueOnce([{ id: 'oppB' }]) // opp
      .mockResolvedValueOnce([]); // multi_topic flip

    const res = await ingestTopicFilesForSolicitation({
      solicitationId: SOL,
      files: [txt('AF251-001.txt', 'a'), txt('AF251-002.txt', 'b')],
      userId: null,
    });

    expect(res.created).toHaveLength(1);
    expect(res.created[0].topicNumber).toBe('AF251-002');
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0].filename).toBe('AF251-001.txt');
  });
});
