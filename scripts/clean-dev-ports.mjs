#!/usr/bin/env node
/**
 * Clean Cucumber Studio dev ports after watcher/launcher shutdowns leave orphan
 * processes behind. This is intentionally dependency-free so it can run before
 * install repair work as well as during normal pnpm workflows.
 */
import { execFile } from "node:child_process";
import { loadEnvFile } from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_WEB_PORT = 3000;
const DEFAULT_SERVER_PORT = 3001;
const FORCE_KILL_DELAY_MS = 1500;

loadRootEnv();

const requestedPorts = parsePorts(process.argv.slice(2));

if (requestedPorts.length === 0) {
  console.log("[dev-clean] no ports configured for cleanup.");
  process.exit(0);
}

console.log(`[dev-clean] checking ports: ${requestedPorts.join(", ")}`);

let killedCount = 0;

for (const port of requestedPorts) {
  const listeners = await findListeners(port);

  if (listeners.length === 0) {
    console.log(`[dev-clean] port ${port} is free.`);
    continue;
  }

  console.log(`[dev-clean] port ${port} is occupied:`);
  for (const listener of listeners) {
    console.log(
      `  - pid ${listener.pid} (${listener.command || "unknown command"})`,
    );
  }

  await terminateListeners(port, listeners);
  killedCount += listeners.length;
}

if (killedCount === 0) {
  console.log("[dev-clean] nothing to clean.");
} else {
  console.log(`[dev-clean] released ${killedCount} dev port listener(s).`);
}

function loadRootEnv() {
  try {
    loadEnvFile(".env.local");
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
    console.warn(`[dev-clean] failed to load .env.local: ${message}`);
  }
}

function parsePorts(args) {
  const portArgs = args.filter((arg) => arg !== "--");
  const rawPorts =
    portArgs.length > 0
      ? portArgs
      : [
          String(DEFAULT_WEB_PORT),
          process.env.CUCUMBER_SERVER_PORT ??
            process.env.PORT ??
            String(DEFAULT_SERVER_PORT),
        ];

  const ports = new Set();
  for (const rawPort of rawPorts.flatMap((value) => value.split(","))) {
    const port = Number.parseInt(rawPort.trim(), 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`Invalid dev port value: ${rawPort}`);
    }

    ports.add(port);
  }

  return [...ports].sort((left, right) => left - right);
}

async function findListeners(port) {
  try {
    const { stdout } = await execFileAsync("lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-F",
      "pc",
    ]);

    return parseLsofFieldOutput(stdout);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 1
    ) {
      return [];
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to inspect port ${port}: ${message}`);
  }
}

function parseLsofFieldOutput(output) {
  const listeners = [];
  let current = null;

  for (const line of output.split("\n")) {
    if (!line) {
      continue;
    }

    const field = line[0];
    const value = line.slice(1);

    if (field === "p") {
      current = { pid: Number.parseInt(value, 10), command: "" };
      if (Number.isInteger(current.pid)) {
        listeners.push(current);
      }
      continue;
    }

    if (field === "c" && current) {
      current.command = value;
    }
  }

  return listeners;
}

async function terminateListeners(port, listeners) {
  for (const listener of listeners) {
    sendSignal(listener.pid, "SIGTERM", port);
  }

  await wait(FORCE_KILL_DELAY_MS);

  const remainingListeners = await findListeners(port);
  if (remainingListeners.length === 0) {
    console.log(`[dev-clean] port ${port} released with SIGTERM.`);
    return;
  }

  console.log(`[dev-clean] port ${port} still occupied; sending SIGKILL.`);
  for (const listener of remainingListeners) {
    sendSignal(listener.pid, "SIGKILL", port);
  }

  await wait(250);

  const stubbornListeners = await findListeners(port);
  if (stubbornListeners.length > 0) {
    const details = stubbornListeners
      .map((listener) => `${listener.pid} (${listener.command})`)
      .join(", ");
    throw new Error(`Port ${port} is still occupied by ${details}`);
  }
}

function sendSignal(pid, signal, port) {
  try {
    process.kill(pid, signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to send ${signal} to pid ${pid} on port ${port}: ${message}`,
    );
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
