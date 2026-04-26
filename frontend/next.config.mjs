/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pg', 'postgres', 'bcryptjs', 'mammoth', 'pdf-parse', 'pdfjs-dist', 'googleapis'],
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
};

export default nextConfig;
