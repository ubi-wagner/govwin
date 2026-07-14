import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Legacy Spotlight feed — converged onto the Greenfield Opportunities surface
 * (/cards), the canonical customer opportunity view fed by the bridge
 * (tenant_opportunity_cards). Kept as a redirect so old links/bookmarks land on
 * the new surface. The prior tenant_pipeline_items implementation is in git
 * history (git log -- this file).
 */
export default async function SpotlightsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  redirect(`/portal/${tenantSlug}/cards`);
}
