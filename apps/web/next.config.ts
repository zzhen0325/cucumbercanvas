import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  transpilePackages: ["@cucumber/canvas-core"],
  webpack(config) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  env: {
    NEXT_PUBLIC_CUCUMBER_SERVER_BASE_URL:
      process.env.NEXT_PUBLIC_CUCUMBER_SERVER_BASE_URL,
    NEXT_PUBLIC_CUCUMBER_SUPABASE_URL:
      process.env.NEXT_PUBLIC_CUCUMBER_SUPABASE_URL,
    NEXT_PUBLIC_CUCUMBER_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_CUCUMBER_SUPABASE_ANON_KEY,
  },
};

export default nextConfig;
