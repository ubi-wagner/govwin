/**
 * TEST-15 — POST /api/invite route handler
 *
 * Regression guard for FE-02/FE-06 fixes.
 * Key assertions:
 *   (a) Valid token → password set + collaborator accepted inside one transaction
 *   (b) Event type is EXACTLY 'invite.accepted' (NOT 'identity.invite_accepted')
 *   (c) Event namespace is 'identity'
 *   (d) Invalid/missing token → 404 or 400
 *   (e) Already-accepted invite → 409
 *   (f) Short password → 400 validation
 *   (g) Transaction failure → 500, no event emitted
 *
 * Mocked: @/lib/db (sql + sql.begin), @/lib/events (emitEventSingle, systemActor),
 *         bcryptjs
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mock factories ────────────────────────────────────────────────
const { sqlMock, sqlBeginMock, emitEventSingleMock, bcryptHashMock } = vi.hoisted(() => {
  const sqlBeginMock = vi.fn();
  const sqlMock = Object.assign(vi.fn(), { begin: sqlBeginMock });
  return {
    sqlMock,
    sqlBeginMock,
    emitEventSingleMock: vi.fn(),
    bcryptHashMock: vi.fn(),
  };
});

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('@/lib/db', () => ({ enterTenant: () => {}, enterBypass: () => {},
  sql: sqlMock,
  sqlBypass: sqlMock,
}));

vi.mock('@/lib/events', () => ({
  emitEventSingle: emitEventSingleMock,
  systemActor: () => ({ type: 'system' }),
}));

vi.mock('bcryptjs', () => ({
  default: {
    hash: bcryptHashMock,
  },
  hash: bcryptHashMock,
}));

// ─── Import after mocks ────────────────────────────────────────────────────
import { POST, GET } from '@/app/api/invite/route';

// ─── Fixtures ─────────────────────────────────────────────────────────────

const COLLABORATOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROPOSAL_ID = 'cccccccc-cccc-4ccc-4ccc-cccccccccccc';
const TENANT_SLUG = 'acme-defense';

function makeCollaborator(overrides: Partial<{
  id: string;
  userId: string | null;
  email: string;
  proposalId: string;
  acceptedAt: string | null;
}> = {}) {
  return {
    id: COLLABORATOR_ID,
    userId: USER_ID,
    email: 'partner@external.com',
    proposalId: PROPOSAL_ID,
    acceptedAt: null,
    ...overrides,
  };
}

function makePostRequest(body: unknown) {
  return new Request('http://localhost/api/invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('POST /api/invite — input validation', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlBeginMock.mockReset();
    emitEventSingleMock.mockReset();
    bcryptHashMock.mockReset();
    bcryptHashMock.mockResolvedValue('$2a$12$hashed');
  });

  it('returns 400 when token is missing', async () => {
    const res = await POST(makePostRequest({ password: 'validpassword123' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('VALIDATION_ERROR');
    expect(json.error).toMatch(/token/i);
  });

  it('returns 400 when token is empty string', async () => {
    const res = await POST(makePostRequest({ token: '  ', password: 'validpassword123' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when password is shorter than 12 characters', async () => {
    const res = await POST(makePostRequest({ token: COLLABORATOR_ID, password: 'short' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('VALIDATION_ERROR');
    expect(json.error).toMatch(/12/);
  });

  it('returns 400 when password is exactly 11 characters (boundary)', async () => {
    const res = await POST(makePostRequest({ token: COLLABORATOR_ID, password: '12345678901' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('VALIDATION_ERROR');
  });

  it('accepts password of exactly 12 characters (boundary)', async () => {
    // Set up valid collaborator for this test
    sqlMock.mockResolvedValueOnce([makeCollaborator()]); // collaborator lookup
    sqlBeginMock.mockResolvedValue(undefined);
    sqlMock.mockResolvedValue([]); // tenant slug lookup

    const res = await POST(makePostRequest({ token: COLLABORATOR_ID, password: '123456789012' }));
    // Should NOT be a 400 validation error about password length
    expect(res.status).not.toBe(400);
  });

  it('returns 400 when body is invalid JSON', async () => {
    const req = new Request('http://localhost/api/invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json {{{',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/invite — token lookup', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlBeginMock.mockReset();
    emitEventSingleMock.mockReset();
    bcryptHashMock.mockReset();
    bcryptHashMock.mockResolvedValue('$2a$12$hashed');
  });

  it('returns 404 when collaborator is not found', async () => {
    sqlMock.mockResolvedValueOnce([]); // no collaborator found
    const res = await POST(makePostRequest({ token: 'nonexistent-token', password: 'validpassword123' }));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.code).toBe('NOT_FOUND');
  });

  it('returns 409 when invite is already accepted', async () => {
    sqlMock.mockResolvedValueOnce([makeCollaborator({ acceptedAt: '2026-01-01T00:00:00Z' })]);
    const res = await POST(makePostRequest({ token: COLLABORATOR_ID, password: 'validpassword123' }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe('VALIDATION_ERROR');
    expect(json.error).toMatch(/already accepted/i);
  });

  it('returns 500 when collaborator DB query throws', async () => {
    sqlMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await POST(makePostRequest({ token: COLLABORATOR_ID, password: 'validpassword123' }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.code).toBe('DB_ERROR');
  });
});

describe('POST /api/invite — success path', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlBeginMock.mockReset();
    emitEventSingleMock.mockReset();
    bcryptHashMock.mockReset();
    bcryptHashMock.mockResolvedValue('$2a$12$hashed');
    emitEventSingleMock.mockResolvedValue(undefined);
  });

  it('calls sql.begin for the transaction (atomicity)', async () => {
    sqlMock.mockResolvedValueOnce([makeCollaborator()]);
    sqlBeginMock.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
      const txMock = vi.fn().mockResolvedValue([]);
      return cb(txMock);
    });
    sqlMock.mockResolvedValue([]); // tenant slug lookup

    await POST(makePostRequest({ token: COLLABORATOR_ID, password: 'validpassword123' }));

    expect(sqlBeginMock).toHaveBeenCalledOnce();
  });

  it('emits event with namespace=identity and type=invite.accepted (NOT identity.invite_accepted)', async () => {
    sqlMock.mockResolvedValueOnce([makeCollaborator()]);
    sqlBeginMock.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
      const txMock = vi.fn().mockResolvedValue([]);
      return cb(txMock);
    });
    sqlMock.mockResolvedValue([]); // tenant slug lookup

    await POST(makePostRequest({ token: COLLABORATOR_ID, password: 'validpassword123' }));

    expect(emitEventSingleMock).toHaveBeenCalledOnce();

    const call = emitEventSingleMock.mock.calls[0][0];
    // Critical regression guards for FE-02/FE-06
    expect(call.namespace).toBe('identity');
    expect(call.type).toBe('invite.accepted');
    // Confirm it is NOT the wrong combined form
    expect(call.type).not.toBe('identity.invite_accepted');
    expect(call.namespace).not.toBe('invite');
  });

  it('event payload contains collaboratorId, email, and proposalId', async () => {
    const collaborator = makeCollaborator();
    sqlMock.mockResolvedValueOnce([collaborator]);
    sqlBeginMock.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
      const txMock = vi.fn().mockResolvedValue([]);
      return cb(txMock);
    });
    sqlMock.mockResolvedValue([]);

    await POST(makePostRequest({ token: COLLABORATOR_ID, password: 'validpassword123' }));

    const call = emitEventSingleMock.mock.calls[0][0];
    expect(call.payload.collaboratorId).toBe(COLLABORATOR_ID);
    expect(call.payload.email).toBe(collaborator.email);
    expect(call.payload.proposalId).toBe(PROPOSAL_ID);
    expect(call.payload.correlationId).toBeDefined();
  });

  it('returns 200 with accepted=true and redirectTo', async () => {
    sqlMock.mockResolvedValueOnce([makeCollaborator()]);
    sqlBeginMock.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
      const txMock = vi.fn().mockResolvedValue([]);
      return cb(txMock);
    });
    // Tenant slug query returns tenant
    sqlMock.mockResolvedValueOnce([{ tenantSlug: TENANT_SLUG }]);

    const res = await POST(makePostRequest({ token: COLLABORATOR_ID, password: 'validpassword123' }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.accepted).toBe(true);
    expect(json.data.redirectTo).toBe(`/portal/${TENANT_SLUG}/proposals/${PROPOSAL_ID}`);
  });

  it('falls back to /portal when tenant slug query fails', async () => {
    sqlMock.mockResolvedValueOnce([makeCollaborator()]);
    sqlBeginMock.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
      const txMock = vi.fn().mockResolvedValue([]);
      return cb(txMock);
    });
    // Tenant slug query returns no results
    sqlMock.mockResolvedValueOnce([]);

    const res = await POST(makePostRequest({ token: COLLABORATOR_ID, password: 'validpassword123' }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.redirectTo).toBe('/portal');
  });

  it('bcrypt.hash is called with the provided password and cost factor 12', async () => {
    sqlMock.mockResolvedValueOnce([makeCollaborator()]);
    sqlBeginMock.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
      const txMock = vi.fn().mockResolvedValue([]);
      return cb(txMock);
    });
    sqlMock.mockResolvedValue([]);

    await POST(makePostRequest({ token: COLLABORATOR_ID, password: 'mysecurepassword!' }));

    expect(bcryptHashMock).toHaveBeenCalledWith('mysecurepassword!', 12);
  });

  it('skips user UPDATE inside transaction when collaborator has no userId', async () => {
    // collaborator.userId = null means no user row to update
    sqlMock.mockResolvedValueOnce([makeCollaborator({ userId: null })]);

    const txMock = vi.fn().mockResolvedValue([]);
    sqlBeginMock.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
      return cb(txMock);
    });
    sqlMock.mockResolvedValue([]);

    const res = await POST(makePostRequest({ token: COLLABORATOR_ID, password: 'validpassword123' }));

    expect(res.status).toBe(200);
    // transaction still ran (collaborator accepted_at update)
    expect(sqlBeginMock).toHaveBeenCalledOnce();
    // Only ONE sql call inside tx (not two, since userId is null)
    expect(txMock).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/invite — transaction failure', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlBeginMock.mockReset();
    emitEventSingleMock.mockReset();
    bcryptHashMock.mockReset();
    bcryptHashMock.mockResolvedValue('$2a$12$hashed');
  });

  it('returns 500 when transaction throws, and does NOT emit the event', async () => {
    sqlMock.mockResolvedValueOnce([makeCollaborator()]);
    sqlBeginMock.mockRejectedValue(new Error('deadlock detected'));

    const res = await POST(makePostRequest({ token: COLLABORATOR_ID, password: 'validpassword123' }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.code).toBe('DB_ERROR');

    // Event must NOT be emitted when the transaction failed
    expect(emitEventSingleMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/invite — token lookup', () => {
  beforeEach(() => {
    sqlMock.mockReset();
  });

  it('returns 400 when token is missing from query params', async () => {
    const req = new Request('http://localhost/api/invite');
    const res = await GET(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when token does not match any collaborator', async () => {
    sqlMock.mockResolvedValueOnce([]);
    const req = new Request(`http://localhost/api/invite?token=${COLLABORATOR_ID}`);
    const res = await GET(req);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.code).toBe('NOT_FOUND');
  });

  it('returns invite details when token is valid', async () => {
    const row = {
      email: 'partner@ext.com',
      acceptedAt: null,
      inviterName: 'Alice Admin',
      inviterEmail: 'alice@acme.com',
      proposalTitle: 'Advanced Sensor Proposal',
      companyName: 'Acme Defense',
    };
    sqlMock.mockResolvedValueOnce([row]);

    const req = new Request(`http://localhost/api/invite?token=${COLLABORATOR_ID}`);
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.email).toBe(row.email);
    expect(json.data.alreadyAccepted).toBe(false);
    expect(json.data.companyName).toBe(row.companyName);
  });

  it('returns alreadyAccepted=true when acceptedAt is set', async () => {
    sqlMock.mockResolvedValueOnce([{
      email: 'partner@ext.com',
      acceptedAt: '2026-01-01T00:00:00Z',
      inviterName: null,
      inviterEmail: null,
      proposalTitle: null,
      companyName: null,
    }]);

    const req = new Request(`http://localhost/api/invite?token=${COLLABORATOR_ID}`);
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.alreadyAccepted).toBe(true);
  });

  it('returns 500 when DB query throws', async () => {
    sqlMock.mockRejectedValueOnce(new Error('DB timeout'));
    const req = new Request(`http://localhost/api/invite?token=${COLLABORATOR_ID}`);
    const res = await GET(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.code).toBe('DB_ERROR');
  });
});
