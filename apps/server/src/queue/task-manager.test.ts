import { beforeEach, describe, expect, it, vi } from "vitest";

const poolMocks = vi.hoisted(() => ({
  end: vi.fn(),
  on: vi.fn(),
  query: vi.fn(),
}));

vi.mock("pg", () => ({
  default: {
    Pool: class MockPool {
      query = poolMocks.query;
      end = poolMocks.end;
      on = poolMocks.on;
    },
  },
}));

import { createTaskManager } from "./task-manager.js";

describe("createTaskManager", () => {
  beforeEach(() => {
    poolMocks.query.mockReset();
    poolMocks.end.mockReset();
    poolMocks.on.mockReset();
  });

  it("enqueues tasks and clamps negative delay to zero", async () => {
    poolMocks.query.mockResolvedValueOnce({
      rows: [createTaskRow({ status: "queued" })],
    });

    const manager = createTaskManager("postgres://example.test/app");
    const task = await manager.enqueue({
      jobId: "job-1",
      workspaceId: "workspace-1",
      queueName: "generation",
      jobType: "image_generation",
      delaySeconds: -20,
    });

    expect(poolMocks.query).toHaveBeenCalledWith(
      expect.stringContaining("insert into public.tasks"),
      ["job-1", "workspace-1", null, null, "generation", "image_generation", 0],
    );
    expect(task).toMatchObject({
      id: "task-1",
      job_id: "job-1",
      queue_name: "generation",
      status: "queued",
    });
  });

  it("claims tasks with normalized lease and poll parameters", async () => {
    poolMocks.query.mockResolvedValueOnce({
      rows: [
        createTaskRow({
          id: "task-claim",
          status: "running",
          locked_by: "worker-1",
        }),
      ],
    });

    const manager = createTaskManager("postgres://example.test/app");
    const tasks = await manager.claimWithPoll(
      "generation",
      "worker-1",
      0,
      0,
      0,
      10,
    );

    expect(poolMocks.query).toHaveBeenCalledWith(
      expect.stringContaining("claim_background_tasks_with_poll"),
      ["generation", "worker-1", 1, 1, 1, 100],
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: "task-claim",
      locked_by: "worker-1",
      status: "running",
    });
  });

  it("renews leases only when the current worker still owns the task", async () => {
    poolMocks.query.mockResolvedValueOnce({ rowCount: 0 });

    const manager = createTaskManager("postgres://example.test/app");
    await expect(manager.renewLease("task-1", "worker-1", 90)).resolves.toBe(
      false,
    );
    expect(poolMocks.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "lease_until = now() + ($3::integer * interval '1 second')",
      ),
      ["task-1", "worker-1", 90],
    );
  });

  it("supports success, retry, dead-letter, and cancel transitions", async () => {
    poolMocks.query
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });

    const manager = createTaskManager("postgres://example.test/app");

    await expect(manager.markSucceeded("task-1", "worker-1")).resolves.toBe(
      true,
    );
    await expect(
      manager.requeue("task-1", "worker-1", 15, "provider_busy", "Retry later"),
    ).resolves.toBe(true);
    await expect(
      manager.markDeadLetter(
        "task-1",
        "worker-1",
        "fatal",
        "Permanent failure",
      ),
    ).resolves.toBe(true);
    await expect(manager.markCanceled("task-1", "worker-1")).resolves.toBe(
      true,
    );

    expect(poolMocks.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("status = 'queued'::public.task_status"),
      ["task-1", "worker-1", 15, "provider_busy", "Retry later"],
    );
    expect(poolMocks.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("status = 'dead_letter'::public.task_status"),
      ["task-1", "worker-1", "fatal", "Permanent failure"],
    );
    expect(poolMocks.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("status = 'canceled'::public.task_status"),
      ["task-1", "worker-1"],
    );
  });

  it("cancels queued or running tasks by job id and closes the pool", async () => {
    poolMocks.query.mockResolvedValueOnce({ rowCount: 2 });

    const manager = createTaskManager("postgres://example.test/app");
    await manager.cancelByJobId("job-1");
    await manager.shutdown();

    expect(poolMocks.query).toHaveBeenCalledWith(
      expect.stringContaining("where job_id = $1::uuid"),
      ["job-1"],
    );
    expect(poolMocks.end).toHaveBeenCalledTimes(1);
  });
});

function createTaskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    job_id: "job-1",
    workspace_id: "workspace-1",
    canvas_id: null,
    session_id: null,
    queue_name: "generation",
    job_type: "image_generation",
    status: "queued",
    available_at: "2026-01-01T00:00:00.000Z",
    lease_until: null,
    locked_at: null,
    locked_by: null,
    last_error_code: null,
    last_error_message: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    completed_at: null,
    canceled_at: null,
    ...overrides,
  };
}
