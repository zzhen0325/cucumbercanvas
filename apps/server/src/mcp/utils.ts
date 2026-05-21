import type { ToolRuntime } from "@langchain/core/tools";
import { z, type ZodTypeAny } from "zod";

import type { McpToolCallResult, McpToolContext } from "./types.js";

type ZodNamespaceWithJsonSchema = typeof z & {
  toJSONSchema?: (schema: ZodTypeAny) => unknown;
};

export function schemaToJsonSchema(schema: unknown): Record<string, unknown> {
  const schemaWithMethod = schema as {
    toJSONSchema?: () => unknown;
  };
  if (typeof schemaWithMethod.toJSONSchema === "function") {
    const jsonSchema = schemaWithMethod.toJSONSchema();
    if (jsonSchema && typeof jsonSchema === "object") {
      return jsonSchema as Record<string, unknown>;
    }
  }

  const converter = (z as ZodNamespaceWithJsonSchema).toJSONSchema;
  if (typeof converter === "function") {
    try {
      const jsonSchema = converter(schema as ZodTypeAny);
      if (jsonSchema && typeof jsonSchema === "object") {
        return jsonSchema as Record<string, unknown>;
      }
    } catch {
      // Fall back below for non-Zod schema implementations.
    }
  }

  return {
    type: "object",
    additionalProperties: false,
  };
}

export function resolveMcpToolContext(runtime?: ToolRuntime): McpToolContext {
  const configurable =
    runtime && typeof runtime === "object" && "configurable" in runtime
      ? ((runtime as { configurable?: Record<string, unknown> }).configurable ??
        undefined)
      : undefined;

  return {
    ...(configurable ? { configurable } : {}),
    ...(runtime ? { runtime } : {}),
  };
}

export function normalizeLegacyToolOutput(output: unknown): McpToolCallResult {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const structuredContent = output as Record<string, unknown>;
    return {
      content: [
        {
          type: "text",
          text:
            typeof structuredContent.summary === "string"
              ? structuredContent.summary
              : JSON.stringify(structuredContent),
        },
      ],
      structuredContent,
    };
  }

  if (typeof output === "string") {
    const structuredContent = tryParseJsonRecord(output);
    return {
      content: [{ type: "text", text: output }],
      ...(structuredContent ? { structuredContent } : {}),
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(output ?? null),
      },
    ],
  };
}

export function unwrapMcpToolResult(result: McpToolCallResult): unknown {
  if (result.structuredContent) {
    return result.structuredContent;
  }

  const text = result.content.find((part) => part.type === "text")?.text;
  return text ?? "";
}

export function buildLegacyToolInvokeConfig(context: McpToolContext) {
  return {
    ...(context.runtime ? { state: context.runtime.state } : {}),
    ...(context.configurable ? { configurable: context.configurable } : {}),
  };
}

function tryParseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore non-JSON strings.
  }

  return null;
}
