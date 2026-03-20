/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for Railway Docker deployment
  // Produces a minimal self-contained build in .next/standalone
  output: 'standalone',

  // Ensure pg and postgres are not bundled by webpack
  // (moved from experimental.serverComponentsExternalPackages in Next.js 14.2+)
  serverExternalPackages: ['pg', 'postgres'],
}

export default nextConfig
