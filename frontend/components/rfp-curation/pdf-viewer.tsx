'use client';

/**
 * PDF Viewer with text-layer selection + persistent highlight overlays.
 *
 * Features:
 *   - Renders PDF pages with selectable text layer (react-pdf / pdf.js)
 *   - On text selection, fires `onTextSelect` with the selection string,
 *     page number, and bounding rect for the tag popover
 *   - Renders colored highlight overlays for saved annotations (by
 *     searching the text layer for the source_excerpt on each page)
 *   - Supports external `goToPage(n)` via ref for compliance-matrix
 *     "click to source" navigation
 *   - Loads PDF from a signed S3 URL via the signed-url endpoint
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export interface TextSelection {
  text: string;
  pageNumber: number;
  rect: { top: number; left: number; width: number; height: number };
}

export interface HighlightAnnotation {
  id: string;
  pageNumber: number;
  sourceExcerpt: string;
  variableName: string | null;
  color?: string;
}

export interface PdfViewerHandle {
  goToPage: (page: number) => void;
  highlightText: (page: number, excerpt: string) => void;
}

interface Props {
  documentId: string;
  onTextSelect?: (selection: TextSelection) => void;
  highlights?: HighlightAnnotation[];
  width?: number;
}

export const PdfViewer = forwardRef<PdfViewerHandle, Props>(
  function PdfViewer({ documentId, onTextSelect, highlights = [], width = 700 }, ref) {
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [numPages, setNumPages] = useState<number>(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [flashExcerpt, setFlashExcerpt] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      goToPage(page: number) {
        setCurrentPage(Math.max(1, Math.min(page, numPages)));
      },
      highlightText(page: number, excerpt: string) {
        setCurrentPage(Math.max(1, Math.min(page, numPages)));
        setFlashExcerpt(excerpt);
        setTimeout(() => setFlashExcerpt(null), 3000);
      },
    }), [numPages]);

    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const resp = await fetch(`/api/admin/rfp-document/${documentId}/signed-url`);
          const json = await resp.json();
          if (!cancelled && json.data?.url) setPdfUrl(json.data.url);
          else if (!cancelled) setError('Failed to get document URL');
        } catch {
          if (!cancelled) setError('Network error loading document');
        }
      })();
      return () => { cancelled = true; };
    }, [documentId]);

    const onDocumentLoadSuccess = useCallback(
      ({ numPages: n }: { numPages: number }) => { setNumPages(n); setLoading(false); },
      [],
    );

    const onDocumentLoadError = useCallback((err: Error) => {
      setError(`PDF load failed: ${err.message}`); setLoading(false);
    }, []);

    const handleMouseUp = useCallback(() => {
      if (!onTextSelect) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
      const text = sel.toString().trim();
      if (text.length < 3) return;

      let pageEl: HTMLElement | null = sel.anchorNode instanceof HTMLElement
        ? sel.anchorNode : sel.anchorNode?.parentElement ?? null;
      let pageNumber = currentPage;
      while (pageEl) {
        const pn = pageEl.getAttribute?.('data-page-number');
        if (pn) { pageNumber = parseInt(pn, 10); break; }
        pageEl = pageEl.parentElement;
      }

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const containerRect = containerRef.current?.getBoundingClientRect();
      const relRect = containerRect
        ? { top: rect.top - containerRect.top, left: rect.left - containerRect.left, width: rect.width, height: rect.height }
        : { top: rect.top, left: rect.left, width: rect.width, height: rect.height };

      onTextSelect({ text, pageNumber, rect: relRect });
    }, [onTextSelect, currentPage]);

    // Highlight overlays for the current page — find matching text in
    // the text layer and apply a colored background via DOM manipulation
    // after the page renders.
    const onPageRenderSuccess = useCallback(() => {
      if (!containerRef.current) return;
      const pageHighlights = highlights.filter((h) => h.pageNumber === currentPage);
      const flashTarget = flashExcerpt;

      // Find the text layer spans
      const textLayer = containerRef.current.querySelector('.react-pdf__Page__textContent');
      if (!textLayer) return;

      // Remove previous custom highlights
      textLayer.querySelectorAll('.rfp-highlight').forEach((el) => el.remove());

      const spans = Array.from(textLayer.querySelectorAll('span'));
      const fullText = spans.map((s) => s.textContent ?? '').join('');

      const allTargets = [
        ...pageHighlights.map((h) => ({ excerpt: h.sourceExcerpt, color: h.color ?? 'rgba(74, 222, 128, 0.3)', flash: false })),
        ...(flashTarget ? [{ excerpt: flashTarget, color: 'rgba(250, 204, 21, 0.5)', flash: true }] : []),
      ];

      for (const target of allTargets) {
        const excerpt = target.excerpt.slice(0, 200);
        const idx = fullText.toLowerCase().indexOf(excerpt.toLowerCase());
        if (idx === -1) continue;

        // Find which spans contain this text range
        let charCount = 0;
        for (const span of spans) {
          const spanText = span.textContent ?? '';
          const spanStart = charCount;
          const spanEnd = charCount + spanText.length;
          charCount = spanEnd;

          if (spanEnd <= idx) continue;
          if (spanStart >= idx + excerpt.length) break;

          // This span overlaps with our target text
          const rect = span.getBoundingClientRect();
          const containerRect = containerRef.current!.getBoundingClientRect();

          const overlay = document.createElement('div');
          overlay.className = 'rfp-highlight';
          overlay.style.cssText = `
            position: absolute;
            top: ${rect.top - containerRect.top}px;
            left: ${rect.left - containerRect.left}px;
            width: ${rect.width}px;
            height: ${rect.height}px;
            background: ${target.color};
            pointer-events: none;
            z-index: 5;
            border-radius: 2px;
            ${target.flash ? 'animation: rfp-flash 1s ease-out 2;' : ''}
          `;
          containerRef.current!.appendChild(overlay);
        }
      }
    }, [highlights, currentPage, flashExcerpt]);

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
        <style>{`
          @keyframes rfp-flash {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }
        `}</style>

        <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 text-sm">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="px-2 py-1 border rounded text-xs disabled:opacity-30"
          >
            Prev
          </button>
          <div className="flex items-center gap-2">
            <span className="text-gray-600">Page</span>
            <input
              type="number"
              min={1}
              max={numPages || 999}
              value={currentPage}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (v >= 1 && v <= numPages) setCurrentPage(v);
              }}
              className="w-14 text-center border rounded px-1 py-0.5 text-xs"
            />
            <span className="text-gray-600">of {numPages || '…'}</span>
          </div>
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
              onRenderSuccess={onPageRenderSuccess}
            />
          </Document>
        </div>

        {/* Current page highlights indicator */}
        {highlights.filter((h) => h.pageNumber === currentPage).length > 0 && (
          <div className="absolute top-12 right-4 bg-award text-white text-xs px-2 py-1 rounded-full shadow">
            {highlights.filter((h) => h.pageNumber === currentPage).length} highlight{highlights.filter((h) => h.pageNumber === currentPage).length !== 1 ? 's' : ''} on this page
          </div>
        )}
      </div>
    );
  }
);
