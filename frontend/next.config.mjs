/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for Railway Docker deployment
  // Produces a minimal self-contained build in .next/standalone
  output: 'standalone',

  // Ensure pg and postgres are not bundled by webpack
  // (top-level in Next.js 15+, was experimental.serverComponentsExternalPackages in 14)
  serverExternalPackages: ['pg', 'postgres', 'bcryptjs'],
}

export default nextConfig
