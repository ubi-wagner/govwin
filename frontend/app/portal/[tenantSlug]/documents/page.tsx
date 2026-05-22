import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ tenantSlug: string }>;
}

const MIME_ICONS: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'text/plain': 'TXT',
  'text/csv': 'CSV',
  'image/png': 'PNG',
  'image/jpeg': 'JPG',
};

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes === 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function DocumentsPage({ params }: Props) {
  const { tenantSlug } = await params;

  const session = await auth();
  if (!session?.user) redirect('/login');

  const sessionUser = session.user as {
    id?: string;
    role?: unknown;
    tenantId?: string | null;
  };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) redirect('/login?error=session');

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/login');

  const tenantId = tenant.id as string;
  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) redirect('/login');

  const basePath = `/portal/${tenantSlug}`;

  // ── Library uploads (tenant_uploads) ──────────────────────────────
  interface UploadRow {
    id: string;
    fileName: string;
    fileSize: number | null;
    mimeType: string | null;
    processed: boolean;
    createdAt: Date;
  }

  let uploads: UploadRow[] = [];
  try {
    uploads = await sql<UploadRow[]>`
      SELECT id, file_name, file_size, mime_type, processed, created_at
      FROM tenant_uploads
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC
      LIMIT 100
    `;
  } catch (e) {
    console.error('[portal/documents] uploads query failed', e);
  }

  // ── Proposal documents (solicitation_documents for tenant proposals) ─
  interface ProposalDocRow {
    id: string;
    originalFilename: string;
    fileSize: number | null;
    contentType: string | null;
    documentType: string | null;
    createdAt: Date;
    proposalTitle: string;
    proposalId: string;
  }

  let proposalDocs: ProposalDocRow[] = [];
  try {
    proposalDocs = await sql<ProposalDocRow[]>`
      SELECT
        sd.id,
        sd.original_filename,
        sd.file_size,
        sd.content_type,
        sd.document_type,
        sd.created_at,
        p.title AS proposal_title,
        p.id AS proposal_id
      FROM solicitation_documents sd
      JOIN curated_solicitations cs ON cs.id = sd.solicitation_id
      JOIN proposals p ON p.opportunity_id = cs.opportunity_id AND p.tenant_id = ${tenantId}
      ORDER BY sd.created_at DESC
      LIMIT 100
    `;
  } catch (e) {
    console.error('[portal/documents] proposal docs query failed', e);
  }

  const totalCount = uploads.length + proposalDocs.length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Documents</h1>
          <p className="text-sm text-gray-500 mt-1">
            {totalCount} document{totalCount !== 1 ? 's' : ''} across your workspace
          </p>
        </div>
        <Link
          href={`${basePath}/library/upload`}
          className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        >
          Upload Document
        </Link>
      </div>

      {/* Library Uploads */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-4">Library Uploads</h2>
        {uploads.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-300">
            <p className="text-sm text-gray-500">No documents uploaded yet.</p>
            <Link href={`${basePath}/library/upload`} className="text-sm text-blue-600 hover:underline mt-1 inline-block">
              Upload your first document
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">File Name</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Size</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Uploaded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {uploads.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono font-medium bg-gray-100 text-gray-600">
                        {MIME_ICONS[u.mimeType ?? ''] ?? (u.mimeType?.split('/')[1]?.toUpperCase() ?? 'FILE')}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">{u.fileName}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{formatBytes(u.fileSize)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        u.processed ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {u.processed ? 'Processed' : 'Pending'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(u.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Proposal Documents */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Proposal Documents</h2>
        {proposalDocs.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No proposal documents found.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">File Name</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Size</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Proposal</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Uploaded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {proposalDocs.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono font-medium bg-gray-100 text-gray-600">
                        {MIME_ICONS[d.contentType ?? ''] ?? (d.documentType?.toUpperCase() ?? 'FILE')}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">{d.originalFilename}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{formatBytes(d.fileSize)}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`${basePath}/proposals/${d.proposalId}`}
                        className="text-blue-600 hover:underline text-xs"
                      >
                        {d.proposalTitle}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(d.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
