import { redirect } from 'next/navigation';
import { auth } from '@/auth';
// `sqlBypass`, deliberately, for the TARGET LOOKUP ONLY — see the comment at the query.
import { sql, sqlBypass } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { getActiveMemberships } from '@/lib/memberships';
import { DeepLinkGate } from '@/components/portal/deep-link-gate';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /go — the deep-link landing for nudge / notification emails (from
 * platform@rfppipeline.com). It ALWAYS lands the recipient acting in the RIGHT company,
 * auditably, whatever their session state:
 *   - not signed in            → login, then /api/enter pins the target + lands
 *   - signed in to the target  → a quick "you're in X" confirm → their task/queue
 *   - signed in to ANOTHER co.  → sign out + re-login to the target (singular session)
 *   - multi-membership, unpinned → pin the target (first pick) + land
 *   - admin                     → straight in (they shadow)
 * Old links are checked against the task's state (completed/cancelled/expired) and the
 * proposal's stage (archived/submitted): a dead link routes to the company queue with a
 * "already done" note rather than a broken destination. See MULTI_MEMBERSHIP_IDENTITY_DESIGN.
 */
export default async function GoPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string; tenant?: string; next?: string }>;
}) {
  const { task: taskId, tenant: tenantParam, next: nextParam } = await searchParams;

  // ── Resolve target company + destination + whether the work is already done ──
  let targetSlug: string | null = null;
  let targetName: string | null = null;
  let dest: string | null = null;
  let taskDone = false;

  if (taskId && UUID_RE.test(taskId)) {
    try {
      // ── THE LOOKUP THAT DECIDES WHICH TENANT TO ENTER CANNOT ITSELF BE TENANT-SCOPED ──────
      //
      // `tasks` has row-level security, so under the request's (as yet unset) tenant context the
      // context-aware `sql` cannot see a TENANT-SCOPED task at all. And it cannot be set: working
      // out which tenant to enter is the entire job of this query. The result was that every
      // notification deep-link to a tenant task — section review, draft, acknowledge, every
      // workflow to-do — fell through `!targetSlug` to `redirect('/portal')` and dropped the
      // recipient on a dashboard instead of the work the email pointed at.
      //
      // It survived because PLATFORM-scope tasks (`tenant_id IS NULL`) ARE visible without a
      // context, via the `OR (tenant_id IS NULL)` arm — so every admin-facing deep link worked,
      // and the broken half was the customer-facing half. Measured, not guessed: the same query
      // as `govtech_app` returns nothing for a tenant task and the slug for a platform one.
      //
      // This read is the platform plane doing dispatch, which is the documented `sqlBypass` case.
      // It grants NOTHING: authorisation is still `getActiveMemberships` below, unchanged — a
      // person who is not a member of the resolved tenant is sent to the dispatcher exactly as
      // before. All this restores is the ability to READ which tenant the link refers to.
      const [row] = await sqlBypass<
        {
          status: string;
          entityType: string | null;
          entityId: string | null;
          slug: string | null;
          name: string | null;
          propStage: string | null;
        }[]
      >`
        SELECT t.status, t.entity_type, t.entity_id, tn.slug, tn.name, p.stage AS prop_stage
        FROM tasks t
        LEFT JOIN tenants tn ON tn.id = t.tenant_id
        LEFT JOIN proposals p ON p.id = t.entity_id AND t.entity_type = 'proposal'
        WHERE t.id = ${taskId}::uuid
        LIMIT 1
      `;
      if (row?.slug) {
        targetSlug = row.slug;
        targetName = row.name;
        const stageDead = !!row.propStage && ['archived', 'submitted'].includes(row.propStage);
        taskDone = ['completed', 'cancelled', 'expired'].includes(row.status) || stageDead;
        if (!taskDone && row.entityType === 'proposal' && row.entityId) {
          dest = `/portal/${row.slug}/proposals/${row.entityId}`;
        } else {
          dest = `/portal/${row.slug}/dashboard`;
        }
      }
    } catch (e) {
      console.error('[go] task lookup failed:', e);
    }
  } else if (tenantParam?.trim()) {
    const slug = tenantParam.trim();
    try {
      const [t] = await sql<{ slug: string; name: string }[]>`SELECT slug, name FROM tenants WHERE slug = ${slug} LIMIT 1`;
      if (t) {
        targetSlug = t.slug;
        targetName = t.name;
        dest = `/portal/${t.slug}/dashboard`;
      }
    } catch (e) {
      console.error('[go] tenant lookup failed:', e);
    }
  }

  // Honour an explicit next only if it's inside the target company's portal (no open redirect).
  if (
    nextParam &&
    targetSlug &&
    (nextParam === `/portal/${targetSlug}` || nextParam.startsWith(`/portal/${targetSlug}/`)) &&
    !nextParam.includes('..') &&
    !nextParam.includes('://')
  ) {
    dest = nextParam;
  }

  if (!targetSlug || !dest) redirect('/portal'); // unknown target → dispatcher
  const enterUrl = `/api/enter?slug=${encodeURIComponent(targetSlug)}&next=${encodeURIComponent(dest)}`;

  // ── Auth ──
  const session = await auth();
  if (!session?.user) redirect(`/login?from=${encodeURIComponent(enterUrl)}`);
  const u = session.user as { id?: string; role?: unknown; tenantSlug?: string | null; membershipPinned?: boolean };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id) redirect('/login?error=session');

  // Admins shadow freely → straight in.
  if (hasRoleAtLeast(role, 'rfp_admin')) redirect(dest);

  // Non-admin: must hold an active membership at the (non-archived) target.
  const memberships = await getActiveMemberships(u.id);
  const target = memberships.find((m) => m.tenantSlug === targetSlug);
  if (!target) redirect('/portal'); // no access / archived → dispatcher shows the message

  const sessionSlug = u.tenantSlug ?? null;
  const pinned = u.membershipPinned === true;

  // Committed to a DIFFERENT company → singular session: sign out + re-login into target.
  // Re-login goes back through /go (not /api/enter) so a fresh not-yet-pinned session is
  // routed correctly (a multi-membership user must be PINNED to the target, not just land).
  if (pinned && sessionSlug && sessionSlug !== targetSlug) {
    const fromName = memberships.find((m) => m.tenantSlug === sessionSlug)?.tenantName ?? 'your current company';
    const backToGo = `/go?tenant=${encodeURIComponent(targetSlug)}${nextParam ? `&next=${encodeURIComponent(dest)}` : ''}`;
    const relogin = `/login?from=${encodeURIComponent(backToGo)}&switchedTo=${encodeURIComponent(target.tenantName)}&switchedFrom=${encodeURIComponent(fromName)}`;
    return <DeepLinkGate mode="switch" toCompany={target.tenantName} fromCompany={fromName} reloginUrl={relogin} />;
  }

  // Effectively committed to the target — pinned to it, OR single-membership (their one
  // company, no pin needed) → confirm + continue. A NOT-pinned multi-membership user
  // (even if their home slug happens to match) still needs to PIN first, so they fall
  // through to /api/enter below.
  if ((pinned && sessionSlug === targetSlug) || memberships.length === 1) {
    return <DeepLinkGate mode="here" toCompany={target.tenantName} dest={dest} taskDone={taskDone} />;
  }

  // Multi-membership, not yet committed → pin the target (first pick) + land.
  redirect(enterUrl);
}
