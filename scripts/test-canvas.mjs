#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(dirname, "..");

function run(label, args) {
  console.log(`[test-canvas] start: ${label}`);
  const result = spawnSync("pnpm", args, {
    cwd: rootDir,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  console.log(`[test-canvas] done: ${label}`);
}

const webCanvasTests = [
  "test/canvas-runtime-store.test.ts",
  "test/canvas-selection-helpers.test.ts",
  "test/use-canvas-keyboard-shortcuts.test.tsx",
  "test/use-canvas-clipboard-import.test.tsx",
  "test/canvas-editor-toolbar.test.tsx",
  "test/canvas-page-tabs.test.tsx",
  "test/canvas-property-panel.test.tsx",
  "test/canvas-layers-panel.test.tsx",
  "test/canvas-design-system-panel.test.tsx",
  "test/canvas-export.test.ts",
  "test/skia-canvas-selection-snapshot.test.tsx",
  "test/sticky-note-tool.test.ts",
  "test/pen-renderer-frame-label.test.ts",
];

const serverCanvasTests = [
  "src/mcp/schema.test.ts",
  "src/mcp/deepagents-bridge.test.ts",
  "src/features/canvas/canvas-service.test.ts",
  "src/features/canvas/canvas-element-writer.test.ts",
  "src/features/canvas/live-canvas-service.test.ts",
  "src/agent/tools/manipulate-canvas.test.ts",
  "src/mcp/tools/structured-canvas.test.ts",
  "src/mcp/tools/get-selection-context.test.ts",
  "src/mcp/tools/canvas-transaction-tools.test.ts",
  "src/mcp/tools/canvas-validation-tools.test.ts",
  "src/mcp/tools/canvas-asset-tools.test.ts",
  "src/mcp/tools/canvas-connector-tools.test.ts",
  "src/mcp/tools/canvas-agent-output-container-tools.test.ts",
  "src/mcp/tools/create-agent-canvas-flow.test.ts",
  "src/mcp/tools/canvas-layout-tools.test.ts",
  "src/mcp/tools/canvas-resize-tools.test.ts",
  "src/mcp/tools/canvas-critique-tools.test.ts",
  "src/mcp/tools/canvas-export-deliverable-tools.test.ts",
  "src/mcp/tools/canvas-memory-index-tools.test.ts",
  "src/mcp/tools/canvas-run-trace-tools.test.ts",
];

run("canvas-core typecheck", [
  "--filter",
  "@cucumber/canvas-core",
  "run",
  "typecheck",
]);
run("canvas-core tests", ["--filter", "@cucumber/canvas-core", "run", "test"]);

run("pen-core typecheck", [
  "--filter",
  "@cucumber/pen-core",
  "run",
  "typecheck",
]);
run("pen-core tests", ["--filter", "@cucumber/pen-core", "run", "test"]);

run("pen-renderer typecheck", [
  "--filter",
  "@cucumber/pen-renderer",
  "run",
  "typecheck",
]);
run("pen-renderer tests", [
  "--filter",
  "@cucumber/pen-renderer",
  "run",
  "test",
]);

run("web canvas tests", [
  "--filter",
  "@cucumber/web",
  "exec",
  "vitest",
  "run",
  ...webCanvasTests,
]);

run("server canvas tests", [
  "--filter",
  "@cucumber/server",
  "exec",
  "vitest",
  "run",
  ...serverCanvasTests,
]);

console.log("[test-canvas] canvas regression matrix complete");
