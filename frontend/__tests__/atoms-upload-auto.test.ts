/**
 * Auto-atomize on upload (#6) — POST /api/portal/[t]/atoms/upload?mode=auto.
 *
 * Pins the ROUTE'S new wiring (the atomize core + librarian producer are mocked — their own logic is
 * covered by atomize-plan.test.ts): mode=auto segments the whole doc via atomizeDocumentIntoLibrary
 * and hands the resulting cocoon to the librarian to catalog; the DEFAULT (no mode) path never
 * auto-atomizes or enqueues the librarian (byte-for-byte the manual box-and-tag flow).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, getTenantMock, verifyMock, atomizeMock, ctxTagsMock, requestAgentTaskMock, emitMock, createAtomMock, readDocMock, textOfNodesMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getTenantMock: vi.fn(),
  verifyMock: vi.fn(),
  atomizeMock: vi.fn(),
  ctxTagsMock: vi.fn(),
  requestAgentTaskMock: vi.fn(),
  emitMock: vi.fn(),
  createAtomMock: vi.fn(),
  readDocMock: vi.fn(),
  textOfNodesMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ getTenantBySlug: getTenantMock, verifyTenantAccess: verifyMock }));
vi.mock('@/lib/atomize-package', () => ({ atomizeDocumentIntoLibrary: atomizeMock, contextTags: ctxTagsMock }));
vi.mock('@/lib/agent-client', () => ({ requestAgentTask: requestAgentTaskMock }));
vi.mock('@/lib/events', () => ({ emitEventSingle: emitMock, userActor: (id: string, email?: string) => ({ type: 'user', id, email }) }));
vi.mock('@/lib/atoms', () => ({ createAtom: createAtomMock }));
vi.mock('@/lib/import', () => ({ readDocument: readDocMock }));
vi.mock('@/lib/atom-size', () => ({ textOfNodes: textOfNodesMock }));

import { POST } from '@/app/api/portal/[tenantSlug]/atoms/upload/route';

const TENANT_ID = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ctx = () => ({ params: Promise.resolve({ tenantSlug: 'foundation' }) });

function reqWith(extra: Record<string, string>) {
  const fd = new FormData();
  fd.append('file', new File(['# Overview\nFoundation prints concrete foundation walls with robots.'], 'doc.md', { type: 'text/markdown' }));
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return new Request('http://localhost/api/portal/foundation/atoms/upload', { method: 'POST', body: fd });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: USER_ID, email: 'kate@foundation3dp.com', role: 'tenant_admin' } });
  getTenantMock.mockResolvedValue({ id: TENANT_ID });
  verifyMock.mockResolvedValue(true);
  ctxTagsMock.mockReturnValue([]);
  emitMock.mockResolvedValue(undefined);
  requestAgentTaskMock.mockResolvedValue(undefined);
});

describe('auto-atomize on upload — POST atoms/upload?mode=auto', () => {
  it('mode=auto segments the doc and fires the librarian on the resulting cocoon', async () => {
    atomizeMock.mockResolvedValue({ file: 'doc.md', format: 'md', atoms: 4, skipped: 1, cocoonId: 'coc-1', reference: true });
    const res = await POST(reqWith({ mode: 'auto', context: JSON.stringify({ agency: 'Ohio' }) }), ctx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.atomized).toBe(true);
    expect(json.data.atoms).toBe(4);
    expect(json.data.skipped).toBe(1);

    // The atomize core ran with the tenant + uploaded buffer.
    expect(atomizeMock).toHaveBeenCalledTimes(1);
    expect(atomizeMock.mock.calls[0][0]).toBe(TENANT_ID);

    // The librarian producer was fired with the cocoon it should catalog.
    expect(requestAgentTaskMock).toHaveBeenCalledTimes(1);
    const task = requestAgentTaskMock.mock.calls[0][0];
    expect(task.agentRole).toBe('librarian');
    expect(task.taskType).toBe('catalog');
    expect(task.tenantId).toBe(TENANT_ID);
    expect(task.input.cocoonId).toBe('coc-1');
    expect(task.input.atomCount).toBe(4);

    // The manual box-and-tag path was NOT taken (no per-block reference read).
    expect(readDocMock).not.toHaveBeenCalled();
  });

  it('mode=auto with nothing extractable returns atomized:true/atoms:0 and does NOT enqueue the librarian', async () => {
    atomizeMock.mockResolvedValue({ file: 'doc.md', format: 'md', atoms: 0, skipped: 0, cocoonId: null, error: 'no extractable content' });
    const res = await POST(reqWith({ mode: 'auto' }), ctx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.atomized).toBe(true);
    expect(json.data.atoms).toBe(0);
    expect(requestAgentTaskMock).not.toHaveBeenCalled(); // no cocoon → nothing to catalog
  });

  it('default upload (no mode) does NOT auto-atomize or enqueue the librarian', async () => {
    readDocMock.mockResolvedValue({ sourceFormat: 'md', atoms: [{ nodes: [{ type: 'text_block', content: { text: 'hello world foo bar' } }], headingText: null, suggestedCategory: '', charOffset: 0, charLength: 10 }] });
    textOfNodesMock.mockReturnValue('hello world foo bar');
    createAtomMock.mockResolvedValue({ atomId: 'ref-1' });
    const res = await POST(reqWith({}), ctx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.atomized).toBeUndefined();
    expect(Array.isArray(json.data.blocks)).toBe(true);
    expect(atomizeMock).not.toHaveBeenCalled();
    expect(requestAgentTaskMock).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated caller (401) — no atomize, no enqueue', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(reqWith({ mode: 'auto' }), ctx());
    expect(res.status).toBe(401);
    expect(atomizeMock).not.toHaveBeenCalled();
    expect(requestAgentTaskMock).not.toHaveBeenCalled();
  });
});
