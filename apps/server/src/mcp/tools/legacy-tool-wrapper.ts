import type { StructuredTool } from "@langchain/core/tools";

import type { CucumberMcpTool } from "../types.js";
import {
  buildLegacyToolInvokeConfig,
  normalizeLegacyToolOutput,
  schemaToJsonSchema,
} from "../utils.js";

export function wrapLegacyStructuredToolAsMcpTool(
  legacyTool: StructuredTool,
): CucumberMcpTool {
  return {
    name: legacyTool.name,
    description: legacyTool.description,
    schema: legacyTool.schema,
    inputSchema: schemaToJsonSchema(legacyTool.schema),
    execute: async (args, context) => {
      const output = await legacyTool.invoke(
        args,
        buildLegacyToolInvokeConfig(context) as never,
      );
      return normalizeLegacyToolOutput(output);
    },
  };
}
