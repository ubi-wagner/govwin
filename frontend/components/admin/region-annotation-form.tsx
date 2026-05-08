'use client';

import React, { useCallback, useState } from 'react';

const REGION_TYPES = ['content', 'listing', 'download', 'navigation', 'table'] as const;

interface RegionAnnotationFormProps {
  profileId: string;
  onCreated: () => void;
}

export default function RegionAnnotationForm({ profileId, onCreated }: RegionAnnotationFormProps) {
  const [name, setName] = useState('');
  const [regionType, setRegionType] = useState<string>('content');
  const [contentContext, setContentContext] = useState('');
  const [selectorHint, setSelectorHint] = useState('');
  const [sampleText, setSampleText] = useState('');
  const [sampleHtml, setSampleHtml] = useState('');
  const [showHtml, setShowHtml] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!contentContext.trim()) {
      setError('Content context is required.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/sources/${profileId}/regions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          regionType,
          contentContext: contentContext.trim(),
          selectorHint: selectorHint.trim() || null,
          sampleText: sampleText.trim() || null,
          sampleHtml: sampleHtml.trim() || null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed to create region (HTTP ${res.status})`);
      }

      // Reset form
      setName('');
      setRegionType('content');
      setContentContext('');
      setSelectorHint('');
      setSampleText('');
      setSampleHtml('');
      setShowHtml(false);
      setSuccess(true);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create region');
    } finally {
      setSubmitting(false);
    }
  }, [profileId, name, regionType, contentContext, selectorHint, sampleText, sampleHtml, onCreated]);

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg border shadow-sm p-5 space-y-4">
      <h3 className="text-sm font-semibold text-gray-800">Add Region Annotation</h3>

      {/* Name */}
      <div>
        <label htmlFor="region-name" className="block text-sm font-medium text-gray-700 mb-1">
          Name <span className="text-red-500">*</span>
        </label>
        <input
          id="region-name"
          type="text"
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          placeholder="e.g., Active Topics Table"
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </div>

      {/* Region Type */}
      <div>
        <label htmlFor="region-type" className="block text-sm font-medium text-gray-700 mb-1">
          Region Type <span className="text-red-500">*</span>
        </label>
        <select
          id="region-type"
          value={regionType}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setRegionType(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
        >
          {REGION_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {/* Content Context */}
      <div>
        <label htmlFor="content-context" className="block text-sm font-medium text-gray-700 mb-1">
          Content Context <span className="text-red-500">*</span>
        </label>
        <textarea
          id="content-context"
          value={contentContext}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setContentContext(e.target.value)}
          rows={3}
          placeholder="Describe what this region contains and what changes matter. Example: 'This table shows active BAA topics. Alert me when new rows appear with OPEN status.'"
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
        />
      </div>

      {/* Selector Hint */}
      <div>
        <label htmlFor="selector-hint" className="block text-sm font-medium text-gray-700 mb-1">
          Selector Hint <span className="text-xs text-gray-400">(optional)</span>
        </label>
        <input
          id="selector-hint"
          type="text"
          value={selectorHint}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSelectorHint(e.target.value)}
          placeholder=".topic-card, #results-table, etc."
          className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </div>

      {/* Sample Text */}
      <div>
        <label htmlFor="sample-text" className="block text-sm font-medium text-gray-700 mb-1">
          Sample Text <span className="text-xs text-gray-400">(optional)</span>
        </label>
        <textarea
          id="sample-text"
          value={sampleText}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSampleText(e.target.value)}
          rows={2}
          placeholder="Paste the current visible text from this region so Claude has a baseline for comparison."
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
        />
      </div>

      {/* Sample HTML (collapsed) */}
      <div>
        <button
          type="button"
          onClick={() => setShowHtml(!showHtml)}
          className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          <span className={`transform transition-transform ${showHtml ? 'rotate-90' : ''}`}>
            {'▶'}
          </span>
          Sample HTML (advanced)
        </button>
        {showHtml && (
          <textarea
            value={sampleHtml}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSampleHtml(e.target.value)}
            rows={4}
            placeholder="Paste the raw HTML for this region (for advanced selector matching)."
            className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y mt-2"
          />
        )}
      </div>

      {/* Error / Success */}
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
          {error}
        </div>
      )}
      {success && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2">
          Region created successfully.
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={submitting}
        className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'Creating...' : 'Add Region'}
      </button>
    </form>
  );
}
