/**
 * Phase 1 §E.3 — compliance + annotation tools (E10, E11, E12, E15).
 *
 * Covers:
 *   - compliance.list_variables (E12): read catalog, optional category filter
 *   - compliance.save_variable_value (E15): THE HITL write site —
 *     named-column UPSERT, custom-variable path, action inference,
 *     memory write gated by namespace, type coercion
 *   - solicitation.save_annotation (E10): INSERT + event
 *   - solicitation.delete_annotation (E11): scoped DELETE
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

import { __resetForTest, register, invoke } from '@/lib/tools/registry';
import { complianceListVariablesTool } from '@/lib/tools/compliance-list-variables';
import { complianceSaveVariableValueTool } from '@/lib/tools/compliance-save-variable-value';
import { solicitationSaveAnnotationTool } from '@/lib/tools/solicitation-save-annotation';
import { solicitationDeleteAnnotationTool } from '@/lib/tools/solicitation-delete-annotation';
import { ToolValidationError } from '@/lib/tools/errors';
import { NotFoundError, ValidationError } from '@/lib/errors';
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
const ANNO_ID = '55555555-5555-4555-8555-555555555555';
const NAMESPACE = 'DOD:unknown:SBIR:Phase1';

beforeEach(() => {
  __resetForTest();
  register(complianceListVariablesTool);
  register(complianceSaveVariableValueTool);
  register(solicitationSaveAnnotationTool);
  register(solicitationDeleteAnnotationTool);
  sqlMock.mockReset();
  emitSingleMock.mockReset();
  emitSingleMock.mockResolvedValue(undefined);
});

// ─── compliance.list_variables (E12) ──────────────────────────────

describe('compliance.list_variables', () => {
  it('returns variables from the catalog', async () => {
    sqlMock.mockResolvedValueOnce([
      { id: 'v1', name: 'page_limit_technical', label: 'Page Limit (Technical)',
        category: 'format', dataType: 'number', options: null, isSystem: true },
      { id: 'v2', name: 'font_size', label: 'Font Size',
        category: 'format', dataType: 'text', options: null, isSystem: true },
    ]);

    const result = await invoke('compliance.list_variables', {}, ctx()) as {
      variables: Array<{ name: string }>;
    };

    expect(result.variables).toHaveLength(2);
    expect(result.variables[0].name).toBe('page_limit_technical');
  });

  it('filters by category when provided', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await invoke('compliance.list_variables', { category: 'format' }, ctx());
    expect(sqlMock).toHaveBeenCalled();
  });
});

// ─── compliance.save_variable_value (E15) — the marquee HITL site ─

describe('compliance.save_variable_value', () => {
  it('INSERT path (no prior row): action=manual_entry + writes memory', async () => {
    sqlMock
      .mockResolvedValueOnce([{ namespace: NAMESPACE, compId: null, priorJson: null }])
      .mockResolvedValueOnce([{ verifiedAt: new Date('2026-04-22T15:00:00Z') }]) // INSERT
      .mockResolvedValueOnce(undefined); // memory INSERT

    const result = await invoke('compliance.save_variable_value', {
      solicitationId: SOL_ID,
      variableName: 'page_limit_technical',
      value: 15,
      sourceExcerpt: 'Technical Volume shall not exceed 15 pages.',
    }, ctx()) as {
      storedAs: string; action: string; memoryWritten: boolean;
    };

    expect(result.storedAs).toBe('custom_variables');
    expect(result.action).toBe('manual_entry');
    expect(result.memoryWritten).toBe(true);
  });

  it('UPDATE path: action=verify when value matches prior', async () => {
    sqlMock
      .mockResolvedValueOnce([{
        namespace: NAMESPACE, compId: 'comp-1',
        priorJson: { value: 15, source_excerpt: 'prior', notes: null },
      }])
      .mockResolvedValueOnce([{ verifiedAt: new Date() }])
      .mockResolvedValueOnce(undefined);

    const result = await invoke('compliance.save_variable_value', {
      solicitationId: SOL_ID,
      variableName: 'page_limit_technical',
      value: 15,
    }, ctx()) as { action: string };

    expect(result.action).toBe('verify');
  });

  it('UPDATE path: action=correct when value differs from prior', async () => {
    sqlMock
      .mockResolvedValueOnce([{
        namespace: NAMESPACE, compId: 'comp-1',
        priorJson: { value: 15 },
      }])
      .mockResolvedValueOnce([{ verifiedAt: new Date() }])
      .mockResolvedValueOnce(undefined);

    const result = await invoke('compliance.save_variable_value', {
      solicitationId: SOL_ID,
      variableName: 'page_limit_technical',
      value: 20,
    }, ctx()) as { action: string };

    expect(result.action).toBe('correct');
  });

  it('accepts unknown variable names (freeform)', async () => {
    sqlMock
      .mockResolvedValueOnce([{ namespace: NAMESPACE, compId: null, priorJson: null }])
      .mockResolvedValueOnce([{ verifiedAt: new Date() }])
      .mockResolvedValueOnce(undefined);

    const result = await invoke('compliance.save_variable_value', {
      solicitationId: SOL_ID,
      variableName: 'some_custom_agency_flag',
      value: 'yes',
    }, ctx()) as { storedAs: string };

    expect(result.storedAs).toBe('custom_variables');
  });

  it('skips memory write when namespace is null', async () => {
    sqlMock
      .mockResolvedValueOnce([{ namespace: null, compId: null, priorJson: null }])
      .mockResolvedValueOnce([{ verifiedAt: new Date() }]);

    const result = await invoke('compliance.save_variable_value', {
      solicitationId: SOL_ID,
      variableName: 'font_size',
      value: '11',
    }, ctx()) as { memoryWritten: boolean };

    expect(result.memoryWritten).toBe(false);
  });

  it('throws ValidationError on bad type coercion (non-int to known int variable)', async () => {
    await expect(
      invoke('compliance.save_variable_value', {
        solicitationId: SOL_ID,
        variableName: 'page_limit_technical',
        value: 'fifteen',
      }, ctx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when solicitation missing', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await expect(
      invoke('compliance.save_variable_value', {
        solicitationId: SOL_ID,
        variableName: 'font_size',
        value: '11',
      }, ctx()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('explicit action override wins over inferred', async () => {
    sqlMock
      .mockResolvedValueOnce([{
        namespace: NAMESPACE, compId: 'comp-1',
        priorJson: { value: 15 },
      }])
      .mockResolvedValueOnce([{ verifiedAt: new Date() }])
      .mockResolvedValueOnce(undefined);

    const result = await invoke('compliance.save_variable_value', {
      solicitationId: SOL_ID,
      variableName: 'page_limit_technical',
      value: 15,
      action: 'correct',
    }, ctx()) as { action: string };

    expect(result.action).toBe('correct');
  });
});

// ─── solicitation.save_annotation (E10) ───────────────────────────

describe('solicitation.save_annotation', () => {
  it('happy path: inserts + emits event', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: SOL_ID }])  // exists check
      .mockResolvedValueOnce([{ id: ANNO_ID, createdAt: new Date() }]);  // INSERT RETURNING

    const result = await invoke('solicitation.save_annotation', {
      solicitationId: SOL_ID,
      kind: 'highlight',
      sourceLocation: { page: 7, offset: 120, length: 50 },
      payload: { color: 'yellow' },
      complianceVariableName: 'page_limit_technical',
    }, ctx()) as { id: string; kind: string };

    expect(result.id).toBe(ANNO_ID);
    expect(result.kind).toBe('highlight');
    expect(emitSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'rfp.annotation_saved' }),
    );
  });

  it('throws NotFoundError on missing solicitation', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await expect(
      invoke('solicitation.save_annotation', {
        solicitationId: SOL_ID,
        kind: 'highlight',
        sourceLocation: { page: 1, offset: 0, length: 10 },
      }, ctx()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects invalid kind', async () => {
    await expect(
      invoke('solicitation.save_annotation', {
        solicitationId: SOL_ID,
        kind: 'scribble',
        sourceLocation: { page: 1, offset: 0, length: 10 },
      }, ctx()),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });
});

// ─── solicitation.delete_annotation (E11) ─────────────────────────

describe('solicitation.delete_annotation', () => {
  it('happy path: deletes + returns', async () => {
    sqlMock.mockResolvedValueOnce([{ id: ANNO_ID }]);

    const result = await invoke('solicitation.delete_annotation', {
      annotationId: ANNO_ID,
      solicitationId: SOL_ID,
    }, ctx()) as { deleted: true };

    expect(result.deleted).toBe(true);
  });

  it('throws NotFoundError when annotation is absent or belongs to a different solicitation', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await expect(
      invoke('solicitation.delete_annotation', {
        annotationId: ANNO_ID,
        solicitationId: SOL_ID,
      }, ctx()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
