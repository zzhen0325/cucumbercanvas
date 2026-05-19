#!/usr/bin/env node
/**
 * Dev launcher that starts the server and worker as child processes,
 * forwarding SIGINT/SIGTERM so they shut down gracefully when the parent
 * (turbo / pnpm dev) is killed with Ctrl+C.
 *
 * Using shell `&` + `wait` in package.json scripts does NOT forward
 * signals to background jobs, so node processes become orphans and
 * keep ports (e.g. 3001) occupied. This launcher fixes that.
 */
import { spawn } from "node:child_process";

const nodeArgs = ["--watch", "--env-file=../../.env.local", "--import", "tsx"];
const supportsProcessGroups = process.platform !== "win32";

const children = [];

function spawnChild(name, command, args, envOverride = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...envOverride },
    detached: supportsProcessGroups,
  });
  child.name = name;
  children.push(child);
  return child;
}

function killChildTree(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  try {
    if (supportsProcessGroups && child.pid) {
      // `node --watch` spawns the actual app process as a child. Launching the
      // watcher in its own process group lets us forward shutdown signals to the
      // entire tree so Ctrl+C does not leave the inner server/worker running.
      process.kill(-child.pid, signal);
      return;
    }

    child.kill(signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[dev-launcher] failed to send ${signal} to ${child.name}: ${message}`);
  }
}

// Start server
spawnChild("server", "node", [...nodeArgs, "./src/server.ts"]);

// Start worker
spawnChild("worker", "node", [...nodeArgs, "./src/worker.ts"], {
  CUCUMBER_WORKER_ID: "w1",
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[dev-launcher] received ${signal}, shutting down children...`);

  for (const child of children) {
    killChildTree(child, signal);
  }

  // Force exit after 5s if children refuse to die
  setTimeout(() => {
    console.log("[dev-launcher] force killing remaining children...");
    for (const child of children) {
      killChildTree(child, "SIGKILL");
    }
    process.exit(1);
  }, 5000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// If all children exit naturally, exit the launcher too
let exitedCount = 0;
for (const child of children) {
  child.on("exit", (code, childSignal) => {
    exitedCount++;
    const label = `[dev-launcher] ${child.name} exited`;
    if (childSignal) {
      console.log(`${label} with signal ${childSignal}`);
    } else {
      console.log(`${label} with code ${code}`);
    }
    if (exitedCount >= children.length) {
      process.exit(code ?? 0);
    }
  });
}
