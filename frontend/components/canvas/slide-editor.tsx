'use client';

/**
 * Slide Editor — WYSIWYG presentation editor for slide-format documents.
 *
 * Replaces the standard continuous-scroll CanvasRenderer when the document
 * format is slide_16_9 or slide_4_3. Provides a PowerPoint-like editing
 * experience with a thumbnail panel on the left and a single-slide editing
 * area in the center.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import type { CanvasDocument, CanvasNode, NodeType, HeadingContent } from '@/lib/types/canvas-document';
import { CanvasRenderer } from './canvas-renderer';
import { useContainerScale } from '@/lib/hooks/use-container-scale';

// ─── Types ──────────────────────────────────────────────────────────

interface SlideEditorProps {
  document: CanvasDocument;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onUpdateNode: (nodeId: string, content: CanvasNode['content']) => void;
  onAddNode: (type: NodeType, afterId?: string) => void;
  onDeleteNode: (nodeId: string) => void;
  variables?: Record<string, string>;
  readOnly?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Split the flat node list into per-slide groups using page_break as separator. */
function splitIntoSlides(nodes: CanvasNode[]): CanvasNode[][] {
  const slides: CanvasNode[][] = [];
  let current: CanvasNode[] = [];
  for (const node of nodes) {
    if (node.type === 'page_break') {
      slides.push(current);
      current = [];
    } else {
      current.push(node);
    }
  }
  slides.push(current);
  return slides;
}

/** Extract a human-readable title from a slide's nodes. */
function getSlideTitle(slideNodes: CanvasNode[]): string | null {
  for (const node of slideNodes) {
    if (node.type === 'heading' && node.content) {
      return (node.content as HeadingContent).text;
    }
  }
  return null;
}

function substituteVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

// ─── Component ──────────────────────────────────────────────────────

export function SlideEditor({
  document: doc,
  selectedNodeId,
  onSelectNode,
  onUpdateNode,
  onAddNode,
  onDeleteNode,
  variables = {},
  readOnly = false,
}: SlideEditorProps) {
  const [currentSlide, setCurrentSlide] = useState(0);

  const slides = useMemo(() => splitIntoSlides(doc.nodes), [doc.nodes]);

  // Clamp currentSlide if slides are removed (P10: use useEffect instead of setState during render)
  useEffect(() => {
    if (currentSlide >= slides.length) {
      setCurrentSlide(Math.max(0, slides.length - 1));
    }
  }, [slides.length, currentSlide]);

  const clampedSlide = Math.min(currentSlide, Math.max(0, slides.length - 1));
  // Memoize so the `?? []` fallback doesn't create a new array ref every render
  // (which would defeat the slideDoc useMemo below).
  const currentSlideNodes = useMemo(() => slides[clampedSlide] ?? [], [slides, clampedSlide]);

  // Build a synthetic CanvasDocument containing only the current slide's nodes
  // so we can reuse CanvasRenderer for full editing capability.
  // Strip header/footer to avoid duplicate chrome (P12, P13).
  const slideDoc: CanvasDocument = useMemo(() => ({
    ...doc,
    canvas: {
      ...doc.canvas,
      header: null,
      footer: null,
    },
    nodes: currentSlideNodes,
    metadata: { ...doc.metadata },
  }), [doc, currentSlideNodes]);

  const is16x9 = doc.canvas.format === 'slide_16_9';
  const aspectRatio = is16x9 ? 16 / 9 : 4 / 3;
  // Scale the 700px reference slide to the actual center-area width so it fits
  // any pane (including a Chrome split-screen half) instead of overflowing.
  const [slideAreaRef, slideScale] = useContainerScale(700, { min: 0.3, pad: 64 });
  const slideW = Math.round(700 * slideScale);
  const slideH = Math.round((700 / aspectRatio) * slideScale);

  // Thumbnail dimensions
  const thumbWidth = 164; // px (inside the w-48 panel with padding)
  const thumbHeight = Math.round(thumbWidth / aspectRatio);

  const handleAddSlide = useCallback(() => {
    // Find the last node in the current slide and insert a page_break after it
    // We need to find the actual index in doc.nodes for the last node of the current slide
    const currentNodes = slides[Math.max(0, clampedSlide)] ?? [];
    const lastNode = currentNodes[currentNodes.length - 1];

    if (lastNode) {
      onAddNode('page_break', lastNode.id);
    } else if (doc.nodes.length === 0) {
      // Empty doc — just add a page_break to create a second slide
      onAddNode('page_break');
    } else {
      // Current slide is empty but there are nodes; find the page_break before this slide
      // and insert after it
      let pageBreakCount = 0;
      for (const node of doc.nodes) {
        if (node.type === 'page_break') {
          pageBreakCount++;
          if (pageBreakCount === clampedSlide) {
            onAddNode('page_break', node.id);
            break;
          }
        }
      }
      if (pageBreakCount < clampedSlide) {
        // Fallback: append to end
        onAddNode('page_break');
      }
    }

    setCurrentSlide(clampedSlide + 1);
  }, [slides, clampedSlide, doc.nodes, onAddNode]);

  const handleDeleteSlide = useCallback((slideIndex: number) => {
    if (slides.length <= 1) return; // Don't delete the last slide

    // Delete all nodes in this slide
    const slideNodes = slides[slideIndex];
    for (const node of slideNodes) {
      onDeleteNode(node.id);
    }

    // Delete the page_break that precedes this slide (if it exists, i.e. slideIndex > 0)
    // page_breaks in doc.nodes: the Nth page_break creates the boundary before slide N+1
    if (slideIndex > 0) {
      let breakCount = 0;
      for (const node of doc.nodes) {
        if (node.type === 'page_break') {
          breakCount++;
          if (breakCount === slideIndex) {
            onDeleteNode(node.id);
            break;
          }
        }
      }
    } else {
      // Deleting first slide: remove the first page_break (which separates slide 0 from slide 1)
      const firstBreak = doc.nodes.find((n) => n.type === 'page_break');
      if (firstBreak) {
        onDeleteNode(firstBreak.id);
      }
    }

    // Navigate to previous slide or 0
    setCurrentSlide(Math.max(0, slideIndex - 1));
  }, [slides, doc.nodes, onDeleteNode]);

  return (
    <div className="flex h-full">
      {/* ── Slide thumbnails panel ── */}
      <div className="w-48 bg-gray-100 border-r overflow-y-auto p-2 space-y-2 flex-shrink-0">
        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider px-1 mb-1">
          Slides
        </div>

        {slides.map((slideNodes, i) => (
          <button
            key={i}
            onClick={() => setCurrentSlide(i)}
            className={`w-full bg-white rounded shadow-sm border-2 transition-colors relative group ${
              clampedSlide === i ? 'border-blue-500' : 'border-transparent hover:border-gray-300'
            }`}
            style={{ aspectRatio: `${aspectRatio}` }}
          >
            {/* Mini slide preview */}
            <div className="absolute inset-0 p-2 overflow-hidden text-left">
              <div className="text-[8px] font-medium text-gray-700 truncate leading-tight">
                {getSlideTitle(slideNodes) || `Slide ${i + 1}`}
              </div>
              <div className="text-[6px] text-gray-400 mt-0.5">
                {slideNodes.length} element{slideNodes.length !== 1 ? 's' : ''}
              </div>
            </div>

            {/* Slide number */}
            <span className="absolute bottom-1 right-1.5 text-[9px] text-gray-400 font-medium">
              {i + 1}
            </span>

            {/* Delete button (on hover, not on the only slide) */}
            {!readOnly && slides.length > 1 && (
              <span
                onClick={(e) => { e.stopPropagation(); handleDeleteSlide(i); }}
                className="absolute top-0.5 right-0.5 hidden group-hover:flex items-center justify-center w-4 h-4 bg-red-500 text-white text-[8px] rounded-full cursor-pointer hover:bg-red-600"
                title="Delete slide"
              >
                x
              </span>
            )}
          </button>
        ))}

        {!readOnly && (
          <button
            onClick={handleAddSlide}
            className="w-full py-2 text-xs text-blue-600 hover:bg-blue-50 rounded border border-dashed border-blue-300 transition-colors"
          >
            + Add Slide
          </button>
        )}

        {/* Slide count */}
        <div className="text-[10px] text-gray-400 text-center pt-1">
          {slides.length} slide{slides.length !== 1 ? 's' : ''}
          {doc.canvas.max_slides && ` / ${doc.canvas.max_slides} max`}
        </div>
      </div>

      {/* ── Current slide editing area ── */}
      <div ref={slideAreaRef} className="flex-1 min-w-0 bg-gray-700 flex items-center justify-center overflow-auto p-8">
        <div className="flex flex-col items-center gap-4">
          {/* Slide surface */}
          <div
            className="bg-white shadow-2xl relative overflow-hidden"
            style={{
              width: slideW,
              height: slideH,
            }}
          >
            {/* Render current slide nodes using CanvasRenderer internals */}
            <div className="absolute inset-0">
              <CanvasRenderer
                document={slideDoc}
                selectedNodeId={selectedNodeId}
                onSelectNode={onSelectNode}
                onUpdateNode={onUpdateNode}
                variables={variables}
                readOnly={readOnly}
              />
            </div>

            {/* Footer overlay */}
            {doc.canvas.footer && (
              <div
                className="absolute bottom-0 left-0 right-0 px-6 py-1.5 text-center bg-white/90"
                style={{
                  fontFamily: doc.canvas.footer.font.family,
                  fontSize: `${doc.canvas.footer.font.size * 0.7}pt`,
                  color: '#888',
                }}
              >
                {substituteVars(doc.canvas.footer.template, {
                  ...variables,
                  n: String(clampedSlide + 1),
                  N: String(slides.length),
                })}
              </div>
            )}
          </div>

          {/* Slide info bar */}
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span>Slide {clampedSlide + 1} of {slides.length}</span>
            <span>&middot;</span>
            <span>{currentSlideNodes.length} element{currentSlideNodes.length !== 1 ? 's' : ''}</span>
            <span>&middot;</span>
            <span>{is16x9 ? '16:9' : '4:3'}</span>
          </div>

          {/* Keyboard navigation hint */}
          <div className="text-[10px] text-gray-500">
            Use the thumbnail panel to navigate between slides
          </div>
        </div>
      </div>
    </div>
  );
}
