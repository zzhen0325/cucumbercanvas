import pg from "pg";

import type { BackgroundJobType, BackgroundTask } from "@cucumber/shared";

export type EnqueueTaskInput = {
  jobId: string;
  workspaceId: string;
  queueName: string;
  jobType: BackgroundJobType;
  canvasId?: string;
  sessionId?: string;
  delaySeconds?: number;
};

export type TaskManager = {
  enqueue(input: EnqueueTaskInput): Promise<BackgroundTask>;
  claimWithPoll(
    queueName: string,
    workerId: string,
    leaseSeconds: number,
    limit: number,
    maxPollSeconds?: number,
    pollIntervalMs?: number,
  ): Promise<BackgroundTask[]>;
  renewLease(
    taskId: string,
    workerId: string,
    leaseSeconds: number,
  ): Promise<boolean>;
  markSucceeded(taskId: string, workerId: string): Promise<boolean>;
  requeue(
    taskId: string,
    workerId: string,
    delaySeconds: number,
    errorCode: string,
    errorMessage: string,
  ): Promise<boolean>;
  markDeadLetter(
    taskId: string,
    workerId: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<boolean>;
  markCanceled(taskId: string, workerId: string): Promise<boolean>;
  cancelByJobId(jobId: string): Promise<void>;
  shutdown(): Promise<void>;
};

function mapTaskRow(row: Record<string, unknown>): BackgroundTask {
  return {
    id: row.id as string,
    job_id: row.job_id as string,
    workspace_id: row.workspace_id as string,
    canvas_id: (row.canvas_id as string) ?? null,
    session_id: (row.session_id as string) ?? null,
    queue_name: row.queue_name as string,
    job_type: row.job_type as BackgroundTask["job_type"],
    status: row.status as BackgroundTask["status"],
    available_at: row.available_at as string,
    lease_until: (row.lease_until as string) ?? null,
    locked_at: (row.locked_at as string) ?? null,
    locked_by: (row.locked_by as string) ?? null,
    last_error_code: (row.last_error_code as string) ?? null,
    last_error_message: (row.last_error_message as string) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    completed_at: (row.completed_at as string) ?? null,
    canceled_at: (row.canceled_at as string) ?? null,
  };
}

export function createTaskManager(databaseUrl: string): TaskManager {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });

  pool.on("error", (err) => {
    console.error("[task-manager] Pool error (non-fatal):", err.message);
  });

  return {
    async enqueue(input) {
      const { rows } = await pool.query(
        `
          insert into public.tasks (
            job_id,
            workspace_id,
            canvas_id,
            session_id,
            queue_name,
            job_type,
            status,
            available_at
          )
          values (
            $1::uuid,
            $2::uuid,
            $3::uuid,
            $4::uuid,
            $5::text,
            $6::public.background_job_type,
            'queued'::public.task_status,
            now() + ($7::integer * interval '1 second')
          )
          on conflict (job_id) do update
            set job_id = public.tasks.job_id
          returning *
        `,
        [
          input.jobId,
          input.workspaceId,
          input.canvasId ?? null,
          input.sessionId ?? null,
          input.queueName,
          input.jobType,
          Math.max(0, input.delaySeconds ?? 0),
        ],
      );

      const row = rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error(`Failed to enqueue task for job ${input.jobId}`);
      }

      return mapTaskRow(row);
    },

    async claimWithPoll(
      queueName,
      workerId,
      leaseSeconds,
      limit,
      maxPollSeconds = 5,
      pollIntervalMs = 500,
    ) {
      const { rows } = await pool.query(
        `
          select *
          from public.claim_background_tasks_with_poll(
            $1::text,
            $2::text,
            $3::integer,
            $4::integer,
            $5::integer,
            $6::integer
          )
        `,
        [
          queueName,
          workerId,
          Math.max(1, leaseSeconds),
          Math.max(1, limit),
          Math.max(1, maxPollSeconds),
          Math.max(100, pollIntervalMs),
        ],
      );

      return rows.map((row) => mapTaskRow(row as Record<string, unknown>));
    },

    async renewLease(taskId, workerId, leaseSeconds) {
      const { rowCount } = await pool.query(
        `
          update public.tasks
          set
            lease_until = now() + ($3::integer * interval '1 second'),
            updated_at = now()
          where id = $1::uuid
            and locked_by = $2::text
            and status = 'running'::public.task_status
        `,
        [taskId, workerId, Math.max(1, leaseSeconds)],
      );

      return (rowCount ?? 0) > 0;
    },

    async markSucceeded(taskId, workerId) {
      const { rowCount } = await pool.query(
        `
          update public.tasks
          set
            status = 'succeeded'::public.task_status,
            lease_until = null,
            locked_at = null,
            locked_by = null,
            completed_at = now(),
            updated_at = now()
          where id = $1::uuid
            and locked_by = $2::text
            and status = 'running'::public.task_status
        `,
        [taskId, workerId],
      );

      return (rowCount ?? 0) > 0;
    },

    async requeue(taskId, workerId, delaySeconds, errorCode, errorMessage) {
      const { rowCount } = await pool.query(
        `
          update public.tasks
          set
            status = 'queued'::public.task_status,
            available_at = now() + ($3::integer * interval '1 second'),
            lease_until = null,
            locked_at = null,
            locked_by = null,
            last_error_code = $4::text,
            last_error_message = $5::text,
            updated_at = now()
          where id = $1::uuid
            and locked_by = $2::text
            and status = 'running'::public.task_status
        `,
        [taskId, workerId, Math.max(0, delaySeconds), errorCode, errorMessage],
      );

      return (rowCount ?? 0) > 0;
    },

    async markDeadLetter(taskId, workerId, errorCode, errorMessage) {
      const { rowCount } = await pool.query(
        `
          update public.tasks
          set
            status = 'dead_letter'::public.task_status,
            lease_until = null,
            locked_at = null,
            locked_by = null,
            last_error_code = $3::text,
            last_error_message = $4::text,
            updated_at = now()
          where id = $1::uuid
            and locked_by = $2::text
            and status = 'running'::public.task_status
        `,
        [taskId, workerId, errorCode, errorMessage],
      );

      return (rowCount ?? 0) > 0;
    },

    async markCanceled(taskId, workerId) {
      const { rowCount } = await pool.query(
        `
          update public.tasks
          set
            status = 'canceled'::public.task_status,
            lease_until = null,
            locked_at = null,
            locked_by = null,
            canceled_at = coalesce(canceled_at, now()),
            updated_at = now()
          where id = $1::uuid
            and locked_by = $2::text
            and status = 'running'::public.task_status
        `,
        [taskId, workerId],
      );

      return (rowCount ?? 0) > 0;
    },

    async cancelByJobId(jobId) {
      await pool.query(
        `
          update public.tasks
          set
            status = 'canceled'::public.task_status,
            lease_until = null,
            locked_at = null,
            locked_by = null,
            canceled_at = coalesce(canceled_at, now()),
            updated_at = now()
          where job_id = $1::uuid
            and status in ('queued'::public.task_status, 'running'::public.task_status)
        `,
        [jobId],
      );
    },

    async shutdown() {
      await pool.end();
    },
  };
}
