/**
 * paginate() — re-exported from the canonical ruler in lib/types/canvas-document.
 *
 * The flow-pagination engine now lives beside estimatePageCount so both share ONE
 * calibrated implementation (flowMetrics + nodeStackHeightPt). Previously this file
 * carried its own uncalibrated metrics (0.5em glyphs, lighter heading/table scales)
 * that UNDERCOUNTED — the in-editor gauge could read "6 pages" while the compliance
 * floor read "7". Unifying removed that drift. Import site kept for compatibility.
 *
 * See docs/CANVAS_GEOMETRY_REDESIGN.md §6.
 */
export { paginate, type LayoutResult, type SectionPageInfo } from '@/lib/types/canvas-document';
