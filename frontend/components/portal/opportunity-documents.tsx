'use client';

import { useState, useEffect, useCallback } from 'react';

interface OpportunityDocument {
  id: string;
  filename: string;
  documentType: string;
  fileSize: number | null;
  contentType: string | null;
  isPrimary: boolean;
  label: string | null;
  downloadUrl: string | null;
}

interface OpportunityDocumentsProps {
  tenantSlug: string;
  opportunityId: string;
}

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes === 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function OpportunityDocuments({ tenantSlug, opportunityId }: OpportunityDocumentsProps) {
  const [documents, setDocuments] = useState<OpportunityDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/opportunities/${opportunityId}/documents`,
      );
      if (!res.ok) {
        if (res.status === 403) {
          // No access, likely no pipeline item
          setDocuments([]);
          return;
        }
        const json = await res.json().catch(() => ({ error: 'Failed to load' }));
        setError(json.error || 'Failed to load documents');
        return;
      }
      const json = await res.json();
      setDocuments(json.data?.documents ?? []);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [tenantSlug, opportunityId]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Source Documents</h2>
        <p className="text-sm text-gray-400">Loading documents...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Source Documents</h2>
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  if (documents.length === 0) {
    return null;
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Source Documents</h2>
      <div className="space-y-2">
        {documents.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono font-medium bg-gray-100 text-gray-600 flex-shrink-0">
                {doc.documentType?.toUpperCase() ?? 'FILE'}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {doc.filename}
                  {doc.isPrimary && (
                    <span className="ml-2 inline-flex items-center rounded px-1 py-0.5 text-[10px] font-semibold bg-blue-50 text-blue-600 border border-blue-200">
                      PRIMARY
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-400">
                  {doc.label && `${doc.label} -- `}
                  {formatBytes(doc.fileSize)}
                </p>
              </div>
            </div>
            {doc.downloadUrl ? (
              <a
                href={doc.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 rounded-md hover:bg-blue-50 flex-shrink-0 transition-colors"
              >
                Download
              </a>
            ) : (
              <span className="text-xs text-gray-400 flex-shrink-0">No file</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
