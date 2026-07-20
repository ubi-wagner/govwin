import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Legacy library upload (→ library_units) — converged onto /atoms, where the
 * "Upload package" tab drops a whole proposal package and auto-atomizes it into the
 * canonical library_atoms with taxonomy + context tags. Kept as a redirect.
 */
export default async function LibraryUploadPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  redirect(`/portal/${tenantSlug}/atoms`);
}
