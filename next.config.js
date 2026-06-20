/** @type {import('next').NextConfig} */
const nextConfig = {
  // Increase server timeout for LLM calls (default 30s is too short for chained steps)
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};
module.exports = nextConfig;
