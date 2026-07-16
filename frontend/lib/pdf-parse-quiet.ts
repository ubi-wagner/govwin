/**
 * Load `pdf-parse` (which bundles pdf.js) for TEXT EXTRACTION with pdf.js's
 * one-time Node setup noise silenced.
 *
 * On load in Node, pdf.js emits warnings we don't care about — we only ever extract
 * text, never render:
 *   Warning: Cannot load "@napi-rs/canvas" package: "..."     (optional native canvas dep)
 *   Warning: Please use the `legacy` build in Node.js environments.
 * Both come from top-level `if (isNodeJS) { ... }` blocks that run while a pdf.js
 * module is being EVALUATED, routed through pdf.js's `warn()` →
 * `console.warn("Warning: " + msg)`. pdf-parse already defaults its `verbosity` to
 * ERRORS, so every warn() AFTER a parser is constructed is silenced — but these fire
 * at module-eval, BEFORE any verbosity can be set (`setVerbosityLevel` is exported
 * from the very module that warns during its own evaluation), so verbosity can't
 * reach them, and making the `@napi-rs/canvas` require succeed wouldn't touch the
 * "legacy build" line. pdf-parse runs pdf.js on the MAIN thread (its worker is left
 * unset), so the emissions are main-thread — which the one available lever, the
 * `console.warn` channel, can reach. We install a tight, permanent pass-through that
 * drops ONLY those exact pdf.js setup lines (matched with the "Warning: " prefix
 * pdf.js itself adds) and forwards everything else verbatim. Installed once,
 * concurrency-safe (no save/restore race), and active before pdf.js is imported.
 *
 * Verified by driving a real parse: the reproduced "legacy build" line reached the
 * terminal 0 times with this filter, while an ordinary app warning still printed.
 *
 * Also stubs the browser-only canvas globals (via pdf-node-globals) before pdf.js
 * loads, preserving prior behaviour on the text-extraction path.
 */
import '@/lib/pdf-node-globals'; // MUST precede pdf-parse — stubs canvas globals pdf.js expects

// Exact prefixes pdf.js emits via console.warn during Node setup. The "Warning: "
// prefix is added by pdf.js's own warn(), so these never collide with app warnings.
const PDFJS_SETUP_NOISE = [
  'Warning: Cannot load "@napi-rs/canvas"',
  'Warning: Please use the `legacy` build',
  'Warning: Cannot access the `require` function',
  'Warning: Cannot polyfill',
] as const;

const QUIET_MARK = '__pdfjsQuietInstalled';

/** Idempotently wrap console.warn to drop pdf.js's Node setup lines. */
function installWarnFilter(): void {
  const current = console.warn as typeof console.warn & { [QUIET_MARK]?: boolean };
  if (current[QUIET_MARK]) return; // already wrapped (guards double module eval)
  const original = console.warn;
  const wrapped = ((...args: unknown[]): void => {
    const first = typeof args[0] === 'string' ? args[0] : '';
    if (PDFJS_SETUP_NOISE.some((n) => first.startsWith(n))) return;
    Reflect.apply(original, console, args);
  }) as typeof console.warn & { [QUIET_MARK]?: boolean };
  wrapped[QUIET_MARK] = true;
  console.warn = wrapped;
}

installWarnFilter();

type PdfParseModule = { PDFParse: (typeof import('pdf-parse'))['PDFParse'] };

let cached: Promise<PdfParseModule> | null = null;

/**
 * Dynamically import pdf-parse once (memoized), with the pdf.js setup warnings
 * already filtered. Returns the `PDFParse` constructor.
 */
export function loadPdfParse(): Promise<PdfParseModule> {
  if (!cached) {
    cached = import('pdf-parse').then((m) => ({ PDFParse: m.PDFParse }));
  }
  return cached;
}
