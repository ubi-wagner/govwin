import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Required for Railway Docker deployment
  // Produces a minimal self-contained build in .next/standalone
  output: 'standalone',

  // Railway injects PORT — tell Next.js to use it
  // (handled via server.js in standalone output)

  // Silence build errors on missing env vars during CI
  // Real values are injected by Railway at runtime
  experimental: {
    serverComponentsExternalPackages: ['pg', 'postgres'],
  },
}

export default nextConfig
