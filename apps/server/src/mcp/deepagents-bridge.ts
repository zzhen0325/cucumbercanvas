import type { StructuredTool, ToolRuntime } from "@langchain/core/tools";
import { tool } from "langchain";

import type { CucumberMcpServer } from "./server.js";
import type { CucumberMcpTool } from "./types.js";
import { resolveMcpToolContext, unwrapMcpToolResult } from "./utils.js";

export function bridgeMcpServerToolsToDeepAgent(
  server: CucumberMcpServer,
): StructuredTool[] {
  return server
    .getTools()
    .map((toolDef) =>
      bridgeSingleMcpToolToDeepAgent(toolDef, async (args, runtime) =>
        server.callTool(toolDef.name, args, resolveMcpToolContext(runtime)),
      ),
    );
}

export function bridgeMcpToolToDeepAgent(
  toolDef: CucumberMcpTool,
): StructuredTool {
  return bridgeSingleMcpToolToDeepAgent(toolDef, async (args, runtime) =>
    toolDef.execute(args, resolveMcpToolContext(runtime)),
  );
}

function bridgeSingleMcpToolToDeepAgent(
  toolDef: CucumberMcpTool,
  invoke: (args: unknown, runtime: ToolRuntime) => Promise<unknown>,
): StructuredTool {
  return tool(
    async (input, runtime: ToolRuntime) => {
      const result = await invoke(input, runtime);
      return unwrapMcpToolResult(result as never);
    },
    {
      name: toolDef.name,
      description: toolDef.description,
      schema: toolDef.schema,
    },
  ) as unknown as StructuredTool;
}
