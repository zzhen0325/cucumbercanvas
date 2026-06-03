export type AgentPersistenceComponent = "checkpointer" | "store";

export class AgentPersistenceInitializationError extends Error {
  readonly code = "AGENT_PERSISTENCE_INIT_FAILED";
  readonly component: AgentPersistenceComponent;
  readonly retryable = true;
  readonly target: string;

  constructor(options: {
    cause: unknown;
    component: AgentPersistenceComponent;
    target: string;
  }) {
    super(
      `Agent 持久化初始化失败：无法连接 Supabase Postgres ${options.component}（${options.target}）。请检查 CUCUMBER_SUPABASE_DB_URL 的数据库主机、账号密码、网络连接以及 Supabase pooler/direct connection 状态。`,
      { cause: options.cause },
    );
    this.name = "AgentPersistenceInitializationError";
    this.component = options.component;
    this.target = options.target;
  }
}

export function describePostgresTarget(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const username = url.username || "<missing-user>";
    const database = url.pathname || "/<missing-database>";
    return `${username}@${url.host}${database}`;
  } catch {
    return "<invalid CUCUMBER_SUPABASE_DB_URL>";
  }
}

export function wrapAgentPersistenceInitializationError(options: {
  cause: unknown;
  component: AgentPersistenceComponent;
  connectionString: string;
}): AgentPersistenceInitializationError {
  const target = describePostgresTarget(options.connectionString);
  const error = new AgentPersistenceInitializationError({
    cause: options.cause,
    component: options.component,
    target,
  });

  console.error("[agent-persistence] Failed to initialize persistence", {
    component: options.component,
    target,
    cause:
      options.cause instanceof Error
        ? {
            message: options.cause.message,
            name: options.cause.name,
          }
        : String(options.cause),
  });

  return error;
}
