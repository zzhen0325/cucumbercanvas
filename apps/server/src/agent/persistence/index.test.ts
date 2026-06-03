import { describe, expect, it, vi } from "vitest";

import {
  AgentPersistenceInitializationError,
  createAgentPersistenceService,
} from "./index.js";
import type { createSupabaseCheckpointer } from "./supabase-checkpointer.js";
import type { createSupabaseStore } from "./supabase-store.js";

const TEST_DB_URL = "postgres://postgres:secret@db.example.com/postgres";

describe("createAgentPersistenceService", () => {
  it("returns null when persisted threads are not configured", async () => {
    const service = createAgentPersistenceService({});

    await expect(service.getPersistence()).resolves.toBeNull();
  });

  it("shares one pending initialization across concurrent callers", async () => {
    let resolveCheckpointer:
      | ((
          value: Awaited<ReturnType<typeof createSupabaseCheckpointer>>,
        ) => void)
      | undefined;
    let resolveStore:
      | ((value: Awaited<ReturnType<typeof createSupabaseStore>>) => void)
      | undefined;
    const checkpointer = {} as Awaited<
      ReturnType<typeof createSupabaseCheckpointer>
    >;
    const store = {} as Awaited<ReturnType<typeof createSupabaseStore>>;
    const createCheckpointer = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<typeof createSupabaseCheckpointer>>>(
          (resolve) => {
            resolveCheckpointer = resolve;
          },
        ),
    ) as unknown as typeof createSupabaseCheckpointer;
    const createStore = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<typeof createSupabaseStore>>>(
          (resolve) => {
            resolveStore = resolve;
          },
        ),
    ) as unknown as typeof createSupabaseStore;
    const service = createAgentPersistenceService(
      { supabaseDbUrl: TEST_DB_URL },
      { createCheckpointer, createStore },
    );

    const first = service.getPersistence();
    const second = service.getPersistence();

    expect(createCheckpointer).toHaveBeenCalledTimes(1);
    expect(createStore).toHaveBeenCalledTimes(1);

    resolveCheckpointer?.(checkpointer);
    resolveStore?.(store);

    const [firstPersistence, secondPersistence] = await Promise.all([
      first,
      second,
    ]);
    expect(firstPersistence).toEqual({ checkpointer, store });
    expect(secondPersistence).toBe(firstPersistence);
  });

  it("wraps initialization failures and retries the next call", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const checkpointer = {} as Awaited<
      ReturnType<typeof createSupabaseCheckpointer>
    >;
    const store = {} as Awaited<ReturnType<typeof createSupabaseStore>>;
    const createCheckpointer = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Connection terminated due to connection timeout", {
          cause: new Error("Connection terminated unexpectedly"),
        }),
      )
      .mockResolvedValue(
        checkpointer,
      ) as unknown as typeof createSupabaseCheckpointer;
    const createStore = vi
      .fn()
      .mockResolvedValue(store) as unknown as typeof createSupabaseStore;
    const service = createAgentPersistenceService(
      { supabaseDbUrl: TEST_DB_URL },
      { createCheckpointer, createStore },
    );

    try {
      await expect(service.getPersistence()).rejects.toMatchObject({
        code: "AGENT_PERSISTENCE_INIT_FAILED",
        component: "checkpointer",
        name: "AgentPersistenceInitializationError",
        retryable: true,
        target: "postgres@db.example.com/postgres",
      });
      await expect(service.getPersistence()).resolves.toEqual({
        checkpointer,
        store,
      });
      expect(createCheckpointer).toHaveBeenCalledTimes(2);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("is an Error subclass for runtime failure handling", () => {
    const error = new AgentPersistenceInitializationError({
      cause: new Error("boom"),
      component: "store",
      target: "postgres@db.example.com/postgres",
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("Supabase Postgres store");
  });
});
