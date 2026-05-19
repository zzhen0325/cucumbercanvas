import { bootstrap } from "global-agent";

// Enable HTTP proxy for all outbound requests if GLOBAL_AGENT_HTTP_PROXY is set
bootstrap();

// Native fetch() proxy — needed for @google/generative-ai SDK
if (process.env.GLOBAL_AGENT_HTTP_PROXY) {
  const { ProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new ProxyAgent(process.env.GLOBAL_AGENT_HTTP_PROXY));
}

import { randomUUID } from "node:crypto";
import { loadServerEnv } from "./config/env.js";
import { type ExecutorContext, getExecutor } from "./features/jobs/job-executor.js";
import { createJobService } from "./features/jobs/job-service.js";
import { type PgmqMessage, createPgmqClient } from "./queue/pgmq-client.js";
import { createAdminSupabaseClient } from "./supabase/admin.js";
import { createUserSupabaseClientFactory } from "./supabase/user.js";

// Import executors to trigger registration via side effects
import "./features/jobs/executors/image-generation.js";
import "./features/jobs/executors/video-generation.js";

import type { BackgroundJobType } from "@cucumber/shared";

// Register all image/video providers via shared helper (keeps parity with app.ts)
import { registerAllProviders } from "./generation/providers/register-all.js";

// 代码执行由 LocalShellBackend 的内置 execute 工具直接处理，不走 PGMQ。
const QUEUES = ["image_generation_jobs", "video_generation_jobs"] as const;

const QUEUE_TO_TYPE: Record<string, BackgroundJobType> = {
  image_generation_jobs: "image_generation",
  video_generation_jobs: "video_generation",
};

const VT_BY_QUEUE: Record<string, number> = {
  image_generation_jobs: 120,
  video_generation_jobs: 300,
};

async function main() {
  const env = loadServerEnv();

  if (!env.supabaseDbUrl) {
    console.error("CUCUMBER_SUPABASE_DB_URL is required for worker process.");
    process.exit(1);
  }

  // Register all generation providers (shared with app.ts)
  registerAllProviders(env);

  const pgmq = createPgmqClient(env.supabaseDbUrl);
  const createUserClient = createUserSupabaseClientFactory(env);

  let adminClient: ReturnType<typeof createAdminSupabaseClient> | undefined;
  const getAdminClient = () => {
    adminClient ??= createAdminSupabaseClient(env);
    return adminClient;
  };

  const jobService = createJobService({ createUserClient, getAdminClient, pgmq });

  // Base context — per-message fields (queue, msgId, renewVt) are added in processMessage
  const baseCtx = {
    jobService,
    pgmq,
    getAdminClient,
    env,
  };

  const CONCURRENCY_BY_QUEUE: Record<string, number> = {
    image_generation_jobs: env.workerImageConcurrency ?? 3,
    video_generation_jobs: env.workerVideoConcurrency ?? 2,
  };

  const inFlightByQueue = new Map<string, Set<Promise<void>>>(
    QUEUES.map((q) => [q, new Set()]),
  );

  // Server-side long poll: wait up to N seconds inside Postgres for messages,
  // checking every 500ms. This replaces the old client-side sleep(2000) + read()
  // pattern that generated ~340K idle queries per monitoring period.
  const pollTimeoutSeconds = Math.max(1, Math.floor((env.workerPollIntervalMs ?? 5000) / 1000));
  const workerId = env.workerId ?? randomUUID().slice(0, 8);
  const tag = `[worker:${workerId}]`;

  let running = true;

  // Graceful shutdown — wait for in-flight jobs then exit
  const shutdown = async () => {
    const totalInFlight = [...inFlightByQueue.values()].reduce((n, s) => n + s.size, 0);
    console.log(`${tag} Shutting down, waiting for ${totalInFlight} in-flight jobs...`);
    running = false;
    const allTasks = [...inFlightByQueue.values()].flatMap((s) => [...s]);
    if (allTasks.length > 0) {
      await Promise.allSettled(allTasks);
    }
    await pgmq.shutdown();
    console.log(`${tag} Shutdown complete.`);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const concurrencyDesc = QUEUES.map((q) => `${q}=${CONCURRENCY_BY_QUEUE[q] ?? 1}`).join(", ");
  console.log(`${tag} Postgres target: ${describePostgresTarget(env.supabaseDbUrl)}`);
  const dbUrlWarning = getSupabaseDbUrlWarning(env.supabaseDbUrl);
  if (dbUrlWarning) {
    console.warn(`${tag} ${dbUrlWarning}`);
  }
  console.log(
    `${tag} Started. concurrency={${concurrencyDesc}}, longPollTimeout=${pollTimeoutSeconds}s`,
  );

  while (running) {
    for (const queue of QUEUES) {
      try {
        const inFlight = inFlightByQueue.get(queue);
        if (!inFlight) {
          console.error(`${tag} Missing in-flight queue state for ${queue}; skipping poll cycle.`);
          continue;
        }

        const cap = CONCURRENCY_BY_QUEUE[queue] ?? 1;
        const available = cap - inFlight.size;
        if (available <= 0) continue;

        const vt = VT_BY_QUEUE[queue] ?? 120;
        const messages = await pgmq.readWithPoll(queue, vt, available, pollTimeoutSeconds, 500);

        for (const msg of messages) {
          const ctx: ExecutorContext = {
              ...baseCtx,
              queue,
              msgId: msg.msg_id,
              renewVt: async (vtSeconds: number) => {
                try { await pgmq.setVt(queue, msg.msg_id, vtSeconds); }
                catch (e) { console.warn(`[renewVt] failed for msg ${msg.msg_id}:`, e); }
              },
            };
            const task = processMessage(queue, msg, ctx, tag)
            .finally(() => inFlight.delete(task));
          inFlight.add(task);
        }
      } catch (err) {
        if (isFatalDatabaseAuthenticationError(err)) {
          await stopWorkerAfterFatalDatabaseAuthError(tag, queue, err, pgmq);
        }

        console.error(`${tag} Error polling ${queue}:`, err);
      }
    }
  }
}

function describePostgresTarget(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    const username = url.username || "<missing-user>";
    const database = url.pathname || "/<missing-database>";
    return `${username}@${url.host}${database}`;
  } catch {
    return "<invalid CUCUMBER_SUPABASE_DB_URL>";
  }
}

function getSupabaseDbUrlWarning(databaseUrl: string): string | null {
  try {
    const url = new URL(databaseUrl);
    const isSupabaseApiHost =
      url.hostname.endsWith(".supabase.co") && !url.hostname.startsWith("db.");
    if (!isSupabaseApiHost || url.port !== "5432") {
      return null;
    }

    return "CUCUMBER_SUPABASE_DB_URL looks like a Supabase API hostname on port 5432. Use the Dashboard database connection host instead, usually db.<project-ref>.supabase.co or the Supavisor pooler host.";
  } catch {
    return "CUCUMBER_SUPABASE_DB_URL is not a valid PostgreSQL URL. Worker database polling cannot start until it is fixed.";
  }
}

function isFatalDatabaseAuthenticationError(error: unknown): boolean {
  const pgError = error as { code?: unknown; message?: unknown };
  if (pgError.code === "28P01") {
    return true;
  }

  const message = typeof pgError.message === "string"
    ? pgError.message.toLowerCase()
    : String(error).toLowerCase();

  return (
    message.includes("ecircuitbreaker") ||
    message.includes("password authentication failed") ||
    message.includes("too many authentication failures")
  );
}

function summarizeDatabaseError(error: unknown) {
  const pgError = error as {
    code?: unknown;
    message?: unknown;
    severity?: unknown;
  };

  return {
    code: typeof pgError.code === "string" ? pgError.code : undefined,
    severity: typeof pgError.severity === "string" ? pgError.severity : undefined,
    message: typeof pgError.message === "string" ? pgError.message : String(error),
  };
}

async function stopWorkerAfterFatalDatabaseAuthError(
  tag: string,
  queue: string,
  error: unknown,
  pgmq: Pick<ReturnType<typeof createPgmqClient>, "shutdown">,
): Promise<never> {
  console.error(
    `${tag} Fatal database authentication error while polling ${queue}. Check CUCUMBER_SUPABASE_DB_URL host, username, password, and pooler/direct connection mode. Stopping the worker to avoid repeated failed logins and Supabase circuit breaker blocks.`,
    summarizeDatabaseError(error),
  );

  await pgmq.shutdown().catch((shutdownError: unknown) => {
    console.warn(`${tag} Failed to close PGMQ pool after fatal database auth error:`, shutdownError);
  });

  process.exit(1);
}

async function processMessage(
  queue: string,
  msg: PgmqMessage,
  ctx: ExecutorContext,
  tag: string,
) {
  const jobId = msg.message.job_id as string;
  const jobType = (msg.message.job_type as BackgroundJobType) ?? QUEUE_TO_TYPE[queue];

  if (!jobId || !jobType) {
    console.error(`${tag} Invalid message in ${queue}:`, msg.message);
    await ctx.pgmq.archive(queue, msg.msg_id);
    return;
  }

  // Extract traceability context from PGMQ message (if present)
  const sessionShort = typeof msg.message.session_id === "string"
    ? msg.message.session_id.slice(0, 8)
    : undefined;
  const startTime = Date.now();
  console.log(`${tag} Processing job ${jobId} (${jobType})${sessionShort ? ` session:${sessionShort}` : ""}`);

  const executor = getExecutor(jobType);
  if (!executor) {
    console.error(`${tag} No executor for job type: ${jobType}`);
    await ctx.jobService.markFailed(jobId, "no_executor", `No executor registered for ${jobType}`);
    await ctx.pgmq.archive(queue, msg.msg_id);
    return;
  }

  // Increment attempt count
  const { attempt_count, max_attempts } = await ctx.jobService.incrementAttempt(jobId);

  // Mark running
  await ctx.jobService.markRunning(jobId);

  try {
    const result = await executor(jobId, msg.message as Record<string, unknown>, ctx);
    await ctx.jobService.markSucceeded(jobId, result);
    await ctx.pgmq.deleteMsg(queue, msg.msg_id);
    console.log(`${tag} Job ${jobId} succeeded +${Date.now() - startTime}ms`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorCode = (err as { code?: string })?.code ?? "executor_error";

    // Non-retryable errors: retrying with the same input will always fail.
    // Dead-letter immediately so the caller (agent polling) gets fast feedback.
    const NON_RETRYABLE_CODES = new Set([
      "invalid_input",
      "model_not_found",
      "provider_not_found",
      "safety_filter",
    ]);
    const shouldDeadLetter =
      attempt_count >= max_attempts || NON_RETRYABLE_CODES.has(errorCode);

    if (shouldDeadLetter) {
      await ctx.jobService.markDeadLetter(jobId, errorCode, errorMessage);
      await ctx.pgmq.archive(queue, msg.msg_id);

      console.error(`${tag} Job ${jobId} dead-lettered after ${attempt_count} attempts +${Date.now() - startTime}ms: ${errorMessage}`);
    } else {
      await ctx.jobService.markFailed(jobId, errorCode, errorMessage);
      // Message will re-appear after VT expires for retry
      console.warn(`${tag} Job ${jobId} failed (attempt ${attempt_count}/${max_attempts}) +${Date.now() - startTime}ms: ${errorMessage}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("[worker] Fatal error:", err);
  process.exit(1);
});
