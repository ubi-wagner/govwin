/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for Railway Docker deployment
  // Produces a minimal self-contained build in .next/standalone
  output: 'standalone',

  // Railway injects PORT — tell Next.js to use it
  // (handled via server.js in standalone output)

  // Externalize native node modules from server components
  experimental: {
    serverComponentsExternalPackages: ['pg', 'postgres'],
  },
}

export default nextConfig
