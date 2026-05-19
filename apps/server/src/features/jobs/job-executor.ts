import type { BackgroundJobType } from "@cucumber/shared";

import type { ServerEnv } from "../../config/env.js";
import type { TaskManager } from "../../queue/task-manager.js";
import type { AdminSupabaseClient } from "../../supabase/admin.js";
import type { JobService } from "./job-service.js";

export type ExecutorContext = {
  jobService: JobService;
  taskManager: TaskManager;
  getAdminClient: () => AdminSupabaseClient;
  env: ServerEnv;
  /** Queue name for the current task (set per-task by the worker). */
  queueName: string;
  /** Current leased task id (set per-task by the worker). */
  taskId: string;
  /**
   * Best-effort lease renewal — extends the current task lease so it stays
   * owned by this worker while the executor is still running.
   * Never throws; logs on failure.
   */
  renewLease: (leaseSeconds: number) => Promise<void>;
};

export type JobExecutor = (
  jobId: string,
  payload: Record<string, unknown>,
  ctx: ExecutorContext,
) => Promise<Record<string, unknown>>;

const executors = new Map<BackgroundJobType, JobExecutor>();

export function registerExecutor(
  jobType: BackgroundJobType,
  executor: JobExecutor,
): void {
  executors.set(jobType, executor);
}

export function getExecutor(
  jobType: BackgroundJobType,
): JobExecutor | undefined {
  return executors.get(jobType);
}
