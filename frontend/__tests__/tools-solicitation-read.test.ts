/**
 * Phase 1 §E — solicitation + opportunity read tools (E1, E2, E16).
 *
 * Hermetic unit tests: mocks `@/lib/db` so no PG is required.
 * Verifies each tool:
 *   - Registers under the expected name
 *   - Validates input (rejects bad shapes via ToolValidationError)
 *   - Enforces rfp_admin role (rejects tenant_user via ToolAuthorizationError)
 *   - Happy-path passes the right args to sql
 *   - Raises NotFoundError when a target row doesn't exist
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────
// vi.mock is hoisted; references to outer variables are hazardous.
// Use vi.hoisted() to keep the mock fn reachable from test bodies.
const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));

vi.mock('@/lib/db', () => ({
  sql: sqlMock,
}));

vi.mock('@/lib/events', async () => {
  const actual = await vi.importActual<typeof import('@/lib/events')>('@/lib/events');
  return {
    ...actual,
    emitEventStart: vi.fn(async () => 'stub-event-id'),
    emitEventEnd: vi.fn(async () => undefined),
    emitEventSingle: vi.fn(async () => undefined),
  };
});

vi.mock('@/lib/capacity', () => ({
  recordInvoke: vi.fn(async () => undefined),
}));

// Import AFTER mocks are in place
import { __resetForTest, register, invoke, list } from '@/lib/tools/registry';
import { solicitationListTriageTool } from '@/lib/tools/solicitation-list-triage';
import { solicitationGetDetailTool } from '@/lib/tools/solicitation-get-detail';
import { opportunityGetByIdTool } from '@/lib/tools/opportunity-get-by-id';
import { ToolAuthorizationError, ToolValidationError } from '@/lib/tools/errors';
import { NotFoundError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import type { ToolContext } from '@/lib/tools/base';

const testLog = createLogger('tools');

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    actor: {
      type: 'user',
      id: '11111111-1111-1111-1111-111111111111',
      email: 'admin@example.com',
      role: 'rfp_admin',
    },
    tenantId: null,
    requestId: 'req_test',
    log: testLog,
    ...overrides,
  };
}

beforeEach(() => {
  __resetForTest();
  register(solicitationListTriageTool);
  register(solicitationGetDetailTool);
  register(opportunityGetByIdTool);
  sqlMock.mockReset();
});

// ─── Registration ─────────────────────────────────────────────────

describe('Phase 1 §E tool registration', () => {
  it('registers three new tools with expected names', () => {
    const names = list().map((t) => t.name);
    expect(names).toContain('solicitation.list_triage');
    expect(names).toContain('solicitation.get_detail');
    expect(names).toContain('opportunity.get_by_id');
  });

  it('all three tools declare requiredRole=rfp_admin and tenantScoped=false', () => {
    for (const tool of [solicitationListTriageTool, solicitationGetDetailTool, opportunityGetByIdTool]) {
      expect(tool.requiredRole).toBe('rfp_admin');
      expect(tool.tenantScoped).toBe(false);
    }
  });
});

// ─── solicitation.list_triage (E1) ────────────────────────────────

describe('solicitation.list_triage', () => {
  it('happy path returns items + nextCursor=null when fewer than limit+1 rows', async () => {
    sqlMock.mockResolvedValueOnce([
      {
        solicitationId: 'sol-1',
        opportunityId: 'opp-1',
        status: 'new',
        namespace: 'DOD:unknown:SBIR:Phase1',
        claimedBy: null,
        claimedAt: null,
        curatedBy: null,
        approvedBy: null,
        createdAt: new Date('2026-04-15T10:00:00Z'),
        title: 'DoD 25.1 SBIR',
        source: 'sam_gov',
        agency: 'Department of Defense',
        office: null,
        programType: 'sbir_phase_1',
        closeDate: new Date('2026-06-15T00:00:00Z'),
        postedDate: new Date('2026-04-01T00:00:00Z'),
      },
    ]);

    const result = await invoke('solicitation.list_triage',
      { limit: 25, claimedBy: 'any' },
      ctx(),
    );

    expect(result).toMatchObject({ items: expect.any(Array), nextCursor: null });
    const items = (result as { items: unknown[] }).items;
    expect(items).toHaveLength(1);
    expect((items[0] as { title: string }).title).toBe('DoD 25.1 SBIR');
  });

  it('returns a nextCursor when exactly limit+1 rows come back', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      solicitationId: `sol-${i}`,
      opportunityId: `opp-${i}`,
      status: 'new',
      namespace: null,
      claimedBy: null,
      claimedAt: null,
      curatedBy: null,
      approvedBy: null,
      createdAt: new Date(`2026-04-${15 - i}T10:00:00Z`),
      title: `Title ${i}`,
      source: 'sam_gov',
      agency: null,
      office: null,
      programType: null,
      closeDate: null,
      postedDate: null,
    }));
    sqlMock.mockResolvedValueOnce(rows);

    const result = await invoke('solicitation.list_triage',
      { limit: 2, claimedBy: 'any' },
      ctx(),
    ) as { items: unknown[]; nextCursor: string | null };

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).not.toBeNull();
  });

  it('rejects wrong-role caller with ToolAuthorizationError', async () => {
    await expect(
      invoke('solicitation.list_triage',
        { limit: 10, claimedBy: 'any' },
        ctx({ actor: { type: 'user', id: 'u', email: null, role: 'tenant_user' } }),
      ),
    ).rejects.toBeInstanceOf(ToolAuthorizationError);
  });

  it('rejects invalid input (negative limit) with ToolValidationError', async () => {
    await expect(
      invoke('solicitation.list_triage', { limit: -5, claimedBy: 'any' }, ctx()),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });

  it('default claimedBy=any when not provided', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await invoke('solicitation.list_triage', { limit: 10 }, ctx());
    expect(sqlMock).toHaveBeenCalled();
  });
});

// ─── solicitation.get_detail (E2) ─────────────────────────────────

describe('solicitation.get_detail', () => {
  const SOL_ID = '22222222-2222-4222-8222-222222222222';

  it('throws NotFoundError when the solicitation does not exist', async () => {
    sqlMock.mockResolvedValueOnce([]); // solicitation JOIN query returns empty

    await expect(
      invoke('solicitation.get_detail', { solicitationId: SOL_ID }, ctx()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('resolves all four queries on the happy path', async () => {
    sqlMock
      .mockResolvedValueOnce([{
        id: SOL_ID, opportunityId: 'opp-1', status: 'ai_analyzed',
        namespace: 'DOD:unknown:SBIR:Phase1',
        claimedBy: null, claimedAt: null, curatedBy: null, approvedBy: null,
        reviewRequestedFor: null, phaseLike: null,
        aiExtracted: { sections: [] }, aiConfidence: null,
        fullText: 'full text', annotationsInline: null,
        pushedAt: null, dismissedReason: null,
        createdAt: new Date('2026-04-15T10:00:00Z'),
        updatedAt: new Date('2026-04-15T10:00:00Z'),
        oppId: 'opp-1', source: 'sam_gov', sourceId: 'src-1',
        title: 'DoD 25.1 SBIR', agency: 'DoD', office: null,
        programType: 'sbir_phase_1', solicitationNumber: 'XXX',
        naicsCodes: ['541715'], setAsideType: null,
        closeDate: null, postedDate: null, description: 'desc',
      }])
      .mockResolvedValueOnce([]) // compliance empty
      .mockResolvedValueOnce([]) // annotations empty
      .mockResolvedValueOnce([]); // triage empty

    const result = await invoke('solicitation.get_detail',
      { solicitationId: SOL_ID },
      ctx(),
    ) as {
      solicitation: { id: string; status: string };
      opportunity: { id: string; title: string };
      compliance: null;
      annotations: unknown[];
      triageHistory: unknown[];
    };

    expect(result.solicitation.id).toBe(SOL_ID);
    expect(result.solicitation.status).toBe('ai_analyzed');
    expect(result.opportunity.title).toBe('DoD 25.1 SBIR');
    expect(result.compliance).toBeNull();
    expect(result.annotations).toEqual([]);
    expect(result.triageHistory).toEqual([]);
    expect(sqlMock).toHaveBeenCalledTimes(4);
  });

  it('rejects non-UUID solicitationId', async () => {
    await expect(
      invoke('solicitation.get_detail', { solicitationId: 'not-a-uuid' }, ctx()),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });
});

// ─── opportunity.get_by_id (E16) ──────────────────────────────────

describe('opportunity.get_by_id', () => {
  const OPP_ID = '33333333-3333-4333-8333-333333333333';

  it('returns the row on the happy path', async () => {
    sqlMock.mockResolvedValueOnce([{
      id: OPP_ID, source: 'sam_gov', sourceId: 'src-1',
      title: 'Test opportunity', agency: 'DoD', office: null,
      programType: 'sbir_phase_1', solicitationNumber: 'XXX',
      naicsCodes: ['541715'], setAsideType: null,
      classificationCode: null,
      closeDate: null, postedDate: null,
      description: 'desc', isActive: true,
      createdAt: new Date('2026-04-15T10:00:00Z'),
    }]);

    const result = await invoke('opportunity.get_by_id',
      { opportunityId: OPP_ID },
      ctx(),
    ) as { id: string; title: string; isActive: boolean };

    expect(result.id).toBe(OPP_ID);
    expect(result.title).toBe('Test opportunity');
    expect(result.isActive).toBe(true);
  });

  it('throws NotFoundError when opportunity is absent', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await expect(
      invoke('opportunity.get_by_id', { opportunityId: OPP_ID }, ctx()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects non-UUID opportunityId', async () => {
    await expect(
      invoke('opportunity.get_by_id', { opportunityId: 'not-a-uuid' }, ctx()),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });
});
