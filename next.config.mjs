/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow large request bodies for file uploads (Server Actions only, but
  // we keep it here as documentation; our route uses streaming via busboy).
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
  // Standalone output keeps the production image small and self-contained,
  // which matters for the Brimble Dockerfile build below.
  output: "standalone",
};

export default nextConfig;
