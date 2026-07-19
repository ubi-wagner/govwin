/**
 * GET /api/enter?slug=<company>&next=<path> — company-specific deep-link landing.
 *
 * Nudge/notification emails (from platform@rfppipeline.com) link here so the recipient
 * lands DIRECTLY in the right company's queue (their notifications / ToDos), even if
 * they belong to several companies. We PIN the target company onto their session
 * (singular-session model) so a multi-membership user skips the company picker and goes
 * straight to that company's landing — then redirect to `next`. Access is still gated:
 * we only pin a company where the user holds an ACTIVE membership at a non-archived
 * tenant. See docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { auth, unstable_update } from '@/auth';
import { getActiveMemberships } from '@/lib/memberships';
import { getLandingPath, isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

/** Only allow an internal path under the target company's portal (no open redirect). */
function safeNext(next: string | null, slug: string): string | null {
  if (!next) return null;
  if (next.includes('..') || next.includes('://') || next.startsWith('//')) return null;
  if (next === `/portal/${slug}` || next.startsWith(`/portal/${slug}/`)) return next;
  return null;
}

export async function GET(req: NextRequest) {
  const url = (p: string) => new URL(p, req.nextUrl.origin);
  const session = await auth();
  const u = session?.user as { id?: string; role?: unknown } | undefined;
  const slug = req.nextUrl.searchParams.get('slug')?.trim() ?? '';
  const next = req.nextUrl.searchParams.get('next');

  if (!u?.id) {
    // Not signed in — send to login, come back here afterwards (preserves the deep link).
    const cb = `/api/enter?slug=${encodeURIComponent(slug)}${next ? `&next=${encodeURIComponent(next)}` : ''}`;
    return NextResponse.redirect(url(`/login?callbackUrl=${encodeURIComponent(cb)}`));
  }
  const role = isRole(u.role) ? u.role : null;
  if (!slug) return NextResponse.redirect(url('/portal'));

  // Admins don't pin (they shadow) — straight to the destination.
  if (role && hasRoleAtLeast(role, 'rfp_admin')) {
    return NextResponse.redirect(url(safeNext(next, slug) ?? `/portal/${slug}/dashboard`));
  }

  // Non-admin: only enter a company where they hold an ACTIVE (non-archived) membership.
  const memberships = await getActiveMemberships(u.id);
  const chosen = memberships.find((m) => m.tenantSlug === slug);
  if (!chosen) return NextResponse.redirect(url('/portal')); // no access / archived → dispatcher

  // Pin the target company onto the session so they land there directly.
  await unstable_update({
    user: { role: chosen.role, tenantId: chosen.tenantId, tenantSlug: chosen.tenantSlug, membershipPinned: true },
  } as unknown as Parameters<typeof unstable_update>[0]);

  const dest = safeNext(next, slug) ?? getLandingPath(chosen.role as Role, chosen.tenantSlug) ?? `/portal/${slug}/dashboard`;
  return NextResponse.redirect(url(dest));
}
