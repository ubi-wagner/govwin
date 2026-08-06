import { redirect } from 'next/navigation';

/**
 * /portal/[tenantSlug] — bare-slug entry. The portal's real surfaces live under sub-routes
 * (/dashboard, /cards, /proposals, …); there was no page at the bare slug, so /portal/<slug>
 * 404'd. Redirect it to the canonical landing (/dashboard), matching /api/enter's fallback.
 */
export default async function PortalIndex({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  redirect(`/portal/${tenantSlug}/dashboard`);
}
