'use server';

/**
 * Membership selection (singular-session model) — see
 * docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md.
 *
 * A person's session acts as exactly ONE (company, role) at a time. When a
 * multi-membership user picks a company at /select-company, this rewrites the
 * session's active company AND role onto the JWT (unstable_update), then pins it so
 * there is no in-session switch (to change company you log out and back in). Every
 * downstream authz reader — the portal layout, all portal API routes, middleware —
 * then scopes off the SELECTED membership, never the home role.
 */
import { redirect } from 'next/navigation';
import { auth, unstable_update } from '@/auth';
import { getLandingPath, type Role } from '@/lib/rbac';
import { getActiveMemberships } from '@/lib/memberships';

export async function selectCompanyAction(formData: FormData): Promise<void> {
  const session = await auth();
  const u = session?.user as { id?: string; membershipPinned?: boolean } | undefined;
  if (!u?.id) redirect('/login');
  // Re-pick-proof: once committed this session, no in-session switch. (Log out to change.)
  if (u.membershipPinned) redirect('/portal');

  const tenantId = String(formData.get('tenantId') ?? '');
  // NEVER trust the posted tenantId — re-load the caller's own active memberships and
  // confirm the choice is among them (this doubles as the revocation re-check).
  const memberships = await getActiveMemberships(u.id);
  const chosen = memberships.find((m) => m.tenantId === tenantId);
  if (!chosen) redirect('/select-company');

  // Rewrite the session's active membership (company + role) onto the JWT and pin it.
  await unstable_update({
    user: {
      role: chosen.role,
      tenantId: chosen.tenantId,
      tenantSlug: chosen.tenantSlug,
      membershipPinned: true,
    },
  } as unknown as Parameters<typeof unstable_update>[0]);

  redirect(getLandingPath(chosen.role as Role, chosen.tenantSlug) ?? `/portal/${chosen.tenantSlug}/dashboard`);
}
