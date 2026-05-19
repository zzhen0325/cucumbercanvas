import { bootstrap } from "global-agent";

bootstrap();

if (process.env.GLOBAL_AGENT_HTTP_PROXY) {
  const { ProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new ProxyAgent(process.env.GLOBAL_AGENT_HTTP_PROXY));
}

import { randomUUID } from "node:crypto";
import type { BackgroundJobType, BackgroundTask } from "@cucumber/shared";

import { loadServerEnv } from "./config/env.js";
import {
  type ExecutorContext,
  getExecutor,
} from "./features/jobs/job-executor.js";
import { createJobService } from "./features/jobs/job-service.js";
import { createTaskManager } from "./queue/task-manager.js";
import { createAdminSupabaseClient } from "./supabase/admin.js";
import { createUserSupabaseClientFactory } from "./supabase/user.js";

import "./features/jobs/executors/image-generation.js";
import "./features/jobs/executors/video-generation.js";

import { registerAllProviders } from "./generation/providers/register-all.js";

const QUEUES = ["image_generation_jobs", "video_generation_jobs"] as const;

const QUEUE_TO_TYPE: Record<string, BackgroundJobType> = {
  image_generation_jobs: "image_generation",
  video_generation_jobs: "video_generation",
};

const LEASE_BY_QUEUE: Record<string, number> = {
  image_generation_jobs: 120,
  video_generation_jobs: 300,
};

async function main() {
  const env = loadServerEnv();

  if (!env.supabaseDbUrl) {
    console.error("CUCUMBER_SUPABASE_DB_URL is required for worker process.");
    process.exit(1);
  }

  registerAllProviders(env);

  const taskManager = createTaskManager(env.supabaseDbUrl);
  const createUserClient = createUserSupabaseClientFactory(env);

  let adminClient: ReturnType<typeof createAdminSupabaseClient> | undefined;
  const getAdminClient = () => {
    adminClient ??= createAdminSupabaseClient(env);
    return adminClient;
  };

  const jobService = createJobService({
    createUserClient,
    getAdminClient,
    taskManager,
  });

  const baseCtx = {
    jobService,
    taskManager,
    getAdminClient,
    env,
  };

  const CONCURRENCY_BY_QUEUE: Record<string, number> = {
    image_generation_jobs: env.workerImageConcurrency ?? 3,
    video_generation_jobs: env.workerVideoConcurrency ?? 2,
  };

  const inFlightByQueue = new Map<string, Set<Promise<void>>>(
    QUEUES.map((queueName) => [queueName, new Set()]),
  );

  const pollTimeoutSeconds = Math.max(
    1,
    Math.floor((env.workerPollIntervalMs ?? 5000) / 1000),
  );
  const maxBatchSize = Math.max(1, env.workerMaxBatchSize ?? 4);
  const workerId = env.workerId ?? randomUUID().slice(0, 8);
  const tag = `[worker:${workerId}]`;

  let running = true;
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    const totalInFlight = [...inFlightByQueue.values()].reduce(
      (count, set) => count + set.size,
      0,
    );
    console.log(
      `${tag} Shutting down, waiting for ${totalInFlight} in-flight jobs...`,
    );
    running = false;

    const allTasks = [...inFlightByQueue.values()].flatMap((set) => [...set]);
    if (allTasks.length > 0) {
      await Promise.allSettled(allTasks);
    }

    await taskManager.shutdown();
    console.log(`${tag} Shutdown complete.`);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const concurrencyDesc = QUEUES.map(
    (queueName) => `${queueName}=${CONCURRENCY_BY_QUEUE[queueName] ?? 1}`,
  ).join(", ");
  console.log(
    `${tag} Postgres target: ${describePostgresTarget(env.supabaseDbUrl)}`,
  );
  const dbUrlWarning = getSupabaseDbUrlWarning(env.supabaseDbUrl);
  if (dbUrlWarning) {
    console.warn(`${tag} ${dbUrlWarning}`);
  }
  console.log(
    `${tag} Started. concurrency={${concurrencyDesc}}, batchSize=${maxBatchSize}, pollTimeout=${pollTimeoutSeconds}s`,
  );

  while (running) {
    for (const queueName of QUEUES) {
      try {
        const inFlight = inFlightByQueue.get(queueName);
        if (!inFlight) {
          console.error(
            `${tag} Missing in-flight queue state for ${queueName}; skipping poll cycle.`,
          );
          continue;
        }

        const cap = CONCURRENCY_BY_QUEUE[queueName] ?? 1;
        const available = Math.min(cap - inFlight.size, maxBatchSize);
        if (available <= 0) {
          continue;
        }

        const leaseSeconds = LEASE_BY_QUEUE[queueName] ?? 120;
        const leasedTasks = await taskManager.claimWithPoll(
          queueName,
          workerId,
          leaseSeconds,
          available,
          pollTimeoutSeconds,
          500,
        );

        for (const leasedTask of leasedTasks) {
          const ctx: ExecutorContext = {
            ...baseCtx,
            queueName,
            taskId: leasedTask.id,
            renewLease: async (nextLeaseSeconds: number) => {
              try {
                const renewed = await taskManager.renewLease(
                  leasedTask.id,
                  workerId,
                  nextLeaseSeconds,
                );
                if (!renewed) {
                  console.warn(
                    `${tag} renewLease skipped for task ${leasedTask.id} (job ${leasedTask.job_id}); lease already released or task no longer running.`,
                  );
                }
              } catch (error) {
                console.warn(
                  `${tag} renewLease failed for task ${leasedTask.id} (job ${leasedTask.job_id}):`,
                  error,
                );
              }
            },
          };

          const task = processTask(
            queueName,
            leasedTask,
            ctx,
            tag,
            workerId,
          ).finally(() => inFlight.delete(task));
          inFlight.add(task);
        }
      } catch (error) {
        if (!running) {
          break;
        }

        if (isFatalDatabaseAuthenticationError(error)) {
          await stopWorkerAfterFatalDatabaseAuthError(
            tag,
            queueName,
            error,
            taskManager,
          );
        }

        console.error(`${tag} Error polling ${queueName}:`, error);
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
    return "CUCUMBER_SUPABASE_DB_URL is not a valid PostgreSQL URL. Worker task polling cannot start until it is fixed.";
  }
}

function isFatalDatabaseAuthenticationError(error: unknown): boolean {
  const pgError = error as { code?: unknown; message?: unknown };
  if (pgError.code === "28P01") {
    return true;
  }

  const message =
    typeof pgError.message === "string"
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
    severity:
      typeof pgError.severity === "string" ? pgError.severity : undefined,
    message:
      typeof pgError.message === "string" ? pgError.message : String(error),
  };
}

async function stopWorkerAfterFatalDatabaseAuthError(
  tag: string,
  queueName: string,
  error: unknown,
  taskManager: Pick<ReturnType<typeof createTaskManager>, "shutdown">,
): Promise<never> {
  console.error(
    `${tag} Fatal database authentication error while polling ${queueName}. Check CUCUMBER_SUPABASE_DB_URL host, username, password, and pooler/direct connection mode. Stopping the worker to avoid repeated failed logins and Supabase circuit breaker blocks.`,
    summarizeDatabaseError(error),
  );

  await taskManager.shutdown().catch((shutdownError: unknown) => {
    console.warn(
      `${tag} Failed to close task manager pool after fatal database auth error:`,
      shutdownError,
    );
  });

  process.exit(1);
}

async function processTask(
  queueName: string,
  leasedTask: BackgroundTask,
  ctx: ExecutorContext,
  tag: string,
  workerId: string,
) {
  const jobId = leasedTask.job_id;
  const jobType = leasedTask.job_type ?? QUEUE_TO_TYPE[queueName];

  if (!jobId || !jobType) {
    console.error(`${tag} Invalid task payload in ${queueName}:`, leasedTask);
    await ctx.taskManager.markDeadLetter(
      leasedTask.id,
      workerId,
      "invalid_task",
      "Task row is missing job_id or job_type.",
    );
    return;
  }

  const sessionShort = leasedTask.session_id
    ? leasedTask.session_id.slice(0, 8)
    : undefined;
  const startTime = Date.now();
  console.log(
    `${tag} Processing task ${leasedTask.id} job ${jobId} (${jobType})${sessionShort ? ` session:${sessionShort}` : ""}`,
  );

  const executor = getExecutor(jobType);
  if (!executor) {
    console.error(`${tag} No executor for job type: ${jobType}`);
    await ctx.jobService.markDeadLetter(
      jobId,
      "no_executor",
      `No executor registered for ${jobType}`,
    );
    await ctx.taskManager.markDeadLetter(
      leasedTask.id,
      workerId,
      "no_executor",
      `No executor registered for ${jobType}`,
    );
    return;
  }

  const currentJob = await ctx.jobService.getJobAdmin(jobId);
  if (currentJob.status === "canceled") {
    await ctx.taskManager.markCanceled(leasedTask.id, workerId);
    console.warn(`${tag} Skipping canceled job ${jobId}.`);
    return;
  }
  if (currentJob.status === "succeeded") {
    await ctx.taskManager.markSucceeded(leasedTask.id, workerId);
    console.warn(`${tag} Skipping already-succeeded job ${jobId}.`);
    return;
  }
  if (currentJob.status === "dead_letter") {
    await ctx.taskManager.markDeadLetter(
      leasedTask.id,
      workerId,
      currentJob.error_code ?? "dead_letter",
      currentJob.error_message ??
        "Job already dead-lettered before task claim.",
    );
    console.warn(`${tag} Skipping already-dead-lettered job ${jobId}.`);
    return;
  }

  const { attempt_count, max_attempts } =
    await ctx.jobService.incrementAttempt(jobId);
  await ctx.jobService.markRunning(jobId);

  try {
    const result = await executor(
      jobId,
      leasedTask as unknown as Record<string, unknown>,
      ctx,
    );

    const latestJob = await ctx.jobService.getJobAdmin(jobId);
    if (latestJob.status === "canceled") {
      await ctx.taskManager.markCanceled(leasedTask.id, workerId);
      console.warn(
        `${tag} Job ${jobId} finished execution after cancellation; dropped result +${Date.now() - startTime}ms`,
      );
      return;
    }

    await ctx.jobService.markSucceeded(jobId, result);
    await ctx.taskManager.markSucceeded(leasedTask.id, workerId);
    console.log(`${tag} Job ${jobId} succeeded +${Date.now() - startTime}ms`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = (error as { code?: string })?.code ?? "executor_error";

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
      await ctx.taskManager.markDeadLetter(
        leasedTask.id,
        workerId,
        errorCode,
        errorMessage,
      );
      console.error(
        `${tag} Job ${jobId} dead-lettered after ${attempt_count} attempts +${Date.now() - startTime}ms: ${errorMessage}`,
      );
      return;
    }

    await ctx.jobService.markFailed(jobId, errorCode, errorMessage);
    await ctx.taskManager.requeue(
      leasedTask.id,
      workerId,
      LEASE_BY_QUEUE[queueName] ?? 120,
      errorCode,
      errorMessage,
    );
    console.warn(
      `${tag} Job ${jobId} failed (attempt ${attempt_count}/${max_attempts}) +${Date.now() - startTime}ms: ${errorMessage}`,
    );
  }
}

main().catch((error) => {
  console.error("[worker] Fatal error:", error);
  process.exit(1);
});
