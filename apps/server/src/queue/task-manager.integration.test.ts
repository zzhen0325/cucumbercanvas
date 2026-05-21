import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chown, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createTaskManager,
  type EnqueueTaskInput,
  type TaskManager,
} from "./task-manager.js";

const INITDB_BIN = "/usr/lib/postgresql/15/bin/initdb";
const PG_CTL_BIN = "/usr/lib/postgresql/15/bin/pg_ctl";

describe.sequential("createTaskManager (real Postgres)", () => {
  let adminPool: pg.Pool;
  let databaseDir = "";
  let databaseUrl = "";
  let postgresUser: SystemUser | undefined;

  beforeAll(async () => {
    databaseDir = await mkdtemp(
      path.join(tmpdir(), "cucumber-task-manager-postgres-"),
    );
    const port = await getAvailablePort();
    postgresUser = await lookupSystemUser("postgres");

    if (postgresUser) {
      await chown(databaseDir, postgresUser.uid, postgresUser.gid);
    }

    const logFile = path.join(databaseDir, "postgres.log");
    await runCommand(
      INITDB_BIN,
      ["-D", databaseDir, "-A", "trust", "-U", "postgres"],
      postgresUser,
    );
    await runCommand(
      PG_CTL_BIN,
      [
        "-D",
        databaseDir,
        "-l",
        logFile,
        "-o",
        `-F -p ${port}`,
        "-w",
        "start",
      ],
      postgresUser,
    );

    databaseUrl = `postgres://postgres@127.0.0.1:${port}/postgres`;
    adminPool = new pg.Pool({ connectionString: databaseUrl });
    await adminPool.query(TEST_SCHEMA_SQL);
  }, 120_000);

  afterAll(async () => {
    await adminPool?.end();
    if (databaseDir) {
      try {
        await runCommand(
          PG_CTL_BIN,
          ["-D", databaseDir, "-m", "immediate", "-w", "stop"],
          postgresUser,
        );
      } catch {
        // Ignore shutdown failures so cleanup can continue.
      }
      await rm(databaseDir, { force: true, recursive: true });
    }
  }, 120_000);

  beforeEach(async () => {
    await adminPool.query(`
      truncate table
        public.tasks,
        public.background_jobs,
        public.chat_sessions,
        public.canvases,
        public.workspaces
      restart identity cascade
    `);
  });

  it("allows only one concurrent worker to claim the same task", async () => {
    const seed = await seedJob(adminPool);
    const enqueueManager = createTaskManager(databaseUrl);
    const claimManagers = Array.from({ length: 8 }, () =>
      createTaskManager(databaseUrl),
    );

    try {
      const task = await enqueueManager.enqueue(createEnqueueInput(seed));
      const claimResults = await Promise.all(
        claimManagers.map((manager, index) =>
          manager.claimWithPoll(
            seed.queueName,
            `worker-${index + 1}`,
            5,
            1,
            1,
            100,
          ),
        ),
      );

      const claimedTasks = claimResults.flat();
      expect(claimedTasks).toHaveLength(1);
      expect(claimedTasks[0]).toMatchObject({
        id: task.id,
        locked_by: expect.stringMatching(/^worker-/),
        status: "running",
      });

      const persistedTask = await fetchTask(adminPool, task.id);
      expect(persistedTask).toMatchObject({
        id: task.id,
        locked_by: claimedTasks[0]?.locked_by ?? null,
        status: "running",
      });
    } finally {
      await shutdownManagers(enqueueManager, ...claimManagers);
    }
  });

  it("lets another worker reclaim a task after the lease times out", async () => {
    const seed = await seedJob(adminPool);
    const workerA = createTaskManager(databaseUrl);
    const workerB = createTaskManager(databaseUrl);

    try {
      const task = await workerA.enqueue(createEnqueueInput(seed));
      const firstClaim = await workerA.claimWithPoll(
        seed.queueName,
        "worker-a",
        1,
        1,
        1,
        100,
      );

      expect(firstClaim).toHaveLength(1);
      expect(firstClaim[0]).toMatchObject({
        id: task.id,
        locked_by: "worker-a",
      });

      const beforeExpiry = await workerB.claimWithPoll(
        seed.queueName,
        "worker-b",
        1,
        1,
        1,
        100,
      );
      expect(beforeExpiry).toHaveLength(0);

      await sleep(1_250);

      const reclaimed = await workerB.claimWithPoll(
        seed.queueName,
        "worker-b",
        5,
        1,
        1,
        100,
      );
      expect(reclaimed).toHaveLength(1);
      expect(reclaimed[0]).toMatchObject({
        id: task.id,
        locked_by: "worker-b",
        status: "running",
      });
    } finally {
      await shutdownManagers(workerA, workerB);
    }
  });

  it("keeps dead-lettered tasks out of future claim attempts", async () => {
    const seed = await seedJob(adminPool);
    const workerA = createTaskManager(databaseUrl);
    const workerB = createTaskManager(databaseUrl);

    try {
      const task = await workerA.enqueue(createEnqueueInput(seed));
      const [claimedTask] = await workerA.claimWithPoll(
        seed.queueName,
        "worker-a",
        5,
        1,
        1,
        100,
      );

      expect(claimedTask).toBeDefined();
      await expect(
        workerA.markDeadLetter(
          task.id,
          "worker-a",
          "fatal_provider_error",
          "Model permanently rejected the request",
        ),
      ).resolves.toBe(true);

      const persistedTask = await fetchTask(adminPool, task.id);
      expect(persistedTask).toMatchObject({
        id: task.id,
        last_error_code: "fatal_provider_error",
        status: "dead_letter",
      });

      const futureClaims = await workerB.claimWithPoll(
        seed.queueName,
        "worker-b",
        5,
        1,
        1,
        100,
      );
      expect(futureClaims).toHaveLength(0);
    } finally {
      await shutdownManagers(workerA, workerB);
    }
  });

  it("treats duplicate enqueue calls for the same job as idempotent", async () => {
    const seed = await seedJob(adminPool);
    const enqueueInput = createEnqueueInput(seed);
    const managerA = createTaskManager(databaseUrl);
    const managerB = createTaskManager(databaseUrl);

    try {
      const [firstTask, secondTask] = await Promise.all([
        managerA.enqueue(enqueueInput),
        managerB.enqueue(enqueueInput),
      ]);

      expect(firstTask.id).toBe(secondTask.id);
      expect(firstTask.job_id).toBe(seed.jobId);
      expect(secondTask.status).toBe("queued");

      const { rows } = await adminPool.query<{ count: string }>(
        `
          select count(*)::text as count
          from public.tasks
          where job_id = $1::uuid
        `,
        [seed.jobId],
      );

      expect(rows[0]?.count).toBe("1");
    } finally {
      await shutdownManagers(managerA, managerB);
    }
  });
});

type SeededJob = {
  canvasId: string;
  jobId: string;
  queueName: string;
  sessionId: string;
  workspaceId: string;
};

type SystemUser = {
  gid: number;
  uid: number;
};

function createEnqueueInput(seed: SeededJob): EnqueueTaskInput {
  return {
    canvasId: seed.canvasId,
    jobId: seed.jobId,
    jobType: "image_generation",
    queueName: seed.queueName,
    sessionId: seed.sessionId,
    workspaceId: seed.workspaceId,
  };
}

async function seedJob(pool: pg.Pool): Promise<SeededJob> {
  const workspaceId = randomUUID();
  const canvasId = randomUUID();
  const sessionId = randomUUID();
  const jobId = randomUUID();
  const queueName = "generation";

  await pool.query(`insert into public.workspaces (id) values ($1::uuid)`, [
    workspaceId,
  ]);
  await pool.query(`insert into public.canvases (id) values ($1::uuid)`, [
    canvasId,
  ]);
  await pool.query(`insert into public.chat_sessions (id) values ($1::uuid)`, [
    sessionId,
  ]);
  await pool.query(
    `
      insert into public.background_jobs (
        id,
        workspace_id,
        canvas_id,
        session_id,
        queue_name,
        job_type
      )
      values (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4::uuid,
        $5::text,
        $6::public.background_job_type
      )
    `,
    [jobId, workspaceId, canvasId, sessionId, queueName, "image_generation"],
  );

  return { canvasId, jobId, queueName, sessionId, workspaceId };
}

async function fetchTask(pool: pg.Pool, taskId: string) {
  const { rows } = await pool.query<{
    id: string;
    last_error_code: string | null;
    locked_by: string | null;
    status: string;
  }>(
    `
      select id, status, locked_by, last_error_code
      from public.tasks
      where id = $1::uuid
    `,
    [taskId],
  );

  return rows[0] ?? null;
}

async function shutdownManagers(...managers: TaskManager[]) {
  await Promise.all(managers.map((manager) => manager.shutdown()));
}

async function getAvailablePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate a TCP port.")));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function lookupSystemUser(name: string): Promise<SystemUser | undefined> {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) {
    return undefined;
  }

  const uid = await execShell(`id -u ${name}`);
  const gid = await execShell(`id -g ${name}`);

  return {
    gid: Number.parseInt(gid.trim(), 10),
    uid: Number.parseInt(uid.trim(), 10),
  };
}

async function execShell(command: string) {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn("sh", ["-c", command]);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(`Command failed: ${command}\n${stderr}`));
    });
  });
}

async function runCommand(
  command: string,
  args: string[],
  user?: SystemUser,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      gid: user?.gid,
      stdio: "pipe",
      uid: user?.uid,
    });
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Command failed (${command} ${args.join(" ")}):\n${stderr.trim()}`,
        ),
      );
    });
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TEST_SCHEMA_SQL = `
  create extension if not exists pgcrypto;

  do $$
  begin
    create type public.background_job_type as enum (
      'image_generation',
      'video_generation'
    );
  exception
    when duplicate_object then null;
  end
  $$;

  do $$
  begin
    create type public.task_status as enum (
      'queued',
      'running',
      'succeeded',
      'canceled',
      'dead_letter'
    );
  exception
    when duplicate_object then null;
  end
  $$;

  create or replace function public.set_updated_at()
  returns trigger
  language plpgsql
  as $$
  begin
    new.updated_at = now();
    return new;
  end;
  $$;

  create table if not exists public.workspaces (
    id uuid primary key
  );

  create table if not exists public.canvases (
    id uuid primary key
  );

  create table if not exists public.chat_sessions (
    id uuid primary key
  );

  create table if not exists public.background_jobs (
    id uuid primary key,
    workspace_id uuid not null references public.workspaces(id),
    canvas_id uuid references public.canvases(id) on delete set null,
    session_id uuid references public.chat_sessions(id) on delete set null,
    queue_name text not null,
    job_type public.background_job_type not null
  );

  create table if not exists public.tasks (
    id uuid primary key default gen_random_uuid(),
    job_id uuid not null unique references public.background_jobs(id) on delete cascade,
    workspace_id uuid not null references public.workspaces(id),
    canvas_id uuid references public.canvases(id) on delete set null,
    session_id uuid references public.chat_sessions(id) on delete set null,
    queue_name text not null,
    job_type public.background_job_type not null,
    status public.task_status not null default 'queued',
    available_at timestamptz not null default now(),
    lease_until timestamptz,
    locked_at timestamptz,
    locked_by text,
    last_error_code text,
    last_error_message text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    completed_at timestamptz,
    canceled_at timestamptz
  );

  create index if not exists idx_tasks_claimable
    on public.tasks(queue_name, available_at, created_at)
    where status = 'queued';

  create index if not exists idx_tasks_expired_leases
    on public.tasks(queue_name, lease_until)
    where status = 'running';

  drop trigger if exists trg_tasks_updated_at on public.tasks;
  create trigger trg_tasks_updated_at
    before update on public.tasks
    for each row execute function public.set_updated_at();

  create or replace function public.claim_background_tasks(
    p_queue_name text,
    p_worker_id text,
    p_lease_seconds integer default 120,
    p_limit integer default 1
  )
  returns setof public.tasks
  language plpgsql
  as $$
  begin
    return query
    with candidate as (
      select id
      from public.tasks
      where queue_name = p_queue_name
        and available_at <= now()
        and (
          status = 'queued'::public.task_status
          or (
            status = 'running'::public.task_status
            and lease_until is not null
            and lease_until <= now()
          )
        )
      order by available_at asc, created_at asc
      limit greatest(p_limit, 1)
      for update skip locked
    )
    update public.tasks as t
    set
      status = 'running'::public.task_status,
      locked_at = now(),
      locked_by = p_worker_id,
      lease_until = now() + (greatest(p_lease_seconds, 1) * interval '1 second'),
      updated_at = now()
    from candidate
    where t.id = candidate.id
    returning t.*;
  end;
  $$;

  create or replace function public.claim_background_tasks_with_poll(
    p_queue_name text,
    p_worker_id text,
    p_lease_seconds integer default 120,
    p_limit integer default 1,
    p_max_poll_seconds integer default 5,
    p_poll_interval_ms integer default 500
  )
  returns setof public.tasks
  language plpgsql
  as $$
  declare
    v_deadline timestamptz := clock_timestamp() + (greatest(p_max_poll_seconds, 1) * interval '1 second');
  begin
    loop
      return query
      select *
      from public.claim_background_tasks(
        p_queue_name,
        p_worker_id,
        p_lease_seconds,
        p_limit
      );

      if found then
        return;
      end if;

      exit when clock_timestamp() >= v_deadline;
      perform pg_sleep(greatest(p_poll_interval_ms, 100) / 1000.0);
    end loop;

    return;
  end;
  $$;
`;
