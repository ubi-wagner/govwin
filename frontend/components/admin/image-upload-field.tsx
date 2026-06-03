'use client';

import { useRef, useState } from 'react';

/**
 * A URL text field with an Upload button. Uploading posts to
 * /api/admin/site/upload-image and fills the field with the returned permanent
 * URL (/api/uploads/cms/...). You can also paste any external image URL.
 */
export function ImageUploadField({
  value,
  onChange,
  placeholder = 'Image URL, or upload →',
  className = '',
}: {
  value: string;
  onChange: (url: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/admin/site/upload-image', { method: 'POST', body: fd });
      const json = (await res.json().catch(() => ({}))) as { data?: { url?: string }; error?: string };
      if (!res.ok || !json.data?.url) {
        setErr(String(json.error ?? 'Upload failed'));
        return;
      }
      onChange(json.data.url);
    } catch {
      setErr('Upload failed');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <input
          className="flex-1 border rounded px-2 py-1 text-sm"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <label className="shrink-0 text-sm px-3 py-1.5 rounded border hover:bg-gray-50 cursor-pointer">
          {busy ? 'Uploading…' : 'Upload'}
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
        </label>
      </div>
      {value && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="mt-2 h-16 rounded border object-cover bg-gray-50" />
      )}
      {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
    </div>
  );
}
