import { readFileSync } from "node:fs";

export const DEFAULT_AGENT_BACKEND_MODE = "state";
export const DEFAULT_AGENT_MODEL = "gpt-4.1";
export const DEFAULT_GOOGLE_AGENT_MODEL = "gemini-2.5-flash";
export const DEFAULT_DEEPSEEK_AGENT_MODEL = "deepseek-chat";
export const DEFAULT_SERVER_PORT = 3001;
export const DEFAULT_WEB_ORIGIN = "http://localhost:3000";

/**
 * Resolve the default agent model based on available provider configuration.
 * Priority: OpenAI > Google > DeepSeek
 */
export function resolveDefaultAgentModel(
  env: Pick<
    ServerEnv,
    "deepseekApiKey" | "googleApiKey" | "googleVertexProject" | "openAIApiKey"
  >,
): string {
  const hasOpenAI = !!env.openAIApiKey;
  const hasGoogle = !!(env.googleApiKey || env.googleVertexProject);
  const hasDeepSeek = !!env.deepseekApiKey;

  if (!hasOpenAI && hasGoogle) return DEFAULT_GOOGLE_AGENT_MODEL;
  if (!hasOpenAI && !hasGoogle && hasDeepSeek)
    return DEFAULT_DEEPSEEK_AGENT_MODEL;
  return DEFAULT_AGENT_MODEL;
}

export type AgentBackendMode = "filesystem" | "state";

export type ServerEnv = {
  agentBackendMode: AgentBackendMode;
  agentFilesRoot?: string;
  agentModel: string;
  deepseekApiBase?: string;
  deepseekApiKey?: string;
  googleApiKey?: string;
  googleApplicationCredentials?: string;
  googleFontsApiKey?: string;
  googleVertexLocation?: string;
  googleVertexProject?: string;
  openAIApiBase?: string;
  openAIApiKey?: string;
  port: number;
  seedreamAccessKeyId?: string;
  seedreamSecretAccessKey?: string;
  seedreamReqKey?: string;
  seedreamVideoReqKey?: string;
  seedreamHost?: string;
  seedreamRegion?: string;
  seedreamService?: string;
  seedreamVersion?: string;
  supabaseAnonKey?: string;
  supabaseDbUrl?: string;
  supabaseJwtSecret?: string;
  supabaseProjectId?: string;
  supabaseServiceRoleKey?: string;
  supabaseUrl?: string;
  version: string;
  skillsRoot?: string;
  webOrigin: string;
  workerConcurrency?: number;
  workerImageConcurrency?: number;
  workerVideoConcurrency?: number;
  workerId?: string;
  workerPollIntervalMs?: number;
  workerMaxBatchSize?: number;
};

export function loadServerEnv(
  overrides: Partial<ServerEnv> = {},
  source: NodeJS.ProcessEnv = process.env,
): ServerEnv {
  const agentFilesRoot =
    overrides.agentFilesRoot ??
    parseAgentFilesRoot(source.CUCUMBER_AGENT_FILES_ROOT);
  const deepseekApiBase =
    overrides.deepseekApiBase ??
    normalizeOptionalString(source.CUCUMBER_DEEPSEEK_API_BASE);
  const deepseekApiKey =
    overrides.deepseekApiKey ??
    normalizeOptionalString(source.CUCUMBER_DEEPSEEK_API_KEY);
  const openAIApiBase =
    overrides.openAIApiBase ??
    normalizeOptionalString(source.CUCUMBER_OPENAI_API_BASE);
  const openAIApiKey =
    overrides.openAIApiKey ??
    normalizeOptionalString(source.CUCUMBER_OPENAI_API_KEY);
  const supabaseUrl =
    overrides.supabaseUrl ??
    normalizeOptionalString(source.CUCUMBER_SUPABASE_URL);
  const supabaseAnonKey =
    overrides.supabaseAnonKey ??
    normalizeOptionalString(source.CUCUMBER_SUPABASE_ANON_KEY);
  const supabaseDbUrl =
    overrides.supabaseDbUrl ??
    normalizeOptionalString(source.CUCUMBER_SUPABASE_DB_URL);
  const supabaseJwtSecret =
    overrides.supabaseJwtSecret ??
    normalizeOptionalString(source.CUCUMBER_SUPABASE_JWT_SECRET);
  const supabaseServiceRoleKey =
    overrides.supabaseServiceRoleKey ??
    normalizeOptionalString(source.CUCUMBER_SUPABASE_SERVICE_ROLE_KEY);
  const supabaseProjectId =
    overrides.supabaseProjectId ??
    normalizeOptionalString(source.CUCUMBER_SUPABASE_PROJECT_ID);
  const googleApiKey =
    overrides.googleApiKey ??
    normalizeOptionalString(source.CUCUMBER_GOOGLE_API_KEY);
  const googleApplicationCredentials =
    overrides.googleApplicationCredentials ??
    normalizeOptionalString(source.CUCUMBER_GOOGLE_APPLICATION_CREDENTIALS);
  const googleFontsApiKey =
    overrides.googleFontsApiKey ??
    normalizeOptionalString(source.CUCUMBER_GOOGLE_FONTS_API_KEY);
  const googleVertexProject =
    overrides.googleVertexProject ??
    normalizeOptionalString(source.CUCUMBER_GOOGLE_VERTEX_PROJECT);
  const googleVertexLocation =
    overrides.googleVertexLocation ??
    normalizeOptionalString(source.CUCUMBER_GOOGLE_VERTEX_LOCATION);
  const seedreamAccessKeyId =
    overrides.seedreamAccessKeyId ??
    normalizeOptionalString(source.CUCUMBER_VOLCENGINE_ACCESS_KEY_ID) ??
    normalizeOptionalString(source.CUCUMBER_SEEDREAM_ACCESS_KEY_ID);
  const seedreamSecretAccessKey =
    overrides.seedreamSecretAccessKey ??
    normalizeOptionalString(source.CUCUMBER_VOLCENGINE_SECRET_ACCESS_KEY) ??
    normalizeOptionalString(source.CUCUMBER_SEEDREAM_SECRET_ACCESS_KEY);
  const seedreamReqKey =
    overrides.seedreamReqKey ??
    normalizeOptionalString(source.CUCUMBER_SEEDREAM_REQ_KEY) ??
    "jimeng_seedream46_cvtob";
  const seedreamVideoReqKey =
    overrides.seedreamVideoReqKey ??
    normalizeOptionalString(source.CUCUMBER_SEEDREAM_VIDEO_REQ_KEY);
  const seedreamHost =
    overrides.seedreamHost ??
    normalizeOptionalString(source.CUCUMBER_SEEDREAM_HOST) ??
    "visual.volcengineapi.com";
  const seedreamRegion =
    overrides.seedreamRegion ??
    normalizeOptionalString(source.CUCUMBER_SEEDREAM_REGION) ??
    "cn-north-1";
  const seedreamService =
    overrides.seedreamService ??
    normalizeOptionalString(source.CUCUMBER_SEEDREAM_SERVICE) ??
    "cv";
  const seedreamVersion =
    overrides.seedreamVersion ??
    normalizeOptionalString(source.CUCUMBER_SEEDREAM_VERSION) ??
    "2022-08-31";
  const skillsRoot =
    overrides.skillsRoot ??
    normalizeOptionalString(source.CUCUMBER_SKILLS_ROOT);
  const workerConcurrency =
    overrides.workerConcurrency ??
    (source.CUCUMBER_WORKER_CONCURRENCY
      ? Number.parseInt(source.CUCUMBER_WORKER_CONCURRENCY, 10)
      : undefined);
  const workerImageConcurrency =
    overrides.workerImageConcurrency ??
    (source.CUCUMBER_WORKER_IMAGE_CONCURRENCY
      ? Number.parseInt(source.CUCUMBER_WORKER_IMAGE_CONCURRENCY, 10)
      : undefined);
  const workerVideoConcurrency =
    overrides.workerVideoConcurrency ??
    (source.CUCUMBER_WORKER_VIDEO_CONCURRENCY
      ? Number.parseInt(source.CUCUMBER_WORKER_VIDEO_CONCURRENCY, 10)
      : undefined);
  const workerId =
    overrides.workerId ?? normalizeOptionalString(source.CUCUMBER_WORKER_ID);
  const workerPollIntervalMs =
    overrides.workerPollIntervalMs ??
    (source.CUCUMBER_WORKER_POLL_INTERVAL_MS
      ? Number.parseInt(source.CUCUMBER_WORKER_POLL_INTERVAL_MS, 10)
      : undefined);
  const workerMaxBatchSize =
    overrides.workerMaxBatchSize ??
    (source.CUCUMBER_WORKER_MAX_BATCH_SIZE
      ? Number.parseInt(source.CUCUMBER_WORKER_MAX_BATCH_SIZE, 10)
      : undefined);

  // Resolve default agent model based on available provider keys.
  // Explicit CUCUMBER_AGENT_MODEL always takes precedence; otherwise fall back
  // based on configured providers.
  const explicitModel =
    overrides.agentModel ?? parseAgentModel(source.CUCUMBER_AGENT_MODEL);
  const resolvedAgentModel =
    explicitModel ??
    resolveDefaultAgentModel({
      ...(deepseekApiKey ? { deepseekApiKey } : {}),
      ...(googleApiKey ? { googleApiKey } : {}),
      ...(googleVertexProject ? { googleVertexProject } : {}),
      ...(openAIApiKey ? { openAIApiKey } : {}),
    });

  return {
    agentBackendMode:
      overrides.agentBackendMode ??
      parseAgentBackendMode(source.CUCUMBER_AGENT_BACKEND_MODE),
    agentModel: resolvedAgentModel,
    port:
      overrides.port ?? parsePort(source.CUCUMBER_SERVER_PORT ?? source.PORT),
    version: overrides.version ?? readServerVersion(),
    webOrigin:
      overrides.webOrigin ?? source.CUCUMBER_WEB_ORIGIN ?? DEFAULT_WEB_ORIGIN,
    ...(agentFilesRoot ? { agentFilesRoot } : {}),
    ...(googleApiKey ? { googleApiKey } : {}),
    ...(googleApplicationCredentials ? { googleApplicationCredentials } : {}),
    ...(openAIApiBase ? { openAIApiBase } : {}),
    ...(openAIApiKey ? { openAIApiKey } : {}),
    ...(supabaseUrl ? { supabaseUrl } : {}),
    ...(supabaseAnonKey ? { supabaseAnonKey } : {}),
    ...(supabaseDbUrl ? { supabaseDbUrl } : {}),
    ...(supabaseJwtSecret ? { supabaseJwtSecret } : {}),
    ...(supabaseServiceRoleKey ? { supabaseServiceRoleKey } : {}),
    ...(supabaseProjectId ? { supabaseProjectId } : {}),
    ...(deepseekApiBase ? { deepseekApiBase } : {}),
    ...(deepseekApiKey ? { deepseekApiKey } : {}),
    ...(googleFontsApiKey ? { googleFontsApiKey } : {}),
    ...(googleVertexProject ? { googleVertexProject } : {}),
    ...(googleVertexLocation ? { googleVertexLocation } : {}),
    ...(seedreamAccessKeyId ? { seedreamAccessKeyId } : {}),
    ...(seedreamSecretAccessKey ? { seedreamSecretAccessKey } : {}),
    seedreamReqKey,
    ...(seedreamVideoReqKey ? { seedreamVideoReqKey } : {}),
    seedreamHost,
    seedreamRegion,
    seedreamService,
    seedreamVersion,
    ...(skillsRoot ? { skillsRoot } : {}),
    ...(workerConcurrency ? { workerConcurrency } : {}),
    ...(workerImageConcurrency ? { workerImageConcurrency } : {}),
    ...(workerVideoConcurrency ? { workerVideoConcurrency } : {}),
    ...(workerId ? { workerId } : {}),
    ...(workerPollIntervalMs ? { workerPollIntervalMs } : {}),
    ...(workerMaxBatchSize ? { workerMaxBatchSize } : {}),
  };
}

function parseAgentBackendMode(rawMode: string | undefined): AgentBackendMode {
  if (!rawMode) {
    return DEFAULT_AGENT_BACKEND_MODE;
  }

  if (rawMode === "state" || rawMode === "filesystem") {
    return rawMode;
  }

  throw new Error(`Invalid CUCUMBER_AGENT_BACKEND_MODE value: ${rawMode}`);
}

function parseAgentFilesRoot(rawRoot: string | undefined) {
  return normalizeOptionalString(rawRoot);
}

function parseAgentModel(rawModel: string | undefined) {
  return normalizeOptionalString(rawModel);
}

function normalizeOptionalString(value: string | undefined) {
  const normalizedValue = value?.trim();
  return normalizedValue || undefined;
}

function parsePort(rawPort: string | undefined) {
  if (!rawPort) {
    return DEFAULT_SERVER_PORT;
  }

  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid CUCUMBER_SERVER_PORT value: ${rawPort}`);
  }

  return port;
}

function readServerVersion() {
  const packageJson = readFileSync(
    new URL("../../package.json", import.meta.url),
    "utf8",
  );

  const parsed = JSON.parse(packageJson) as { version?: string };
  return parsed.version ?? "0.0.0";
}
