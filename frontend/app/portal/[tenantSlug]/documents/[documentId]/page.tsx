import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { resolveDocumentCapabilities, type CanvasArtifactType } from '@/lib/canvas/capabilities';
import { CanvasEditorPage } from '@/components/canvas/canvas-editor-page';
import { coerceJsonb } from '@/lib/jsonb';
import { isValidUUID } from '@/lib/validation';
import {
  createEmptyCanvas, CANVAS_PRESETS,
  type CanvasDocument,
} from '@/lib/types/canvas-document';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ tenantSlug: string; documentId: string }>;
}

/**
 * Standalone document editor (Tier 2, #3). The SAME canvas shell as a proposal
 * section — only the persistence target differs — but with the proposal-scoped
 * tools (comments, atomize-node, complete-&-lock) masked off, since a standalone
 * document has no section/matrix behind those routes. Insert-from-library stays
 * on (tenant-scoped) so "from template AND library" holds.
 */
export default async function PortalDocumentEditorPage({ params }: Props) {
  const { tenantSlug, documentId } = await params;

  const session = await auth();
  if (!session?.user) redirect('/login');

  const sessionUser = session.user as {
    id?: string;
    name?: string | null;
    email?: string;
    role?: unknown;
    tenantId?: string | null;
  };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) redirect('/login?error=session');

  if (!isValidUUID(documentId)) notFound();

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/portal');
  const tenantId = tenant.id as string;

  // Standalone documents are a tenant-member surface (no cross-company
  // collaborators). partner_user is proposal-scoped → excluded.
  if (!hasRoleAtLeast(role, 'tenant_user')) redirect(`/portal/${tenantSlug}/proposals`);
  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) redirect('/portal');

  const userId = sessionUser.id;
  const userName = sessionUser.name ?? sessionUser.email ?? 'Unknown';

  // ── Load the document (tenant-scoped) ───────────────────────────────
  let row: { id: string; title: string; canvas: unknown; status: string; version: number } | undefined;
  try {
    [row] = await sql<{ id: string; title: string; canvas: unknown; status: string; version: number }[]>`
      SELECT id, title, canvas, status, version
      FROM tenant_documents
      WHERE id = ${documentId}::uuid AND tenant_id = ${tenantId}::uuid
      LIMIT 1
    `;
  } catch (e) {
    console.error('[portal/documents/editor] load failed:', e);
  }
  if (!row) notFound();

  // Coerce the stored canvas; fall back to an empty letter canvas if malformed.
  const stored = coerceJsonb<Partial<CanvasDocument>>(row.canvas, {});
  const canvasDoc: CanvasDocument = stored && stored.canvas && (Array.isArray(stored.nodes) || Array.isArray(stored.sections))
    ? (stored as CanvasDocument)
    : createEmptyCanvas({
        documentId,
        canvas: CANVAS_PRESETS.letter_standard,
        metadata: {
          title: row.title, volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '',
          created_at: new Date().toISOString(), last_modified_at: new Date().toISOString(),
          last_modified_by: userId, version_number: row.version, status: 'empty',
        },
      });

  // ── Resolve the tool set for a standalone document (proposal-scoped
  //    powers masked off; insert-from-library kept). ──
  const fmt = canvasDoc.canvas?.format ?? 'letter';
  const artifactType: CanvasArtifactType = fmt.startsWith('slide') ? 'slide' : fmt === 'spreadsheet' ? 'spreadsheet' : 'document';
  const isFinal = row.status === 'final';
  const capabilities = resolveDocumentCapabilities({ role, final: isFinal, artifactType });
  const stage = isFinal ? 'locked' : capabilities.canEditContent ? 'draft' : 'review';

  return (
    <CanvasEditorPage
      canvasDocument={canvasDoc}
      documentId={documentId}
      actorId={userId}
      actorName={userName}
      initialVersion={row.version}
      readOnly={!capabilities.canEditContent}
      capabilities={capabilities}
      stage={stage}
      tenantSlug={tenantSlug}
    />
  );
}
