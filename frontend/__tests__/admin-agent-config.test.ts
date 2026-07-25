/**
 * Admin AI-config routes:
 *   - /api/admin/tenants/[tenantId]/agent-config  (per-tenant, rfp_admin+)
 *   - /api/admin/agents/platform-config           (pipeline-wide, master_admin)
 *
 * Covers auth gating, role gating, validation, and the success path.
 * sqlMock is implementation-keyed because both PATCH handlers build dynamic
 * SET fragments via tagged templates (every `sql\`\`` call hits the mock).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, sqlMock, emitStartMock, emitEndMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  sqlMock: vi.fn(),
  emitStartMock: vi.fn(),
  emitEndMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ enterTenant: () => {}, enterBypass: () => {}, sql: sqlMock }));
vi.mock('@/lib/events', () => ({
  emitEventStart: emitStartMock,
  emitEventEnd: emitEndMock,
  userActor: (id: string, email?: string) => ({ type: 'user', id, email }),
}));

import {
  GET as tenantGET,
  PATCH as tenantPATCH,
} from '@/app/api/admin/tenants/[tenantId]/agent-config/route';
import {
  GET as platformGET,
  PATCH as platformPATCH,
} from '@/app/api/admin/agents/platform-config/route';

const TENANT = '22222222-2222-4222-8222-222222222222';
const USER = '11111111-1111-4111-8111-111111111111';

function session(role: string) {
  return { user: { id: USER, email: 'admin@example.com', role } };
}
function patchReq(body: unknown) {
  return new Request('http://t/api', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const tenantCtx = { params: Promise.resolve({ tenantId: TENANT }) };

beforeEach(() => {
  authMock.mockReset();
  sqlMock.mockReset();
  emitStartMock.mockReset().mockResolvedValue('evt-1');
  emitEndMock.mockReset().mockResolvedValue(undefined);
  // Default: any tagged-template call resolves to [] (fragment builds, etc.).
  sqlMock.mockResolvedValue([]);
});

// ─── Per-tenant route ───────────────────────────────────────────────

describe('PATCH /api/admin/tenants/[tenantId]/agent-config', () => {
  it('401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await tenantPATCH(patchReq({ monthlyBudget: 10 }), tenantCtx);
    expect(res.status).toBe(401);
  });

  it('403 for a non-admin role', async () => {
    authMock.mockResolvedValue(session('tenant_user'));
    const res = await tenantPATCH(patchReq({ monthlyBudget: 10 }), tenantCtx);
    expect(res.status).toBe(403);
  });

  it('422 for a negative budget', async () => {
    authMock.mockResolvedValue(session('rfp_admin'));
    const res = await tenantPATCH(patchReq({ monthlyBudget: -5 }), tenantCtx);
    expect(res.status).toBe(422);
  });

  it('400 when no fields are provided', async () => {
    authMock.mockResolvedValue(session('rfp_admin'));
    const res = await tenantPATCH(patchReq({}), tenantCtx);
    expect(res.status).toBe(400);
  });

  it('sets monthlyBudget=0 (disable AI) and returns it', async () => {
    authMock.mockResolvedValue(session('rfp_admin'));
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const q = Array.isArray(strings) ? strings.join('?') : String(strings);
      if (q.includes('FROM tenants')) return Promise.resolve([{ id: TENANT }]);
      if (q.includes('UPDATE tenant_agent_config')) {
        return Promise.resolve([{ monthlyBudget: '0', rateLimitPerHour: null }]);
      }
      return Promise.resolve([]);
    });
    const res = await tenantPATCH(patchReq({ monthlyBudget: 0 }), tenantCtx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.monthlyBudget).toBe(0);
    expect(emitStartMock).toHaveBeenCalled();
  });

  it('422 for a per-call ceiling of 0', async () => {
    authMock.mockResolvedValue(session('rfp_admin'));
    const res = await tenantPATCH(patchReq({ perCallCeiling: 0 }), tenantCtx);
    expect(res.status).toBe(422);
  });

  it('sets a per-call ceiling override and returns it', async () => {
    authMock.mockResolvedValue(session('rfp_admin'));
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const q = Array.isArray(strings) ? strings.join('?') : String(strings);
      if (q.includes('FROM tenants')) return Promise.resolve([{ id: TENANT }]);
      if (q.includes('UPDATE tenant_agent_config')) {
        return Promise.resolve([{ monthlyBudget: null, rateLimitPerHour: null, perCallCeiling: '0.2500' }]);
      }
      return Promise.resolve([]);
    });
    const res = await tenantPATCH(patchReq({ perCallCeiling: 0.25 }), tenantCtx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.perCallCeiling).toBe(0.25);
  });

  it('404 when the tenant does not exist', async () => {
    authMock.mockResolvedValue(session('rfp_admin'));
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const q = Array.isArray(strings) ? strings.join('?') : String(strings);
      if (q.includes('FROM tenants')) return Promise.resolve([]); // not found
      return Promise.resolve([]);
    });
    const res = await tenantPATCH(patchReq({ monthlyBudget: 25 }), tenantCtx);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/admin/tenants/[tenantId]/agent-config', () => {
  it('returns the override and the platform defaults', async () => {
    authMock.mockResolvedValue(session('rfp_admin'));
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const q = Array.isArray(strings) ? strings.join('?') : String(strings);
      if (q.includes('FROM tenant_agent_config')) {
        return Promise.resolve([{ monthlyBudget: '120.00', rateLimitPerHour: 10 }]);
      }
      if (q.includes('FROM platform_agent_config')) {
        return Promise.resolve([{ defaultMonthlyBudget: '50.00', defaultRateLimitPerHour: 50 }]);
      }
      return Promise.resolve([]);
    });
    const res = await tenantGET(new Request('http://t/api'), tenantCtx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.monthlyBudget).toBe(120);
    expect(json.data.rateLimitPerHour).toBe(10);
    expect(json.data.platformDefaults.monthlyBudget).toBe(50);
  });
});

// ─── Platform route ─────────────────────────────────────────────────

describe('PATCH /api/admin/agents/platform-config', () => {
  it('403 for rfp_admin (master_admin required)', async () => {
    authMock.mockResolvedValue(session('rfp_admin'));
    const res = await platformPATCH(patchReq({ aiEnabled: false }));
    expect(res.status).toBe(403);
  });

  it('422 for a rate limit below 1', async () => {
    authMock.mockResolvedValue(session('master_admin'));
    const res = await platformPATCH(patchReq({ defaultRateLimitPerHour: 0 }));
    expect(res.status).toBe(422);
  });

  it('toggles aiEnabled off and updates a default', async () => {
    authMock.mockResolvedValue(session('master_admin'));
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const q = Array.isArray(strings) ? strings.join('?') : String(strings);
      if (q.includes('UPDATE platform_agent_config')) {
        return Promise.resolve([
          { defaultMonthlyBudget: '80.00', defaultRateLimitPerHour: 50, platformMonthlyCap: null, aiEnabled: false },
        ]);
      }
      return Promise.resolve([]);
    });
    const res = await platformPATCH(patchReq({ defaultMonthlyBudget: 80, aiEnabled: false }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.aiEnabled).toBe(false);
    expect(json.data.defaultMonthlyBudget).toBe(80);
  });

  it('422 for a default per-call ceiling of 0', async () => {
    authMock.mockResolvedValue(session('master_admin'));
    const res = await platformPATCH(patchReq({ defaultPerCallCeiling: 0 }));
    expect(res.status).toBe(422);
  });

  it('sets the default per-call ceiling and serializes it', async () => {
    authMock.mockResolvedValue(session('master_admin'));
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const q = Array.isArray(strings) ? strings.join('?') : String(strings);
      if (q.includes('UPDATE platform_agent_config')) {
        return Promise.resolve([
          { defaultMonthlyBudget: '50.00', defaultRateLimitPerHour: 50, defaultPerCallCeiling: '0.1000', platformMonthlyCap: null, aiEnabled: true },
        ]);
      }
      return Promise.resolve([]);
    });
    const res = await platformPATCH(patchReq({ defaultPerCallCeiling: 0.1 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.defaultPerCallCeiling).toBe(0.1);
  });

  it('accepts a platform cap and serializes it', async () => {
    authMock.mockResolvedValue(session('master_admin'));
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const q = Array.isArray(strings) ? strings.join('?') : String(strings);
      if (q.includes('UPDATE platform_agent_config')) {
        return Promise.resolve([
          { defaultMonthlyBudget: '50.00', defaultRateLimitPerHour: 50, platformMonthlyCap: '1500.00', aiEnabled: true },
        ]);
      }
      return Promise.resolve([]);
    });
    const res = await platformPATCH(patchReq({ platformMonthlyCap: 1500 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.platformMonthlyCap).toBe(1500);
  });
});

describe('GET /api/admin/agents/platform-config', () => {
  it('401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await platformGET();
    expect(res.status).toBe(401);
  });

  it('returns serialized config for master_admin', async () => {
    authMock.mockResolvedValue(session('master_admin'));
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const q = Array.isArray(strings) ? strings.join('?') : String(strings);
      if (q.includes('FROM platform_agent_config')) {
        return Promise.resolve([
          { defaultMonthlyBudget: '50.00', defaultRateLimitPerHour: 50, platformMonthlyCap: null, aiEnabled: true },
        ]);
      }
      return Promise.resolve([]);
    });
    const res = await platformGET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.defaultMonthlyBudget).toBe(50);
    expect(json.data.aiEnabled).toBe(true);
  });
});
