import type { BackendFactory, BackendProtocol } from "deepagents";

import type {
  PersistImageFn,
  SubmitImageJobFn,
} from "../agent/tools/image-generate.js";
import type { SubmitVideoJobFn } from "../agent/tools/video-generate.js";
import type { LiveCanvasService } from "../features/canvas/live-canvas-service.js";
import type { UserSupabaseClient } from "../supabase/user.js";
import type { ConnectionManager } from "../ws/connection-manager.js";
import { createGenerateImageMcpTool } from "./tools/generate-image.js";
import { createGenerateVideoMcpTool } from "./tools/generate-video.js";
import { createInspectCanvasMcpTool } from "./tools/inspect-canvas.js";
import { createManipulateCanvasMcpTool } from "./tools/manipulate-canvas.js";
import { createOpenPencilCanvasMcpTools } from "./tools/open-pencil-canvas.js";
import { createPersistSandboxFileMcpTool } from "./tools/persist-sandbox-file.js";
import { createProjectSearchMcpTool } from "./tools/project-search.js";
import type {
  CucumberMcpTool,
  McpListedTool,
  McpToolCallResult,
  McpToolContext,
} from "./types.js";

export type CreateCucumberMcpServerDeps = {
  createUserClient: (accessToken: string) => unknown;
  brandKitId?: string | null;
  connectionManager?: ConnectionManager;
  liveCanvasService?: LiveCanvasService;
  persistImage?: PersistImageFn;
  sandboxDir?: string;
  submitImageJob?: SubmitImageJobFn;
  submitVideoJob?: SubmitVideoJobFn;
};

export type CucumberMcpServer = {
  callTool: (
    name: string,
    args: unknown,
    context?: McpToolContext,
  ) => Promise<McpToolCallResult>;
  getTool: (name: string) => CucumberMcpTool | undefined;
  getTools: () => CucumberMcpTool[];
  listTools: () => McpListedTool[];
};

export function createCucumberMcpServer(
  backend: BackendProtocol | BackendFactory,
  deps: CreateCucumberMcpServerDeps,
): CucumberMcpServer {
  const createUserClient = deps.createUserClient as (
    accessToken: string,
  ) => UserSupabaseClient;
  return createInMemoryMcpServer([
    createProjectSearchMcpTool(backend),
    createInspectCanvasMcpTool({ createUserClient }),
    createManipulateCanvasMcpTool({
      createUserClient,
      ...(deps.liveCanvasService
        ? { liveCanvasService: deps.liveCanvasService }
        : {}),
    }),
    ...createOpenPencilCanvasMcpTools({
      ...(deps.liveCanvasService
        ? { liveCanvasService: deps.liveCanvasService }
        : {}),
    }),
    createGenerateImageMcpTool({
      ...(deps.persistImage ? { persistImage: deps.persistImage } : {}),
      ...(deps.submitImageJob ? { submitImageJob: deps.submitImageJob } : {}),
    }),
    createGenerateVideoMcpTool({
      ...(deps.submitVideoJob ? { submitVideoJob: deps.submitVideoJob } : {}),
    }),
    createPersistSandboxFileMcpTool({
      createUserClient,
      ...(deps.sandboxDir ? { sandboxDir: deps.sandboxDir } : {}),
    }),
  ]);
}

export function createInMemoryMcpServer(
  tools: CucumberMcpTool[],
): CucumberMcpServer {
  const toolMap = new Map(tools.map((toolDef) => [toolDef.name, toolDef]));

  return {
    async callTool(name, args, context = {}) {
      const toolDef = toolMap.get(name);
      if (!toolDef) {
        return {
          content: [{ type: "text", text: `Tool not found: ${name}` }],
          isError: true,
          structuredContent: {
            error: "tool_not_found",
            message: `Tool not found: ${name}`,
          },
        };
      }

      const t0 = Date.now();
      console.log(`[mcp] tool.start ${name}`);
      try {
        const result = await toolDef.execute(args, context);
        console.log(`[mcp] tool.done ${name} +${Date.now() - t0}ms`);
        return result;
      } catch (error) {
        console.error(`[mcp] tool.failed ${name} +${Date.now() - t0}ms`, error);
        throw error;
      }
    },
    getTool(name) {
      return toolMap.get(name);
    },
    getTools() {
      return tools;
    },
    listTools() {
      return tools.map((toolDef) => ({
        description: toolDef.description,
        inputSchema: toolDef.inputSchema,
        name: toolDef.name,
      }));
    },
  };
}
