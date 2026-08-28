/**
 * This project's notification policy — the THIRD level of the automation model.
 *
 *   GET   — what each project trigger currently resolves to, and WHICH LEVEL decided it.
 *   PATCH — set or clear this project's override for one trigger.
 *
 * A field sent as `null` CLEARS back to inherit, which is a different act from setting it to the
 * value the tenant currently has: the second stops tracking the moment the tenant changes theirs.
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { getProject } from '@/lib/projects/project';
import { canAssign } from '@/lib/projects/access';
import {
  resolveProjectNotify, setProjectNotify, PROJECT_TRIGGERS, type ProjectTrigger,
} from '@/lib/projects/notify-policy';
import { TRIGGER_CATALOG } from '@/lib/automation/catalog';

type Ctx = { params: Promise<{ tenantSlug: string; projectId: string }> };

const isProjectTrigger = (v: unknown): v is ProjectTrigger =>
  typeof v === 'string' && (PROJECT_TRIGGERS as readonly string[]).includes(v);

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      if (!(await getProject(gate.actor, projectId))) {
        return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });
      }
      const triggers = await Promise.all(PROJECT_TRIGGERS.map(async (t) => {
        const resolved = await resolveProjectNotify(gate.actor.tenantId, projectId, t);
        const meta = TRIGGER_CATALOG.find((c) => c.scope === 'project' && c.triggerKey === t);
        return {
          trigger: t,
          label: meta?.label ?? t,
          help: meta?.help ?? '',
          // The dial must never lie: the editor renders a 'preview' trigger as not-yet-delivering.
          deliveryStatus: meta?.deliveryStatus ?? 'preview',
          ...resolved,
        };
      }));
      return NextResponse.json({ data: { triggers } });
    });
  } catch (err) {
    console.error('[api/portal/projects/notifications GET]', err);
    return NextResponse.json({ error: 'Failed to load the notification policy', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      if (!canAssign(gate.actor.role)) {
        return NextResponse.json(
          { error: 'Only a tenant admin can change this project’s notification policy', code: 'FORBIDDEN' },
          { status: 403 },
        );
      }
      if (!(await getProject(gate.actor, projectId))) {
        return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });
      }

      let body: Record<string, unknown>;
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      if (!isProjectTrigger(body.trigger)) {
        return NextResponse.json(
          { error: `trigger must be one of ${PROJECT_TRIGGERS.join(', ')}`, code: 'VALIDATION_ERROR' },
          { status: 400 },
        );
      }
      // `undefined` leaves a field alone; `null` clears it to inherit. Distinguished on purpose.
      const ok = await setProjectNotify(gate.actor.tenantId, projectId, body.trigger, {
        enabled: body.enabled === null ? null : typeof body.enabled === 'boolean' ? body.enabled : undefined,
        nudgeDays: body.nudgeDays === null ? null : Array.isArray(body.nudgeDays) ? body.nudgeDays.map(Number) : undefined,
        channel: body.channel === null ? null : (body.channel as never) ?? undefined,
      });
      if (!ok) {
        return NextResponse.json({ error: 'Failed to save the policy', code: 'DB_ERROR' }, { status: 500 });
      }
      const resolved = await resolveProjectNotify(gate.actor.tenantId, projectId, body.trigger);
      return NextResponse.json({ data: { trigger: body.trigger, ...resolved } });
    });
  } catch (err) {
    console.error('[api/portal/projects/notifications PATCH]', err);
    return NextResponse.json({ error: 'Failed to save the policy', code: 'DB_ERROR' }, { status: 500 });
  }
}
