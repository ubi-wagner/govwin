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
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'text/plain': 'TXT',
  'text/csv': 'CSV',
  'image/png': 'PNG',
  'image/jpeg': 'JPG',
};

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  empty: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Empty' },
  ai_drafted: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'AI Drafted' },
  in_progress: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'In Progress' },
  human_edited: { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'Edited' },
  completed: { bg: 'bg-green-100', text: 'text-green-700', label: 'Completed' },
  missing: { bg: 'bg-red-100', text: 'text-red-700', label: 'Missing' },
  uploaded: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Uploaded' },
  reviewed: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Reviewed' },
  approved: { bg: 'bg-green-100', text: 'text-green-700', label: 'Approved' },
  waived: { bg: 'bg-gray-100', text: 'text-gray-500', label: 'Waived' },
};

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes === 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? { bg: 'bg-gray-100', text: 'text-gray-600', label: status };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}>
      {style.label}
    </span>
  );
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

  // ── 1. Proposal Sections (from proposal_sections) ─────────────────
  interface SectionRow {
    id: string;
    sectionNumber: string;
    title: string;
    status: string;
    pageAllocation: number | null;
    version: number;
    updatedAt: Date;
    proposalTitle: string;
    proposalId: string;
    proposalStage: string;
  }

  let sections: SectionRow[] = [];
  try {
    sections = await sql<SectionRow[]>`
      SELECT ps.id, ps.section_number, ps.title, ps.status,
             ps.page_allocation, ps.version, ps.updated_at,
             p.title AS proposal_title, p.id AS proposal_id, p.stage AS proposal_stage
      FROM proposal_sections ps
      JOIN proposals p ON p.id = ps.proposal_id
      WHERE p.tenant_id = ${tenantId}
      ORDER BY p.created_at DESC, ps.section_number ASC
      LIMIT 200
    `;
  } catch (e) {
    console.error('[portal/documents] sections query failed', e);
  }

  // ── 2. Supporting Documents (from proposal_supporting_docs) ────────
  interface SupportingDocRow {
    id: string;
    requirementLabel: string;
    requirementSource: string | null;
    category: string;
    isRequired: boolean;
    originalFilename: string | null;
    fileSize: number | null;
    contentType: string | null;
    status: string;
    uploadedAt: Date | null;
    proposalTitle: string;
    proposalId: string;
  }

  let supportingDocs: SupportingDocRow[] = [];
  try {
    supportingDocs = await sql<SupportingDocRow[]>`
      SELECT psd.id, psd.requirement_label, psd.requirement_source,
             psd.category, psd.is_required, psd.original_filename,
             psd.file_size, psd.content_type, psd.status, psd.uploaded_at,
             p.title AS proposal_title, p.id AS proposal_id
      FROM proposal_supporting_docs psd
      JOIN proposals p ON p.id = psd.proposal_id
      WHERE psd.tenant_id = ${tenantId}
        AND psd.category = 'supporting_document'
      ORDER BY p.created_at DESC, psd.requirement_label ASC
      LIMIT 200
    `;
  } catch (e) {
    console.error('[portal/documents] supporting docs query failed', e);
  }

  // ── 3. Library Items (from library_units WHERE source_type = 'upload') ─
  interface LibraryRow {
    id: string;
    title: string | null;
    sourceType: string;
    contentType: string | null;
    storageKey: string | null;
    createdAt: Date;
  }

  let libraryItems: LibraryRow[] = [];
  try {
    libraryItems = await sql<LibraryRow[]>`
      SELECT id, title, source_type, content_type, storage_key, created_at
      FROM library_units
      WHERE tenant_id = ${tenantId}
        AND source_type = 'upload'
      ORDER BY created_at DESC
      LIMIT 100
    `;
  } catch (e) {
    console.error('[portal/documents] library query failed', e);
  }

  // ── 4. Solicitation Source Docs (from solicitation_documents via proposals) ─
  interface SolDocRow {
    id: string;
    originalFilename: string;
    fileSize: number | null;
    contentType: string | null;
    documentType: string | null;
    documentLabel: string | null;
    isPrimary: boolean;
    createdAt: Date;
    proposalTitle: string;
    proposalId: string;
  }

  let solDocs: SolDocRow[] = [];
  try {
    solDocs = await sql<SolDocRow[]>`
      SELECT DISTINCT ON (sd.id)
        sd.id,
        sd.original_filename,
        sd.file_size,
        sd.content_type,
        sd.document_type,
        sd.document_label,
        sd.is_primary,
        sd.created_at,
        p.title AS proposal_title,
        p.id AS proposal_id
      FROM solicitation_documents sd
      JOIN proposals p ON p.solicitation_id = sd.solicitation_id
      WHERE p.tenant_id = ${tenantId}
      ORDER BY sd.id, sd.is_primary DESC, sd.created_at DESC
      LIMIT 100
    `;
  } catch (e) {
    console.error('[portal/documents] sol docs query failed', e);
  }

  const totalCount = sections.length + supportingDocs.length + libraryItems.length + solDocs.length;

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

      {/* Proposal Sections */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-4">Proposal Sections</h2>
        <p className="text-xs text-gray-500 mb-3">Volume sections from your active proposals</p>
        {sections.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-300">
            <p className="text-sm text-gray-500">No proposal sections yet.</p>
            <Link href={`${basePath}/proposals`} className="text-sm text-blue-600 hover:underline mt-1 inline-block">
              Create a proposal to get started
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Section</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Title</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Pages</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Proposal</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Modified</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sections.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{s.sectionNumber}</td>
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">
                      <Link
                        href={`${basePath}/proposals/${s.proposalId}/sections/${s.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        {s.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {s.pageAllocation ? `${s.pageAllocation}p` : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`${basePath}/proposals/${s.proposalId}`}
                        className="text-blue-600 hover:underline text-xs"
                      >
                        {s.proposalTitle}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(s.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Supporting Documents */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-4">Supporting Documents</h2>
        <p className="text-xs text-gray-500 mb-3">Required and optional documents from the compliance matrix</p>
        {supportingDocs.length === 0 ? (
          <p className="text-sm text-gray-400 italic py-4">No supporting documents defined yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Requirement</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Source</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">File</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Size</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Proposal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {supportingDocs.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">
                      <span className="flex items-center gap-1.5">
                        {d.requirementLabel}
                        {d.isRequired && (
                          <span className="inline-flex items-center rounded px-1 py-0.5 text-[10px] font-semibold bg-red-50 text-red-600 border border-red-200">
                            REQ
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{d.requirementSource ?? '-'}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={d.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-xs max-w-[200px] truncate">
                      {d.originalFilename ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">{formatBytes(d.fileSize)}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`${basePath}/proposals/${d.proposalId}`}
                        className="text-blue-600 hover:underline text-xs"
                      >
                        {d.proposalTitle}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Library Items */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-4">Library Uploads</h2>
        <p className="text-xs text-gray-500 mb-3">Uploaded files atomized into your content library</p>
        {libraryItems.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-300">
            <p className="text-sm text-gray-500">No library uploads yet.</p>
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
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Title</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Source</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Uploaded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {libraryItems.map((li) => (
                  <tr key={li.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono font-medium bg-gray-100 text-gray-600">
                        {MIME_ICONS[li.contentType ?? ''] ?? 'FILE'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">
                      <Link
                        href={`${basePath}/library/${li.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        {li.title ?? 'Untitled'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{li.sourceType}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(li.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Solicitation Source Docs */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Solicitation Source Documents</h2>
        <p className="text-xs text-gray-500 mb-3">Original RFP/BAA documents from your proposals</p>
        {solDocs.length === 0 ? (
          <p className="text-sm text-gray-400 italic py-4">No solicitation documents found.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">File Name</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Size</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Label</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Proposal</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {solDocs.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono font-medium bg-gray-100 text-gray-600">
                        {MIME_ICONS[d.contentType ?? ''] ?? (d.documentType?.toUpperCase() ?? 'FILE')}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">
                      <span className="flex items-center gap-1.5">
                        {d.originalFilename}
                        {d.isPrimary && (
                          <span className="inline-flex items-center rounded px-1 py-0.5 text-[10px] font-semibold bg-blue-50 text-blue-600 border border-blue-200">
                            PRIMARY
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">{formatBytes(d.fileSize)}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{d.documentLabel ?? d.documentType ?? '-'}</td>
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
