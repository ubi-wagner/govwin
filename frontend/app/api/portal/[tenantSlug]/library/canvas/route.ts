/**
 * POST /api/portal/[tenantSlug]/library/canvas — Create Canvas (phase ②).
 * Mints a FOUNDATION ARTIFACT in the tenant's library from a blank form
 * (doc/ppt/pdf/sheet), decomposing it into section/group/atom real atoms and
 * tagging kind×form×context (docs/LIBRARY_AND_VAULTS_DESIGN.md §2).
 * Body: { title, form, kind?, context? }. tenant_user+ with verified access.
 */
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { blankCanvasForForm, ARTIFACT_FORMAT, type ArtifactForm } from '@/lib/library/artifact-canvas';
import { decomposeAndIngest } from '@/lib/library/foundation';

const FORMS: ArtifactForm[] = ['doc', 'ppt', 'pdf', 'sheet'];

async function gate(tenantSlug: string, minRole: Role) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const u = session.user as { id?: string; role?: unknown };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id) return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  if (!hasRoleAtLeast(role, minRole)) return { error: NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 }) };
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(u.id, role, tenantId))) return { error: NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }) };
  return { tenantId, userId: u.id };
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'canvas';

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const g = await gate(tenantSlug, 'tenant_user');
    if ('error' in g) return g.error;

    let body: { title?: unknown; form?: unknown; kind?: unknown; context?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'BAD_REQUEST' }, { status: 400 });
    }
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
    const form = body.form as ArtifactForm;
    const kind = body.kind === 'template' ? 'template' : 'document';
    const context = typeof body.context === 'string' ? body.context.trim().slice(0, 60) : 'general';
    if (!title) return NextResponse.json({ error: 'title is required', code: 'BAD_REQUEST' }, { status: 400 });
    if (!FORMS.includes(form)) return NextResponse.json({ error: `form must be one of ${FORMS.join(', ')}`, code: 'BAD_REQUEST' }, { status: 400 });

    const doc = blankCanvasForForm(form, title);
    const slug = `${slugify(title)}-${randomUUID().slice(0, 8)}`;
    const d = await decomposeAndIngest(
      g.tenantId, doc,
      { title, slug, form, kind, context, collection: 'user_created' },
      { id: g.userId },
    );
    return NextResponse.json({
      data: {
        foundationId: d.foundationId, form, format: ARTIFACT_FORMAT[form], kind, context,
        sections: d.sectionIds.length, groups: d.groupIds.length, atoms: d.atomIds.length,
      },
    }, { status: 201 });
  } catch (e) {
    console.error('[library/canvas POST]', e);
    return NextResponse.json({ error: 'Failed to create canvas', code: 'DB_ERROR' }, { status: 500 });
  }
}
