import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Allow large server actions for PDF uploads via Blob; the client-direct
    // upload path bypasses this anyway.
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
  // pdfjs-dist ships ESM; ensure it's transpiled correctly in turbopack.
  turbopack: {
    resolveAlias: {
      // canvas is optional for pdfjs-dist in Node — alias to noop to avoid build errors.
      canvas: "./lib/empty-shim.js",
    },
  },
  webpack: (config) => {
    // For non-turbopack builds (e.g. CI), avoid bundling canvas.
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    };
    return config;
  },
};

export default nextConfig;
