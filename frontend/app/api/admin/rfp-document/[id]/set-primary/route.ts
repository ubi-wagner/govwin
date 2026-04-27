/**
 * POST /api/admin/rfp-document/[id]/set-primary
 *
 * Marks a document as primary for its solicitation and clears the
 * primary flag from all other documents on the same solicitation.
 * Only one document per solicitation should be primary at a time.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'UNAUTHENTICATED' },
      { status: 401 },
    );
  }
  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    return NextResponse.json(
      { error: 'rfp_admin role required', code: 'FORBIDDEN' },
      { status: 403 },
    );
  }

  const { id } = await ctx.params;

  // Look up the document to find its solicitation_id
  const docRows = await sql<{ id: string; solicitationId: string; isPrimary: boolean }[]>`
    SELECT id, solicitation_id, is_primary
    FROM solicitation_documents
    WHERE id = ${id}::uuid
  `;
  if (docRows.length === 0) {
    return NextResponse.json(
      { error: 'Document not found', code: 'NOT_FOUND' },
      { status: 404 },
    );
  }

  const doc = docRows[0];

  try {
    // Clear all primary flags for this solicitation, then set the new one
    await sql`
      UPDATE solicitation_documents
      SET is_primary = false
      WHERE solicitation_id = ${doc.solicitationId}::uuid
        AND is_primary = true
    `;

    await sql`
      UPDATE solicitation_documents
      SET is_primary = true
      WHERE id = ${id}::uuid
    `;

    return NextResponse.json({ data: { id, isPrimary: true } });
  } catch (err) {
    console.error('[set-primary] failed', err);
    return NextResponse.json(
      { error: 'Failed to update primary document', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
