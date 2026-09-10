/** @type {import('next').NextConfig} */
// Deploy checkpoint 2026-08-05 — full redeploy checkpoint (all 3 services + both DBs). Touches the frontend build/deploy + main-DB migration runner. No behavior change.

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self'",
      "connect-src 'self' https://api.anthropic.com https://api.stripe.com",
      "frame-ancestors 'self'",
    ].join('; '),
  },
];

const nextConfig = {
  output: 'standalone',
  /**
   * `next dev` AND the standalone build CANNOT SHARE `.next` — and the damage is INVISIBLE until
   * the next restart.
   *
   * Running `next dev` in this tree writes into the same `.next` that `output:'standalone'` owns:
   * it deletes `required-server-files.json` and the entire `standalone/` directory. The
   * already-running server keeps answering 200 throughout, because it holds its files open — so
   * nothing looks wrong until something restarts and the build is simply gone. Measured, not
   * reasoned: it cost a full rebuild to learn.
   *
   * `NEXT_DIST_DIR=.next-dev npx next dev -p 3001` gives dev its own directory and leaves the
   * deployable build untouched. Unset — which is every CI, Docker and Railway build — this is
   * `.next`, exactly as before.
   *
   * ⚠️ One thing dev DOES still write outside its dist dir: it rewrites `next-env.d.ts` and
   * `tsconfig.json` to point at whatever `distDir` is active — `./.next-dev/types/routes.d.ts`,
   * plus a `.next-dev/types` glob entry in tsconfig's `include`. Both files are TRACKED. (That glob
   * is written out here without its wildcards ON PURPOSE: the literal contains the two characters
   * that CLOSE a block comment, which is how this exact line broke `next.config.mjs` for every
   * build until the dev server refused to boot on `SyntaxError: Unexpected token '.'`.) Committing
   * reference breaks `tsc` and `next build` for everyone else, against a directory that exists only
   * on the machine that ran dev.
   *
   * And it is STICKY: `next build` reads the include list and writes it back, so a build started
   * while tsconfig is contaminated re-adds the dev entry even after `.next-dev` is deleted. Revert
   * FIRST, then build: `git checkout -- frontend/tsconfig.json frontend/next-env.d.ts`.
   *
   * ── AND THE SECOND HALF: DO NOT SOURCE sandbox-env.sh INTO `next dev` ──────────────────────
   * `scripts/sandbox-env.sh` exports `NODE_ENV=production` (line ~125) for the drives, and a
   * sourced shell carries it into whatever you launch next. `next dev` under `NODE_ENV=production`
   * builds the edge-middleware sandbox in production mode — code generation from strings
   * DISALLOWED — while webpack still emits every dev module wrapped in `eval("…")`. Every request
   * then 500s with
   *
   *     EvalError: Code generation from strings disallowed for this context
   *
   * pointing at `next-middleware-loader.js`, i.e. at Next's own code, which reads like a framework
   * incompatibility and is an environment variable. Launch dev with `NODE_ENV=development`
   * explicitly; `scripts/capture-hydration-diff.mjs` documents the full invocation.
   *
   * Both halves together are why `docs/PROJECT_BUILD_LOG.md` records the React #418 hydration
   * intermittent three separate times as *"observed, unreproduced"*, each entry closing with the
   * same next step — capture it on a dev build, where React prints the server-vs-client diff and
   * the component stack instead of a minified error code. That step was not skipped; it was not
   * reachable.
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',
  serverExternalPackages: ['postgres', 'bcryptjs', 'mammoth', 'pdf-parse', 'pdfjs-dist', '@napi-rs/canvas', 'googleapis', 'tesseract.js', 'playwright', 'playwright-core'],
  // tesseract.js loads its core wasm + our OCR language data by PATH at runtime (not via require),
  // so Next's tracer misses them — force them into the standalone so OCR works on any deploy.
  outputFileTracingIncludes: {
    '/api/portal/[tenantSlug]/atoms/capture': ['./node_modules/tesseract.js-core/**/*', './ocr-data/**/*'],
    // pdf.js resolves its WORKER (pdf.worker.mjs) by PATH at runtime, exactly like tesseract's wasm
    // above — so Next's tracer copies pdf.mjs into .next/standalone but NOT the worker beside it.
    // The standalone server is what deploys (`output: 'standalone'`), so without this EVERY PDF text
    // extraction fails there with "Setting up fake worker failed: Cannot find module …/pdf.worker.mjs"
    // while working fine in dev. Caught live: a DoW SBIR BAA upload shredded to 0 chars, and the
    // compliance matrix then filled from SYSTEM_DEFAULTS as if the rules had been read.
    // Keyed per PDF-reading route (pdf-parse nests its own pdfjs-dist copy).
    '/api/admin/rfp-upload': ['./node_modules/pdf-parse/node_modules/pdfjs-dist/legacy/build/**/*'],
    '/api/admin/upload-topic-files': ['./node_modules/pdf-parse/node_modules/pdfjs-dist/legacy/build/**/*'],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
    // The atomize-package / atoms-upload routes accept files up to 25MB, but the middleware
    // buffers request bodies to a 10MB default — silently truncating 10–25MB uploads (e.g. a
    // real slide deck) before the route ever sees them. Lift the middleware cap to match.
    middlewareClientMaxBodySize: '50mb',
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
  async redirects() {
    return [
      // V8: standalone /blog consolidated into /resources. RSS stays at /blog/feed.xml.
      { source: '/blog', destination: '/resources', permanent: true },
    ];
  },
};

export default nextConfig;
