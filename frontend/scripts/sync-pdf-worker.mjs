#!/usr/bin/env node
/**
 * sync-pdf-worker — keep the SERVED pdf.js worker byte-identical to the pdfjs-dist that
 * react-pdf actually resolves.
 *
 * pdf.js hard-fails when the API and the worker are different releases:
 *
 *   PDF load failed: The API version "5.4.296" does not match the Worker version "5.6.205".
 *
 * That is exactly what shipped: `public/pdf.worker.min.mjs` was copied by hand from the
 * TOP-LEVEL pdfjs-dist (5.6.205, what package.json pins directly), while `react-pdf` resolves
 * its OWN nested pdfjs-dist (5.4.296) for the API. The two drifted the moment either dependency
 * moved, and nothing in the build noticed — the failure only shows up at runtime, in the
 * browser, as an unrenderable document.
 *
 * The cost is not cosmetic. Every human-in-the-loop path that depends on SEEING the source runs
 * through this viewer: the RFP curation source-document pane, tagging text as a compliance
 * variable, and the box/annotation capture that produces `hitl` provenance
 * (SourceAnchor.method = 'manual_selection', see migration 187). A curator cannot highlight a
 * page that will not render, so the strongest provenance tier we have is unreachable whenever
 * these versions disagree.
 *
 * So: never hand-copy the worker. Resolve it from react-pdf's own dependency tree — the same
 * resolution Node/webpack performs for the API — and copy it to every path the app serves it
 * from. Wired into `prebuild`, so a dependency bump can no longer desync it silently.
 *
 * Serving paths (keep in sync with the components that set GlobalWorkerOptions.workerSrc):
 *   /pdf.worker.min.mjs        components/rfp-curation/pdf-viewer.tsx
 *   /pdfjs/pdf.worker.min.mjs  components/portal/capture-atomizer.tsx
 */
import { createRequire } from 'node:module';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const require = createRequire(import.meta.url);

/** Serve targets, relative to public/. Add a path here when a component serves the worker from a new URL. */
const TARGETS = ['pdf.worker.min.mjs', 'pdfjs/pdf.worker.min.mjs'];

async function main() {
  // Resolve pdfjs-dist THROUGH react-pdf so we get the copy whose API the viewer runs.
  let pkgJson;
  try {
    pkgJson = require.resolve('pdfjs-dist/package.json', { paths: [require.resolve('react-pdf')] });
  } catch {
    console.error('[sync-pdf-worker] cannot resolve pdfjs-dist via react-pdf — is react-pdf installed?');
    process.exit(1);
  }
  const pdfjsDir = path.dirname(pkgJson);
  const version = require(pkgJson).version;
  const src = path.join(pdfjsDir, 'build', 'pdf.worker.min.mjs');

  try {
    await stat(src);
  } catch {
    console.error(`[sync-pdf-worker] worker missing at ${src}`);
    process.exit(1);
  }

  for (const rel of TARGETS) {
    const dest = path.join(ROOT, 'public', rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, dest);
    console.log(`[sync-pdf-worker] public/${rel} ← pdfjs-dist@${version}`);
  }
  console.log(`[sync-pdf-worker] worker synced to the version react-pdf resolves (${version}).`);
}

main().catch((e) => {
  console.error('[sync-pdf-worker] failed:', e);
  process.exit(1);
});
