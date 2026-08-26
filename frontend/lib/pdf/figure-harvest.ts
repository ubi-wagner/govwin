/**
 * Harvest a PDF's FIGURES into the tenant's library.
 *
 * WHY THIS EXISTS. A customer uploads their last three proposals so the system can reuse their
 * work. Ingest ran a text extractor over them and kept the words. Everything the author actually
 * DREW — the lab photographs, the CAD renders, the annotated screenshots, the plots — was dropped
 * on the floor. Measured on a real tenant library: 224 atoms, 1,010 canvas nodes, and not one image
 * among them. So when the drafter asked the library for material to put in a technical volume, the
 * only honest answer was prose, and the volume came out a wall of text.
 *
 * The pictures were never missing. They were in the PDFs the whole time.
 *
 * WHAT IT DOES. Runs the page-capture floor over the document, crops the figures off the rendered
 * pages, and lands each one as a tagged draft image atom — through
 * `atomizeCaptureIntoLibrary`, the SAME path the human Capture tab uses. That is deliberate: the
 * cocoon, the reference anchor, the OCR/vision enrichment, the tag vocabulary and the draft-review
 * gate all already exist and are already correct. This adds a source of regions, not a second
 * pipeline.
 *
 * WHAT IT WILL NOT DO. It does not publish. Every harvested atom lands `draft`, exactly as a
 * boxed screen capture does, so a person approves what enters the reusable library — a figure
 * lifted out of a past submission may carry another customer's markings, an export-controlled
 * image, or a competitor's logo, and none of that is for a machine to wave through.
 */
import { createHash } from 'node:crypto';
import { atomizeCaptureIntoLibrary, type CaptureRegionInput } from '@/lib/atomize-capture';
import type { AtomTagInput, CreatorKind } from '@/lib/atoms';
import { extractPdfFigures, capturePdfPages, type FigureOptions } from '@/lib/pdf/page-capture';

export interface HarvestInput {
  /** The document's bytes. */
  pdf: Buffer;
  /** File name / title, printed in the provenance line on every atom. */
  sourceName: string;
  /** Context tags for the whole harvest — agency/program/phase, as the ingest already resolved them. */
  ctxTags?: AtomTagInput[];
  actor: { id: string; kind: CreatorKind };
  /** Cap on atoms created from one document. */
  maxFigures?: number;
  capture?: FigureOptions;
}

export interface HarvestResult {
  /** Figures found on the pages. */
  found: number;
  /** Figures that survived dedupe + filtering and became atoms. */
  harvested: number;
  /** Dropped as a repeat (a letterhead or watermark recurring on every page). */
  duplicates: number;
  atomIds: string[];
  cocoonId: string | null;
}

/** Cap per document. A 300-page BAA full of icons is not a windfall. */
const MAX_FIGURES = 40;

/**
 * Pull the figures out of one PDF and put them in the library.
 *
 * Never throws: a document whose figures cannot be read still ingests its text, which is strictly
 * better than failing the upload.
 */
export async function harvestPdfFiguresIntoLibrary(
  tenantId: string,
  tenantSlug: string,
  input: HarvestInput,
): Promise<HarvestResult> {
  const empty: HarvestResult = { found: 0, harvested: 0, duplicates: 0, atomIds: [], cocoonId: null };
  try {
    const figures = await extractPdfFigures(input.pdf, { scale: 2, maxPages: 60, ...input.capture });
    if (figures.length === 0) return empty;

    // Drop repeats. A letterhead, a distribution-statement banner or a page-footer logo appears on
    // every page and would otherwise become thirty identical atoms. Hashing the decoded pixels (not
    // the PNG bytes) makes this robust to re-encoding differences between pages.
    const seen = new Set<string>();
    const kept: typeof figures = [];
    let duplicates = 0;
    for (const f of figures) {
      const key = await pixelHash(f.png);
      if (key && seen.has(key)) { duplicates += 1; continue; }
      if (key) seen.add(key);
      kept.push(f);
      if (kept.length >= (input.maxFigures ?? MAX_FIGURES)) break;
    }
    if (kept.length === 0) return { ...empty, found: figures.length, duplicates };

    const regions: CaptureRegionInput[] = kept.map((f) => ({
      buffer: f.png,
      contentType: 'image/png',
      width: f.width,
      height: f.height,
      // The title says where it came from, because that is the only thing known for certain before
      // enrichment runs. Vision captioning (when a key is present) replaces the guesswork with a
      // description of what the figure actually shows.
      title: `${input.sourceName} — page ${f.pageNumber}`,
      tags: input.ctxTags ?? [],
    }));

    // The document's first page stands as the reference frame the regions anchor to — the same role
    // the whole screen grab plays in a browser capture.
    const [firstPage] = await capturePdfPages(input.pdf, { scale: 2, pages: [1] });

    const res = await atomizeCaptureIntoLibrary(tenantId, tenantSlug, {
      ...(firstPage ? { full: { buffer: firstPage.png, contentType: 'image/png', width: firstPage.width, height: firstPage.height } } : {}),
      regions,
      sourceUrl: input.sourceName,
      sourceLabel: 'Figure harvested from PDF',
      note: `Figures harvested from ${input.sourceName} — ${kept.length} of ${figures.length} images kept`,
      ctxTags: input.ctxTags ?? [],
      actor: input.actor,
    });

    return {
      found: figures.length,
      harvested: res.regionIds.length,
      duplicates,
      atomIds: res.regionIds,
      cocoonId: res.cocoonId,
    };
  } catch (e) {
    console.error('[pdf/figure-harvest] harvest failed (non-fatal):', e instanceof Error ? e.message : e);
    return empty;
  }
}

/**
 * A hash of the DECODED pixels, downsampled.
 *
 * Two copies of the same letterhead on different pages re-encode to different PNG bytes, so hashing
 * the file would catch none of them. Decoding to a small fixed-size greyscale raster and hashing
 * that is both cheap and tolerant of the small rendering differences between pages.
 */
async function pixelHash(png: Buffer): Promise<string | null> {
  try {
    const sharp = (await import('sharp')).default;
    const raw = await sharp(png).greyscale().resize(16, 16, { fit: 'fill' }).raw().toBuffer();
    return createHash('sha1').update(raw).digest('hex');
  } catch {
    return null;
  }
}
