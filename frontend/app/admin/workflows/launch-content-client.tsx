'use client';

/**
 * Generate Content — a minimal rfp_admin form that launches the CMS content
 * vertical (OnCmsContentRequested) via POST /api/admin/workflows with an overlay.
 *
 * The pipeline drafts the body with Claude, then parks at a review ToDo for
 * approval. This form just collects the overlay and fires the launch; the
 * instance shows up in the monitor below / the Process Ledger within ~10s.
 */
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

const CONTENT_TYPES = ['blog_post', 'resource', 'guide', 'announcement', 'faq'] as const;

type LaunchSuccess = { eventId: string; workflowName: string; trigger: string };

export function LaunchContentClient() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [slug, setSlug] = useState('');
  const [contentType, setContentType] = useState<string>('blog_post');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<LaunchSuccess | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!title.trim() || !brief.trim()) {
      setError('Title and brief are required.');
      return;
    }

    setSubmitting(true);
    try {
      const overlay: Record<string, unknown> = {
        title: title.trim(),
        brief: brief.trim(),
        contentType,
      };
      if (slug.trim()) overlay.slug = slug.trim();

      const res = await fetch('/api/admin/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowName: 'OnCmsContentRequested', overlay }),
      });

      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        // non-JSON response — fall through to status-based error
      }

      if (!res.ok) {
        const d = (data ?? {}) as { error?: string; code?: string };
        setError(
          d.error ? `${d.error}${d.code ? ` (${d.code})` : ''}` : `Request failed (${res.status})`,
        );
        return;
      }

      const d = (data ?? {}) as { data?: LaunchSuccess };
      setSuccess(d.data ?? null);
      setTitle('');
      setBrief('');
      setSlug('');
      // Give the pipeline a moment to create the instance, then refresh the monitor.
      setTimeout(() => router.refresh(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
      <div className="mb-3">
        <h2 className="text-lg font-semibold">Generate Content</h2>
        <p className="text-sm text-gray-500">
          Launch the CMS content vertical — AI drafts the body, then it parks at a review
          ToDo for approval before publishing.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Why SBIR Phase I matters"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Content type</label>
            <select
              value={contentType}
              onChange={(e) => setContentType(e.target.value)}
              className={inputClass}
            >
              {CONTENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Brief <span className="text-red-500">*</span>
          </label>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={3}
            placeholder="What should the article cover? e.g. Explain SBIR Phase I eligibility and the application timeline to a first-time small-business applicant."
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-400">
            The AI drafts the body from this. Falls back to the brief verbatim if no model key
            is configured.
          </p>
        </div>

        <div className="sm:w-1/2">
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Slug <span className="text-gray-400">(optional)</span>
          </label>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="auto from title"
            className={inputClass}
          />
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            Launched. The pipeline will draft it and park at the review ToDo within ~10s — find
            it below or in the{' '}
            <a href="/admin/processes" className="underline">
              Process Ledger
            </a>
            .{' '}
            <span className="text-green-600">(trigger event {success.eventId.slice(0, 8)}…)</span>
          </div>
        )}

        <div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Launching…' : 'Generate Content'}
          </button>
        </div>
      </form>
    </div>
  );
}
