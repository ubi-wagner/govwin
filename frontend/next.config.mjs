/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pg', 'postgres', 'bcryptjs'],
};

export default nextConfig;
