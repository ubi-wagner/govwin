/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for Railway Docker deployment
  // Produces a minimal self-contained build in .next/standalone
  output: 'standalone',

  // Silence build errors on missing env vars during CI
  // Real values are injected by Railway at runtime
  experimental: {
    serverComponentsExternalPackages: ['pg', 'postgres'],
  },
}

export default nextConfig
