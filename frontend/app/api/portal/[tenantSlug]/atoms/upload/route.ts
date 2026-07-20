/**
 * POST /api/portal/[tenantSlug]/atoms/upload  (multipart: file)
 *
 * Upload → deconstruct → register. Parses the file with the existing import readers,
 * registers the whole doc as a `reference` atom (so the upload registers itself and its
 * full content is available to atomize later), and returns the deconstructed objects
 * (heading + content chunks, with suggested tags) for the atomizer to select from.
 * Nothing is auto-atomized — the admin picks what becomes atoms.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { readDocument } from '@/lib/import';
import { textOfNodes } from '@/lib/atom-size';
import { createAtom } from '@/lib/atoms';

// The import readers use the legacy 18-value category vocab; map the obvious ones to a
// vol: value so the atomizer can pre-suggest a (confirmable) tag. Unknown → no suggestion.
const CATEGORY_TO_VOL: Record<string, string> = {
  technical_approach: 'technical', past_performance: 'past_performance', key_personnel: 'key_personnel',
  capability_statement: 'overview', cost_volume: 'cost', management_approach: 'management',
  commercialization: 'commercialization', abstract: 'abstract', qualifications: 'key_personnel',
  schedule: 'milestones', facilities: 'facilities', teaming: 'key_personnel', transition_plan: 'transition_plan',
};
const FMT_OF: Record<string, string> = { docx: 'doc', pptx: 'slide', pdf: 'doc', txt: 'doc', md: 'doc' };

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    const u = session.user as { id?: string; role?: unknown };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    if (!hasRoleAtLeast(role, 'tenant_user')) return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(u.id, role, tenantId))) return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });

    let form: FormData;
    try { form = await request.formData(); } catch { return NextResponse.json({ error: 'Expected multipart form-data', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'file is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: 'file too large (25MB max)', code: 'VALIDATION_ERROR' }, { status: 413 });

    let parsed;
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      parsed = await readDocument(buffer, file.name);
    } catch (e) {
      console.error('[atoms/upload] parse failed', e);
      return NextResponse.json({ error: 'Could not parse the document', code: 'PARSE_ERROR' }, { status: 422 });
    }

    const allNodes = parsed.atoms.flatMap((a) => a.nodes);
    const fullText = parsed.atoms.map((a) => textOfNodes(a.nodes)).join('\n\n');

    // Register the whole doc as a reference atom (full content kept for later atomization).
    let referenceAtomId: string | null = null;
    try {
      const ref = await createAtom(tenantId, {
        grain: 'reference', title: file.name, content: fullText || null, canvasNodes: allNodes.length ? allNodes : null,
        summary: `Uploaded ${parsed.sourceFormat} · ${parsed.atoms.length} objects`, source: 'upload', status: 'approved',
        tags: [{ dimension: 'fmt', value: FMT_OF[parsed.sourceFormat] ?? 'doc', source: 'auto', confirmed: true }],
        // Provenance follows the actual uploader — a collaborator's upload is
        // 'collaborator', not 'admin'. createAtom stamps owner_user_id = uploader.
      }, { id: u.id, kind: hasRoleAtLeast(role, 'tenant_admin') || role === 'rfp_admin' || role === 'master_admin' ? 'admin' : 'collaborator' });
      referenceAtomId = ref.atomId;
    } catch (e) {
      console.error('[atoms/upload] reference atom create failed (non-fatal)', e);
    }

    // Deconstructed objects for the annotation atomizer. Each block carries its
    // real CanvasNodes + a primaryType so the atomizer can offer the right GRAIN
    // (image → figure atom; table/list → one atom OR a group of rows/items; text
    // → narrative) instead of flattening everything to text.
    const blocks = parsed.atoms.map((a, i) => {
      const text = textOfNodes(a.nodes);
      const types = new Set(a.nodes.map((n) => n.type));
      const primaryType: 'image' | 'table' | 'list' | 'heading' | 'narrative' =
        types.has('image') ? 'image'
        : types.has('table') ? 'table'
        : (types.has('bulleted_list') || types.has('numbered_list')) ? 'list'
        : (a.headingText && text.length < (text.indexOf('\n') + 1 || text.length + 1)) ? 'heading'
        : 'narrative';
      return {
        id: `b${i}`,
        heading: a.headingText,
        text,
        kind: primaryType === 'heading' ? 'heading' : 'narrative',
        primaryType,
        nodes: a.nodes,
        charOffset: a.charOffset,
        charLength: a.charLength,
        suggestedVol: CATEGORY_TO_VOL[a.suggestedCategory] ?? null,
      };
    });

    return NextResponse.json({ data: { referenceAtomId, sourceFormat: parsed.sourceFormat, blocks } });
  } catch (err) {
    console.error('[atoms/upload] error', err);
    return NextResponse.json({ error: 'Upload failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
