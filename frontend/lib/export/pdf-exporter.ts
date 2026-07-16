/**
 * Export a CanvasDocument to a PDF Buffer via Chromium (Playwright).
 *
 * The canvas → HTML render (canvas-html.ts) is pure; this module adds the
 * Chromium print step, so styled text, tables, and inline `data:` SVG figures
 * render at full fidelity, with the canvas header/footer repeated on every page
 * (Playwright running templates) and real page numbers.
 *
 * Chromium is loaded via a DYNAMIC import so it is never pulled into the Next.js
 * bundle — only when a PDF is actually generated (the offline deliverable
 * generator, or a Node-runtime worker). Requires Chromium on the host
 * (PLAYWRIGHT_BROWSERS_PATH). This is an infra dependency, documented alongside
 * the pipeline worker — the native docx/pptx/xlsx exporters have no such need.
 */
import { renderCanvasToHtml } from './canvas-html';
import type { CanvasDocument } from '@/lib/types/canvas-document';

type RunningSpec = { text?: string } | null | undefined;

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function subst(t: unknown, vars: Record<string, string>): string {
  return String(t ?? '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

function headerTemplate(spec: RunningSpec, vars: Record<string, string>): string {
  const text = spec?.text ? esc(subst(spec.text, vars)) : '';
  return `<div style="font-size:9px;width:100%;padding:0 0.6in;color:#475569;border-bottom:0.5px solid #e2e8f0">${text}</div>`;
}
function footerTemplate(spec: RunningSpec, vars: Record<string, string>): string {
  const text = spec?.text ? esc(subst(spec.text, vars)) : '';
  return `<div style="font-size:9px;width:100%;padding:0 0.6in;color:#475569;display:flex;justify-content:space-between;border-top:0.5px solid #e2e8f0">
    <span>${text}</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>`;
}

/**
 * Resolve a Chromium executable. In production Playwright installs its own
 * version-matched browser (return undefined → default). In a sandbox where the
 * pre-installed browser build may not match the bundled Playwright, honor an
 * explicit override, else auto-detect a `chromium-*` under PLAYWRIGHT_BROWSERS_PATH.
 */
async function resolveExecutable(): Promise<string | undefined> {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root) {
    try {
      const { readdirSync, existsSync } = await import('fs');
      for (const d of readdirSync(root)) {
        if (d.startsWith('chromium-') && !d.includes('headless_shell')) {
          const p = `${root}/${d}/chrome-linux/chrome`;
          if (existsSync(p)) return p;
        }
      }
    } catch {
      /* fall through to Playwright's default */
    }
  }
  return undefined;
}

export async function exportToPdf(doc: CanvasDocument, variables: Record<string, string> = {}): Promise<Buffer> {
  const html = renderCanvasToHtml(doc, variables);
  const { chromium } = await import('playwright');
  const executablePath = await resolveExecutable();
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
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
      headerTemplate: headerTemplate(header, variables),
      footerTemplate: footerTemplate(footer, variables),
    });
    return Buffer.from(buf);
  } finally {
    await browser.close();
  }
}
