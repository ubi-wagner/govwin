'use client';

import { useState } from 'react';

interface ContentItem {
  id: string;
  slug: string;
  title: string;
  contentType: string;
  excerpt: string | null;
  author: string | null;
  tags: string[];
  publishedAt: string | null;
  featuredImage: string | null;
  externalUrl: string | null;
}

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'resource', label: 'Resources' },
  { key: 'guide', label: 'Guides' },
  { key: 'blog_post', label: 'Blog Posts' },
] as const;

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export default function ResourcesFilter({ content }: { content: ContentItem[] }) {
  const [activeTab, setActiveTab] = useState<string>('all');

  const filtered = activeTab === 'all'
    ? content
    : content.filter((c) => c.contentType === activeTab);

  return (
    <>
      {/* Filter tabs */}
      <div className="flex gap-2 mb-8">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-brand-500 text-white'
                : 'bg-white border border-cream-200 text-navy-600 hover:border-brand-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content grid */}
      {filtered.length === 0 ? (
        <p className="text-navy-400 text-center py-8">No content in this category yet.</p>
      ) : (
        <div className="grid md:grid-cols-3 gap-6">
          {filtered.map((item) => (
            <article
              key={item.id}
              className="bg-white border border-cream-200 rounded-lg overflow-hidden hover:shadow-sm transition-shadow"
            >
              {item.featuredImage && (
                <div className="h-40 bg-cream-100 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.featuredImage}
                    alt={item.title}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="p-6">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-xs text-brand-500 font-semibold uppercase tracking-wider">
                    {item.contentType.replace('_', ' ')}
                  </span>
                  {item.publishedAt && (
                    <span className="text-xs text-navy-400">{formatDate(item.publishedAt)}</span>
                  )}
                </div>
                <h3 className="font-display font-bold text-navy-900">{item.title}</h3>
                {item.excerpt && (
                  <p className="mt-2 text-sm text-navy-600 leading-relaxed line-clamp-3">
                    {item.excerpt}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-1">
                  {(item.tags ?? []).slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex rounded bg-cream-100 px-1.5 py-0.5 text-xs text-navy-500"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                {item.author && (
                  <p className="mt-3 text-xs text-navy-400">By {item.author}</p>
                )}
                <div className="mt-4">
                  {item.externalUrl ? (
                    <a
                      href={item.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-brand-500 hover:text-brand-700 font-medium"
                    >
                      Read More &rarr;
                    </a>
                  ) : (
                    <a
                      href={`/resources/${item.slug}`}
                      className="text-sm text-brand-500 hover:text-brand-700 font-medium"
                    >
                      Read More &rarr;
                    </a>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
