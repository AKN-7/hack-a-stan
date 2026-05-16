import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  devIndicators: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb",
    },
  },
  // Increase API body size limit
  serverExternalPackages: ["@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"],
};

export default nextConfig;
