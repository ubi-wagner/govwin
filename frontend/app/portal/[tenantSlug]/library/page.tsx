import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';

/**
 * Library list page — shows all library_units for this tenant.
 *
 * Supports optional category filter via ?category= query param.
 */

interface LibraryRow {
  id: string;
  content: string;
  category: string;
  subcategory: string | null;
  tags: string[];
  status: string;
  sourceType: string | null;
  createdAt: string;
}

export default async function LibraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantSlug } = await params;
  const resolvedSearchParams = await searchParams;

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

  const basePath = `/portal/${tenantSlug}`;

  // Category filter
  const categoryParam =
    typeof resolvedSearchParams.category === 'string'
      ? resolvedSearchParams.category
      : undefined;

  // ---------- Fetch library units ----------
  let units: LibraryRow[] = [];
  try {
    if (categoryParam) {
      units = await sql<LibraryRow[]>`
        SELECT id, content, category, subcategory, tags, status, source_type, created_at
        FROM library_units
        WHERE tenant_id = ${tenantId} AND category = ${categoryParam}
        ORDER BY created_at DESC
        LIMIT 200
      `;
    } else {
      units = await sql<LibraryRow[]>`
        SELECT id, content, category, subcategory, tags, status, source_type, created_at
        FROM library_units
        WHERE tenant_id = ${tenantId}
        ORDER BY created_at DESC
        LIMIT 200
      `;
    }
  } catch (e) {
    console.error('[library] query failed', e);
  }

  // ---------- Distinct categories for filter ----------
  let categories: string[] = [];
  try {
    const catRows = await sql<{ category: string }[]>`
      SELECT DISTINCT category FROM library_units
      WHERE tenant_id = ${tenantId}
      ORDER BY category
    `;
    categories = catRows.map((r) => r.category);
  } catch (e) {
    console.error('[library] categories query failed', e);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Content Library</h1>
          <p className="text-gray-500 mt-1 text-sm">
            {units.length} item{units.length !== 1 ? 's' : ''}
            {categoryParam ? ` in "${categoryParam}"` : ''}
          </p>
        </div>
        <a
          href={`${basePath}/library/upload`}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Upload Documents
        </a>
      </div>

      {/* Category filter */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <a
            href={`${basePath}/library`}
            className={`px-3 py-1 rounded-full text-xs font-medium border ${
              !categoryParam
                ? 'bg-blue-100 border-blue-300 text-blue-700'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            All
          </a>
          {categories.map((cat) => (
            <a
              key={cat}
              href={`${basePath}/library?category=${encodeURIComponent(cat)}`}
              className={`px-3 py-1 rounded-full text-xs font-medium border ${
                categoryParam === cat
                  ? 'bg-blue-100 border-blue-300 text-blue-700'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {cat}
            </a>
          ))}
        </div>
      )}

      {/* Library items table */}
      {units.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-lg">No library items yet.</p>
          <p className="text-sm mt-2">
            <a
              href={`${basePath}/library/upload`}
              className="text-blue-600 hover:underline"
            >
              Upload your first documents
            </a>{' '}
            to get started.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">
                  Category
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">
                  Content
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">
                  Status
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">
                  Tags
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">
                  Created
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {units.map((unit) => (
                <tr key={unit.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                      {unit.category}
                    </span>
                    {unit.subcategory && (
                      <span className="text-xs text-gray-400 ml-1">
                        / {unit.subcategory}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 max-w-md">
                    <p className="truncate text-gray-700">
                      {unit.content.length > 120
                        ? unit.content.slice(0, 120) + '...'
                        : unit.content}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={unit.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(unit.tags ?? []).slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="inline-block px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-600"
                        >
                          {tag}
                        </span>
                      ))}
                      {(unit.tags ?? []).length > 3 && (
                        <span className="text-xs text-gray-400">
                          +{unit.tags.length - 3}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                    {new Date(unit.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: 'bg-yellow-50 text-yellow-700',
    approved: 'bg-green-50 text-green-700',
    archived: 'bg-gray-100 text-gray-500',
  };
  const cls = colors[status] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}
