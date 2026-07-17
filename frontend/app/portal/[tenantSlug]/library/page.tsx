import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Legacy library (library_units) — converged onto the canonical unified library
 * surface (/atoms), which now covers browse/curate (tag+status filters, usage,
 * lineage, uploaded/returned badges, archive, detail), package upload →
 * auto-atomize, and hand-shred. Kept as a redirect so old links/bookmarks land on
 * the new surface. Prior implementation is in git history (git log -- this file).
 */
export default async function LibraryPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  redirect(`/portal/${tenantSlug}/atoms`);
}
