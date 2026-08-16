/**
 * POST /api/portal/[tenantSlug]/atoms/propose-regions   (JSON: { width, height })
 *
 * The "machine draws the boxes" step (BOX-2): given a rendered frame's geometry, return proposed
 * bounding-box regions for the figures/tables worth grabbing. The client PRE-POPULATES the box
 * tool with them; the human confirms/edits/deletes before anything is atomized (advisory — never
 * writes a business row here). Tenant-isolated via verifyTenantAccess.
 *
 * VISION-GATED (honest-inert by default): a vision model would look at the actual frame pixels and
 * detect regions (engine 'vision'). None is wired yet, so this route reports `available:false` and
 * returns NO regions — it never presents a fixed heuristic as if it were AI. A deterministic demo
 * stand-in (`proposeDemoRegions`) is opt-in for dev/demo via REGION_PROPOSER=demo (engine 'demo').
 * When a vision model is wired, this reads the frame image + calls the detector (engine 'vision') —
 * a server-only swap; the client consumes `{ regions, engine, available }` unchanged.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { proposeDemoRegions } from '@/lib/propose-regions';

const MAX_DIM = 20000; // guard absurd frames

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    const u = session.user as { id?: string; role?: unknown };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    // Same authority as capture: collaborators (partner_user) may propose too.
    if (!hasRoleAtLeast(role, 'partner_user')) return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    if (!(await verifyTenantAccess(u.id, role, tenant.id as string))) return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });

    let body: { width?: unknown; height?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Expected JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    const width = Math.floor(Number(body.width));
    const height = Math.floor(Number(body.height));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > MAX_DIM || height > MAX_DIM) {
      return NextResponse.json({ error: 'width and height must be positive frame dimensions', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // TODO(vision): when a vision model is configured, read the frame image here → engine 'vision'.
    // Default is honest-inert: no detector wired → no regions + available:false (never fake AI output).
    // The deterministic demo stand-in is opt-in for dev/demo only.
    const engine = process.env.REGION_PROPOSER === 'demo' ? 'demo' : 'off';
    const regions = engine === 'demo' ? proposeDemoRegions(width, height) : [];
    return NextResponse.json({ data: { regions, engine, available: engine !== 'off' } });
  } catch (err) {
    console.error('[atoms/propose-regions] error', err);
    return NextResponse.json({ error: 'Could not propose regions', code: 'SERVER_ERROR' }, { status: 500 });
  }
}
