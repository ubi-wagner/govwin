/**
 * PATCH /api/admin/topics/[id]
 *
 * Update a topic's editable fields. Admin-only. Simple JSON body:
 *   { title?, description?, topicStatus?, techFocusAreas? }
 *
 * Emits finder.topic.updated event for the activity feed.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventSingle } from '@/lib/events';

const BodySchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(20000).nullable().optional(),
  topicStatus: z.enum(['open', 'pre_release', 'closed', 'awarded', 'withdrawn']).optional(),
  techFocusAreas: z.array(z.string().max(200)).optional(),
  topicBranch: z.string().max(200).nullable().optional(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    return NextResponse.json({ error: 'rfp_admin role required' }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json();
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;

  try {
    const rows = await sql<{ id: string; solicitationId: string | null }[]>`
      UPDATE opportunities
      SET
        title = COALESCE(${input.title ?? null}, title),
        description = CASE WHEN ${input.description !== undefined ? 't' : 'f'}::bool
                           THEN ${input.description ?? null}
                           ELSE description END,
        topic_status = COALESCE(${input.topicStatus ?? null}, topic_status),
        tech_focus_areas = CASE WHEN ${input.techFocusAreas !== undefined ? 't' : 'f'}::bool
                                 THEN ${input.techFocusAreas ?? []}::text[]
                                 ELSE tech_focus_areas END,
        topic_branch = CASE WHEN ${input.topicBranch !== undefined ? 't' : 'f'}::bool
                            THEN ${input.topicBranch ?? null}
                            ELSE topic_branch END,
        updated_at = now()
      WHERE id = ${id}::uuid
      RETURNING id, solicitation_id
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Topic not found' }, { status: 404 });
    }

    const userId = (session.user as { id?: string; email?: string }).id;
    const userEmail = (session.user as { email?: string }).email;
    await emitEventSingle({
      namespace: 'finder',
      type: 'topic.updated',
      actor: { type: 'user', id: userId ?? 'unknown', email: userEmail ?? undefined },
      payload: {
        topicId: id,
        solicitationId: rows[0].solicitationId,
        changes: Object.keys(input),
      },
    });

    return NextResponse.json({ data: { id, updated: true } });
  } catch (err) {
    console.error('[topics PATCH] failed', err);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}
