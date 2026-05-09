/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['postgres', 'bcryptjs', 'mammoth', 'pdf-parse', 'pdfjs-dist', '@napi-rs/canvas', 'googleapis'],
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
};

export default nextConfig;
