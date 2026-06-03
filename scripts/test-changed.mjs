#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(dirname, "..");

const args = process.argv.slice(2);
const includeE2e = args.includes("--include-e2e");
const all = args.includes("--all");
const baseArgIndex = args.indexOf("--base");
const explicitBase =
  baseArgIndex >= 0 && args[baseArgIndex + 1] ? args[baseArgIndex + 1] : null;

const packageDirs = [
  "apps/web",
  "apps/server",
  "packages/canvas-core",
  "packages/config",
  "packages/pen-core",
  "packages/pen-figma",
  "packages/pen-renderer",
  "packages/pen-types",
  "packages/shared",
];

const rootAffectsAll = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
  "tsconfig.base.json",
  "biome.json",
  "vitest.config.ts",
]);

const harnessFiles = new Set([
  "scripts/codex-check.sh",
  "scripts/test-changed.mjs",
  "scripts/test-canvas.mjs",
  "tests/workspace.test.mjs",
]);

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(rootDir, relativePath), "utf8"));
}

function gitOutput(gitArgs) {
  const result = spawnSync("git", gitArgs, {
    cwd: rootDir,
    encoding: "utf8",
  });
  if (result.status !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function resolveBaseRef() {
  if (explicitBase) return explicitBase;
  const originMain = spawnSync(
    "git",
    ["rev-parse", "--verify", "origin/main"],
    {
      cwd: rootDir,
      stdio: "ignore",
    },
  );
  if (originMain.status === 0) return "origin/main";
  const previousHead = spawnSync("git", ["rev-parse", "--verify", "HEAD~1"], {
    cwd: rootDir,
    stdio: "ignore",
  });
  if (previousHead.status === 0) return "HEAD~1";
  return "HEAD";
}

function changedFiles() {
  if (all) {
    return ["package.json"];
  }

  const baseRef = resolveBaseRef();
  const files = new Set([
    ...gitOutput([
      "diff",
      "--name-only",
      "--diff-filter=ACMRTUB",
      `${baseRef}...HEAD`,
    ]),
    ...gitOutput(["diff", "--name-only", "--diff-filter=ACMRTUB"]),
    ...gitOutput(["diff", "--cached", "--name-only", "--diff-filter=ACMRTUB"]),
    ...gitOutput(["ls-files", "--others", "--exclude-standard"]),
  ]);
  return [...files].sort();
}

const manifests = new Map(
  packageDirs.map((directory) => {
    const manifest = readJson(`${directory}/package.json`);
    return [
      directory,
      {
        directory,
        name: manifest.name,
        scripts: manifest.scripts ?? {},
      },
    ];
  }),
);

const files = changedFiles();
const affectedPackages = new Set();
let runWorkspaceSmoke = false;
let runAllPackages = false;
const changedE2eSpecs = [];

for (const file of files) {
  if (rootAffectsAll.has(file)) {
    runAllPackages = true;
  }
  if (harnessFiles.has(file) || file.startsWith("tests/")) {
    runWorkspaceSmoke = true;
  }
  if (file.startsWith("tests/e2e/") || file.startsWith("playwright-tests/")) {
    changedE2eSpecs.push(file);
  }

  for (const [directory, pkg] of manifests.entries()) {
    if (file === directory || file.startsWith(`${directory}/`)) {
      affectedPackages.add(pkg.name);
    }
  }
}

if (runAllPackages) {
  for (const pkg of manifests.values()) {
    affectedPackages.add(pkg.name);
  }
}

console.log(
  `[test-changed] files=${files.length} packages=${affectedPackages.size}${
    runAllPackages ? " scope=all" : ""
  }`,
);

if (files.length === 0 || runWorkspaceSmoke) {
  run("pnpm", ["run", "test:workspace"]);
}

for (const pkgName of affectedPackages) {
  const pkg = [...manifests.values()].find((entry) => entry.name === pkgName);
  if (!pkg) continue;

  if (pkg.scripts.typecheck) {
    run("pnpm", ["--filter", pkgName, "run", "typecheck"]);
  }
  if (pkg.scripts.test) {
    run("pnpm", ["--filter", pkgName, "run", "test"]);
  }
}

if (changedE2eSpecs.length > 0) {
  if (includeE2e) {
    run("pnpm", ["run", "test:e2e", "--", ...changedE2eSpecs]);
  } else {
    console.log(
      `[test-changed] skipped e2e specs (${changedE2eSpecs.length}); pass --include-e2e to run them.`,
    );
  }
}

if (files.length === 0 && affectedPackages.size === 0) {
  console.log("[test-changed] no changed package files detected.");
}
