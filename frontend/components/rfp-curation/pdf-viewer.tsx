'use client';

/**
 * PDF Viewer with text-layer selection for compliance tagging.
 *
 * Uses react-pdf (pdf.js) to render each page with a selectable text
 * layer. When the admin selects text, fires `onTextSelect` with the
 * selection string + page number + bounding rect so the parent can
 * show the tag popover.
 *
 * Loads the PDF from a signed S3 URL fetched via
 * /api/admin/rfp-document/[id]/signed-url.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';

// Worker — load from CDN for simplicity in Railway/Next.js
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export interface TextSelection {
  text: string;
  pageNumber: number;
  rect: { top: number; left: number; width: number; height: number };
}

interface Props {
  /** The solicitation_documents.id to load. */
  documentId: string;
  /** Fires when the user selects text on any page. */
  onTextSelect?: (selection: TextSelection) => void;
  /** Max width of each rendered page in px. */
  width?: number;
}

export function PdfViewer({ documentId, onTextSelect, width = 700 }: Props) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch signed URL on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`/api/admin/rfp-document/${documentId}/signed-url`);
        const json = await resp.json();
        if (!cancelled && json.data?.url) {
          setPdfUrl(json.data.url);
        } else if (!cancelled) {
          setError('Failed to get document URL');
        }
      } catch {
        if (!cancelled) setError('Network error loading document');
      }
    })();
    return () => { cancelled = true; };
  }, [documentId]);

  const onDocumentLoadSuccess = useCallback(
    ({ numPages: n }: { numPages: number }) => {
      setNumPages(n);
      setLoading(false);
    },
    [],
  );

  const onDocumentLoadError = useCallback((err: Error) => {
    setError(`PDF load failed: ${err.message}`);
    setLoading(false);
  }, []);

  // Capture text selection on mouseup inside the PDF container
  const handleMouseUp = useCallback(() => {
    if (!onTextSelect) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;

    const text = sel.toString().trim();
    if (text.length < 3) return; // ignore tiny accidental selections

    // Find which page the selection is on by walking up from the
    // anchor node to find a [data-page-number] attribute.
    let pageEl: HTMLElement | null = sel.anchorNode instanceof HTMLElement
      ? sel.anchorNode
      : sel.anchorNode?.parentElement ?? null;
    let pageNumber = currentPage;
    while (pageEl) {
      const pn = pageEl.getAttribute?.('data-page-number');
      if (pn) {
        pageNumber = parseInt(pn, 10);
        break;
      }
      pageEl = pageEl.parentElement;
    }

    // Get the selection bounding rect relative to the container
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();
    const relRect = containerRect
      ? {
          top: rect.top - containerRect.top,
          left: rect.left - containerRect.left,
          width: rect.width,
          height: rect.height,
        }
      : { top: rect.top, left: rect.left, width: rect.width, height: rect.height };

    onTextSelect({ text, pageNumber, rect: relRect });
  }, [onTextSelect, currentPage]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 bg-gray-50 border border-red-200 rounded-lg">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (!pdfUrl) {
    return (
      <div className="flex items-center justify-center h-64 bg-gray-50 border rounded-lg">
        <p className="text-sm text-gray-500 animate-pulse">Loading document...</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Page navigation bar */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 text-sm">
        <button
          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          disabled={currentPage <= 1}
          className="px-2 py-1 border rounded text-xs disabled:opacity-30"
        >
          Prev
        </button>
        <span className="text-gray-600">
          Page {currentPage} of {numPages || '…'}
        </span>
        <button
          onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
          disabled={currentPage >= numPages}
          className="px-2 py-1 border rounded text-xs disabled:opacity-30"
        >
          Next
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-64">
          <p className="text-sm text-gray-500 animate-pulse">Rendering PDF...</p>
        </div>
      )}

      {/* PDF page — one at a time for performance */}
      <div
        className="flex justify-center bg-gray-100 p-4 min-h-[600px]"
        onMouseUp={handleMouseUp}
      >
        <Document
          file={pdfUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={null}
        >
          <Page
            pageNumber={currentPage}
            width={width}
            renderTextLayer={true}
            renderAnnotationLayer={true}
          />
        </Document>
      </div>
    </div>
  );
}
