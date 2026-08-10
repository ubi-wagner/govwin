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
  serverExternalPackages: ['postgres', 'bcryptjs', 'mammoth', 'pdf-parse', 'pdfjs-dist', '@napi-rs/canvas', 'googleapis'],
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
