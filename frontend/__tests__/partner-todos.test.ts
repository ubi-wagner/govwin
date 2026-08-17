/**
 * Partner cross-stable to-do feed (#16) — lib/partner/todos.ts.
 *
 * Proves the empty-stable short-circuit, the row→item mapping (title fallback + href), and the
 * best-effort catch (a query failure returns [] rather than breaking the console).
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ sqlBypass: sqlMock }));
vi.mock('@/lib/tasks/completers', () => ({
  taskHref: ({ entityType, entityId, tenantSlug }: any) =>
    entityType === 'proposal' && entityId ? `/portal/${tenantSlug}/proposals/${entityId}` : null,
}));

import { getPartnerStableTodos } from '@/lib/partner/todos';

beforeEach(() => sqlMock.mockReset());

describe('getPartnerStableTodos', () => {
  it('short-circuits to [] for an empty stable (no query)', async () => {
    expect(await getPartnerStableTodos([])).toEqual([]);
    expect(await getPartnerStableTodos([''])).toEqual([]);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('maps rows to items with the in-portal href (and the /todos fallback)', async () => {
    sqlMock.mockResolvedValueOnce([
      { id: 't1', title: 'Edit section: Approach', taskType: 'edit_section', companySlug: 'acme', companyName: 'Acme', entityType: 'proposal', entityId: 'p9', dueAt: '2026-08-20', params: null },
      { id: 't2', title: null, taskType: 'record_outcome', companySlug: 'acme', companyName: 'Acme', entityType: null, entityId: null, dueAt: null, params: null },
    ]);
    const out = await getPartnerStableTodos(['11111111-1111-1111-1111-111111111111']);
    expect(out).toHaveLength(2);
    expect(out[0].inPortalHref).toBe('/portal/acme/proposals/p9');
    expect(out[1].title).toBe('Untitled to-do');           // null title → fallback
    expect(out[1].inPortalHref).toBe('/portal/acme/todos'); // no entity → /todos fallback
  });

  it('never throws — a query failure resolves to []', async () => {
    sqlMock.mockRejectedValueOnce(new Error('boom'));
    expect(await getPartnerStableTodos(['11111111-1111-1111-1111-111111111111'])).toEqual([]);
  });
});
