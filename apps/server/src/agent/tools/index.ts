import type { StructuredTool } from "@langchain/core/tools";
import type { BackendFactory, BackendProtocol } from "deepagents";

import type { LiveCanvasService } from "../../features/canvas/live-canvas-service.js";
import { bridgeMcpServerToolsToDeepAgent } from "../../mcp/deepagents-bridge.js";
import { createCucumberMcpServer } from "../../mcp/server.js";
import type { UserSupabaseClient } from "../../supabase/user.js";
import type { ConnectionManager } from "../../ws/connection-manager.js";
import type { CanvasEventBuffer } from "../../ws/event-buffer.js";
import { createBrandKitTool } from "./brand-kit.js";
import {
  type PersistImageFn,
  type SubmitImageJobFn,
  createImageGenerateTool,
} from "./image-generate.js";
import { createProjectSearchTool } from "./project-search.js";
import {
  type SubmitVideoJobFn,
  createVideoGenerateTool,
} from "./video-generate.js";

export { createImageGenerateTool } from "./image-generate.js";
export { createVideoGenerateTool } from "./video-generate.js";
export { createInspectCanvasTool } from "./inspect-canvas.js";
export { createManipulateCanvasTool } from "./manipulate-canvas.js";

// ---------------------------------------------------------------------------
// deepagents 内置工具参考 (由 FilesystemMiddleware 自动注入)
// ---------------------------------------------------------------------------
//
// deepagents@1.8.4 通过 createFilesystemMiddleware 自动注入以下工具，
// 我们自定义的工具名称不能与这些冲突：
//
//   ls          — 列出目录内容
//   read_file   — 读取文件内容（支持 offset/limit）
//   write_file  — 写入文件
//   edit_file   — 编辑文件（find & replace）
//   glob        — 按模式匹配文件路径
//   grep        — 按正则搜索文件内容
//   execute     — 执行 shell 命令（仅 SandboxBackendProtocol 时可用）
//   task        — 分发子任务到 subagent
//   write_todos — 管理 TODO 列表
//
// 我们使用 LocalShellBackend 作为 CompositeBackend 的 default backend，
// 它实现了 SandboxBackendProtocol，因此 execute 工具自动可用。
// 代码执行无需额外自定义工具。
//
// CompositeBackend 路由互不干扰：
//   /workspace/  → StoreBackend (PostgresStore) — 文件持久化
//   /memories/   → StoreBackend (PostgresStore) — agent 记忆
//   /skills/     → FilesystemBackend            — 系统 skills
//   default      → LocalShellBackend            — execute + 临时文件
// ---------------------------------------------------------------------------

export function createMainAgentTools(
  backend: BackendProtocol | BackendFactory,
  deps: {
    createUserClient: (accessToken: string) => UserSupabaseClient;
    brandKitId?: string | null;
    connectionManager?: ConnectionManager;
    eventBuffer?: CanvasEventBuffer;
    liveCanvasService?: LiveCanvasService;
    persistImage?: PersistImageFn;
    sandboxDir?: string;
    submitImageJob?: SubmitImageJobFn;
    submitVideoJob?: SubmitVideoJobFn;
  },
) {
  const mcpServer = createCucumberMcpServer(backend, deps);
  const tools: StructuredTool[] = [
    ...bridgeMcpServerToolsToDeepAgent(mcpServer),
    // execute 工具由 deepagents FilesystemMiddleware 自动注入，
    // 因为 CompositeBackend 的 default backend 是 LocalShellBackend。
    // 不需要在这里手动注册。
    // screenshot_canvas 只通过 MCP bridge 注册。旧的直接工具注册会产生
    // 同名双实例，触发 LangChain wrapModelCall 工具一致性校验。
  ];
  if (deps.brandKitId) {
    tools.push(createBrandKitTool(deps, deps.brandKitId));
  }
  return tools;
}

/** @deprecated Use createMainAgentTools + sub-agents instead */
export function createPhaseATools(backend: BackendProtocol | BackendFactory) {
  return [
    createProjectSearchTool(backend),
    createImageGenerateTool(),
    createVideoGenerateTool(),
  ] as const;
}
