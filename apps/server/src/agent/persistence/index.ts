import type {
  BaseCheckpointSaver,
  BaseStore,
} from "@langchain/langgraph-checkpoint";

import type { ServerEnv } from "../../config/env.js";
import {
  type AgentPersistenceComponent,
  AgentPersistenceInitializationError,
  wrapAgentPersistenceInitializationError,
} from "./errors.js";
import { createSupabaseCheckpointer } from "./supabase-checkpointer.js";
import { createSupabaseStore } from "./supabase-store.js";

export { AgentPersistenceInitializationError };

export type AgentPersistence = {
  checkpointer: BaseCheckpointSaver;
  store: BaseStore;
};

export type AgentPersistenceService = {
  getPersistence(): Promise<AgentPersistence | null>;
};

export function createAgentPersistenceService(
  env: Pick<ServerEnv, "supabaseDbUrl">,
  overrides?: {
    createCheckpointer?: typeof createSupabaseCheckpointer;
    createStore?: typeof createSupabaseStore;
  },
): AgentPersistenceService {
  let pendingPersistence: Promise<AgentPersistence> | null = null;

  return {
    async getPersistence() {
      if (!env.supabaseDbUrl) {
        return null;
      }
      const connectionString = env.supabaseDbUrl;

      if (!pendingPersistence) {
        const initialize = async <T>(
          component: AgentPersistenceComponent,
          factory: () => Promise<T>,
        ): Promise<T> => {
          try {
            return await factory();
          } catch (error) {
            throw wrapAgentPersistenceInitializationError({
              cause: error,
              component,
              connectionString,
            });
          }
        };

        pendingPersistence = Promise.all([
          initialize("checkpointer", () =>
            (overrides?.createCheckpointer ?? createSupabaseCheckpointer)({
              connectionString,
            }),
          ),
          initialize("store", () =>
            (overrides?.createStore ?? createSupabaseStore)({
              connectionString,
            }),
          ),
        ])
          .then(([checkpointer, store]) => ({ checkpointer, store }))
          .catch((error) => {
            pendingPersistence = null;
            throw error;
          });
      }

      return pendingPersistence;
    },
  };
}
