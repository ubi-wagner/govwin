/**
 * PATCH /api/admin/rfp-curation/[solId]/items/[itemId] — decide a required item's disposition.
 *
 *   { disposition: 'external' }  → completed OUTSIDE the workspace; provisioning creates no section
 *   { disposition: 'authored' }  → authored HERE; the item needs a mold (build one, or accept the
 *                                  registry fallback), and it will provision as a section
 *
 * WHY THIS EXISTS. Ingest only ever derives part of a solicitation's shape. On a DoD annual BAA the
 * spec yields the Volume 1 summaries, Volume 2, Volume 3 and some of Volume 5 — the rest is not in
 * the document to be read: a DSIP cover-sheet webform, a Company Commercialization Report pulled
 * from the agency's own system, a Fraud/Waste/Abuse training certificate, a signed DD Form 2345,
 * Reps & Certifications filed in SAM. Somebody has to say, per item, "we build this" or "this is
 * obtained elsewhere".
 *
 * Until now nobody could. `volume_required_items.metadata.dsipOnly` was already read by
 * compliance-resolver and already honoured by provision-proposal (`isAuthoredItem`) — the flag was
 * fully wired end to end and simply had no way to be SET outside a hand-written migration. So every
 * ingested item defaulted to authorable, and the section drafter then wrote four kilobytes of
 * plausible prose into a "DD Form 2345 — Militarily Critical Technical Data Agreement". Measured on
 * a real DoW 2026 build: 10 of 23 sections, every one a form or certification. Empty would have been
 * safer than drafted; what a buyer needs there is the actual signed form.
 *
 * This is the master record, so a decision here reaches every tenant that later provisions from it.
 * rfp_admin+, audited, and platform-scoped (sqlBypass) like the rest of the curation surface.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sqlBypass } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a person can say about an item that the document did not settle. */
const DISPOSITIONS = ['external', 'authored'] as const;
type Disposition = (typeof DISPOSITIONS)[number];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ solId: string; itemId: string }> },
) {
  try {
    const { solId, itemId } = await params;

    const session = await auth();
    const u = session?.user as { id?: string; role?: unknown; email?: string } | undefined;
    const role: Role | null = isRole(u?.role) ? (u!.role as Role) : null;
    if (!u?.id || !role) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'rfp_admin')) {
      return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    if (!UUID_RE.test(solId) || !UUID_RE.test(itemId)) {
      return NextResponse.json({ error: 'Invalid id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    let body: { disposition?: unknown; note?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    const disposition = body.disposition as Disposition;
    if (!DISPOSITIONS.includes(disposition)) {
      return NextResponse.json(
        { error: `disposition must be one of: ${DISPOSITIONS.join(', ')}`, code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // The NOTE is what turns "not authored here" into something the buyer can act on. A checklist
    // row saying only "DD Form 2345 — completed elsewhere" invites the question "elsewhere WHERE?";
    // this carries the answer onto the row at provision. Optional, because the default text ("in the
    // agency submission portal") is right for the common case, and blank CLEARS a stale note.
    const rawNote = body.note;
    if (rawNote !== undefined && typeof rawNote !== 'string') {
      return NextResponse.json({ error: 'note must be a string', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const note = typeof rawNote === 'string' ? rawNote.trim().slice(0, 2000) : undefined;

    // The item must belong to THIS solicitation. Without the join an admin could retarget any item
    // in the system by pairing a real item id with a solicitation they happen to be looking at.
    const external = disposition === 'external';
    const rows = await sqlBypass<Array<{ id: string; itemName: string; volumeNumber: number }>>`
      UPDATE volume_required_items vri
         SET metadata = COALESCE(vri.metadata, '{}'::jsonb) || ${sqlBypass.json({ dsipOnly: external })},
             expert_notes = ${note === undefined ? sqlBypass`vri.expert_notes` : (note || null)}
        FROM solicitation_volumes sv
       WHERE sv.id = vri.volume_id
         AND vri.id = ${itemId}::uuid
         AND sv.solicitation_id = ${solId}::uuid
      RETURNING vri.id, vri.item_name AS "itemName", sv.volume_number AS "volumeNumber"`;

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Item not found on this solicitation', code: 'NOT_FOUND' }, { status: 404 });
    }

    await emitEventSingle({
      namespace: 'finder',
      type: 'required_item.disposition_set',
      actor: userActor(u.id, u.email ?? undefined),
      tenantId: null,
      payload: { solicitationId: solId, note: note ?? null, itemId, disposition, itemName: rows[0].itemName, volumeNumber: rows[0].volumeNumber },
    });

    return NextResponse.json({ data: { itemId, disposition, itemName: rows[0].itemName } });
  } catch (err) {
    console.error('[rfp-curation/items] PATCH error', err);
    return NextResponse.json({ error: 'Could not set the disposition', code: 'DB_ERROR' }, { status: 500 });
  }
}
