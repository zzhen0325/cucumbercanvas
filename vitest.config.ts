import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: path.resolve(__dirname),
  test: {
    projects: [
      {
        test: {
          name: "workspace",
          environment: "node",
          include: ["tests/**/*.test.mjs"],
        },
      },
      {
        test: {
          name: "server",
          environment: "node",
          exclude: ["apps/server/src/**/*.integration.test.ts"],
          include: ["apps/server/src/**/*.test.ts"],
        },
      },
      {
        esbuild: {
          jsx: "automatic",
        },
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "apps/web/src"),
          },
        },
        test: {
          name: "web",
          environment: "jsdom",
          include: ["apps/web/test/**/*.{test,spec}.{ts,tsx}"],
          setupFiles: ["./apps/web/test/setup.ts"],
        },
      },
      {
        test: {
          name: "canvas-core",
          environment: "node",
          include: ["packages/canvas-core/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "pen-core",
          environment: "node",
          include: ["packages/pen-core/__tests__/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "pen-figma",
          environment: "node",
          include: ["packages/pen-figma/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "pen-renderer",
          environment: "node",
          include: ["packages/pen-renderer/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "shared",
          environment: "node",
          include: ["packages/shared/src/**/*.test.ts"],
        },
      },
    ],
  },
});
