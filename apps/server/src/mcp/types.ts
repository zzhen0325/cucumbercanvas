import type { ToolRuntime, ToolSchemaBase } from "@langchain/core/tools";

export type McpToolTextContent = {
  type: "text";
  text: string;
};

export type McpToolCallResult = {
  content: McpToolTextContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export type McpToolContext = {
  configurable?: Record<string, unknown>;
  runtime?: ToolRuntime;
};

export type CucumberMcpTool<TSchema extends ToolSchemaBase = ToolSchemaBase> = {
  name: string;
  description: string;
  schema: TSchema;
  inputSchema: Record<string, unknown>;
  execute: (
    args: unknown,
    context: McpToolContext,
  ) => Promise<McpToolCallResult>;
};

export type McpListedTool = Pick<
  CucumberMcpTool,
  "description" | "inputSchema" | "name"
>;
