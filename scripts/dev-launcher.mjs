#!/usr/bin/env node
/**
 * Root dev launcher that starts the web app and backend server as separate
 * child process groups so Ctrl+C can stop the full dev stack cleanly.
 *
 * `turbo run dev` does not reliably tear down every persistent child on macOS,
 * especially when nested watchers spawn their own processes. This launcher owns
 * the child trees directly and forwards shutdown signals to both apps.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_NODE_EXTRA_CA_CERTS = "/etc/ssl/cert.pem";
const supportsProcessGroups = process.platform !== "win32";
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const children = [];
let shuttingDown = false;
let remainingChildren = 0;
let shutdownExitCode = 0;
let forceKillTimer = null;

loadRootEnv();
configureNodeExtraCaCerts();

function loadRootEnv() {
  const envPath = path.join(rootDir, ".env.local");

  try {
    loadEnvFile(envPath);
    console.log(`[root-dev-launcher] loaded ${envPath}`);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[root-dev-launcher] failed to load ${envPath}: ${message}`);
  }
}

function configureNodeExtraCaCerts() {
  if (process.env.NODE_EXTRA_CA_CERTS) {
    return;
  }

  if (!existsSync(DEFAULT_NODE_EXTRA_CA_CERTS)) {
    return;
  }

  process.env.NODE_EXTRA_CA_CERTS = DEFAULT_NODE_EXTRA_CA_CERTS;
  console.log(
    `[root-dev-launcher] using NODE_EXTRA_CA_CERTS=${DEFAULT_NODE_EXTRA_CA_CERTS}`,
  );
}

function spawnChild(name, cwd, args) {
  const child = spawn(pnpmCommand, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
    detached: supportsProcessGroups,
  });

  child.name = name;
  children.push(child);
  remainingChildren += 1;
  return child;
}

function killChildTree(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  try {
    if (supportsProcessGroups && child.pid) {
      process.kill(-child.pid, signal);
      return;
    }

    child.kill(signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[root-dev-launcher] failed to send ${signal} to ${child.name}: ${message}`,
    );
  }
}

function finishIfDone(code) {
  if (remainingChildren > 0) {
    return;
  }

  if (forceKillTimer) {
    clearTimeout(forceKillTimer);
    forceKillTimer = null;
  }

  process.exit(shutdownExitCode || code || 0);
}

function shutdown(reason, exitCode = 0, childSignal = "SIGTERM") {
  if (shuttingDown) {
    shutdownExitCode ||= exitCode;
    return;
  }

  shuttingDown = true;
  shutdownExitCode = exitCode;
  console.log(
    `\n[root-dev-launcher] received ${reason}, shutting down web and server...`,
  );

  for (const child of children) {
    killChildTree(child, childSignal);
  }

  forceKillTimer = setTimeout(() => {
    console.log("[root-dev-launcher] force killing remaining children...");
    for (const child of children) {
      killChildTree(child, "SIGKILL");
    }
  }, 5000);
}

function normalizeExitCode(code, signal) {
  if (typeof code === "number") {
    return code;
  }

  if (signal === "SIGINT" || signal === "SIGTERM") {
    return 0;
  }

  return 1;
}

const web = spawnChild("web", path.join(rootDir, "apps/web"), ["dev"]);
const server = spawnChild("server", path.join(rootDir, "apps/server"), ["dev"]);

for (const child of [web, server]) {
  child.on("exit", (code, signal) => {
    remainingChildren -= 1;

    const label = `[root-dev-launcher] ${child.name} exited`;
    if (signal) {
      console.log(`${label} with signal ${signal}`);
    } else {
      console.log(`${label} with code ${code}`);
    }

    const childExitCode = normalizeExitCode(code, signal);

    if (!shuttingDown && remainingChildren > 0) {
      shutdown(`${child.name}-exit`, childExitCode, "SIGTERM");
    } else {
      shutdownExitCode ||= childExitCode;
    }

    finishIfDone(childExitCode);
  });
}

process.on("SIGINT", () => shutdown("SIGINT", 0, "SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM", 0, "SIGTERM"));
