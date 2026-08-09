/**
 * PUT /api/admin/proposals/[proposalId]/sections/[sectionId]
 *
 * Admin cross-tenant (BYPASSRLS) section save. Regression guard for the canvas_versions
 * numbering invariant: the snapshot must number from the section's LIVE version counter and
 * ADVANCE it — NOT from client-supplied metadata.version_number (which the editor page
 * hardcodes to 1, so the old code overwrote the v1 history every save via ON CONFLICT DO
 * UPDATE and never advanced). Mocked: @/auth, @/lib/db (sqlBypass), @/lib/events.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, sqlMock, emitEventSingleMock } = vi.hoisted(() => {
  const sqlMock = Object.assign(vi.fn(), { json: (x: unknown) => x });
  return { authMock: vi.fn(), sqlMock, emitEventSingleMock: vi.fn() };
});

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ sqlBypass: sqlMock }));
vi.mock('@/lib/events', () => ({ emitEventSingle: emitEventSingleMock }));

import { PUT } from '@/app/api/admin/proposals/[proposalId]/sections/[sectionId]/route';

const PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SECTION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OLD_CONTENT = { version: 1, nodes: [{ type: 'text_block', content: { text: 'old live content' } }] };

function ctx() {
  return { params: Promise.resolve({ proposalId: PROPOSAL_ID, sectionId: SECTION_ID }) };
}
// Client sends metadata.version_number = 1 (what the editor page hardcodes) — the route MUST ignore it.
function req(content: unknown = { nodes: [{ type: 'text_block' }], metadata: { version_number: 1 } }) {
  return new Request(`http://localhost/api/admin/proposals/${PROPOSAL_ID}/sections/${SECTION_ID}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
}
function setupAuth(role = 'rfp_admin') {
  authMock.mockResolvedValue({ user: { id: USER_ID, email: 'a@a.com', role } });
  emitEventSingleMock.mockResolvedValue(undefined);
}

describe('PUT admin section save', () => {
  beforeEach(() => { authMock.mockReset(); sqlMock.mockReset(); emitEventSingleMock.mockReset(); });

  it('401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect((await PUT(req(), ctx())).status).toBe(401);
  });

  it('403 for a non-admin role', async () => {
    setupAuth('tenant_admin');
    expect((await PUT(req(), ctx())).status).toBe(403);
  });

  it('400 when content is missing', async () => {
    setupAuth();
    expect((await PUT(req(null), ctx())).status).toBe(400);
  });

  it('archives the PRIOR content at the LIVE version and advances the counter (ignores client metadata=1)', async () => {
    setupAuth();
    sqlMock
      .mockResolvedValueOnce([{ content: OLD_CONTENT, version: 5 }]) // SELECT content, version
      .mockResolvedValueOnce([])                                     // INSERT canvas_versions (archive OLD@5)
      .mockResolvedValueOnce([]);                                    // UPDATE proposal_sections (version+1)
    const res = await PUT(req(), ctx());
    expect(res.status).toBe(200);
    // New live version is 6, not the client's hardcoded 1.
    expect((await res.json()).data.version).toBe(6);

    // The archive INSERT (2nd sql call) numbers at the live version 5 and snapshots the OLD content.
    const insertCall = sqlMock.mock.calls[1];
    expect(insertCall).toContain(5);
    expect(insertCall).toContain(OLD_CONTENT);
    expect(insertCall).not.toContain(1); // NOT the client metadata.version_number
    // The INSERT must not clobber existing history.
    expect(insertCall[0].join('')).toContain('ON CONFLICT (section_id, version_number) DO NOTHING');
    // The section UPDATE (3rd call) advances the counter.
    expect(sqlMock.mock.calls[2][0].join('')).toContain('version = version + 1');
    expect(emitEventSingleMock).toHaveBeenCalledTimes(1);
  });

  it('404 when the section does not belong to the proposal', async () => {
    setupAuth();
    sqlMock.mockResolvedValueOnce([]); // SELECT → not found
    expect((await PUT(req(), ctx())).status).toBe(404);
  });
});
