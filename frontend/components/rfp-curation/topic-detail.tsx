'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Topic {
  id: string;
  title: string;
  topicNumber: string | null;
  topicBranch: string | null;
  topicStatus: string;
  techFocusAreas: string[];
  description: string | null;
  closeDate: string | null;
  postedDate: string | null;
  pocName: string | null;
  pocEmail: string | null;
  solicitationId: string;
  solicitationTitle: string | null;
  namespace: string | null;
  solicitationStatus: string | null;
}

export function TopicDetail({ topic }: { topic: Topic; currentUserId: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState(topic.topicStatus);
  const [title, setTitle] = useState(topic.title);
  const [description, setDescription] = useState(topic.description ?? '');
  const [focusAreas, setFocusAreas] = useState(topic.techFocusAreas.join(', '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // Use the generic tool endpoint with a minimal topic-update direct SQL
      // path. We haven't built opportunity.update_topic yet — for now, POST
      // to a small inline endpoint that updates these fields.
      const resp = await fetch(`/api/admin/topics/${topic.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: description || null,
          topicStatus: status,
          techFocusAreas: focusAreas.split(',').map((s) => s.trim()).filter(Boolean),
        }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? `Update failed (HTTP ${resp.status})`);
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm text-gray-500">
          <Link href={`/admin/rfp-curation/${topic.solicitationId}`} className="hover:text-blue-600">
            {topic.solicitationTitle ?? 'Solicitation'}
          </Link>
          {topic.namespace && (
            <span className="ml-2 font-mono text-xs">&middot; {topic.namespace}</span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-2">
          {topic.topicNumber && (
            <span className="font-mono text-sm bg-indigo-100 text-indigo-700 px-2 py-1 rounded">
              {topic.topicNumber}
            </span>
          )}
          {editing ? (
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="flex-1 text-2xl font-bold border border-gray-300 rounded px-3 py-1"
            />
          ) : (
            <h1 className="flex-1 text-2xl font-bold">{topic.title}</h1>
          )}
          <span
            className={`text-xs px-2 py-1 rounded ${
              status === 'open'
                ? 'bg-green-100 text-green-800'
                : status === 'pre_release'
                ? 'bg-yellow-100 text-yellow-800'
                : 'bg-gray-200 text-gray-600'
            }`}
          >
            {status.replace('_', ' ')}
          </span>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {!editing ? (
        <button
          onClick={() => setEditing(true)}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded"
        >
          Edit Topic
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm rounded"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={() => {
              setEditing(false);
              setTitle(topic.title);
              setStatus(topic.topicStatus);
              setDescription(topic.description ?? '');
              setFocusAreas(topic.techFocusAreas.join(', '));
            }}
            className="text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 border rounded-lg p-4 space-y-4">
          <h2 className="text-lg font-semibold">Description</h2>
          {editing ? (
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={8}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            />
          ) : (
            <p className="text-sm text-gray-700 whitespace-pre-wrap">
              {topic.description ?? '(No description yet)'}
            </p>
          )}
        </div>

        <div className="border rounded-lg p-4 space-y-3">
          <h2 className="text-lg font-semibold">Details</h2>
          <dl className="text-sm space-y-2">
            <div>
              <dt className="text-gray-500">Branch / Component</dt>
              <dd>{topic.topicBranch ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Status</dt>
              <dd>
                {editing ? (
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="border rounded px-2 py-1 text-sm"
                  >
                    <option value="open">Open</option>
                    <option value="pre_release">Pre-release</option>
                    <option value="closed">Closed</option>
                  </select>
                ) : (
                  status
                )}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Tech Focus Areas</dt>
              <dd>
                {editing ? (
                  <input
                    value={focusAreas}
                    onChange={(e) => setFocusAreas(e.target.value)}
                    placeholder="comma-separated"
                    className="w-full border rounded px-2 py-1 text-sm"
                  />
                ) : topic.techFocusAreas.length > 0 ? (
                  topic.techFocusAreas.join(', ')
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Posted</dt>
              <dd>{topic.postedDate ? new Date(topic.postedDate).toLocaleDateString() : '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Close Date</dt>
              <dd>{topic.closeDate ? new Date(topic.closeDate).toLocaleDateString() : '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-500">POC</dt>
              <dd>
                {topic.pocName ?? '—'}
                {topic.pocEmail && (
                  <div className="text-xs text-gray-400">{topic.pocEmail}</div>
                )}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
