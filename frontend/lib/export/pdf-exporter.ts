/**
 * Export a CanvasDocument to a PDF Buffer via Chromium (Playwright).
 *
 * The canvas → HTML render (canvas-html.ts) is pure; this module adds the
 * Chromium print step, so styled text, tables, and inline `data:` SVG figures
 * render at full fidelity, with the canvas header/footer repeated on every page
 * (Playwright running templates) and real page numbers.
 *
 * Chromium is loaded via a DYNAMIC import so it is never pulled into the Next.js
 * bundle — only when a PDF is actually generated. `playwright`/`playwright-core`
 * are `serverExternalPackages` (traced into the standalone output); the browser
 * itself is a SYSTEM Chromium (prod Docker: `apk add chromium`, pointed at via
 * `PLAYWRIGHT_CHROMIUM_EXECUTABLE`; sandbox: `PLAYWRIGHT_BROWSERS_PATH`). Launched
 * with `--no-sandbox` (containers run as a non-root user). The native
 * docx/pptx/xlsx exporters have no such dependency.
 */
import { renderCanvasToHtml } from './canvas-html';
import { inlineImageDataUris } from './image-raster';
import type { CanvasDocument } from '@/lib/types/canvas-document';

type RunningSpec = { template?: string } | null | undefined;

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function subst(t: unknown, vars: Record<string, string>): string {
  return String(t ?? '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

/** Render a canvas running-header/footer `template` to a Playwright template.
 *  {n}/{N} map to Chromium's live pageNumber/totalPages spans. */
function runningHtml(spec: RunningSpec, vars: Record<string, string>, isFooter: boolean): string {
  const raw = spec?.template ? subst(spec.template, vars) : '';
  let inner = esc(raw)
    .replace(/\{n\}/g, '<span class="pageNumber"></span>')
    .replace(/\{N\}/g, '<span class="totalPages"></span>');
  if (isFooter && !raw) inner = 'Page <span class="pageNumber"></span> of <span class="totalPages"></span>';
  const border = isFooter ? 'border-top' : 'border-bottom';
  return `<div style="font-size:9px;width:100%;padding:0 0.6in;color:#475569;${border}:0.5px solid #e2e8f0">${inner}</div>`;
}

/**
 * Resolve a Chromium executable. In production Playwright installs its own
 * version-matched browser (return undefined → default). In a sandbox where the
 * pre-installed browser build may not match the bundled Playwright, honor an
 * explicit override, else auto-detect a `chromium-*` under PLAYWRIGHT_BROWSERS_PATH.
 */
async function resolveExecutable(): Promise<string | undefined> {
  const { existsSync } = await import('fs');
  // 1) explicit override — prod Docker sets this to the apk-installed chromium.
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (explicit && existsSync(explicit)) return explicit;
  // 2) a Playwright-managed download under PLAYWRIGHT_BROWSERS_PATH (sandbox).
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root) {
    try {
      const { readdirSync } = await import('fs');
      for (const d of readdirSync(root)) {
        if (d.startsWith('chromium-') && !d.includes('headless_shell')) {
          const p = `${root}/${d}/chrome-linux/chrome`;
          if (existsSync(p)) return p;
        }
      }
    } catch {
      /* fall through */
    }
  }
  // 3) a system Chromium (alpine `apk add chromium`, debian, etc.) — robust to
  //    the exact package path so a mis-set env var can't break PDF export.
  for (const p of ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/lib/chromium/chromium']) {
    if (existsSync(p)) return p;
  }
  // 4) let Playwright use its own default (a dev machine with a full install).
  return undefined;
}

export async function exportToPdf(doc: CanvasDocument, variables: Record<string, string> = {}): Promise<Buffer> {
  // Inline uploaded-image S3 keys to data: URIs first — the sync HTML render can't fetch a storage
  // key, so without this a customer's logo / screenshots export as a broken <img> (the G3 bug).
  const html = renderCanvasToHtml(await inlineImageDataUris(doc), variables);
  const { chromium } = await import('playwright');
  const executablePath = await resolveExecutable();
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...(executablePath ? { executablePath } : {}),
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });

    const canvas = doc.canvas;
    const m = canvas?.margins ?? { top: 72, right: 72, bottom: 72, left: 72 };
    const inch = (pt: number) => `${(pt / 72).toFixed(3)}in`;
    const header = canvas?.header as RunningSpec;
    const footer = canvas?.footer as RunningSpec;
    const hasHF = !!(header || footer);

    const buf = await page.pdf({
      printBackground: true,
      width: inch(canvas?.width ?? 612),
      height: inch(canvas?.height ?? 792),
      margin: { top: inch(m.top), right: inch(m.right), bottom: inch(m.bottom), left: inch(m.left) },
      displayHeaderFooter: hasHF,
      headerTemplate: runningHtml(header, variables, false),
      footerTemplate: runningHtml(footer, variables, true),
    });
    return Buffer.from(buf);
  } finally {
    await browser.close();
  }
}
