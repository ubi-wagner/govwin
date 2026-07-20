/**
 * Template editor route — author a document template's canvas in the full WYSIWYG
 * editor. New templates open with an empty canvas seeded from their preset; system
 * templates open read-only. rfp_admin / master_admin only.
 *
 * Route: /admin/templates/[templateId]/edit
 */
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { createEmptyCanvas, CANVAS_PRESETS, type CanvasRules, type CanvasDocument } from '@/lib/types/canvas-document';
import { TemplateCanvasEditor } from '@/components/admin/template-canvas-editor';

export default async function TemplateEditPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') redirect('/admin/dashboard');

  let tpl: { id: string; name: string; canvas_document: CanvasDocument | null; canvas_preset: CanvasRules | null; is_system: boolean } | undefined;
  try {
    [tpl] = await sql`
      SELECT id, name, canvas_document, canvas_preset, is_system
      FROM document_templates WHERE id = ${templateId}::uuid LIMIT 1`;
  } catch {
    redirect('/admin/templates');
  }
  if (!tpl) redirect('/admin/templates');

  const now = new Date().toISOString();
  let doc = tpl.canvas_document;
  if (!doc || !Array.isArray(doc.nodes)) {
    doc = createEmptyCanvas({
      documentId: tpl.id,
      canvas: tpl.canvas_preset ?? CANVAS_PRESETS.letter_sbir_phase1,
      metadata: {
        title: tpl.name, volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '',
        created_at: now, last_modified_at: now, last_modified_by: '', version_number: 1, status: 'ai_drafted',
      },
    });
  }
  const u = session.user as { id: string; name?: string };
  return (
    <TemplateCanvasEditor
      templateId={tpl.id}
      initialDocument={doc}
      actorId={u.id}
      actorName={u.name ?? 'Admin'}
      readOnly={tpl.is_system}
    />
  );
}
