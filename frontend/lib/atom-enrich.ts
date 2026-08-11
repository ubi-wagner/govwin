/**
 * Image-atom enrichment — the step that stops a boxed/uploaded image from being a dead-end.
 *
 * A cropped region (a boxed table, a figure) becomes a draft IMAGE atom whose `content` is null,
 * so it's invisible to library search (title/summary ILIKE) AND to the reuse/draft agents. This
 * runs OCR over the crop and returns its text, which the capture pipeline writes into the atom's
 * content + summary — making the same atom findable by a human and legible to the machine.
 *
 * ENGINE-GATED like BOX-2's proposer: today the engine is TESSERACT (no API key; language data
 * self-hosted in `ocr-data/`, so it runs fully offline). A VISION caption model is the drop-in
 * upgrade — swap `enrichImages` for a vision call; the pipeline consumes `{ text, engine }` unchanged.
 * BEST-EFFORT by contract: any failure yields empty text so atom creation NEVER breaks.
 */
import { createWorker, type Worker } from 'tesseract.js';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export type EnrichEngine = 'ocr' | 'none';
export interface Enriched { text: string; engine: EnrichEngine }

const OCR_ENABLED = process.env.ATOM_OCR !== 'off'; // kill switch
const MIN_BYTES = 300;                    // skip empty / 1px crops
const MAX_BYTES = 12 * 1024 * 1024;       // don't OCR absurdly large images
const MAX_CHARS = 4000;                   // cap stored text

/** Resolve the self-hosted `eng.traineddata.gz` dir: explicit env → app-committed `ocr-data/`.
 *  cwd is the app root in dev and `.next/standalone` in prod (where ocr-data is staged). */
function resolveLangPath(): string | null {
  const candidates = [process.env.OCR_LANG_PATH, join(process.cwd(), 'ocr-data')].filter(Boolean) as string[];
  for (const c of candidates) if (existsSync(join(c, 'eng.traineddata.gz'))) return c;
  return null;
}

/** Squeeze OCR noise into a compact, storable string (single-spaced, capped). */
export function cleanOcr(raw: string): string {
  return raw.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').replace(/[^\S\n]*\n[^\S\n]*/g, '\n').trim().slice(0, MAX_CHARS);
}

/**
 * OCR a batch of image crops with ONE worker (spawn is ~0.8s, so batch don't per-image). Best-effort:
 * returns one `{ text, engine }` per input, in order; failures/opt-out yield `{ text:'', engine:'none' }`.
 */
export async function enrichImages(buffers: Buffer[]): Promise<Enriched[]> {
  const none = (): Enriched[] => buffers.map(() => ({ text: '', engine: 'none' }));
  if (!OCR_ENABLED || buffers.length === 0) return none();
  const langPath = resolveLangPath();
  if (!langPath) { console.error('[atom-enrich] OCR language data not found (ocr-data/) — skipping'); return none(); }
  const cachePath = process.env.OCR_CACHE || '/tmp/atom-ocr-cache';
  try { mkdirSync(cachePath, { recursive: true }); } catch { /* best-effort */ }

  let worker: Worker | null = null;
  try {
    worker = await createWorker('eng', 1, { langPath, gzip: true, cachePath });
    const out: Enriched[] = [];
    for (const buf of buffers) {
      if (!buf || buf.length < MIN_BYTES || buf.length > MAX_BYTES) { out.push({ text: '', engine: 'none' }); continue; }
      try {
        const { data } = await worker.recognize(buf);
        const text = cleanOcr(data.text);
        out.push({ text, engine: text ? 'ocr' : 'none' });
      } catch (e) {
        console.error('[atom-enrich] recognize failed', e instanceof Error ? e.message : e);
        out.push({ text: '', engine: 'none' });
      }
    }
    return out;
  } catch (e) {
    console.error('[atom-enrich] OCR worker unavailable', e instanceof Error ? e.message : e);
    return none();
  } finally {
    if (worker) { try { await worker.terminate(); } catch { /* ignore */ } }
  }
}
