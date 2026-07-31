/**
 * GET /api/portal/[tenantSlug]/library/atoms/[atomId]/download?format=docx|pptx|xlsx|pdf
 * — P3.3. Render any library atom (foundation / section / group / primitive) from its
 * stored canvas_nodes to its native format via renderCanvas and stream the bytes.
 * The layout preset is picked from the atom's `form` tag. tenant_user+ · tenant-scoped.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { coerceJsonb } from '@/lib/jsonb';
import { renderCanvas, type ExportFormat } from '@/lib/export/artifact-export';
import { CANVAS_PRESETS, type CanvasDocument, type CanvasNode } from '@/lib/types/canvas-document';

const MIME: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};
const FORMATS = new Set(['docx', 'pptx', 'xlsx', 'pdf']);
const PRESET_FOR: Record<string, string> = { doc: 'letter_standard', pdf: 'custom', ppt: 'slide_cso', sheet: 'spreadsheet' };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'atom';

export async function GET(request: Request, { params }: { params: Promise<{ tenantSlug: string; atomId: string }> }) {
  try {
    const { tenantSlug, atomId } = await params;
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    const u = session.user as { id?: string; role?: unknown };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    if (!hasRoleAtLeast(role, 'tenant_user')) return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    if (!isValidUUID(atomId)) return NextResponse.json({ error: 'Invalid ID format', code: 'VALIDATION_ERROR' }, { status: 400 });
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(u.id, role, tenantId))) return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    enterTenant(tenantId); // RLS choke point

    const format = new URL(request.url).searchParams.get('format') ?? '';
    if (!FORMATS.has(format)) return NextResponse.json({ error: 'format must be docx|pptx|xlsx|pdf', code: 'VALIDATION_ERROR' }, { status: 400 });

    // camelCased column (transform.toCamel): canvas_nodes → canvasNodes. Fence to the
    // main library (vault atoms live only on the vault surface) + the viewer's visibility,
    // mirroring getAtom so a non-owner/non-admin can't pull a 'vault'/'owner_only' atom by id.
    const isAdmin = hasRoleAtLeast(role, 'tenant_admin');
    const [row] = await sql<Array<{ title: string | null; canvasNodes: unknown }>>`
      SELECT title, canvas_nodes FROM library_atoms
      WHERE id = ${atomId}::uuid AND tenant_id = ${tenantId}::uuid
        AND vault_id IS NULL
        AND (${isAdmin} OR visibility = 'tenant' OR owner_user_id = ${u.id}::uuid)
      LIMIT 1`;
    if (!row) return NextResponse.json({ error: 'Atom not found', code: 'NOT_FOUND' }, { status: 404 });
    const [t] = await sql<Array<{ value: string }>>`SELECT value FROM atom_tags WHERE atom_id = ${atomId}::uuid AND dimension = 'form' LIMIT 1`;
    const preset = CANVAS_PRESETS[PRESET_FOR[t?.value ?? 'doc'] ?? 'letter_standard'] ?? CANVAS_PRESETS.letter_standard;

    const nodes = coerceJsonb<CanvasNode[]>(row.canvasNodes, []);
    const now = new Date().toISOString();
    const doc: CanvasDocument = {
      version: 1, document_id: atomId, canvas: preset, nodes,
      metadata: { title: row.title ?? 'atom', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: now, last_modified_at: now, last_modified_by: u.id, version_number: 1, status: 'accepted' },
    };
    const buf = await renderCanvas(format as ExportFormat, doc, { company_name: 'Your Company', topic_number: 'TBD' });
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: { 'Content-Type': MIME[format], 'Content-Disposition': `attachment; filename="${slug(row.title ?? 'atom')}.${format}"` },
    });
  } catch (e) {
    console.error('[library/atoms download]', e);
    return NextResponse.json({ error: 'Failed to download', code: 'EXPORT_ERROR' }, { status: 500 });
  }
}
