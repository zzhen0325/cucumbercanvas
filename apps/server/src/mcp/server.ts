import type { BackendFactory, BackendProtocol } from "deepagents";

import type {
  PersistImageFn,
  SubmitImageJobFn,
} from "../agent/tools/image-generate.js";
import type { SubmitVideoJobFn } from "../agent/tools/video-generate.js";
import type { LiveCanvasService } from "../features/canvas/live-canvas-service.js";
import type { UserSupabaseClient } from "../supabase/user.js";
import type { ConnectionManager } from "../ws/connection-manager.js";
import type { CanvasEventBuffer } from "../ws/event-buffer.js";
import { createApplyCanvasTransactionMcpTool } from "./tools/apply-canvas-transaction.js";
import { createCanvasDiffPreviewMcpTool } from "./tools/canvas-diff-preview.js";
import { createCanvasMemoryIndexMcpTool } from "./tools/canvas-memory-index.js";
import { createCanvasRunTraceMcpTool } from "./tools/canvas-run-trace.js";
import { createConnectNodesMcpTool } from "./tools/connect-nodes.js";
import { createAgentOutputContainerMcpTool } from "./tools/create-agent-output-container.js";
import { createCritiqueCanvasMcpTool } from "./tools/critique-canvas.js";
import { createExportCanvasDeliverableMcpTool } from "./tools/export-canvas-deliverable.js";
import { createGenerateImageMcpTool } from "./tools/generate-image.js";
import { createGenerateVideoMcpTool } from "./tools/generate-video.js";
import { createGetSelectionContextMcpTool } from "./tools/get-selection-context.js";
import { createInspectCanvasSemanticMcpTool } from "./tools/inspect-canvas-semantic.js";
import { createInspectCanvasMcpTool } from "./tools/inspect-canvas.js";
import { createLayoutCanvasMcpTool } from "./tools/layout-canvas.js";
import { createManipulateCanvasMcpTool } from "./tools/manipulate-canvas.js";
import { createPersistSandboxFileMcpTool } from "./tools/persist-sandbox-file.js";
import { createProjectSearchMcpTool } from "./tools/project-search.js";
import { createQueryCanvasAssetsMcpTool } from "./tools/query-canvas-assets.js";
import { createReplaceAssetInNodeMcpTool } from "./tools/replace-asset-in-node.js";
import { createResizeContainerToFitMcpTool } from "./tools/resize-container-to-fit.js";
import { createScreenshotCanvasMcpTool } from "./tools/screenshot-canvas.js";
import { createStructuredCanvasMcpTools } from "./tools/structured-canvas.js";
import { createValidateCanvasMcpTool } from "./tools/validate-canvas.js";
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
  eventBuffer?: CanvasEventBuffer;
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
    createInspectCanvasMcpTool({
      createUserClient,
      ...(deps.liveCanvasService
        ? { liveCanvasService: deps.liveCanvasService }
        : {}),
    }),
    createInspectCanvasSemanticMcpTool({
      ...(deps.liveCanvasService
        ? { liveCanvasService: deps.liveCanvasService }
        : {}),
    }),
    createGetSelectionContextMcpTool({
      ...(deps.liveCanvasService
        ? { liveCanvasService: deps.liveCanvasService }
        : {}),
    }),
    createCanvasDiffPreviewMcpTool({
      ...(deps.liveCanvasService
        ? { liveCanvasService: deps.liveCanvasService }
        : {}),
    }),
    createApplyCanvasTransactionMcpTool({
      ...(deps.liveCanvasService
        ? { liveCanvasService: deps.liveCanvasService }
        : {}),
    }),
    createQueryCanvasAssetsMcpTool({
      ...(deps.liveCanvasService
        ? { liveCanvasService: deps.liveCanvasService }
        : {}),
    }),
    createReplaceAssetInNodeMcpTool({
      ...(deps.liveCanvasService
        ? { liveCanvasService: deps.liveCanvasService }
        : {}),
    }),
    createConnectNodesMcpTool({
      ...(deps.liveCanvasService
        ? { liveCanvasService: deps.liveCanvasService }
        : {}),
    }),
    createResizeContainerToFitMcpTool({
      ...(deps.liveCanvasService
        ? { liveCanvasService: deps.liveCanvasService }
        : {}),
    }),
    createAgentOutputContainerMcpTool({
      ...(deps.liveCanvasService
        ? { liveCanvasService: deps.liveCanvasService }
        : {}),
    }),
    createLayoutCanvasMcpTool({
      ...(deps.liveCanvasService
        ? { liveCanvasService: deps.liveCanvasService }
        : {}),
    }),
    createValidateCanvasMcpTool({
      ...(deps.liveCanvasService
        ? { liveCanvasService: deps.liveCanvasService }
        : {}),
    }),
    createCanvasMemoryIndexMcpTool({
      ...(deps.liveCanvasService
        ? { liveCanvasService: deps.liveCanvasService }
        : {}),
    }),
    createCritiqueCanvasMcpTool({
      ...(deps.liveCanvasService
        ? { liveCanvasService: deps.liveCanvasService }
        : {}),
    }),
    createExportCanvasDeliverableMcpTool({
      ...(deps.liveCanvasService
        ? { liveCanvasService: deps.liveCanvasService }
        : {}),
    }),
    createCanvasRunTraceMcpTool({
      ...(deps.eventBuffer ? { eventBuffer: deps.eventBuffer } : {}),
      ...(deps.liveCanvasService
        ? { liveCanvasService: deps.liveCanvasService }
        : {}),
    }),
    createScreenshotCanvasMcpTool({
      ...(deps.connectionManager
        ? { connectionManager: deps.connectionManager }
        : {}),
      ...(deps.persistImage ? { persistImage: deps.persistImage } : {}),
    }),
    createManipulateCanvasMcpTool({
      createUserClient,
      ...(deps.liveCanvasService
        ? { liveCanvasService: deps.liveCanvasService }
        : {}),
    }),
    ...createStructuredCanvasMcpTools({
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
