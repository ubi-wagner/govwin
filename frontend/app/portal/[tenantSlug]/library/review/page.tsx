import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import AtomReviewWrapper from '@/components/portal/atom-review-wrapper';

/**
 * Library atom review page — server component that loads draft atoms
 * after document upload + atomization, then renders the AtomReview
 * client component for triage.
 */

interface DraftRow {
  id: string;
  content: string;
  category: string;
  tags: string[];
  confidence: number;
  metadata?: {
    source_filename?: string;
    heading_text?: string;
    canvas_nodes?: unknown;
    title?: string;
    author?: string;
    page_count?: number;
  } | null;
}

export default async function LibraryReviewPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  // ---------- Auth ----------
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

  // ---------- Load draft atoms ----------
  // The metadata column may not exist on the base table. Try with it first;
  // fall back to a query without it.
  let rows: DraftRow[] = [];
  try {
    rows = await sql<DraftRow[]>`
      SELECT id, content, category, tags, confidence, metadata
      FROM library_units
      WHERE tenant_id = ${tenantId}::uuid
        AND status = 'draft'
        AND content != '[pending extraction]'
      ORDER BY created_at DESC
      LIMIT 200
    `;
  } catch {
    // metadata column likely doesn't exist — query without it
    try {
      rows = await sql<DraftRow[]>`
        SELECT id, content, category, tags, confidence
        FROM library_units
        WHERE tenant_id = ${tenantId}::uuid
          AND status = 'draft'
          AND content != '[pending extraction]'
        ORDER BY created_at DESC
        LIMIT 200
      `;
    } catch (e) {
      console.error('[library/review] query failed', e);
    }
  }

  // ---------- No atoms: empty state ----------
  if (rows.length === 0) {
    return (
      <div className="max-w-3xl mx-auto text-center py-16">
        <h1 className="text-2xl font-bold mb-2">No Atoms to Review</h1>
        <p className="text-gray-500 mb-6">
          There are no draft atoms awaiting review. Upload a document and run
          atomization first, or all atoms have already been reviewed.
        </p>
        <a
          href={`/portal/${tenantSlug}/library`}
          className="text-sm text-blue-600 hover:underline"
        >
          Back to Library
        </a>
      </div>
    );
  }

  // ---------- Transform rows into component props ----------
  // Extract source filename from metadata or tags
  let sourceFilename = 'Unknown document';
  const firstMeta = rows[0]?.metadata;
  if (firstMeta?.source_filename) {
    sourceFilename = firstMeta.source_filename;
  } else {
    for (const row of rows) {
      const sourceTag = (row.tags ?? []).find((t) => t.startsWith('source:'));
      if (sourceTag) {
        sourceFilename = sourceTag.replace('source:', '');
        break;
      }
    }
  }

  const documentMetadata = firstMeta
    ? {
        title: firstMeta.title,
        author: firstMeta.author,
        pageCount: firstMeta.page_count,
      }
    : undefined;

  const atoms = rows.map((row) => ({
    id: row.id,
    content: row.content,
    category: row.category,
    tags: row.tags ?? [],
    headingText: row.metadata?.heading_text ?? null,
    confidence: row.confidence ?? 0.5,
    canvasNodes: row.metadata?.canvas_nodes,
  }));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div />
        <a
          href={`/portal/${tenantSlug}/library`}
          className="text-sm text-blue-600 hover:underline"
        >
          Back to Library
        </a>
      </div>
      <AtomReviewWrapper
        tenantSlug={tenantSlug}
        atoms={atoms}
        sourceFilename={sourceFilename}
        documentMetadata={documentMetadata}
        redirectTo={`/portal/${tenantSlug}/library`}
      />
    </div>
  );
}
