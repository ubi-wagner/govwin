import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';

interface RouteContext {
  params: Promise<{ tenantSlug: string }>;
}

/**
 * POST /api/portal/[tenantSlug]/proposals/create
 *
 * Creates a new proposal for a given topic (opportunity). Admin-granted
 * for the founding cohort — no Stripe required.
 *
 * Input:  { topicId: string }  (opportunities.id — the topic row)
 * Output: { data: { proposalId: string, sectionCount: number } }
 *
 * Steps:
 *   1. Auth + tenant access check (tenant_admin or above)
 *   2. Validate topicId exists and get its solicitation_id
 *   3. Create the proposals row
 *   4. Find the solicitation's volume_required_items
 *   5. Create proposal_sections from required items
 *   6. Emit capture.proposal.purchased event
 */
export async function POST(request: Request, ctx: RouteContext) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    const sessionUser = session.user as {
      id?: string;
      email?: string;
      role?: unknown;
      tenantId?: string | null;
    };

    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json({ error: 'tenant_admin role required' }, { status: 403 });
    }

    const userId = sessionUser.id;
    if (!userId) {
      return NextResponse.json({ error: 'Missing user id in session' }, { status: 401 });
    }

    const { tenantSlug } = await ctx.params;
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(userId, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Tenant access denied' }, { status: 403 });
    }

    // ── Input validation ─────────────────────────────────────────────
    let body: { topicId?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const topicId = body.topicId;
    if (typeof topicId !== 'string' || !topicId.trim()) {
      return NextResponse.json({ error: 'topicId is required' }, { status: 400 });
    }

    // ── Find the topic (opportunity) and its parent solicitation ─────
    const [topic] = await sql<{
      id: string;
      title: string;
      solicitationId: string | null;
      agency: string | null;
      topicNumber: string | null;
    }[]>`
      SELECT id, title, solicitation_id, agency, topic_number
      FROM opportunities
      WHERE id = ${topicId}
    `;

    if (!topic) {
      return NextResponse.json({ error: 'Topic not found' }, { status: 404 });
    }

    if (!topic.solicitationId) {
      return NextResponse.json(
        { error: 'Topic has no linked solicitation' },
        { status: 422 },
      );
    }

    // ── Prevent duplicate proposals for same tenant + topic ──────────
    const [existing] = await sql<{ id: string }[]>`
      SELECT id FROM proposals
      WHERE tenant_id = ${tenantId}
        AND opportunity_id = ${topicId}
      LIMIT 1
    `;
    if (existing) {
      return NextResponse.json(
        { error: 'Proposal already exists for this topic', data: { proposalId: existing.id } },
        { status: 409 },
      );
    }

    // ── Create the proposal ──────────────────────────────────────────
    const proposalTitle = topic.topicNumber
      ? `${topic.topicNumber}: ${topic.title}`
      : topic.title;

    const [proposal] = await sql<{ id: string }[]>`
      INSERT INTO proposals (tenant_id, opportunity_id, solicitation_id, title, stage)
      VALUES (
        ${tenantId},
        ${topicId},
        ${topic.solicitationId},
        ${proposalTitle},
        'outline'
      )
      RETURNING id
    `;

    // ── Find required items from the solicitation's volumes ──────────
    const requiredItems = await sql<{
      id: string;
      itemNumber: number;
      itemName: string;
      pageLimit: number | null;
    }[]>`
      SELECT vri.id, vri.item_number, vri.item_name, vri.page_limit
      FROM volume_required_items vri
      JOIN solicitation_volumes sv ON sv.id = vri.volume_id
      WHERE sv.solicitation_id = ${topic.solicitationId}
      ORDER BY sv.volume_number ASC, vri.item_number ASC
    `;

    // ── Create proposal_sections from required items ─────────────────
    let sectionCount = 0;

    if (requiredItems.length > 0) {
      for (const item of requiredItems) {
        await sql`
          INSERT INTO proposal_sections (
            proposal_id, section_number, title, content, status, page_allocation
          ) VALUES (
            ${proposal.id},
            ${String(item.itemNumber)},
            ${item.itemName},
            ${null},
            'empty',
            ${item.pageLimit}
          )
        `;
        sectionCount++;
      }
    } else {
      // No required items defined — create a single default section
      await sql`
        INSERT INTO proposal_sections (
          proposal_id, section_number, title, content, status
        ) VALUES (
          ${proposal.id},
          '1',
          'Technical Volume',
          ${null},
          'empty'
        )
      `;
      sectionCount = 1;
    }

    // ── Emit event ───────────────────────────────────────────────────
    await emitEventSingle({
      namespace: 'capture',
      type: 'proposal.purchased',
      actor: userActor(userId, sessionUser.email),
      tenantId,
      payload: {
        proposalId: proposal.id,
        topicId,
        solicitationId: topic.solicitationId,
        sectionCount,
        title: proposalTitle,
      },
    });

    return NextResponse.json({
      data: {
        proposalId: proposal.id,
        sectionCount,
      },
    });
  } catch (e) {
    console.error('[api/portal/proposals/create] error:', e);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
