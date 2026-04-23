/**
 * Phase 1 §E extension: volumes + required items tools.
 *
 * Hermetic unit tests. Verifies registration, role enforcement, input
 * validation, happy paths, and conflict / not-found errors.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));
const { emitSingleMock } = vi.hoisted(() => ({ emitSingleMock: vi.fn() }));

vi.mock('@/lib/db', () => ({ sql: sqlMock }));
vi.mock('@/lib/events', async () => {
  const actual = await vi.importActual<typeof import('@/lib/events')>('@/lib/events');
  return {
    ...actual,
    emitEventStart: vi.fn(async () => 'stub-event-id'),
    emitEventEnd: vi.fn(async () => undefined),
    emitEventSingle: emitSingleMock,
  };
});
vi.mock('@/lib/capacity', () => ({
  recordInvoke: vi.fn(async () => undefined),
}));

import { __resetForTest, register, invoke, list } from '@/lib/tools/registry';
import { volumeAddTool } from '@/lib/tools/volume-add';
import { volumeDeleteTool } from '@/lib/tools/volume-delete';
import { volumeAddRequiredItemTool } from '@/lib/tools/volume-add-required-item';
import { volumeUpdateRequiredItemTool } from '@/lib/tools/volume-update-required-item';
import { volumeDeleteRequiredItemTool } from '@/lib/tools/volume-delete-required-item';
import { ToolAuthorizationError, ToolValidationError } from '@/lib/tools/errors';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import type { ToolContext } from '@/lib/tools/base';

const testLog = createLogger('tools');

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    actor: {
      type: 'user',
      id: '11111111-1111-4111-8111-111111111111',
      email: 'admin@example.com',
      role: 'rfp_admin',
    },
    tenantId: null,
    requestId: 'req_test',
    log: testLog,
    ...overrides,
  };
}

const SOL_ID = '22222222-2222-4222-8222-222222222222';
const VOL_ID = '33333333-3333-4333-8333-333333333333';
const ITEM_ID = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  __resetForTest();
  register(volumeAddTool);
  register(volumeDeleteTool);
  register(volumeAddRequiredItemTool);
  register(volumeUpdateRequiredItemTool);
  register(volumeDeleteRequiredItemTool);
  sqlMock.mockReset();
  emitSingleMock.mockReset();
  emitSingleMock.mockResolvedValue(undefined);
});

describe('volume tools registration', () => {
  it('registers 5 tools', () => {
    const names = list().map((t) => t.name);
    expect(names).toContain('volume.add');
    expect(names).toContain('volume.delete');
    expect(names).toContain('volume.add_required_item');
    expect(names).toContain('volume.update_required_item');
    expect(names).toContain('volume.delete_required_item');
  });
});

describe('volume.add', () => {
  it('happy path inserts + emits event', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: SOL_ID }]) // exists check
      .mockResolvedValueOnce([{ id: VOL_ID }]); // INSERT RETURNING

    const result = await invoke('volume.add', {
      solicitationId: SOL_ID,
      volumeNumber: 2,
      volumeName: 'Technical Volume',
    }, ctx()) as { volumeId: string };

    expect(result.volumeId).toBe(VOL_ID);
    expect(emitSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'volume.added' }),
    );
  });

  it('throws ConflictError on duplicate volume_number', async () => {
    const err = Object.assign(new Error('dupe'), { code: '23505' });
    sqlMock
      .mockResolvedValueOnce([{ id: SOL_ID }])
      .mockRejectedValueOnce(err);
    await expect(
      invoke('volume.add', {
        solicitationId: SOL_ID,
        volumeNumber: 1,
        volumeName: 'Cover',
      }, ctx()),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws NotFoundError when solicitation missing', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await expect(
      invoke('volume.add', {
        solicitationId: SOL_ID,
        volumeNumber: 1,
        volumeName: 'x',
      }, ctx()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects non-rfp_admin', async () => {
    await expect(
      invoke('volume.add', {
        solicitationId: SOL_ID, volumeNumber: 1, volumeName: 'x',
      }, ctx({ actor: { type: 'user', id: 'u', email: null, role: 'tenant_user' } })),
    ).rejects.toBeInstanceOf(ToolAuthorizationError);
  });

  it('rejects invalid volumeNumber', async () => {
    await expect(
      invoke('volume.add', { solicitationId: SOL_ID, volumeNumber: 0, volumeName: 'x' }, ctx()),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });
});

describe('volume.delete', () => {
  it('happy path', async () => {
    sqlMock.mockResolvedValueOnce([{ id: VOL_ID, solicitationId: SOL_ID, volumeNumber: 2 }]);
    const result = await invoke('volume.delete', { volumeId: VOL_ID }, ctx()) as { deleted: true };
    expect(result.deleted).toBe(true);
    expect(emitSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'volume.deleted' }),
    );
  });

  it('throws NotFoundError when volume missing', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await expect(
      invoke('volume.delete', { volumeId: VOL_ID }, ctx()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('volume.add_required_item', () => {
  it('happy path', async () => {
    sqlMock
      .mockResolvedValueOnce([{ solicitationId: SOL_ID }]) // vol lookup
      .mockResolvedValueOnce([{ id: ITEM_ID }]); // INSERT

    const result = await invoke('volume.add_required_item', {
      volumeId: VOL_ID,
      itemNumber: 1,
      itemName: 'Technical Approach',
      pageLimit: 15,
      fontFamily: 'Times New Roman',
      fontSize: '10',
    }, ctx()) as { itemId: string };

    expect(result.itemId).toBe(ITEM_ID);
    expect(emitSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'required_item.added' }),
    );
  });

  it('throws ConflictError on duplicate item number', async () => {
    const err = Object.assign(new Error('dupe'), { code: '23505' });
    sqlMock
      .mockResolvedValueOnce([{ solicitationId: SOL_ID }])
      .mockRejectedValueOnce(err);
    await expect(
      invoke('volume.add_required_item', {
        volumeId: VOL_ID, itemNumber: 1, itemName: 'X',
      }, ctx()),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws NotFoundError when volume missing', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await expect(
      invoke('volume.add_required_item', {
        volumeId: VOL_ID, itemNumber: 1, itemName: 'X',
      }, ctx()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects invalid itemType', async () => {
    await expect(
      invoke('volume.add_required_item', {
        volumeId: VOL_ID, itemNumber: 1, itemName: 'X', itemType: 'bogus',
      }, ctx()),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });
});

describe('volume.update_required_item', () => {
  it('happy path updates + emits event', async () => {
    sqlMock.mockResolvedValueOnce([{ id: ITEM_ID, volumeId: VOL_ID }]);
    const result = await invoke('volume.update_required_item', {
      itemId: ITEM_ID,
      pageLimit: 20,
      fontFamily: 'Arial',
    }, ctx()) as { updated: true };
    expect(result.updated).toBe(true);
    expect(emitSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'required_item.updated' }),
    );
  });

  it('throws NotFoundError on missing item', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await expect(
      invoke('volume.update_required_item', { itemId: ITEM_ID, pageLimit: 5 }, ctx()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('volume.delete_required_item', () => {
  it('happy path', async () => {
    sqlMock.mockResolvedValueOnce([{ id: ITEM_ID, volumeId: VOL_ID }]);
    const result = await invoke('volume.delete_required_item', { itemId: ITEM_ID }, ctx()) as { deleted: true };
    expect(result.deleted).toBe(true);
    expect(emitSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'required_item.deleted' }),
    );
  });

  it('throws NotFoundError on missing item', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await expect(
      invoke('volume.delete_required_item', { itemId: ITEM_ID }, ctx()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
