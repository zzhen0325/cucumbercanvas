import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { ChatDeepSeek, type ChatDeepSeekInput } from "@langchain/deepseek";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatVertexAI } from "@langchain/google-vertexai";
import type {
  BaseCheckpointSaver,
  BaseStore,
} from "@langchain/langgraph-checkpoint";
import { createDeepAgent } from "deepagents";

import {
  DEFAULT_AGENT_MODEL,
  DEFAULT_DEEPSEEK_AGENT_MODEL,
  DEFAULT_GOOGLE_AGENT_MODEL,
  type ServerEnv,
} from "../config/env.js";
import type { ConnectionManager } from "../ws/connection-manager.js";
import type { LiveCanvasService } from "../features/canvas/live-canvas-service.js";
import {
  type AgentBackendResult,
  createAgentBackend,
} from "./backends/index.js";
import { CUCUMBER_SYSTEM_PROMPT } from "./prompts/cucumber-main.js";
import { createReasoningContentChatDeepSeek } from "./reasoning-content-deepseek.js";
import { createReasoningContentChatOpenAI } from "./reasoning-content-openai.js";
import { createVideoSubAgent } from "./sub-agents.js";
import type {
  PersistImageFn,
  SubmitImageJobFn,
} from "./tools/image-generate.js";
import { createMainAgentTools } from "./tools/index.js";
import type { SubmitVideoJobFn } from "./tools/video-generate.js";
import type { WorkspaceSkillEntry } from "./workspace-skills.js";

export type CucumberAgent = Pick<
  ReturnType<typeof createDeepAgent>,
  "stream" | "streamEvents"
>;

export type CucumberAgentFactory = (options: {
  backendResult?: AgentBackendResult;
  brandKitId?: string | null;
  canvasId?: string;
  checkpointer?: BaseCheckpointSaver;
  connectionManager?: ConnectionManager;
  createUserClient?: (accessToken: string) => any;
  env: ServerEnv;
  liveCanvasService?: LiveCanvasService;
  model?: BaseLanguageModel | string;
  persistImage?: PersistImageFn;

  submitImageJob?: SubmitImageJobFn;
  submitVideoJob?: SubmitVideoJobFn;
  store?: BaseStore;
  workspaceSkills?: WorkspaceSkillEntry[];
}) => CucumberAgent;

export function createCucumberDeepAgent(options: {
  backendResult?: AgentBackendResult;
  brandKitId?: string | null;
  canvasId?: string;
  checkpointer?: BaseCheckpointSaver;
  connectionManager?: ConnectionManager;
  createUserClient?: (accessToken: string) => any;
  env: ServerEnv;
  liveCanvasService?: LiveCanvasService;
  model?: BaseLanguageModel | string;
  persistImage?: PersistImageFn;

  submitImageJob?: SubmitImageJobFn;
  submitVideoJob?: SubmitVideoJobFn;
  store?: BaseStore;
  workspaceSkills?: WorkspaceSkillEntry[];
}): CucumberAgent {
  const backendResult =
    options.backendResult ?? createAgentBackend(options.env, options.canvasId);

  applyProviderCompatEnv(options.env);

  const modelSpec = options.model ?? createDefaultModelSpecifier(options.env);
  const resolvedModel =
    typeof modelSpec === "string"
      ? createStreamingChatModel(modelSpec)
      : modelSpec;

  const createUserClient =
    options.createUserClient ??
    ((_accessToken: string): never => {
      throw new Error(
        "inspect_canvas is unavailable: no createUserClient was provided to createCucumberDeepAgent.",
      );
    });

  let systemPrompt = options.brandKitId
    ? `${CUCUMBER_SYSTEM_PROMPT}\n\n当前项目已绑定品牌套件。在进行设计相关工作时，请先使用 get_brand_kit 工具查询品牌信息，确保设计符合品牌规范。`
    : CUCUMBER_SYSTEM_PROMPT;

  // Inject enabled skills (both system and user-created) into the system prompt.
  // All skills are loaded from the database via loadWorkspaceSkills() in runtime.ts.
  const wsSkills = options.workspaceSkills ?? [];
  if (wsSkills.length > 0) {
    const skillsList = wsSkills
      .map((s) => {
        let line = `- **${s.name}**: ${s.description}\n  → Read \`${s.path}\` for full instructions`;
        if (s.files.length > 0) {
          const counts: Record<string, number> = {};
          for (const f of s.files) {
            const dir = f.path.split("/")[0] ?? "other";
            counts[dir] = (counts[dir] ?? 0) + 1;
          }
          const summary = Object.entries(counts)
            .map(([dir, n]) => `${dir}/ (${n})`)
            .join(", ");
          line += `\n  → Has: ${summary}`;
        }
        return line;
      })
      .join("\n");
    systemPrompt += `\n\n## Skills\n\nThe following skills are enabled in this workspace:\n${skillsList}`;
  }

  return createDeepAgent({
    backend: backendResult.factory as any,
    ...(options.checkpointer ? { checkpointer: options.checkpointer } : {}),
    model: resolvedModel,
    name: "cucumber",
    ...(options.store ? { store: options.store } : {}),
    subagents: [createVideoSubAgent()],
    systemPrompt,
    tools: createMainAgentTools(backendResult.factory, {
      createUserClient,
      ...(options.brandKitId != null ? { brandKitId: options.brandKitId } : {}),
      ...(options.connectionManager
        ? { connectionManager: options.connectionManager }
        : {}),
      ...(options.liveCanvasService
        ? { liveCanvasService: options.liveCanvasService }
        : {}),
      ...(options.persistImage ? { persistImage: options.persistImage } : {}),
      ...(backendResult.sandboxDir
        ? { sandboxDir: backendResult.sandboxDir }
        : {}),

      ...(options.submitImageJob
        ? { submitImageJob: options.submitImageJob }
        : {}),
      ...(options.submitVideoJob
        ? { submitVideoJob: options.submitVideoJob }
        : {}),
    }),
  });
}

/**
 * Create a streaming chat model from a `<provider>:<model-id>` specifier.
 *
 * Supported providers:
 * - `openai` (default) — uses ChatOpenAI with `streamUsage: false` to work
 *   around the one-api proxy stripping `delta.role` from chunks.
 * - `google` — uses ChatGoogleGenerativeAI (Google AI Studio, API Key) or
 *   ChatVertexAI (Vertex AI, service account) depending on available config.
 * - `deepseek` — uses ChatDeepSeek with streaming enabled.
 */
function createStreamingChatModel(specifier: string): BaseLanguageModel {
  const colonIdx = specifier.indexOf(":");
  let provider = colonIdx > 0 ? specifier.slice(0, colonIdx) : "openai";
  let modelName = colonIdx > 0 ? specifier.slice(colonIdx + 1) : specifier;

  const hasGoogleApiKey = !!process.env.GOOGLE_API_KEY;
  const hasVertexAI = !!(
    process.env.GOOGLE_VERTEX_PROJECT && process.env.GOOGLE_VERTEX_LOCATION
  );
  const hasGoogle = hasGoogleApiKey || hasVertexAI;
  const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  // Provider availability fallback
  if (provider === "google" && !hasGoogle) {
    console.warn(
      `[model] Google unavailable (no CUCUMBER_GOOGLE_API_KEY or Vertex AI config), falling back to OpenAI for: ${specifier}`,
    );
    provider = "openai";
    modelName = DEFAULT_AGENT_MODEL;
  }
  if (provider === "deepseek" && !hasDeepSeek) {
    console.warn(
      `[model] DeepSeek unavailable (no CUCUMBER_DEEPSEEK_API_KEY), falling back to OpenAI for: ${specifier}`,
    );
    provider = "openai";
    modelName = DEFAULT_AGENT_MODEL;
  }
  if (provider === "openai" && !hasOpenAI) {
    if (hasGoogle) {
      console.warn(
        `[model] OpenAI unavailable (no CUCUMBER_OPENAI_API_KEY), falling back to Google for: ${specifier}`,
      );
      provider = "google";
      modelName = DEFAULT_GOOGLE_AGENT_MODEL;
    } else if (hasDeepSeek) {
      console.warn(
        `[model] OpenAI unavailable (no CUCUMBER_OPENAI_API_KEY), falling back to DeepSeek for: ${specifier}`,
      );
      provider = "deepseek";
      modelName = DEFAULT_DEEPSEEK_AGENT_MODEL;
    }
  }

  switch (provider) {
    case "google":
      // Prefer Vertex AI (service account) when configured; fall back to Developer API key
      if (hasVertexAI) {
        const vertexProject = process.env.GOOGLE_VERTEX_PROJECT!;
        const vertexLocation = process.env.GOOGLE_VERTEX_LOCATION!;
        console.log(
          `[model] Using Vertex AI for: ${modelName} (project=${vertexProject}, location=${vertexLocation})`,
        );
        return new ChatVertexAI({
          model: modelName,
          location: vertexLocation,
          authOptions: { projectId: vertexProject },
          streaming: true,
        });
      }
      return new ChatGoogleGenerativeAI({
        model: modelName,
        apiKey: process.env.GOOGLE_API_KEY!,
        streaming: true,
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: -1, // dynamic — let the model decide
        },
      });
    case "deepseek": {
      const deepseekConfig: Record<string, unknown> = {
        model: modelName,
        apiKey: process.env.DEEPSEEK_API_KEY!,
        streaming: true,
        // Disable DeepSeek thinking mode to avoid reasoning_content round-trip
        // failures during multi-turn agent/tool loops.
        extra_body: {
          thinking: {
            type: "disabled",
          },
        },
      };
      if (process.env.DEEPSEEK_API_BASE) {
        deepseekConfig.configuration = {
          baseURL: process.env.DEEPSEEK_API_BASE,
        };
      }
      return createReasoningContentChatDeepSeek(
        deepseekConfig as ChatDeepSeekInput,
      );
    }
    default:
      return createReasoningContentChatOpenAI({
        model: modelName,
        streaming: true,
        streamUsage: false,
      });
  }
}

/** Known model-name prefixes that map to Google Gemini. */
const GOOGLE_MODEL_PREFIXES = ["gemini-"];
/** Known model-name prefixes that map to DeepSeek. */
const DEEPSEEK_MODEL_PREFIXES = ["deepseek-"];

export function createDefaultModelSpecifier(
  env: Pick<ServerEnv, "agentModel">,
) {
  const model = env.agentModel;
  // Already has an explicit provider prefix — pass through as-is.
  if (model.includes(":")) return model;
  // Auto-detect Google models by name prefix.
  if (GOOGLE_MODEL_PREFIXES.some((p) => model.startsWith(p)))
    return `google:${model}`;
  // Auto-detect DeepSeek models by name prefix.
  if (DEEPSEEK_MODEL_PREFIXES.some((p) => model.startsWith(p)))
    return `deepseek:${model}`;
  return `openai:${model}`;
}

export function applyProviderCompatEnv(
  env: Pick<
    ServerEnv,
    | "deepseekApiBase"
    | "deepseekApiKey"
    | "googleApiKey"
    | "googleApplicationCredentials"
    | "googleVertexLocation"
    | "googleVertexProject"
    | "openAIApiBase"
    | "openAIApiKey"
  >,
  target: NodeJS.ProcessEnv = process.env,
) {
  if (env.openAIApiKey) {
    target.OPENAI_API_KEY = env.openAIApiKey;
  }

  if (env.openAIApiBase) {
    target.OPENAI_BASE_URL = env.openAIApiBase;
  }

  if (env.googleApiKey) {
    target.GOOGLE_API_KEY = env.googleApiKey;
  }

  if (env.googleApplicationCredentials) {
    target.GOOGLE_APPLICATION_CREDENTIALS = env.googleApplicationCredentials;
  }

  if (env.googleVertexProject) {
    target.GOOGLE_VERTEX_PROJECT = env.googleVertexProject;
  }

  if (env.googleVertexLocation) {
    target.GOOGLE_VERTEX_LOCATION = env.googleVertexLocation;
  }

  if (env.deepseekApiKey) {
    target.DEEPSEEK_API_KEY = env.deepseekApiKey;
  }

  if (env.deepseekApiBase) {
    target.DEEPSEEK_API_BASE = env.deepseekApiBase;
  }
}
