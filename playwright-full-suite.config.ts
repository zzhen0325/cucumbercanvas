import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e/full-suite",
  timeout: 60_000,
  retries: 1,
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "e2e/full-suite/reports", open: "never" }],
    ["json", { outputFile: "e2e/full-suite/reports/results.json" }],
  ],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
});
