import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Legacy library review (library_units tag review) — converged onto /atoms, where
 * the Library tab's detail drawer surfaces tags (confirmed/unconfirmed), lineage,
 * and status curation (approve/archive) on the canonical library_atoms. Redirect.
 */
export default async function LibraryReviewPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  redirect(`/portal/${tenantSlug}/atoms`);
}
