import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { CanvasEditorPage } from '@/components/canvas/canvas-editor-page';
import { resolveDocumentCapabilities, type CanvasArtifactType } from '@/lib/canvas/capabilities';
import { coerceJsonb } from '@/lib/jsonb';
import { isValidUUID } from '@/lib/validation';
import { CANVAS_PRESETS, type CanvasDocument, type CanvasNode } from '@/lib/types/canvas-document';

export const dynamic = 'force-dynamic';

/**
 * Foundation editor (P2.2) — opens a library foundation artifact in the SAME
 * canvas shell as a document/section, loading its stored `canvas_nodes` into the
 * editor. Save decomposes-on-save (redecomposeFoundation) so the grains track the
 * edited canvas; the taxonomy (form/kind/context) is fixed at creation.
 */
const PRESET_FOR: Record<string, string> = { doc: 'letter_standard', pdf: 'custom', ppt: 'slide_cso', sheet: 'spreadsheet' };

export default async function FoundationEditorPage({ params }: { params: Promise<{ tenantSlug: string; foundationId: string }> }) {
  const { tenantSlug, foundationId } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');
  const su = session.user as { id?: string; name?: string | null; email?: string; role?: unknown };
  const role: Role | null = isRole(su.role) ? su.role : null;
  if (!role || !su.id) redirect('/login?error=session');
  if (!isValidUUID(foundationId)) notFound();

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/portal');
  const tenantId = tenant.id as string;
  if (!hasRoleAtLeast(role, 'tenant_user')) redirect(`/portal/${tenantSlug}/proposals`);
  if (!(await verifyTenantAccess(su.id, role, tenantId))) redirect('/portal');
  enterTenant(tenantId); // RLS choke point

  // NB: the db client camelCases result columns (transform.toCamel), so
  // `canvas_nodes` arrives as `canvasNodes`.
  let row: { id: string; title: string | null; canvasNodes: unknown } | undefined;
  let form = 'doc';
  try {
    [row] = await sql<{ id: string; title: string | null; canvasNodes: unknown }[]>`
      SELECT id, title, canvas_nodes FROM library_atoms
      WHERE id = ${foundationId}::uuid AND tenant_id = ${tenantId}::uuid AND grain = 'foundation' LIMIT 1`;
    const [t] = await sql<{ value: string }[]>`SELECT value FROM atom_tags WHERE atom_id = ${foundationId}::uuid AND dimension = 'form' LIMIT 1`;
    if (t?.value) form = t.value;
  } catch (e) {
    console.error('[foundation editor] load failed:', e);
  }
  if (!row) notFound();

  const nodes = coerceJsonb<CanvasNode[]>(row.canvasNodes, []);
  const preset = CANVAS_PRESETS[PRESET_FOR[form] ?? 'letter_standard'] ?? CANVAS_PRESETS.letter_standard;
  const now = new Date().toISOString();
  const canvasDoc: CanvasDocument = {
    version: 1, document_id: foundationId, canvas: preset, nodes,
    metadata: {
      title: row.title ?? 'Canvas', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '',
      created_at: now, last_modified_at: now, last_modified_by: su.id, version_number: 1, status: nodes.length ? 'in_progress' : 'empty',
    },
  };
  const artifactType: CanvasArtifactType = form === 'ppt' ? 'slide' : form === 'sheet' ? 'spreadsheet' : 'document';
  const capabilities = resolveDocumentCapabilities({ role, final: false, artifactType });

  return (
    <CanvasEditorPage
      canvasDocument={canvasDoc}
      foundationId={foundationId}
      actorId={su.id}
      actorName={su.name ?? su.email ?? 'Unknown'}
      initialVersion={1}
      capabilities={capabilities}
      stage="draft"
      tenantSlug={tenantSlug}
    />
  );
}
