import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm --dir apps/web exec next dev --turbopack -p 3100",
    env: {
      NEXT_PUBLIC_CUCUMBER_SERVER_BASE_URL: "http://127.0.0.1:4011",
      NEXT_PUBLIC_CUCUMBER_SUPABASE_ANON_KEY: "test-anon-key",
      NEXT_PUBLIC_CUCUMBER_SUPABASE_URL: "http://127.0.0.1:54321",
    },
    port: 3100,
    reuseExistingServer: true,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  },
});
