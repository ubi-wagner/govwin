'use client';

/**
 * SheetMediaStrip — the spreadsheet editor's images + shapes band (SHEETS media).
 *
 * A worksheet is a grid, but a workbook often needs a logo, a figure, or a simple shape.
 * The xlsx exporter already renders `image` + `shape` nodes as floating pictures on the
 * sheet — this strip is the missing EDITOR affordance to add + preview + remove them.
 * Upload mirrors the canvas ImageNode (portal upload endpoint derived from the path); the
 * shape preview reuses the exact SVG the exporter rasterizes, so preview == export.
 */
import { useEffect, useRef, useState } from 'react';
import type { CanvasNode, ImageContent } from '@/lib/types/canvas-document';
import { renderShapeSvg } from '@/lib/export/canvas-html';

interface Props {
  nodes: CanvasNode[];
  readOnly?: boolean;
  onAddImage: (storageKey: string, width: number, height: number, alt: string) => void;
  onAddShape: () => void;
  onDelete: (nodeId: string) => void;
}

/** Portal (tenant) vs admin storage/upload endpoints, from the current path (mirrors ImageNode). */
function endpoints() {
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  const slug = path.includes('/portal/') ? path.split('/portal/')[1]?.split('/')[0] : null;
  return slug
    ? { storage: `/api/portal/${slug}/storage`, upload: `/api/portal/${slug}/uploads/image` }
    : { storage: '/api/admin/storage', upload: '/api/admin/documents/upload-image' };
}

export function SheetMediaStrip({ nodes, readOnly, onAddImage, onAddShape, onDelete }: Props) {
  const media = nodes.filter((n) => n.type === 'image' || n.type === 'shape');
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const ep = endpoints();

  // Resolve presigned URLs for image nodes with a storage_key (once each).
  const imageKeys = media
    .filter((n) => n.type === 'image' && (n.content as ImageContent).storage_key)
    .map((n) => `${n.id}:${(n.content as ImageContent).storage_key}`)
    .join('|');
  useEffect(() => {
    let alive = true;
    media
      .filter((n) => n.type === 'image' && (n.content as ImageContent).storage_key && !urls[n.id])
      .forEach((n) => {
        const key = (n.content as ImageContent).storage_key as string;
        fetch(`${ep.storage}?download=${encodeURIComponent(key)}`)
          .then((r) => r.json())
          .then((j) => { if (alive && j.data?.url) setUrls((u) => ({ ...u, [n.id]: j.data.url })); })
          .catch(() => {});
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageKeys]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(ep.upload, { method: 'POST', body: form });
      if (!res.ok) throw new Error('upload failed');
      const { storageKey, url } = (await res.json()).data as { storageKey: string; url: string };
      const img = new window.Image();
      img.onload = () => onAddImage(storageKey, img.naturalWidth, img.naturalHeight, file.name);
      img.onerror = () => onAddImage(storageKey, 400, 300, file.name);
      img.src = url;
    } catch (e) {
      console.error('[sheet-media] upload failed', e);
    } finally {
      setUploading(false);
    }
  };

  if (readOnly && media.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-gray-50 flex-shrink-0 flex-wrap">
      <span className="text-[10px] uppercase tracking-wide text-gray-400 shrink-0">Media</span>
      {media.map((n) => (
        <div key={n.id} className="relative group border rounded bg-white p-0.5 shrink-0" title={n.type}>
          {n.type === 'image' ? (
            urls[n.id] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={urls[n.id]} alt={(n.content as ImageContent).alt_text || 'image'} className="h-10 w-14 object-contain" />
            ) : (
              <div className="h-10 w-14 bg-gray-100 text-[8px] text-gray-400 flex items-center justify-center">image</div>
            )
          ) : (
            <div className="h-10 w-14 flex items-center justify-center overflow-hidden" dangerouslySetInnerHTML={{ __html: renderShapeSvg(n) }} />
          )}
          {!readOnly && (
            <button
              onClick={() => onDelete(n.id)}
              className="absolute -top-1.5 -right-1.5 hidden group-hover:flex items-center justify-center w-4 h-4 bg-red-500 text-white text-[9px] rounded-full hover:bg-red-600"
              title="Remove"
            >×</button>
          )}
        </div>
      ))}
      {!readOnly && (
        <>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="text-xs px-2 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50 shrink-0"
            title="Insert an image (logo / figure) — exported to the .xlsx"
          >{uploading ? 'Uploading…' : '+ Image'}</button>
          <button
            onClick={onAddShape}
            className="text-xs px-2 py-1 border rounded bg-white hover:bg-gray-100 shrink-0"
            title="Insert a shape — exported to the .xlsx"
          >+ Shape</button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) upload(e.target.files[0]); e.target.value = ''; }} />
        </>
      )}
    </div>
  );
}
