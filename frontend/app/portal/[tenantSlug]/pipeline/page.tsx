import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Legacy Pipeline (pinned tenant_pipeline_items) — converged onto the Greenfield
 * Opportunities surface (/cards), where pin state lives on tenant_opportunity_cards.
 * Kept as a redirect so old links/bookmarks land on the new surface. The prior
 * implementation is in git history (git log -- this file).
 */
export default async function PipelinePage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  redirect(`/portal/${tenantSlug}/cards`);
}
