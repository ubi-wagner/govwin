/**
 * Phase 1 §E.4 — ingest tools + compliance.add_variable + extract.
 *
 * Hermetic unit tests. Mocks @/lib/db, @/lib/events, fetch for
 * compliance.extract_from_text.
 */

import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';

// compliance.extract_from_text captures PIPELINE_INTERNAL_URL at
// module-import time — set it BEFORE any imports below.
process.env.PIPELINE_INTERNAL_URL ??= 'http://pipeline.internal';

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
import { complianceAddVariableTool } from '@/lib/tools/compliance-add-variable';
import { complianceExtractFromTextTool } from '@/lib/tools/compliance-extract-from-text';
import { ingestTriggerManualTool } from '@/lib/tools/ingest-trigger-manual';
import { ingestListRecentRunsTool } from '@/lib/tools/ingest-list-recent-runs';
import { ingestGetRunDetailTool } from '@/lib/tools/ingest-get-run-detail';
import { ToolAuthorizationError, ToolValidationError } from '@/lib/tools/errors';
import {
  ConflictError,
  ExternalServiceError,
  NotFoundError,
} from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import type { ToolContext } from '@/lib/tools/base';

const testLog = createLogger('tools');

function masterCtx(): ToolContext {
  return {
    actor: {
      type: 'user',
      id: '11111111-1111-4111-8111-111111111111',
      email: 'master@example.com',
      role: 'master_admin',
    },
    tenantId: null,
    requestId: 'req_test',
    log: testLog,
  };
}

function adminCtx(): ToolContext {
  return { ...masterCtx(), actor: { ...masterCtx().actor, role: 'rfp_admin' } };
}

beforeEach(() => {
  __resetForTest();
  register(complianceAddVariableTool);
  register(complianceExtractFromTextTool);
  register(ingestTriggerManualTool);
  register(ingestListRecentRunsTool);
  register(ingestGetRunDetailTool);
  sqlMock.mockReset();
  emitSingleMock.mockReset();
  emitSingleMock.mockResolvedValue(undefined);
});

// ─── compliance.add_variable (E13) ────────────────────────────────

describe('compliance.add_variable', () => {
  it('happy path inserts + returns id', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'var-uuid' }]);
    const result = await invoke('compliance.add_variable', {
      name: 'agency_special_flag',
      label: 'Agency Special Flag',
      category: 'eligibility',
      dataType: 'boolean',
    }, adminCtx()) as { id: string; name: string; isSystem: false };

    expect(result.name).toBe('agency_special_flag');
    expect(result.isSystem).toBe(false);
  });

  it('throws ConflictError on unique-name violation', async () => {
    // postgres.js unique violation code
    const err = Object.assign(new Error('dupe'), { code: '23505' });
    sqlMock.mockRejectedValueOnce(err);
    await expect(
      invoke('compliance.add_variable', {
        name: 'font_size', label: 'Font Size', category: 'format', dataType: 'text',
      }, adminCtx()),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects invalid name (not snake_case)', async () => {
    await expect(
      invoke('compliance.add_variable', {
        name: 'Bad Name!', label: 'x', category: 'format', dataType: 'text',
      }, adminCtx()),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });

  it('rejects invalid dataType', async () => {
    await expect(
      invoke('compliance.add_variable', {
        name: 'ok', label: 'x', category: 'format', dataType: 'bogus',
      }, adminCtx()),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });
});

// ─── compliance.extract_from_text (E14) ───────────────────────────
//
// The tool reads PIPELINE_INTERNAL_URL at module load, so the env var
// must be set before the import at the top of this file. We set it
// here via beforeAll, and the tool's behavior with a real 200/non-200
// response is exercised by stubbing global fetch.

describe('compliance.extract_from_text', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('happy path: returns shaped suggestions when pipeline responds 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        matches: [{
          variable_name: 'page_limit_technical', value: 15,
          source_excerpt: 'shall not exceed 15 pages',
          page: null, confidence: 1.0,
        }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    const result = await invoke('compliance.extract_from_text', {
      text: 'The Technical Volume shall not exceed 15 pages.',
    }, adminCtx()) as { suggestions: Array<{ variableName: string }> };

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].variableName).toBe('page_limit_technical');
  });

  it('surfaces non-200 responses as a typed error with code EXTERNAL_SERVICE_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 503 })));

    // Check by the stable error code + http status rather than instanceof —
    // the tool's import path and the test's import path resolve to the
    // same ExternalServiceError class only when we don't reset modules.
    let caught: unknown;
    try {
      await invoke('compliance.extract_from_text', { text: 'x' }, adminCtx());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as { code?: string })?.code).toBe('EXTERNAL_SERVICE_ERROR');
    expect((caught as { httpStatus?: number })?.httpStatus).toBe(502);
  });
});

// ─── ingest.trigger_manual (E19) ──────────────────────────────────

describe('ingest.trigger_manual', () => {
  it('happy path: master_admin can insert high-priority job', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'job-uuid' }]);
    const result = await invoke('ingest.trigger_manual', {
      source: 'sam_gov', runType: 'incremental',
    }, masterCtx()) as { jobId: string; priority: number };

    expect(result.jobId).toBe('job-uuid');
    expect(result.priority).toBe(1);
    expect(emitSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ingest.manual_triggered' }),
    );
  });

  it('rejects rfp_admin (master_admin required)', async () => {
    await expect(
      invoke('ingest.trigger_manual', { source: 'sam_gov', runType: 'full' }, adminCtx()),
    ).rejects.toBeInstanceOf(ToolAuthorizationError);
  });

  it('rejects invalid source', async () => {
    await expect(
      invoke('ingest.trigger_manual', { source: 'made_up', runType: 'incremental' }, masterCtx()),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });
});

// ─── ingest.list_recent_runs (E20) ────────────────────────────────

describe('ingest.list_recent_runs', () => {
  it('returns recent runs with computed durationMs', async () => {
    const started = new Date('2026-04-22T14:00:00Z');
    const finished = new Date('2026-04-22T14:00:02.500Z');
    sqlMock.mockResolvedValueOnce([{
      jobId: 'j1', source: 'sam_gov', status: 'completed', priority: 5,
      createdAt: started, startedAt: started, completedAt: finished,
      result: { inserted: 9, updated: 0, skipped: 0, failed: 0 },
      error: null,
    }]);

    const result = await invoke('ingest.list_recent_runs', { limit: 10 }, masterCtx()) as {
      runs: Array<{ durationMs: number | null; result: unknown }>;
    };
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].durationMs).toBe(2500);
  });

  it('returns null durationMs when the run has not completed', async () => {
    const started = new Date();
    sqlMock.mockResolvedValueOnce([{
      jobId: 'j1', source: 'sam_gov', status: 'running', priority: 5,
      createdAt: started, startedAt: started, completedAt: null,
      result: null, error: null,
    }]);
    const result = await invoke('ingest.list_recent_runs', { limit: 10 }, masterCtx()) as {
      runs: Array<{ durationMs: number | null }>;
    };
    expect(result.runs[0].durationMs).toBeNull();
  });

  it('requires master_admin', async () => {
    await expect(
      invoke('ingest.list_recent_runs', { limit: 5 }, adminCtx()),
    ).rejects.toBeInstanceOf(ToolAuthorizationError);
  });
});

// ─── ingest.get_run_detail (E21) ──────────────────────────────────

describe('ingest.get_run_detail', () => {
  const JOB_ID = '66666666-6666-4666-8666-666666666666';

  it('happy path: returns job + filtered events', async () => {
    const started = new Date('2026-04-22T14:00:00Z');
    const finished = new Date('2026-04-22T14:00:02Z');
    sqlMock
      .mockResolvedValueOnce([{
        id: JOB_ID, source: 'sam_gov', kind: 'ingest', status: 'completed',
        priority: 5, createdAt: started, startedAt: started,
        completedAt: finished, result: { inserted: 9 }, error: null,
        metadata: { run_type: 'incremental' },
      }])
      .mockResolvedValueOnce([
        {
          id: 'e1', namespace: 'finder', type: 'ingest.run.start',
          phase: 'start', actorType: 'pipeline', actorId: 'ingest:sam_gov',
          payload: { source: 'sam_gov' },
          createdAt: started,
        },
        {
          id: 'e2', namespace: 'finder', type: 'ingest.run.end',
          phase: 'end', actorType: 'pipeline', actorId: 'ingest:sam_gov',
          payload: { inserted: 9 }, createdAt: finished,
        },
      ]);

    const result = await invoke('ingest.get_run_detail', { jobId: JOB_ID }, masterCtx()) as {
      job: { id: string; status: string };
      events: Array<{ type: string }>;
    };

    expect(result.job.id).toBe(JOB_ID);
    expect(result.job.status).toBe('completed');
    expect(result.events).toHaveLength(2);
    expect(result.events.map((e) => e.type)).toEqual([
      'ingest.run.start', 'ingest.run.end',
    ]);
  });

  it('throws NotFoundError when job is missing', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await expect(
      invoke('ingest.get_run_detail', { jobId: JOB_ID }, masterCtx()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects invalid UUID', async () => {
    await expect(
      invoke('ingest.get_run_detail', { jobId: 'not-uuid' }, masterCtx()),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });
});
