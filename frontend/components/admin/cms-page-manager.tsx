'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CmsBlock {
  id: string;
  slug: string;
  title: string;
  contentType: string;
  body: string;
  excerpt: string | null;
  author: string | null;
  tags: string[];
  published: boolean;
  status: string;
  publishedAt: string | null;
  featuredImage: string | null;
  externalUrl: string | null;
  displayOrder: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface GroupedPage {
  sections: Record<string, CmsBlock[]>;
}

export interface GroupedData {
  pages: Record<string, GroupedPage>;
  blog: CmsBlock[];
  other: CmsBlock[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PAGE_TABS = [
  'homepage', 'about', 'features', 'value', 'pricing',
  'how-it-works', 'engine', 'the-expert', 'security', 'infosec',
  'apply', 'get-started', 'resources', 'blog', 'other',
] as const;

const PAGE_LABELS: Record<string, string> = {
  homepage: 'Homepage',
  about: 'About',
  features: 'Features',
  value: 'Value',
  pricing: 'Pricing',
  'how-it-works': 'How It Works',
  engine: 'Engine',
  'the-expert': 'The Expert',
  security: 'Security',
  infosec: 'InfoSec',
  apply: 'Apply',
  'get-started': 'Get Started',
  resources: 'Resources',
  blog: 'Blog',
  other: 'Other',
};

const SECTION_LABELS: Record<string, string> = {
  hero: 'Hero Banner',
  stats: 'Statistics',
  stages: 'Process Steps',
  'pricing-hero': 'Pricing Header',
  pricing: 'Pricing Plans',
  'expert-gate': 'Expert Gate',
  quote: 'Pull Quote',
  cta: 'Call to Action',
  pillars: 'Core Pillars',
  founder: 'Founder',
  items: 'Feature Items',
  faqs: 'FAQs',
  spotlight: 'Spotlight',
  portals: 'Portal Links',
  curation: 'Expert Curation',
  flywheel: 'Value Flywheel',
  steps: 'Steps',
  guardrails: 'Guardrails',
  form: 'Form',
};

const STATUS_BADGES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Draft' },
  pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Pending' },
  published: { bg: 'bg-green-100', text: 'text-green-700', label: 'Published' },
  private: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Private' },
  archived: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Archived' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSectionLabel(tag: string): string {
  if (SECTION_LABELS[tag]) return SECTION_LABELS[tag];
  return tag
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function getPageCount(grouped: GroupedData, tab: string): number {
  if (tab === 'blog') return grouped.blog.length;
  if (tab === 'other') return grouped.other.length;
  const page = grouped.pages[tab];
  if (!page) return 0;
  return Object.values(page.sections).reduce((sum, blocks) => sum + blocks.length, 0);
}

// ─── Status Badge Component ──────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const badge = STATUS_BADGES[status] ?? STATUS_BADGES.draft;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.bg} ${badge.text}`}>
      {badge.label}
    </span>
  );
}

// ─── Content Block Card Component ────────────────────────────────────────────

interface BlockCardProps {
  block: CmsBlock;
  onRefresh: () => void;
}

function BlockCard({ block }: BlockCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 font-mono">#{block.displayOrder}</span>
            <h4 className="text-sm font-medium text-gray-900 truncate">{block.title}</h4>
            <StatusBadge status={block.status} />
          </div>
          {block.body && (
            <p className="mt-1 text-sm text-gray-500 line-clamp-2">{block.body}</p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Link
            href={`/admin/content/${block.slug}/preview`}
            className="inline-flex items-center rounded px-2 py-1 text-xs font-medium text-purple-600 hover:bg-purple-50"
            title="Preview"
          >
            Preview
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Section Component ───────────────────────────────────────────────────────

interface SectionGroupProps {
  pageTag: string;
  sectionTag: string;
  blocks: CmsBlock[];
  onRefresh: () => void;
}

function SectionGroup({ sectionTag, blocks, onRefresh }: SectionGroupProps) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100">
        <h3 className="text-sm font-semibold text-gray-700">
          {getSectionLabel(sectionTag)}
        </h3>
        <span className="text-xs text-gray-400 font-mono">({sectionTag})</span>
        <span className="text-xs text-gray-400 ml-auto">{blocks.length} block{blocks.length !== 1 ? 's' : ''}</span>
      </div>

      {blocks.length === 0 ? (
        <p className="text-sm text-gray-400 italic px-3 py-2">No blocks in this section</p>
      ) : (
        <div className="space-y-2">
          {blocks.map((block) => (
            <BlockCard key={block.id} block={block} onRefresh={onRefresh} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Blog/Other Card Component ───────────────────────────────────────────────

function ArticleCard({ block }: { block: CmsBlock }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
              {block.contentType.replace('_', ' ')}
            </span>
            <StatusBadge status={block.status} />
          </div>
          <h4 className="text-sm font-medium text-gray-900">{block.title}</h4>
          {block.excerpt && (
            <p className="mt-1 text-sm text-gray-500 line-clamp-2">{block.excerpt}</p>
          )}
          <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
            {block.author && <span>By {block.author}</span>}
            {block.tags.length > 0 && (
              <span className="flex gap-1">
                {block.tags.map((tag) => (
                  <span key={tag} className="rounded bg-gray-100 px-1.5 py-0.5">{tag}</span>
                ))}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Link
            href={`/admin/content/${block.slug}/preview`}
            className="inline-flex items-center rounded px-2 py-1 text-xs font-medium text-purple-600 hover:bg-purple-50"
            title="Preview"
          >
            Preview
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface CmsPageManagerProps {
  grouped: GroupedData;
  totalBlocks: number;
  publishedCount: number;
  draftCount: number;
  archivedCount: number;
}

export default function CmsPageManager({
  grouped,
  totalBlocks,
  publishedCount,
  draftCount,
  archivedCount,
}: CmsPageManagerProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<string>('homepage');

  const handleRefresh = useCallback(() => {
    router.refresh();
  }, [router]);

  const renderPageContent = (tab: string) => {
    const page = grouped.pages[tab];
    if (!page || Object.keys(page.sections).length === 0) {
      return (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">No content blocks for this page yet.</p>
          <p className="text-xs mt-1">Create blocks with the tag &ldquo;{tab}&rdquo; to populate this page.</p>
        </div>
      );
    }

    const sortedSections = Object.entries(page.sections).sort(([, a], [, b]) => {
      const aOrder = a[0]?.displayOrder ?? 0;
      const bOrder = b[0]?.displayOrder ?? 0;
      return aOrder - bOrder;
    });

    return (
      <div className="space-y-2">
        {sortedSections.map(([sectionTag, blocks]) => (
          <SectionGroup
            key={sectionTag}
            pageTag={tab}
            sectionTag={sectionTag}
            blocks={blocks}
            onRefresh={handleRefresh}
          />
        ))}
      </div>
    );
  };

  const renderBlogContent = () => {
    return (
      <div>
        <div className="mb-4">
          <p className="text-sm text-gray-500">{grouped.blog.length} article{grouped.blog.length !== 1 ? 's' : ''}</p>
        </div>
        {grouped.blog.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-sm">No blog posts, resources, or guides yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {grouped.blog.map((block) => (
              <ArticleCard key={block.id} block={block} />
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderOtherContent = () => {
    return (
      <div>
        <div className="mb-4">
          <p className="text-sm text-gray-500">
            {grouped.other.length} item{grouped.other.length !== 1 ? 's' : ''} (testimonials, team members, announcements, etc.)
          </p>
        </div>
        {grouped.other.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-sm">No other content items.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {grouped.other.map((block) => (
              <ArticleCard key={block.id} block={block} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* Summary Bar */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Content Management</h1>
        <p className="text-sm text-gray-500 mt-1">
          {totalBlocks} total &middot;{' '}
          <span className="text-green-600">{publishedCount} published</span> &middot;{' '}
          <span className="text-gray-600">{draftCount} draft</span> &middot;{' '}
          <span className="text-purple-600">{archivedCount} archived</span>
        </p>
      </div>

      {/* Tab Bar */}
      <div className="mb-6 border-b border-gray-200 overflow-x-auto">
        <nav className="flex space-x-1 -mb-px" aria-label="Content pages">
          {PAGE_TABS.map((tab) => {
            const count = getPageCount(grouped, tab);
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {PAGE_LABELS[tab] ?? tab}
                {count > 0 && (
                  <span className={`ml-1.5 inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-xs ${
                    isActive ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === 'blog' && renderBlogContent()}
        {activeTab === 'other' && renderOtherContent()}
        {activeTab !== 'blog' && activeTab !== 'other' && renderPageContent(activeTab)}
      </div>
    </div>
  );
}
