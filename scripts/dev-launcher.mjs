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
import { once } from "node:events";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_NODE_EXTRA_CA_CERTS = "/etc/ssl/cert.pem";
const DEFAULT_SERVER_PORT = 3001;
const supportsProcessGroups = process.platform !== "win32";
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

let children = [];
let shuttingDown = false;
let remainingChildren = 0;
let shutdownExitCode = 0;
let healthTimer = null;
let healthStartedAt = 0;
let healthConsecutiveFailures = 0;
let restarting = false;
let stackGeneration = 0;

loadRootEnv();
configureNodeExtraCaCerts();

const healthIntervalMs = parsePositiveIntegerEnv(
  "CUCUMBER_DEV_HEALTH_INTERVAL_MS",
  10_000,
);
const healthTimeoutMs = parsePositiveIntegerEnv(
  "CUCUMBER_DEV_HEALTH_TIMEOUT_MS",
  5_000,
);
const healthFailureThreshold = parsePositiveIntegerEnv(
  "CUCUMBER_DEV_HEALTH_FAILURE_THRESHOLD",
  3,
);
const healthStartupGraceMs = parsePositiveIntegerEnv(
  "CUCUMBER_DEV_HEALTH_STARTUP_GRACE_MS",
  25_000,
);
const healthRestartCooldownMs = parsePositiveIntegerEnv(
  "CUCUMBER_DEV_HEALTH_RESTART_COOLDOWN_MS",
  1_500,
);
const serverPort = process.env.CUCUMBER_SERVER_PORT?.trim()
  ? parsePositiveIntegerEnv("CUCUMBER_SERVER_PORT", DEFAULT_SERVER_PORT)
  : parsePositiveIntegerEnv("PORT", DEFAULT_SERVER_PORT);
const healthChecks = [
  {
    name: "web",
    url: process.env.CUCUMBER_WEB_HEALTH_URL ?? "http://127.0.0.1:3000/",
  },
  {
    name: "server",
    url:
      process.env.CUCUMBER_SERVER_HEALTH_URL ??
      `http://127.0.0.1:${serverPort}/api/health`,
  },
];

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

function parsePositiveIntegerEnv(name, defaultValue) {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) {
    return defaultValue;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(
      `${name} must be a positive integer. Received: ${rawValue}`,
    );
  }

  return parsedValue;
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
  attachChildExitHandler(child);
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

  process.exit(shutdownExitCode || code || 0);
}

async function stopChildren(reason, childSignal = "SIGTERM") {
  const childrenToStop = [...children];
  if (childrenToStop.length === 0) {
    return;
  }

  console.log(`[root-dev-launcher] stopping dev stack for ${reason}...`);
  for (const child of childrenToStop) {
    killChildTree(child, childSignal);
  }

  const exited = await waitForChildrenToExit(childrenToStop, 5000);
  if (exited) {
    return;
  }

  console.log("[root-dev-launcher] force killing remaining children...");
  for (const child of childrenToStop) {
    killChildTree(child, "SIGKILL");
  }

  const forceKilled = await waitForChildrenToExit(childrenToStop, 1000);
  if (!forceKilled) {
    throw new Error(`Failed to stop all dev child processes during ${reason}.`);
  }
}

async function waitForChildrenToExit(childrenToWaitFor, timeoutMs) {
  const exitPromises = childrenToWaitFor.map((child) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return Promise.resolve();
    }

    return once(child, "exit");
  });

  const result = await Promise.race([
    Promise.all(exitPromises).then(() => "exited"),
    wait(timeoutMs).then(() => "timeout"),
  ]);

  return result === "exited";
}

async function shutdown(reason, exitCode = 0, childSignal = "SIGTERM") {
  if (shuttingDown) {
    shutdownExitCode ||= exitCode;
    return;
  }

  shuttingDown = true;
  shutdownExitCode = exitCode;
  console.log(
    `\n[root-dev-launcher] received ${reason}, shutting down web and server...`,
  );

  stopHealthTimer();
  await stopChildren(reason, childSignal);
  finishIfDone(exitCode);
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

function startDevStack(reason) {
  children = [];
  remainingChildren = 0;
  healthConsecutiveFailures = 0;
  healthStartedAt = Date.now();
  stackGeneration += 1;

  console.log(
    `[root-dev-launcher] starting web and server (${reason}, generation ${stackGeneration})...`,
  );

  spawnChild("web", path.join(rootDir, "apps/web"), ["dev"]);
  spawnChild("server", path.join(rootDir, "apps/server"), ["dev"]);
}

function attachChildExitHandler(child) {
  child.on("exit", (code, signal) => {
    remainingChildren -= 1;

    const label = `[root-dev-launcher] ${child.name} exited`;
    if (signal) {
      console.log(`${label} with signal ${signal}`);
    } else {
      console.log(`${label} with code ${code}`);
    }

    const childExitCode = normalizeExitCode(code, signal);

    if (restarting) {
      return;
    }

    if (!shuttingDown && remainingChildren > 0) {
      shutdown(`${child.name}-exit`, childExitCode, "SIGTERM").catch(
        (error) => {
          exitAfterAsyncFailure(error, "shutdown");
        },
      );
    } else {
      shutdownExitCode ||= childExitCode;
    }

    finishIfDone(childExitCode);
  });
}

function startHealthTimer() {
  if (healthTimer) {
    return;
  }

  console.log(
    `[root-dev-launcher] health checks enabled: ${healthChecks
      .map((check) => `${check.name}=${check.url}`)
      .join(
        ", ",
      )}; interval=${healthIntervalMs}ms timeout=${healthTimeoutMs}ms threshold=${healthFailureThreshold}`,
  );

  healthTimer = setInterval(() => {
    runHealthChecks().catch((error) => {
      exitAfterAsyncFailure(error, "health check loop");
    });
  }, healthIntervalMs);
}

function stopHealthTimer() {
  if (!healthTimer) {
    return;
  }

  clearInterval(healthTimer);
  healthTimer = null;
}

async function runHealthChecks() {
  if (shuttingDown || restarting) {
    return;
  }

  const uptimeMs = Date.now() - healthStartedAt;
  if (uptimeMs < healthStartupGraceMs) {
    return;
  }

  const results = await Promise.all(
    healthChecks.map((check) => checkHealthTarget(check)),
  );
  const failedResults = results.filter((result) => !result.ok);

  if (failedResults.length === 0) {
    if (healthConsecutiveFailures > 0) {
      console.log("[root-dev-launcher] health checks recovered.");
    }

    healthConsecutiveFailures = 0;
    return;
  }

  healthConsecutiveFailures += 1;
  console.warn(
    `[root-dev-launcher] health check failed (${healthConsecutiveFailures}/${healthFailureThreshold} consecutive cycle(s)): ${failedResults
      .map(formatHealthFailure)
      .join("; ")}`,
  );

  if (healthConsecutiveFailures < healthFailureThreshold) {
    return;
  }

  await restartDevStack(failedResults);
}

async function checkHealthTarget(check) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, healthTimeoutMs);

  try {
    const response = await fetch(check.url, {
      cache: "no-store",
      signal: controller.signal,
    });
    await response.arrayBuffer();
    const durationMs = Date.now() - startedAt;

    if (!response.ok) {
      return {
        ...check,
        ok: false,
        reason: `HTTP ${response.status}`,
        durationMs,
      };
    }

    return {
      ...check,
      ok: true,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `timed out after ${healthTimeoutMs}ms`
        : error instanceof Error
          ? error.message
          : String(error);

    return {
      ...check,
      ok: false,
      reason: message,
      durationMs,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function formatHealthFailure(result) {
  return `${result.name} ${result.url} failed after ${result.durationMs}ms (${result.reason})`;
}

async function restartDevStack(failedResults) {
  if (shuttingDown || restarting) {
    return;
  }

  restarting = true;
  stopHealthTimer();

  console.warn(
    `[root-dev-launcher] health failure threshold reached; restarting dev stack. Failed checks: ${failedResults
      .map(formatHealthFailure)
      .join("; ")}`,
  );

  try {
    await stopChildren("health-restart", "SIGTERM");
    await wait(healthRestartCooldownMs);
    startDevStack("health-restart");
  } finally {
    restarting = false;
    startHealthTimer();
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function exitAfterAsyncFailure(error, label) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[root-dev-launcher] ${label} failed: ${message}`);
  process.exit(1);
}

startDevStack("initial");
startHealthTimer();

process.on("SIGINT", () => {
  shutdown("SIGINT", 0, "SIGINT").catch((error) => {
    exitAfterAsyncFailure(error, "shutdown");
  });
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM", 0, "SIGTERM").catch((error) => {
    exitAfterAsyncFailure(error, "shutdown");
  });
});
