/**
 * Assess ingest readiness — POST /api/admin/rfp-curation/[solId]/assess-ingest.
 *
 * Verifies: rfp_admin/master_admin gate (platform-scope op); the DETERMINISTIC stage snapshot computed
 * inline (mirrors rfp_ingest_manager._get_ingest_state); and the advisory trigger emission
 * finder:ingest.assessment_requested. The agent's richer LLM plan lands async — this route both fires it
 * and returns the immediate readout.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, sqlMock, emitEventStartMock, emitEventEndMock } = vi.hoisted(() => {
  const sqlMock = Object.assign(vi.fn(), { json: (v: unknown) => v });
  return {
    authMock: vi.fn(),
    sqlMock,
    emitEventStartMock: vi.fn(),
    emitEventEndMock: vi.fn(),
  };
});

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ sql: sqlMock }));
vi.mock('@/lib/events', () => ({
  emitEventStart: emitEventStartMock,
  emitEventEnd: emitEventEndMock,
  userActor: (userId: string, email?: string) => ({ type: 'user', id: userId, email }),
}));

import { POST } from '@/app/api/admin/rfp-curation/[solId]/assess-ingest/route';

const SOL_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const ADMIN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function makeSession(role: string) {
  return { user: { id: ADMIN_ID, email: 'rfp@pipeline.com', role } };
}
const ctx = () => ({ params: Promise.resolve({ solId: SOL_ID }) });
const req = () =>
  new Request(`http://localhost/api/admin/rfp-curation/${SOL_ID}/assess-ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(makeSession('rfp_admin'));
  // full_text + ai_extracted present, no compliance rows, no outline → stage 'matrixing'.
  sqlMock.mockResolvedValue([
    { hasFullText: true, hasAiExtracted: true, status: 'curation_in_progress', compCount: '0', hasOutline: false },
  ]);
  emitEventStartMock.mockResolvedValue('evt-start');
  emitEventEndMock.mockResolvedValue(undefined);
});

describe('assess ingest readiness — POST /api/admin/rfp-curation/[solId]/assess-ingest', () => {
  it('rejects a tenant_admin — platform-scope op is rfp_admin+ (403)', async () => {
    authMock.mockResolvedValue(makeSession('tenant_admin'));
    const res = await POST(req(), ctx());
    expect(res.status).toBe(403);
    expect(emitEventStartMock).not.toHaveBeenCalled();
  });

  it('404s when the solicitation does not exist', async () => {
    sqlMock.mockResolvedValue([]);
    const res = await POST(req(), ctx());
    expect(res.status).toBe(404);
    expect(emitEventStartMock).not.toHaveBeenCalled();
  });

  it('computes the deterministic snapshot + emits ingest.assessment_requested', async () => {
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.requested).toBe(true);
    expect(json.data.snapshot.stage).toBe('matrixing');
    const missingStageNames = json.data.snapshot.missingStages.map((m: { stage: string }) => m.stage);
    expect(missingStageNames).toContain('matrixing');
    expect(missingStageNames).toContain('skeletoning');

    expect(emitEventStartMock).toHaveBeenCalledTimes(1);
    const emitArg = emitEventStartMock.mock.calls[0][0];
    expect(emitArg.namespace).toBe('finder');
    expect(emitArg.type).toBe('ingest.assessment_requested');
    expect(emitArg.payload.solicitationId).toBe(SOL_ID);
    expect(emitEventEndMock).toHaveBeenCalledTimes(1);
  });

  it('master_admin can also assess (200)', async () => {
    authMock.mockResolvedValue(makeSession('master_admin'));
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    expect(emitEventStartMock).toHaveBeenCalledTimes(1);
  });
});
