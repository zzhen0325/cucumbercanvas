import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  transpilePackages: [
    "@cucumber/canvas-core",
    "@cucumber/pen-core",
    "@cucumber/pen-engine",
    "@cucumber/pen-renderer",
    "@cucumber/pen-types",
  ],
  webpack(config, { isServer }) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    // canvaskit-wasm ships a Node.js build that references 'fs'/'path'.
    // In the browser bundle these are dead code behind a `typeof process` guard;
    // webpack just needs to be told not to resolve them.
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
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
