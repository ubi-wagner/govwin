/**
 * Site content document editor — canvas-native authoring for front-facing documents
 * (blog_post / resource / guide / testimonial / team_member). The CanvasDocument is the
 * source of truth; the server projects the public HTML body from it on save.
 * See docs/CONTENT_STUDIO_DESIGN.md.
 */
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getDocument, DOC_TYPES, type PageVersion } from '@/lib/content-admin';
import { canvasFromDocBody, newContentCanvas } from '@/lib/content-canvas';
import type { CanvasDocument } from '@/lib/types/canvas-document';
import { SiteDocCanvasEditor } from './doc-canvas-editor';

export const dynamic = 'force-dynamic';

/** The stored canvas (source of truth) if the doc has been canvas-saved before. */
function storedCanvas(src: PageVersion | null): CanvasDocument | null {
  const c = (src?.metadata as Record<string, unknown> | undefined)?.canvas;
  if (c && typeof c === 'object' && !Array.isArray(c)) {
    const doc = c as CanvasDocument;
    if (Array.isArray(doc.nodes) || Array.isArray(doc.sections)) return doc;
  }
  return null;
}

/** The legacy plain body (first block's body) for seed-on-open. */
function legacyBody(src: PageVersion | null): string {
  const b0 = (src?.blocks?.[0] ?? {}) as Record<string, unknown>;
  return typeof b0.body === 'string' ? b0.body : '';
}

export default async function DocEditorPage({ params }: { params: Promise<{ type: string; slug: string }> }) {
  const { type, slug } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') redirect('/admin/dashboard');
  if (!(DOC_TYPES as readonly string[]).includes(type)) redirect('/admin/site');

  const isNew = slug === 'new';
  let active: PageVersion | null = null;
  let draft: PageVersion | null = null;
  let hasArchived = false;
  if (!isNew) {
    try {
      const doc = await getDocument(slug, type);
      active = doc.active;
      draft = doc.draft;
      hasArchived = doc.hasArchived;
    } catch (e) {
      console.error('[admin/site/docs/[type]/[slug]] getDocument failed:', e);
    }
  }

  // Source-of-truth canvas: the stored canvas → else seed from the legacy body → else a
  // fresh starter. The legacy body is left intact until the first canvas save (non-lossy).
  const src = draft ?? active;
  const title = src?.title ?? '';
  const initialDocument =
    storedCanvas(src) ??
    (isNew ? newContentCanvas('') : canvasFromDocBody(title, legacyBody(src)));

  const u = session.user as { id: string; name?: string };
  return (
    <SiteDocCanvasEditor
      type={type}
      slug={isNew ? '' : slug}
      isNew={isNew}
      active={active}
      draft={draft}
      canRestore={hasArchived}
      initialDocument={initialDocument}
      actorId={u.id}
      actorName={u.name ?? 'Admin'}
    />
  );
}
