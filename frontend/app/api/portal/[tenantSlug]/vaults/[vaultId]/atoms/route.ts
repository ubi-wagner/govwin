/**
 * Vault content (P8.5/P8.6) — list + add artifacts to a nook.
 *   GET  — list the vault's whole artifacts (both sides).
 *   POST { title, form?, kind?, context?, doc } — add + atomize an artifact into the vault
 *          (both sides have the upload right; a collaborator uploads their own content, the
 *          tenant admin copies content in). Content lands visibility='vault' + vault_id.
 *
 * Gated by resolveVaultAccess (NOT verifyTenantAccess) so an invited collaborator — who is
 * not a member of the owner tenant — can reach ONLY their nook.
 */
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { auth } from '@/auth';
import { getTenantBySlug, enterTenant } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import { resolveVaultAccess, createVaultArtifact, listVaultArtifacts, getVault, notifyCollaboratorUpload } from '@/lib/vaults/vaults';
import { blankCanvasForForm, type ArtifactForm } from '@/lib/library/artifact-canvas';
import type { CanvasDocument } from '@/lib/types/canvas-document';

const FORMS: ArtifactForm[] = ['doc', 'ppt', 'pdf', 'sheet'];
const slugify = (s: string) => `${s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'artifact'}-${randomUUID().slice(0, 8)}`;

async function gate(tenantSlug: string, vaultId: string) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const u = session.user as { id?: string; role?: unknown; email?: string };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id) return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  const tenantId = tenant.id as string;
  const access = await resolveVaultAccess(vaultId, { userId: u.id, email: u.email ?? null, role });
  if (!access || access.ownerTenantId !== tenantId) return { error: NextResponse.json({ error: 'Vault not found', code: 'NOT_FOUND' }, { status: 404 }) };
  return { access, tenantId, userId: u.id, role, email: u.email ?? null };
}

export async function GET(_request: Request, { params }: { params: Promise<{ tenantSlug: string; vaultId: string }> }) {
  try {
    const { tenantSlug, vaultId } = await params;
    const g = await gate(tenantSlug, vaultId);
    if ('error' in g) return g.error;
    enterTenant(g.tenantId); // RLS choke point
    return NextResponse.json({ data: await listVaultArtifacts(vaultId) });
  } catch (e) {
    console.error('[vault atoms GET]', e);
    return NextResponse.json({ error: 'Failed to list vault artifacts', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string; vaultId: string }> }) {
  try {
    const { tenantSlug, vaultId } = await params;
    const g = await gate(tenantSlug, vaultId);
    if ('error' in g) return g.error;
    enterTenant(g.tenantId); // RLS choke point
    if (!g.access.rights.upload) return NextResponse.json({ error: 'No upload right', code: 'FORBIDDEN' }, { status: 403 });

    let body: { title?: unknown; form?: unknown; kind?: unknown; context?: unknown; doc?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'BAD_REQUEST' }, { status: 400 }); }
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
    const form = FORMS.includes(body.form as ArtifactForm) ? (body.form as ArtifactForm) : 'doc';
    const kind = body.kind === 'template' ? 'template' : 'document';
    const context = typeof body.context === 'string' ? body.context.trim().slice(0, 60) : 'general';
    if (!title) return NextResponse.json({ error: 'title is required', code: 'BAD_REQUEST' }, { status: 400 });
    // Cap the client-supplied doc (a collaborator is the least-trusted principal) so one
    // request can't decompose into thousands of serial per-node writes — matches the save route.
    if (body.doc && JSON.stringify(body.doc).length > 2_000_000) {
      return NextResponse.json({ error: 'artifact too large', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    }
    // A supplied CanvasDocument is atomized; otherwise mint a blank artifact of the form.
    const doc = (body.doc && typeof body.doc === 'object' ? body.doc : blankCanvasForForm(form, title)) as CanvasDocument;

    const r = await createVaultArtifact(vaultId, g.tenantId, doc, { title, slug: slugify(title), form, kind, context }, { id: g.userId });

    // P8.7 HITL — a COLLABORATOR's upload notifies the owner tenant (advisory → the customer
    // decides whether to harvest). A tenant-admin copy-in is self-initiated, so no ToDo.
    if (g.access.side === 'collaborator') {
      const vault = await getVault(vaultId, g.tenantId);
      await notifyCollaboratorUpload(vaultId, g.tenantId, { id: g.userId, email: g.email, role: g.role }, r.foundationId, vault?.partnerName ?? 'partner');
    }
    return NextResponse.json({ data: { foundationId: r.foundationId } }, { status: 201 });
  } catch (e) {
    console.error('[vault atoms POST]', e);
    return NextResponse.json({ error: 'Failed to add vault artifact', code: 'DB_ERROR' }, { status: 500 });
  }
}
