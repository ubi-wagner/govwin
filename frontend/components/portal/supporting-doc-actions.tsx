'use client';

import { useState, useCallback, useRef } from 'react';

interface SupportingDocActionsProps {
  docId: string;
  proposalId: string;
  tenantSlug: string;
  status: string;
  downloadUrl?: string | null;
  isAdmin: boolean;
}

export function SupportingDocActions({
  docId,
  proposalId,
  tenantSlug,
  status,
  downloadUrl,
  isAdmin,
}: SupportingDocActionsProps) {
  const [uploading, setUploading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = useCallback(async () => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setUploading(true);
      setMessage(null);

      try {
        // Step 1: Get presigned upload URL
        const res = await fetch(
          `/api/portal/${tenantSlug}/proposals/${proposalId}/supporting-docs`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              docId,
              filename: file.name,
              contentType: file.type || 'application/octet-stream',
              fileSize: file.size,
            }),
          },
        );

        if (!res.ok) {
          const json = await res.json().catch(() => ({ error: 'Upload failed' }));
          setMessage({ type: 'error', text: json.error || 'Upload failed' });
          return;
        }

        const json = await res.json();
        const uploadUrl = json.data?.uploadUrl;

        if (!uploadUrl) {
          setMessage({ type: 'error', text: 'No upload URL returned' });
          return;
        }

        // Step 2: Upload file to presigned URL
        const uploadRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });

        if (!uploadRes.ok) {
          setMessage({ type: 'error', text: 'File upload to storage failed' });
          return;
        }

        setMessage({ type: 'success', text: 'File uploaded successfully' });
        // Refresh the page to show updated status
        window.location.reload();
      } catch {
        setMessage({ type: 'error', text: 'Network error during upload' });
      } finally {
        setUploading(false);
        // Reset file input
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [docId, proposalId, tenantSlug],
  );

  const handleStatusChange = useCallback(
    async (newStatus: string) => {
      setUpdating(true);
      setMessage(null);
      try {
        const res = await fetch(
          `/api/portal/${tenantSlug}/proposals/${proposalId}/supporting-docs/${docId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus }),
          },
        );

        if (!res.ok) {
          const json = await res.json().catch(() => ({ error: 'Update failed' }));
          setMessage({ type: 'error', text: json.error || 'Update failed' });
          return;
        }

        setMessage({ type: 'success', text: `Status updated to ${newStatus}` });
        window.location.reload();
      } catch {
        setMessage({ type: 'error', text: 'Network error' });
      } finally {
        setUpdating(false);
      }
    },
    [docId, proposalId, tenantSlug],
  );

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileSelected}
        accept=".pdf,.doc,.docx,.xls,.xlsx,.pptx,.txt,.csv,.png,.jpg,.jpeg,.gif,.zip"
      />

      {/* Upload button for missing docs */}
      {status === 'missing' && (
        <button
          onClick={handleUpload}
          disabled={uploading}
          className="px-2 py-1 text-xs font-medium text-blue-600 border border-blue-200 rounded-md hover:bg-blue-50 disabled:opacity-50 transition-colors"
        >
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
      )}

      {/* Download button for uploaded docs */}
      {downloadUrl && status !== 'missing' && (
        <a
          href={downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="px-2 py-1 text-xs font-medium text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
        >
          Download
        </a>
      )}

      {/* Review button for uploaded docs (admin only) */}
      {isAdmin && status === 'uploaded' && (
        <button
          onClick={() => handleStatusChange('reviewed')}
          disabled={updating}
          className="px-2 py-1 text-xs font-medium text-purple-600 border border-purple-200 rounded-md hover:bg-purple-50 disabled:opacity-50 transition-colors"
        >
          {updating ? '...' : 'Review'}
        </button>
      )}

      {/* Approve button for reviewed docs (admin only) */}
      {isAdmin && status === 'reviewed' && (
        <button
          onClick={() => handleStatusChange('approved')}
          disabled={updating}
          className="px-2 py-1 text-xs font-medium text-green-600 border border-green-200 rounded-md hover:bg-green-50 disabled:opacity-50 transition-colors"
        >
          {updating ? '...' : 'Approve'}
        </button>
      )}

      {/* Waive button for reviewed docs (admin only) */}
      {isAdmin && status === 'reviewed' && (
        <button
          onClick={() => handleStatusChange('waived')}
          disabled={updating}
          className="px-2 py-1 text-xs font-medium text-gray-500 border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {updating ? '...' : 'Waive'}
        </button>
      )}

      {message && (
        <span
          className={`text-[10px] ${
            message.type === 'success' ? 'text-green-600' : 'text-red-500'
          }`}
        >
          {message.text}
        </span>
      )}
    </div>
  );
}
