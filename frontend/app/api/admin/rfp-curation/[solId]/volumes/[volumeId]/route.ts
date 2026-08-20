/**
 * PATCH /api/admin/rfp-curation/[solId]/volumes/[volumeId] — decide a whole volume's disposition.
 *
 *   { disposition: 'external' }  → the entire volume is completed outside the workspace
 *   { disposition: 'authored' }  → authored here (the default)
 *
 * WHY A VOLUME-LEVEL TWIN OF THE ITEM ROUTE. Marking items covers most of a solicitation, but not
 * all of it: a volume can carry NO required items at all. On the DoW 2026 SBIR annual BAA, Volume 7
 * — "Disclosures of Foreign Affiliations or Relationships to Foreign Countries" — has zero items,
 * and provisioning has a deliberate fallback that stands up a single placeholder section for exactly
 * that case (provision-proposal.ts, the volume-with-no-items branch). So the item route could never
 * reach it: there was nothing to mark, and the volume provisioned as an authorable section that the
 * drafter then filled with prose.
 *
 * `solicitation_volumes.metadata.dsipOnly` is the lever, and like its item-level counterpart it was
 * already read by compliance-resolver and already honoured by provision-proposal — wired end to end
 * with no way to set it. This is that way.
 *
 * Master record → the decision reaches every tenant provisioning from it. rfp_admin+, audited,
 * platform-scoped (sqlBypass) like the rest of the curation surface.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sqlBypass } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DISPOSITIONS = ['external', 'authored'] as const;
type Disposition = (typeof DISPOSITIONS)[number];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ solId: string; volumeId: string }> },
) {
  try {
    const { solId, volumeId } = await params;

    const session = await auth();
    const u = session?.user as { id?: string; role?: unknown; email?: string } | undefined;
    const role: Role | null = isRole(u?.role) ? (u!.role as Role) : null;
    if (!u?.id || !role) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'rfp_admin')) {
      return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    if (!UUID_RE.test(solId) || !UUID_RE.test(volumeId)) {
      return NextResponse.json({ error: 'Invalid id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    let body: { disposition?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    const disposition = body.disposition as Disposition;
    if (!DISPOSITIONS.includes(disposition)) {
      return NextResponse.json(
        { error: `disposition must be one of: ${DISPOSITIONS.join(', ')}`, code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // Scoped by solicitation for the same reason as the item route: a real volume id paired with
    // someone else's solicitation must not retarget their build.
    const external = disposition === 'external';
    const rows = await sqlBypass<Array<{ id: string; volumeNumber: number; volumeName: string }>>`
      UPDATE solicitation_volumes
         SET metadata = COALESCE(metadata, '{}'::jsonb) || ${sqlBypass.json({ dsipOnly: external })}
       WHERE id = ${volumeId}::uuid AND solicitation_id = ${solId}::uuid
      RETURNING id, volume_number AS "volumeNumber", volume_name AS "volumeName"`;

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Volume not found on this solicitation', code: 'NOT_FOUND' }, { status: 404 });
    }

    await emitEventSingle({
      namespace: 'finder',
      type: 'solicitation_volume.disposition_set',
      actor: userActor(u.id, u.email ?? undefined),
      tenantId: null,
      payload: { solicitationId: solId, volumeId, disposition, volumeNumber: rows[0].volumeNumber, volumeName: rows[0].volumeName },
    });

    return NextResponse.json({ data: { volumeId, disposition, volumeName: rows[0].volumeName } });
  } catch (err) {
    console.error('[rfp-curation/volumes] PATCH error', err);
    return NextResponse.json({ error: 'Could not set the disposition', code: 'DB_ERROR' }, { status: 500 });
  }
}
