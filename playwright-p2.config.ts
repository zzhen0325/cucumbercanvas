import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e/p2",
  timeout: 30_000,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "e2e/p2/reports", open: "never" }],
    ["json", { outputFile: "e2e/p2/reports/results.json" }],
  ],
  use: {
    trace: "retain-on-failure",
    screenshot: "off",
  },
});
