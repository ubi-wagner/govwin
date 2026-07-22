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
 *   - Text search with match highlighting and navigation
 *   - TOC / outline sidebar extracted from PDF metadata
 *   - Keyboard shortcuts: Ctrl+F (search), Esc (close), PgUp/PgDn (nav)
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';

import type { SourceAnchor, AnchorRect } from '@/lib/types/source-anchor';

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export interface TextSelection {
  text: string;
  pageNumber: number;
  /** Screen-space rect for positioning the tag popover. */
  rect: { top: number; left: number; width: number; height: number };
  /** Full anchor data for storage -- includes percentage-based rects. */
  anchor: SourceAnchor;
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

interface TocEntry {
  title: string;
  pageNumber: number;
  level: number;
  children?: TocEntry[];
}

interface SearchMatch {
  pageNumber: number;
  index: number; // character index within the page text
}

interface Props {
  documentId: string;
  onTextSelect?: (selection: TextSelection) => void;
  highlights?: HighlightAnnotation[];
  width?: number;
  /** Pre-extracted text by page (1-indexed). Falls back to text layer. */
  extractedText?: Record<number, string>;
  /** next/dynamic (ssr:false) drops `ref`, so a dynamically-loaded caller passes the
   *  imperative handle here as a normal prop instead. Preferred over `ref` in that case. */
  innerRef?: Ref<PdfViewerHandle>;
}

export const PdfViewer = forwardRef<PdfViewerHandle, Props>(
  function PdfViewer({ documentId, onTextSelect, highlights = [], width = 700, extractedText, innerRef }, ref) {
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [numPages, setNumPages] = useState<number>(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [flashExcerpt, setFlashExcerpt] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const pdfDocRef = useRef<pdfjs.PDFDocumentProxy | null>(null);

    // --- Search state ---
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
    const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // --- TOC state ---
    const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
    const [tocOpen, setTocOpen] = useState(false);

    // --- Page text cache (for search) ---
    const pageTextCache = useRef<Record<number, string>>({});

    useImperativeHandle(innerRef ?? ref, () => ({
      goToPage(page: number) {
        setCurrentPage(Math.max(1, Math.min(page, numPages)));
      },
      highlightText(page: number, excerpt: string) {
        setCurrentPage(Math.max(1, Math.min(page, numPages)));
        setFlashExcerpt(excerpt);
        setTimeout(() => setFlashExcerpt(null), 3000);
      },
    }), [numPages]);

    // --- Fetch PDF URL ---
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
      (pdf: { numPages: number }) => {
        setNumPages(pdf.numPages);
        setLoading(false);
        // Store the proxy for outline extraction
        const proxy = pdf as unknown as pdfjs.PDFDocumentProxy;
        pdfDocRef.current = proxy;
        extractOutline(proxy);
      },
      // extractOutline is a stable useCallback declared just below — listing it
      // here would reference it in its TDZ. It's only invoked (identity-independent),
      // so an empty dep list is correct.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    const onDocumentLoadError = useCallback((err: Error) => {
      setError(`PDF load failed: ${err.message}`); setLoading(false);
    }, []);

    // --- Extract TOC / outline from PDF metadata ---
    const extractOutline = useCallback(async (pdf: pdfjs.PDFDocumentProxy) => {
      try {
        const outline = await pdf.getOutline();
        if (!outline || outline.length === 0) {
          setTocEntries([]);
          return;
        }

        const entries: TocEntry[] = [];

        const processItems = async (
          items: Awaited<ReturnType<pdfjs.PDFDocumentProxy['getOutline']>>,
          level: number,
        ): Promise<TocEntry[]> => {
          if (!items) return [];
          const result: TocEntry[] = [];
          for (const item of items) {
            let pageNum = 1;
            if (item.dest) {
              try {
                const dest = typeof item.dest === 'string'
                  ? await pdf.getDestination(item.dest)
                  : item.dest;
                if (dest && dest[0]) {
                  const pageRef = dest[0];
                  const pageIndex = await pdf.getPageIndex(pageRef);
                  pageNum = pageIndex + 1;
                }
              } catch {
                // Could not resolve destination; default to page 1
              }
            }
            const children = item.items && item.items.length > 0
              ? await processItems(item.items, level + 1)
              : undefined;
            result.push({ title: item.title, pageNumber: pageNum, level, children });
          }
          return result;
        };

        const processed = await processItems(outline, 0);
        setTocEntries(processed);
      } catch {
        setTocEntries([]);
      }
    }, []);

    // --- Get page text (from extractedText prop or pdf.js) ---
    const getPageText = useCallback(async (pageNum: number): Promise<string> => {
      if (extractedText && extractedText[pageNum]) {
        return extractedText[pageNum];
      }
      if (pageTextCache.current[pageNum]) {
        return pageTextCache.current[pageNum];
      }
      if (!pdfDocRef.current) return '';
      try {
        const page = await pdfDocRef.current.getPage(pageNum);
        const textContent = await page.getTextContent();
        const text = textContent.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ');
        pageTextCache.current[pageNum] = text;
        return text;
      } catch {
        return '';
      }
    }, [extractedText]);

    // --- Search: find all matches across all pages ---
    useEffect(() => {
      if (!searchQuery.trim() || !numPages) {
        setSearchMatches([]);
        setCurrentMatchIndex(0);
        return;
      }

      let cancelled = false;
      const query = searchQuery.toLowerCase();

      (async () => {
        const matches: SearchMatch[] = [];
        for (let p = 1; p <= numPages; p++) {
          const text = await getPageText(p);
          if (cancelled) return;
          const lowerText = text.toLowerCase();
          let pos = 0;
          while (true) {
            const idx = lowerText.indexOf(query, pos);
            if (idx === -1) break;
            matches.push({ pageNumber: p, index: idx });
            pos = idx + 1;
          }
        }
        if (!cancelled) {
          setSearchMatches(matches);
          setCurrentMatchIndex(0);
          // Navigate to first match page
          if (matches.length > 0) {
            setCurrentPage(matches[0].pageNumber);
          }
        }
      })();

      return () => { cancelled = true; };
    }, [searchQuery, numPages, getPageText]);

    // --- Search navigation ---
    const goToMatch = useCallback((index: number) => {
      if (searchMatches.length === 0) return;
      const wrapped = ((index % searchMatches.length) + searchMatches.length) % searchMatches.length;
      setCurrentMatchIndex(wrapped);
      setCurrentPage(searchMatches[wrapped].pageNumber);
    }, [searchMatches]);

    const nextMatch = useCallback(() => goToMatch(currentMatchIndex + 1), [goToMatch, currentMatchIndex]);
    const prevMatch = useCallback(() => goToMatch(currentMatchIndex - 1), [goToMatch, currentMatchIndex]);

    // --- Keyboard shortcuts ---
    useEffect(() => {
      const handler = (e: globalThis.KeyboardEvent) => {
        // Ctrl+F -> focus search
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
          e.preventDefault();
          setSearchOpen(true);
          setTimeout(() => searchInputRef.current?.focus(), 50);
          return;
        }
        // Escape -> close search
        if (e.key === 'Escape' && searchOpen) {
          setSearchOpen(false);
          setSearchQuery('');
          setSearchMatches([]);
          return;
        }
        // Page navigation (only when search input is not focused)
        if (document.activeElement?.tagName === 'INPUT') return;
        if (e.key === 'PageDown') {
          e.preventDefault();
          setCurrentPage((p) => Math.min(numPages, p + 1));
        } else if (e.key === 'PageUp') {
          e.preventDefault();
          setCurrentPage((p) => Math.max(1, p - 1));
        }
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }, [numPages, searchOpen]);

    // --- Search input key handlers ---
    const handleSearchKeyDown = useCallback((e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) prevMatch();
        else nextMatch();
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setSearchQuery('');
        setSearchMatches([]);
      }
    }, [nextMatch, prevMatch]);

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

      // Compute percentage-based rects for resolution-independent storage.
      const pageCanvas = containerRef.current?.querySelector('.react-pdf__Page');
      const pageRect = pageCanvas?.getBoundingClientRect();
      let anchorRects: AnchorRect[] | undefined;
      if (pageRect && pageRect.width > 0 && pageRect.height > 0) {
        const clientRects = range.getClientRects();
        anchorRects = Array.from(clientRects).map((cr) => ({
          x: ((cr.left - pageRect.left) / pageRect.width) * 100,
          y: ((cr.top - pageRect.top) / pageRect.height) * 100,
          w: (cr.width / pageRect.width) * 100,
          h: (cr.height / pageRect.height) * 100,
        }));
      }

      const anchor: SourceAnchor = {
        page: pageNumber,
        excerpt: text,
        rects: anchorRects,
        method: 'manual_selection',
        created_at: new Date().toISOString(),
      };

      onTextSelect({ text, pageNumber, rect: relRect, anchor });
    }, [onTextSelect, currentPage]);

    // Highlight overlays for the current page
    const onPageRenderSuccess = useCallback(() => {
      if (!containerRef.current) return;
      const pageHighlights = highlights.filter((h) => h.pageNumber === currentPage);
      const flashTarget = flashExcerpt;

      const textLayer = containerRef.current.querySelector('.react-pdf__Page__textContent');
      if (!textLayer) return;

      // Remove previous custom highlights
      textLayer.querySelectorAll('.rfp-highlight').forEach((el) => el.remove());

      const spans = Array.from(textLayer.querySelectorAll('span'));
      const fullText = spans.map((s) => s.textContent ?? '').join('');

      // Build targets: existing highlights + flash + search highlights
      const allTargets = [
        ...pageHighlights.map((h) => ({ excerpt: h.sourceExcerpt, color: h.color ?? 'rgba(74, 222, 128, 0.3)', flash: false })),
        ...(flashTarget ? [{ excerpt: flashTarget, color: 'rgba(250, 204, 21, 0.5)', flash: true }] : []),
      ];

      // Add search match highlights for the current page
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const lowerFull = fullText.toLowerCase();
        let pos = 0;
        while (true) {
          const idx = lowerFull.indexOf(query, pos);
          if (idx === -1) break;
          const matchText = fullText.slice(idx, idx + searchQuery.length);
          allTargets.push({ excerpt: matchText, color: 'rgba(255, 165, 0, 0.4)', flash: false });
          pos = idx + 1;
        }
      }

      for (const target of allTargets) {
        const excerpt = target.excerpt.slice(0, 200);
        const idx = fullText.toLowerCase().indexOf(excerpt.toLowerCase());
        if (idx === -1) continue;

        let charCount = 0;
        for (const span of spans) {
          const spanText = span.textContent ?? '';
          const spanStart = charCount;
          const spanEnd = charCount + spanText.length;
          charCount = spanEnd;

          if (spanEnd <= idx) continue;
          if (spanStart >= idx + excerpt.length) break;

          const rect = span.getBoundingClientRect();
          const cRect = containerRef.current!.getBoundingClientRect();

          const overlay = document.createElement('div');
          overlay.className = 'rfp-highlight';
          overlay.style.cssText = `
            position: absolute;
            top: ${rect.top - cRect.top}px;
            left: ${rect.left - cRect.left}px;
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
    }, [highlights, currentPage, flashExcerpt, searchQuery]);

    // --- Cache current page text on render ---
    useEffect(() => {
      if (numPages > 0) {
        getPageText(currentPage);
      }
    }, [currentPage, numPages, getPageText]);

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
      <div className="flex">
        {/* TOC Sidebar */}
        {tocOpen && (
          <div className="w-64 border-r bg-white overflow-y-auto max-h-[80vh] flex-shrink-0">
            <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
              <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Outline</span>
              <button
                onClick={() => setTocOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xs"
                title="Close outline"
              >
                &times;
              </button>
            </div>
            {tocEntries.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-gray-400">
                No outline available
              </div>
            ) : (
              <div className="py-1">
                <TocTree entries={tocEntries} onNavigate={(page) => { setCurrentPage(page); }} currentPage={currentPage} />
              </div>
            )}
          </div>
        )}

        {/* Main viewer */}
        <div ref={containerRef} className="relative flex-1">
          <style>{`
            @keyframes rfp-flash {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.3; }
            }
          `}</style>

          {/* Toolbar */}
          <div className="sticky top-0 z-10 bg-white border-b">
            {/* Primary controls: TOC toggle, page nav, search toggle */}
            <div className="flex items-center justify-between px-4 py-2 text-sm">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTocOpen((v) => !v)}
                  className={`px-2 py-1 border rounded text-xs ${tocOpen ? 'bg-gray-100 border-gray-400' : ''}`}
                  title="Toggle outline (TOC)"
                >
                  <svg className="w-3.5 h-3.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h10M4 18h16" />
                  </svg>
                </button>
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="px-2 py-1 border rounded text-xs disabled:opacity-30"
                >
                  Prev
                </button>
              </div>

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
                <span className="text-gray-600">of {numPages || '...'}</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
                  disabled={currentPage >= numPages}
                  className="px-2 py-1 border rounded text-xs disabled:opacity-30"
                >
                  Next
                </button>
                <button
                  onClick={() => {
                    setSearchOpen((v) => !v);
                    if (!searchOpen) setTimeout(() => searchInputRef.current?.focus(), 50);
                  }}
                  className={`px-2 py-1 border rounded text-xs ${searchOpen ? 'bg-gray-100 border-gray-400' : ''}`}
                  title="Search (Ctrl+F)"
                >
                  <svg className="w-3.5 h-3.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Search bar (collapsible) */}
            {searchOpen && (
              <div className="flex items-center gap-2 px-4 py-2 border-t bg-gray-50">
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search in document..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  className="flex-1 border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                  autoFocus
                />
                {searchMatches.length > 0 && (
                  <span className="text-xs text-gray-500 whitespace-nowrap">
                    {currentMatchIndex + 1} of {searchMatches.length} match{searchMatches.length !== 1 ? 'es' : ''}
                  </span>
                )}
                {searchQuery.trim() && searchMatches.length === 0 && (
                  <span className="text-xs text-gray-400 whitespace-nowrap">No matches</span>
                )}
                <button
                  onClick={prevMatch}
                  disabled={searchMatches.length === 0}
                  className="px-1.5 py-0.5 border rounded text-xs disabled:opacity-30"
                  title="Previous match (Shift+Enter)"
                >
                  &uarr;
                </button>
                <button
                  onClick={nextMatch}
                  disabled={searchMatches.length === 0}
                  className="px-1.5 py-0.5 border rounded text-xs disabled:opacity-30"
                  title="Next match (Enter)"
                >
                  &darr;
                </button>
                <button
                  onClick={() => { setSearchOpen(false); setSearchQuery(''); setSearchMatches([]); }}
                  className="text-gray-400 hover:text-gray-600 text-xs px-1"
                  title="Close search (Esc)"
                >
                  &times;
                </button>
              </div>
            )}
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
      </div>
    );
  }
);

// --- TOC Tree component ---

function TocTree({
  entries,
  onNavigate,
  currentPage,
}: {
  entries: TocEntry[];
  onNavigate: (page: number) => void;
  currentPage: number;
}) {
  return (
    <ul className="text-xs">
      {entries.map((entry, i) => (
        <TocItem key={`${entry.pageNumber}-${i}`} entry={entry} onNavigate={onNavigate} currentPage={currentPage} />
      ))}
    </ul>
  );
}

function TocItem({
  entry,
  onNavigate,
  currentPage,
}: {
  entry: TocEntry;
  onNavigate: (page: number) => void;
  currentPage: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const isActive = entry.pageNumber === currentPage;
  const hasChildren = entry.children && entry.children.length > 0;

  return (
    <li>
      <div
        className={`flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-gray-100 ${
          isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'
        }`}
        style={{ paddingLeft: `${8 + entry.level * 12}px` }}
      >
        {hasChildren && (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="w-3 h-3 flex items-center justify-center text-gray-400 hover:text-gray-600 flex-shrink-0"
          >
            {expanded ? '▾' : '▸'}
          </button>
        )}
        {!hasChildren && <span className="w-3 flex-shrink-0" />}
        <button
          onClick={() => onNavigate(entry.pageNumber)}
          className="flex-1 text-left truncate hover:underline"
          title={`${entry.title} (p. ${entry.pageNumber})`}
        >
          {entry.title}
        </button>
        <span className="text-gray-400 flex-shrink-0 ml-1">{entry.pageNumber}</span>
      </div>
      {hasChildren && expanded && (
        <TocTree entries={entry.children!} onNavigate={onNavigate} currentPage={currentPage} />
      )}
    </li>
  );
}
