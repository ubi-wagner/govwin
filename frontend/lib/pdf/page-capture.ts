/**
 * PDF page capture — the foundational floor under every visual check in the product.
 *
 * WHY THIS EXISTS. Text extraction tells you what a document SAYS. It tells you nothing about what
 * the document LOOKS LIKE, and a proposal is judged on both. Every visual defect found in this
 * codebase — diagram labels truncated mid-word, cost bands under ten percent rendering as
 * unlabelled slivers, a caption borrowed from alt text, a footer printing the literal string
 * "Page {page}" — was invisible to every ruler, every type check and every unit test, and obvious
 * the moment somebody rendered the page and looked at it. So rendering the page is not a debugging
 * convenience; it is a primitive the product needs, and this is it.
 *
 * WHAT IT DOES. Rasterizes any PDF, page by page, to PNG — and, separately, pulls the FIGURES back
 * out of those pages as their own images. Two capabilities, one engine:
 *
 *   capturePdfPages    every page as a PNG, at a chosen scale. The input to a visual review: an
 *                      agent (or a person) looks at the page as an evaluator will see it.
 *   extractPdfFigures  every embedded image, cropped out of the rendered page at page resolution
 *                      and returned with its position. This is how a customer's OWN figures — the
 *                      photographs, CAD renders and plots inside the proposals they upload — become
 *                      reusable library content instead of being discarded at ingest.
 *
 * HOW. Chromium (already a dependency — the PDF exporter renders through it) driving the
 * self-hosted pdf.js runtime in `public/pdfjs`. pdf.js needs a real canvas and a worker, so it runs
 * in a browser page rather than in Node: an ephemeral loopback HTTP server serves the runtime, the
 * loader and the PDF bytes to a headless tab, which renders and hands back base64 PNGs.
 *
 * The loopback server is the load-bearing detail. Module scripts cannot be imported from `file:`
 * or `data:` URLs (both are opaque origins), and bundling pdf.js is exactly what
 * `components/portal/capture-atomizer.tsx` documents as breaking — webpack's ESM interop chokes on
 * `pdf.mjs`. A same-origin `http://127.0.0.1:<ephemeral>` server sidesteps both, binds to loopback
 * only, serves three fixed paths, and is closed in a `finally`.
 *
 * BEST-EFFORT AND BOUNDED. Every entry point returns an empty array rather than throwing — a
 * capture failure must never take down an ingest or an export. Page count, scale and per-run
 * timeout are all capped, because this renders untrusted customer documents.
 */
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

/** One rendered page. `png` is raw PNG bytes; `width`/`height` are the rendered pixel size. */
export interface CapturedPage {
  pageNumber: number;
  png: Buffer;
  width: number;
  height: number;
}

/** One figure lifted off a page, with where it sat. `bbox` is in rendered page pixels. */
export interface ExtractedFigure extends CapturedPage {
  bbox: { x: number; y: number; w: number; h: number };
  /** Fraction of the page area the figure covers — the cheapest signal for "is this decoration". */
  pageFraction: number;
}

export interface CaptureOptions {
  /** Render scale. 2 ≈ 144 dpi — legible to a vision model without ballooning the payload. */
  scale?: number;
  /** Hard cap on pages rendered. Protects against a 400-page BAA. */
  maxPages?: number;
  /** 1-based page numbers to render. Omit for "from the start, up to maxPages". */
  pages?: number[];
  /** Whole-run timeout in ms. */
  timeoutMs?: number;
}

const DEFAULTS = { scale: 2, maxPages: 40, timeoutMs: 120_000 };

/** Where the self-hosted pdf.js runtime lives. Same files the Capture tab loads in the browser. */
const PDFJS_DIR = path.join(process.cwd(), 'public', 'pdfjs');

/**
 * The page that does the work. Kept as a string rather than a file so the capability has no build
 * step and no asset to forget to copy into `.next/standalone`.
 *
 * `disableFontFace` is deliberate: it makes pdf.js draw glyphs as paths instead of loading embedded
 * fonts, which removes the one thing that makes headless rendering non-deterministic across hosts.
 * The output is a picture either way, and a picture that renders identically everywhere is worth
 * more here than a marginally crisper one.
 */
const LOADER_HTML = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff">
<script type="module">
import * as pdfjs from './pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs';

async function render(scale, pages) {
  const res = await fetch('./doc.pdf');
  const data = new Uint8Array(await res.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, disableFontFace: true, isEvalSupported: false }).promise;
  const out = [];
  for (const n of pages.filter((p) => p >= 1 && p <= doc.numPages)) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, background: '#fff' }).promise;

    // Where the embedded images sit, in DEVICE space. pdf.js reports a transform per
    // paintImageXObject; the unit image square maps through it, so |a|,|d| give the drawn size and
    // (e,f) the origin — with the PDF y-axis flipped, which is why the top edge is height - f.
    const boxes = [];
    try {
      const ops = await page.getOperatorList();
      const PAINT = new Set([
        pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject,
        pdfjs.OPS.paintImageMaskXObject, pdfjs.OPS.paintJpegXObject,
      ].filter((x) => x !== undefined));
      // Track the CTM the way pdf.js's own evaluator does: save/restore stack + transform ops.
      let ctm = [scale, 0, 0, scale, 0, 0];
      const stack = [];
      const mul = (m, n) => [
        m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
      ];
      for (let i = 0; i < ops.fnArray.length; i += 1) {
        const fn = ops.fnArray[i];
        if (fn === pdfjs.OPS.save) { stack.push(ctm.slice()); continue; }
        if (fn === pdfjs.OPS.restore) { ctm = stack.pop() || ctm; continue; }
        if (fn === pdfjs.OPS.transform) { ctm = mul(ctm, ops.argsArray[i]); continue; }
        if (!PAINT.has(fn)) continue;
        const w = Math.abs(ctm[0]) + Math.abs(ctm[2]);
        const h = Math.abs(ctm[1]) + Math.abs(ctm[3]);
        if (!(w > 1 && h > 1)) continue;
        const x = ctm[4];
        const yTop = canvas.height - ctm[5] - h;   // PDF origin is bottom-left
        boxes.push({ x, y: yTop, w, h });
      }
    } catch { /* an operator walk that fails costs us the boxes, never the page */ }

    out.push({
      pageNumber: n,
      width: canvas.width,
      height: canvas.height,
      png: canvas.toDataURL('image/png'),
      boxes,
    });
  }
  return out;
}
window.__render = render;
window.__ready = true;
</script></body>`;

/** Serve the pdf.js runtime, the loader and the document to a loopback-only ephemeral port. */
async function serveAssets(pdf: Buffer): Promise<{ server: Server; origin: string }> {
  const [runtime, worker] = await Promise.all([
    readFile(path.join(PDFJS_DIR, 'pdf.min.mjs')),
    readFile(path.join(PDFJS_DIR, 'pdf.worker.min.mjs')),
  ]);
  const routes: Record<string, { body: Buffer; type: string }> = {
    '/': { body: Buffer.from(LOADER_HTML, 'utf8'), type: 'text/html; charset=utf-8' },
    '/pdf.min.mjs': { body: runtime, type: 'text/javascript' },
    '/pdf.worker.min.mjs': { body: worker, type: 'text/javascript' },
    '/doc.pdf': { body: pdf, type: 'application/pdf' },
  };
  const server = createServer((req, res) => {
    const hit = routes[(req.url ?? '/').split('?')[0]];
    if (!hit) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': hit.type, 'content-length': hit.body.length });
    res.end(hit.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, origin: `http://127.0.0.1:${port}` };
}

/**
 * Chromium, located by the SAME rule the PDF exporter uses.
 *
 * This used to read its own `CHROMIUM_PATH`, which nothing sets. In the sandbox that meant every
 * capture worked from a shell (where the variable was exported by hand) and every capture failed
 * inside the running server — silently, because the whole module is best-effort. The visible
 * symptom was a Technical Volume that downloaded at eleven pages against a ten-page cap: the
 * render-verified page fit had quietly measured nothing at all.
 *
 * `lib/export/chromium.ts` now owns the one rule — explicit override, Playwright-managed download,
 * system package, Playwright's default — and both callers use it. Two ways of finding the same
 * browser is one way too many, and importing it FROM the exporter would close a cycle (the export
 * assembler imports both), which is the shape that resolves to `undefined` at call time.
 */
async function launchBrowser() {
  const { chromium } = await import('playwright');
  const { resolveChromiumExecutable } = await import('@/lib/export/chromium');
  const executablePath = await resolveChromiumExecutable();
  return chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox', '--disable-setuid-sandbox'] });
}

interface RawPage {
  pageNumber: number; width: number; height: number; png: string;
  boxes: Array<{ x: number; y: number; w: number; h: number }>;
}

/** Render pages once and hand back everything the two public entry points need. */
async function renderPages(pdf: Buffer, opts: CaptureOptions): Promise<RawPage[]> {
  const scale = Math.min(4, Math.max(0.5, opts.scale ?? DEFAULTS.scale));
  const maxPages = Math.min(200, Math.max(1, opts.maxPages ?? DEFAULTS.maxPages));
  const pages = opts.pages?.length
    ? opts.pages.slice(0, maxPages)
    : Array.from({ length: maxPages }, (_, i) => i + 1);

  let server: Server | null = null;
  let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null;
  try {
    const served = await serveAssets(pdf);
    server = served.server;
    browser = await launchBrowser();
    const page = await browser.newPage();
    page.setDefaultTimeout(opts.timeoutMs ?? DEFAULTS.timeoutMs);
    await page.goto(served.origin, { waitUntil: 'load' });
    await page.waitForFunction('window.__ready === true');
    return await page.evaluate(
      ([s, p]) => (window as unknown as { __render: (s: number, p: number[]) => Promise<RawPage[]> }).__render(s as number, p as number[]),
      [scale, pages] as [number, number[]],
    );
  } catch (e) {
    console.error('[pdf/page-capture] render failed:', e instanceof Error ? e.message : e);
    return [];
  } finally {
    await browser?.close().catch(() => {});
    server?.close();
  }
}

const fromDataUrl = (dataUrl: string): Buffer =>
  Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');

/**
 * Every page of a PDF as a PNG.
 *
 * This is what a visual reviewer looks at: the page exactly as an evaluator will see it, margins,
 * white space, figure placement and all.
 */
export async function capturePdfPages(pdf: Buffer, opts: CaptureOptions = {}): Promise<CapturedPage[]> {
  const raw = await renderPages(pdf, opts);
  return raw.map((r) => ({
    pageNumber: r.pageNumber, width: r.width, height: r.height, png: fromDataUrl(r.png),
  }));
}

export interface FigureOptions extends CaptureOptions {
  /** Drop anything smaller than this fraction of the page — rules, bullets, logo chips. */
  minPageFraction?: number;
  /** Drop anything at or above this fraction — a full-bleed background is not a figure. */
  maxPageFraction?: number;
  /** Drop anything narrower/shorter than this many rendered pixels. */
  minPixels?: number;
}

/**
 * The FIGURES inside a PDF, cropped out of the rendered page.
 *
 * Cropping the rendered page rather than pulling the embedded image stream is deliberate. A figure
 * in a real proposal is routinely several XObjects composited together — a plot over a background,
 * a photo with a transparency mask, a CAD render tiled in strips — and the embedded streams are
 * individually meaningless. What the author drew is what the page shows, so that is what gets
 * taken. It also sidesteps every embedded-codec problem (JPX, CCITT, JBIG2) in one move.
 *
 * Filtering is by AREA, not by content. A picture smaller than a postage stamp is a rule or a
 * bullet glyph; one covering the whole page is a background or a scanned page. Both are page
 * furniture, and neither is worth putting in a reuse library.
 */
export async function extractPdfFigures(pdf: Buffer, opts: FigureOptions = {}): Promise<ExtractedFigure[]> {
  const minFrac = opts.minPageFraction ?? 0.02;
  const maxFrac = opts.maxPageFraction ?? 0.92;
  const minPx = opts.minPixels ?? 90;

  const raw = await renderPages(pdf, opts);
  if (raw.length === 0) return [];

  const sharp = (await import('sharp')).default;
  const out: ExtractedFigure[] = [];

  for (const r of raw) {
    const pageArea = r.width * r.height;
    if (pageArea <= 0) continue;
    const pagePng = fromDataUrl(r.png);

    // Merge overlapping boxes before cropping: a composited figure reports one box per layer, and
    // cropping each layer separately yields the same picture three times, sliced.
    const merged = mergeBoxes(r.boxes);

    for (const b of merged) {
      const x = Math.max(0, Math.round(b.x));
      const y = Math.max(0, Math.round(b.y));
      const w = Math.min(r.width - x, Math.round(b.w));
      const h = Math.min(r.height - y, Math.round(b.h));
      if (w < minPx || h < minPx) continue;
      const frac = (w * h) / pageArea;
      if (frac < minFrac || frac > maxFrac) continue;
      try {
        const png = await sharp(pagePng).extract({ left: x, top: y, width: w, height: h }).png().toBuffer();
        out.push({ pageNumber: r.pageNumber, png, width: w, height: h, bbox: { x, y, w, h }, pageFraction: frac });
      } catch (e) {
        console.error('[pdf/page-capture] crop failed:', e instanceof Error ? e.message : e);
      }
    }
  }
  return out;
}

/** Union any boxes that overlap or touch, repeatedly, until nothing merges. */
function mergeBoxes(boxes: Array<{ x: number; y: number; w: number; h: number }>) {
  const out = boxes.map((b) => ({ ...b }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < out.length; i += 1) {
      for (let j = i + 1; j < out.length; j += 1) {
        const a = out[i], b = out[j];
        const overlaps = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        if (!overlaps) continue;
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        out[i] = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
        out.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return out;
}
