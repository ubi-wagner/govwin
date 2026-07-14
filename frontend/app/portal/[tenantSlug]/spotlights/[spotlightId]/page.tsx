import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Legacy Spotlight detail — converged onto the Greenfield Opportunities surface
 * (/cards). Kept as a redirect so old links land on the new surface; the prior
 * implementation is in git history.
 */
export default async function SpotlightDetailPage({ params }: { params: Promise<{ tenantSlug: string; spotlightId: string }> }) {
  const { tenantSlug } = await params;
  redirect(`/portal/${tenantSlug}/cards`);
}
