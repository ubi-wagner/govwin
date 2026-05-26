import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import SourceDetailClient from './source-detail-client';

export const dynamic = 'force-dynamic';

// ── Types for raw DB rows ───────────────────────────────────────────

type SourceProfileRow = {
  id: string;
  name: string;
  siteType: string;
  baseUrl: string;
  bookmarkUrl: string | null;
  agency: string | null;
  programType: string | null;
  adminNotes: string | null;
  visitInstructions: string | null;
  topicUrlPattern: string | null;
  pdfUrlPattern: string | null;
  isActive: boolean;
  lastVisitedAt: Date | null;
  lastVisitedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  autoCrawlEnabled: boolean | null;
  crawlCron: string | null;
  lastCrawlAt: Date | null;
};

type SourceRegionRow = {
  id: string;
  profileId: string;
  name: string;
  selectorHint: string | null;
  contentContext: string | null;
  regionType: string;
  sampleHtml: string | null;
  sampleText: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type SourceDiffRow = {
  id: string;
  profileId: string;
  regionId: string | null;
  isMeaningful: boolean;
  summary: string | null;
  severity: string;
  claudeModel: string | null;
  claudeTokensUsed: number | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  regionName: string | null;
  extractedOpportunities: unknown[] | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Site type badge colors ──────────────────────────────────────────

const SITE_TYPE_COLORS: Record<string, string> = {
  dsip: 'bg-indigo-100 text-indigo-800',
  afwerx: 'bg-blue-100 text-blue-800',
  xtech: 'bg-green-100 text-green-800',
  nsf: 'bg-amber-100 text-amber-800',
  sam_gov: 'bg-gray-100 text-gray-800',
  sbir_gov: 'bg-purple-100 text-purple-800',
  grants_gov: 'bg-teal-100 text-teal-800',
  custom: 'bg-slate-100 text-slate-800',
};

// ── Page ─────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ profileId: string }>;
}

export default async function SourceDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    redirect('/login');
  }

  const { profileId } = await params;
  if (!UUID_RE.test(profileId)) {
    notFound();
  }

  // ── Fetch source profile ───────────────────────────────────────────
  let profileRow: SourceProfileRow | undefined;
  try {
    const [row] = await sql<SourceProfileRow[]>`
      SELECT *
      FROM source_profiles
      WHERE id = ${profileId}::uuid
      LIMIT 1
    `;
    profileRow = row;
  } catch (e) {
    console.error('[admin/sources/[profileId]] profile query failed:', e);
  }

  if (!profileRow) {
    return notFound();
  }

  const profile = profileRow;

  // ── Fetch regions ──────────────────────────────────────────────────
  let regionRows: SourceRegionRow[] = [];
  try {
    regionRows = await sql<SourceRegionRow[]>`
      SELECT id, profile_id, name, selector_hint, content_context,
             region_type, sample_html, sample_text, is_active,
             created_at, updated_at
      FROM source_regions
      WHERE profile_id = ${profileId}::uuid AND is_active = true
      ORDER BY name
    `;
  } catch (e) {
    console.error('[admin/sources/[profileId]] regions query failed:', e);
  }

  // ── Fetch recent diffs ─────────────────────────────────────────────
  let diffRows: SourceDiffRow[] = [];
  try {
    diffRows = await sql<SourceDiffRow[]>`
      SELECT sd.id, sd.profile_id, sd.region_id, sd.is_meaningful,
             sd.summary, sd.severity, sd.claude_model,
             sd.claude_tokens_used, sd.reviewed_by, sd.reviewed_at,
             sd.created_at, sd.extracted_opportunities,
             sr.name AS region_name
      FROM source_diffs sd
      LEFT JOIN source_regions sr ON sr.id = sd.region_id
      WHERE sd.profile_id = ${profileId}::uuid
      ORDER BY sd.created_at DESC
      LIMIT 20
    `;
  } catch (e) {
    console.error('[admin/sources/[profileId]] diffs query failed:', e);
  }

  // ── Serialize for client ───────────────────────────────────────────
  const badgeColor = SITE_TYPE_COLORS[profile.siteType] ?? SITE_TYPE_COLORS.custom;

  const serializedProfile = {
    id: profile.id,
    name: profile.name,
    siteType: profile.siteType,
    baseUrl: profile.baseUrl,
    bookmarkUrl: profile.bookmarkUrl,
    agency: profile.agency,
    programType: profile.programType,
    adminNotes: profile.adminNotes,
    visitInstructions: profile.visitInstructions,
    isActive: profile.isActive,
    autoCrawlEnabled: profile.autoCrawlEnabled ?? false,
    crawlCron: profile.crawlCron ?? null,
    lastCrawlAt: profile.lastCrawlAt?.toISOString() ?? null,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };

  const serializedRegions = regionRows.map((r) => ({
    id: r.id,
    profileId: r.profileId,
    name: r.name,
    selectorHint: r.selectorHint,
    contentContext: r.contentContext,
    regionType: r.regionType,
    sampleHtml: r.sampleHtml,
    sampleText: r.sampleText,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  const serializedDiffs = diffRows.map((d) => ({
    id: d.id,
    profileId: d.profileId,
    regionId: d.regionId,
    isMeaningful: d.isMeaningful,
    summary: d.summary,
    severity: d.severity,
    claudeModel: d.claudeModel,
    claudeTokensUsed: d.claudeTokensUsed,
    reviewedBy: d.reviewedBy,
    reviewedAt: d.reviewedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
    regionName: d.regionName,
    extractedOpportunities: Array.isArray(d.extractedOpportunities) ? d.extractedOpportunities : [],
  }));

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-4">
        <a href="/admin/sources" className="text-sm text-indigo-600 hover:text-indigo-800">
          &larr; Back to Sources
        </a>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold">{profile.name}</h1>
            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${badgeColor}`}>
              {profile.siteType.replace('_', ' ')}
            </span>
          </div>
          {(profile.agency || profile.programType) && (
            <p className="text-sm text-gray-500 mt-1">
              {[profile.agency, profile.programType?.toUpperCase()].filter(Boolean).join(' · ')}
            </p>
          )}
          <a
            href={profile.baseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-1 text-sm font-mono text-blue-600 hover:text-blue-800"
          >
            {profile.baseUrl}
          </a>
        </div>
      </div>

      <SourceDetailClient
        profile={serializedProfile}
        initialRegions={serializedRegions}
        initialDiffs={serializedDiffs}
      />
    </div>
  );
}
