import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(dirname, "..");

async function readJson(relativePath) {
  const filePath = path.join(rootDir, relativePath);
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content);
}

async function readText(relativePath) {
  const filePath = path.join(rootDir, relativePath);
  return readFile(filePath, "utf8");
}

test("root manifest exposes dev, build, test, and lint scripts", async () => {
  const manifest = await readJson("package.json");

  assert.equal(typeof manifest.scripts?.dev, "string");
  assert.equal(typeof manifest.scripts?.build, "string");
  assert.equal(typeof manifest.scripts?.test, "string");
  assert.equal(typeof manifest.scripts?.lint, "string");
});

test("root dev command uses the custom launcher for signal-safe shutdown", async () => {
  const manifest = await readJson("package.json");
  const launcher = await readText("scripts/dev-launcher.mjs");

  assert.match(manifest.scripts.dev, /scripts\/dev-launcher\.mjs/);
  assert.match(launcher, /spawnChild\("web"/);
  assert.match(launcher, /spawnChild\("server"/);
  assert.match(launcher, /process\.on\("SIGINT"/);
  assert.match(launcher, /process\.on\("SIGTERM"/);
});

test("workspace includes apps and packages globs", async () => {
  const workspace = await readText("pnpm-workspace.yaml");

  assert.match(workspace, /apps\/\*/);
  assert.match(workspace, /packages\/\*/);
});

test("root test command wires workspace, changed, canvas, and package tests", async () => {
  const manifest = await readJson("package.json");

  assert.match(manifest.scripts["test:workspace"], /node --test/);
  assert.match(manifest.scripts["test:changed"], /scripts\/test-changed\.mjs/);
  assert.match(manifest.scripts["test:canvas"], /scripts\/test-canvas\.mjs/);
  assert.match(manifest.scripts["test:packages"], /turbo run test/);
  assert.match(manifest.scripts["test:e2e:smoke"], /playwright test/);
  assert.match(manifest.scripts.test, /test:workspace/);
  assert.match(manifest.scripts.test, /test:packages/);
});

test("vitest projects config covers package-level tests", async () => {
  const projectsConfig = await readText("vitest.config.ts");

  assert.match(projectsConfig, /projects/);
  assert.match(projectsConfig, /tests\/\*\*\/\*\.test\.mjs/);
  assert.match(projectsConfig, /apps\/server\/src\/\*\*\/\*\.test\.ts/);
  assert.match(
    projectsConfig,
    /apps\/server\/src\/\*\*\/\*\.integration\.test\.ts/,
  );
  assert.match(
    projectsConfig,
    /packages\/pen-core\/__tests__\/\*\*\/\*\.test\.ts/,
  );
});

for (const appName of ["web", "server"]) {
  test(`${appName} app scripts perform real validation instead of placeholder logs`, async () => {
    const manifest = await readJson(`apps/${appName}/package.json`);

    assert.equal(typeof manifest.scripts?.build, "string");
    assert.equal(typeof manifest.scripts?.test, "string");
    assert.equal(typeof manifest.scripts?.typecheck, "string");
    assert.doesNotMatch(manifest.scripts.build, /placeholder/i);
    assert.doesNotMatch(manifest.scripts.build, /console\.log/);
    assert.doesNotMatch(manifest.scripts.test, /placeholder/i);
    assert.doesNotMatch(manifest.scripts.test, /console\.log/);
    assert.doesNotMatch(manifest.scripts.typecheck, /placeholder/i);
    assert.doesNotMatch(manifest.scripts.typecheck, /console\.log/);
  });
}

test("@cucumber/config exports a single low-drift package contract", async () => {
  const source = await readText("packages/config/src/index.ts");

  assert.doesNotMatch(source, /apps\/\*/);
  assert.doesNotMatch(source, /packages\/\*/);
});

test("shared package placeholder exists for the upcoming contract task", async () => {
  const manifest = await readJson("packages/shared/package.json");

  assert.equal(manifest.name, "@cucumber/shared");
  assert.equal(manifest.type, "module");
});

test("root lint baseline is wired through Biome", async () => {
  const manifest = await readJson("package.json");
  const biomeConfig = await readJson("biome.json");

  assert.equal(typeof manifest.devDependencies["@biomejs/biome"], "string");
  assert.match(manifest.scripts.lint, /biome/);
  assert.match(biomeConfig.$schema, /biome/);
  assert.equal(biomeConfig.formatter.enabled, true);
  assert.equal(biomeConfig.linter.enabled, true);
});
