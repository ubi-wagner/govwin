/**
 * POST /api/portal/[tenantSlug]/atoms/capture  (multipart)
 *
 * Screen-capture → annotate → atomize. The browser captures a frame (getDisplayMedia),
 * the user boxes it into regions and tags each, and each region arrives here as a cropped
 * PNG → a tagged DRAFT image atom in the tenant library (anchored to a reference atom for
 * the whole frame, optionally grouped into a section). One-way, tenant-isolated.
 *
 * Fields: full (File?, the frame) · region_0..region_N (File, boxed crops) ·
 *   regions (JSON [{title?, tags?:[{dimension,value}]}]) · sourceUrl? · note? · groupName? · context?(JSON)
 *
 * Thin wrapper over `lib/atomize-capture` (the drivable core); tenant-isolated via
 * verifyTenantAccess + RLS on every write.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { contextTags } from '@/lib/atomize-package';
import { atomizeCaptureIntoLibrary, MAX_REGIONS, MAX_CAPTURE_BYTES, type CaptureRegionInput, type CaptureImage } from '@/lib/atomize-capture';
import type { AtomTagInput, CreatorKind } from '@/lib/atoms';
import { emitEventSingle, userActor } from '@/lib/events';

async function toImage(f: File): Promise<CaptureImage> {
  return { buffer: Buffer.from(await f.arrayBuffer()), contentType: f.type || 'image/png' };
}

function sanitizeTags(raw: unknown): AtomTagInput[] {
  if (!Array.isArray(raw)) return [];
  const ALLOWED = new Set(['vol', 'kind', 'fmt', 'party_role', 'access', 'tech', 'party', 'topic', 'agency', 'program', 'phase', 'sol', 'dept']);
  const out: AtomTagInput[] = [];
  for (const t of raw) {
    const dim = typeof t?.dimension === 'string' ? t.dimension : '';
    const val = typeof t?.value === 'string' ? t.value.trim().slice(0, 60) : '';
    if (!ALLOWED.has(dim) || !val) continue;
    out.push({ dimension: dim, value: val, source: 'admin', confirmed: true });
  }
  return out.slice(0, 12);
}

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    const u = session.user as { id?: string; email?: string; role?: unknown };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    // Collaborators (partner_user) may capture too — same as atomize-package (offer content UP).
    if (!hasRoleAtLeast(role, 'partner_user')) return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(u.id, role, tenantId))) return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    const actorKind: CreatorKind = hasRoleAtLeast(role, 'tenant_admin') || role === 'rfp_admin' || role === 'master_admin' ? 'admin' : 'collaborator';

    let form: FormData;
    try { form = await request.formData(); } catch { return NextResponse.json({ error: 'Expected multipart form-data', code: 'VALIDATION_ERROR' }, { status: 400 }); }

    // Region metadata (parallel to region_i files by index).
    let regionMeta: Array<{ title?: string; tags?: unknown }> = [];
    const rawRegions = form.get('regions');
    if (typeof rawRegions === 'string' && rawRegions.trim()) {
      try { const p = JSON.parse(rawRegions); if (Array.isArray(p)) regionMeta = p; } catch { /* ignore */ }
    }

    // Collect region_0..region_N files in index order.
    const regions: CaptureRegionInput[] = [];
    for (let i = 0; i < MAX_REGIONS; i++) {
      const f = form.get(`region_${i}`);
      if (!(f instanceof File)) break;
      if (f.size > MAX_CAPTURE_BYTES) return NextResponse.json({ error: `region ${i} too large (12MB max)`, code: 'VALIDATION_ERROR' }, { status: 413 });
      const meta = regionMeta[i] ?? {};
      regions.push({ ...(await toImage(f)), title: typeof meta.title === 'string' ? meta.title.slice(0, 120) : undefined, tags: sanitizeTags(meta.tags) });
    }
    if (regions.length === 0) return NextResponse.json({ error: 'at least one boxed region is required', code: 'VALIDATION_ERROR' }, { status: 400 });

    const fullFile = form.get('full');
    const full = fullFile instanceof File && fullFile.size <= MAX_CAPTURE_BYTES ? await toImage(fullFile) : undefined;

    let ctx: Record<string, string | undefined> = {};
    const rawCtx = form.get('context');
    if (typeof rawCtx === 'string' && rawCtx.trim()) { try { ctx = JSON.parse(rawCtx); } catch { /* ignore */ } }

    const sourceUrl = typeof form.get('sourceUrl') === 'string' ? String(form.get('sourceUrl')).slice(0, 2000) : undefined;
    const note = typeof form.get('note') === 'string' ? String(form.get('note')).slice(0, 500) : undefined;
    const groupName = typeof form.get('groupName') === 'string' ? String(form.get('groupName')).slice(0, 120) : undefined;

    const result = await atomizeCaptureIntoLibrary(tenantId, tenantSlug, {
      full, regions, sourceUrl, note, groupName, ctxTags: contextTags(ctx), actor: { id: u.id, kind: actorKind },
    });

    await emitEventSingle({
      namespace: 'library',
      type: 'capture.atomized',
      actor: userActor(u.id, u.email ?? undefined),
      tenantId,
      payload: { regions: result.atoms, grouped: !!result.groupId, sourceHost: (() => { try { return sourceUrl ? new URL(sourceUrl).host : null; } catch { return null; } })() },
    });

    return NextResponse.json({
      data: { atoms: result.atoms, referenceId: result.referenceId, groupId: result.groupId, regionIds: result.regionIds, status: 'draft' },
    });
  } catch (err) {
    console.error('[atoms/capture] error', err);
    return NextResponse.json({ error: 'Capture atomization failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
