import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import LibraryUploadForm from '@/components/portal/library-upload-form';

/**
 * Library upload page — server component that authenticates, then
 * renders the client-side drag-and-drop upload form.
 */
export default async function LibraryUploadPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  const sessionUser = session.user as {
    id?: string;
    role?: unknown;
    tenantId?: string | null;
  };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) {
    redirect('/login?error=session');
  }

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    redirect('/login');
  }
  const tenantId = tenant.id as string;

  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) {
    redirect('/login');
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Upload Documents</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Upload company documents to your content library. Supported formats:
            PDF, DOCX, DOC, PPTX, PPT, TXT, MD.
          </p>
        </div>
        <a
          href={`/portal/${tenantSlug}/library`}
          className="text-sm text-blue-600 hover:underline"
        >
          Back to Library
        </a>
      </div>
      <LibraryUploadForm tenantSlug={tenantSlug} />
    </div>
  );
}
