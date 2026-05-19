import { bootstrap } from "global-agent";

// Enable HTTP proxy for all outbound requests if http_proxy / https_proxy is set
bootstrap();

// Native fetch() proxy — needed for @google/generative-ai SDK
if (process.env.GLOBAL_AGENT_HTTP_PROXY) {
  const { ProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new ProxyAgent(process.env.GLOBAL_AGENT_HTTP_PROXY));
}

import { buildApp } from "./app.js";
import { loadServerEnv } from "./config/env.js";

const env = loadServerEnv();
const app = buildApp({
  env,
});

const host = process.env.HOST ?? "127.0.0.1";

try {
  await app.listen({
    host,
    port: env.port,
  });

  console.log(`@cucumber/server listening on http://${host}:${env.port}`);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}

// Graceful shutdown — close Fastify server and exit cleanly on SIGINT/SIGTERM.
// This prevents the process from becoming an orphan when the parent shell
// (e.g. turbo / pnpm dev) is killed with Ctrl+C.
const shutdown = async (signal: string) => {
  console.log(`@cucumber/server received ${signal}, shutting down...`);
  try {
    await app.close();
    console.log("@cucumber/server shutdown complete.");
  } catch (err) {
    console.error("@cucumber/server error during shutdown:", err);
  } finally {
    process.exit(0);
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
