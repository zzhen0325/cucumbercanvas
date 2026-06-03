import { z } from "zod";

import type { CucumberMcpTool } from "../types.js";
import { schemaToJsonSchema } from "../utils.js";
import {
  type AiNativeCanvasToolDeps,
  errorResult,
  jsonResult,
  readAiNativeCanvasLiveContext,
} from "./ai-native-canvas-context.js";
import {
  type CanvasValidationCheck,
  validateCanvasDocument,
} from "./ai-native-canvas-validation.js";

const TOOL_NAME = "validate_canvas";

const validationCheckSchema = z.enum([
  "structure",
  "assets",
  "variables",
  "connectors",
  "text_overflow",
  "component_refs",
  "agent_output_visibility",
]);

const validateCanvasSchema = z.object({
  pageId: z.string().optional(),
  nodeIds: z.array(z.string()).optional(),
  checks: z.array(validationCheckSchema).optional(),
  severityThreshold: z.enum(["info", "warning", "error"]).default("info"),
});

export function createValidateCanvasMcpTool(
  deps: AiNativeCanvasToolDeps,
): CucumberMcpTool<typeof validateCanvasSchema> {
  return {
    name: TOOL_NAME,
    description:
      "Validate the live Cucumber canvas with deterministic structural checks. Detects invalid page/node structure, missing assets, missing variables, dangling connectors, likely fixed-text overflow, invalid component refs, and hidden/locked Agent output.",
    schema: validateCanvasSchema,
    inputSchema: schemaToJsonSchema(validateCanvasSchema),
    execute: async (args, context) => {
      try {
        const input = validateCanvasSchema.parse(args);
        const live = await readAiNativeCanvasLiveContext(
          deps,
          context,
          TOOL_NAME,
        );
        const result = validateCanvasDocument({
          checks: input.checks as CanvasValidationCheck[] | undefined,
          doc: live.doc,
          ...(input.nodeIds ? { nodeIds: input.nodeIds } : {}),
          ...(input.pageId ? { pageId: input.pageId } : {}),
          severityThreshold: input.severityThreshold,
        });
        console.info("[ai-native-canvas] validate", {
          canvasId: live.canvasId,
          checkedNodeCount: result.checkedNodeIds.length,
          errorCount: result.issueCounts.error,
          pageId: input.pageId ?? live.doc.activePageId,
          pass: result.pass,
          userId: live.user.id,
          warningCount: result.issueCounts.warning,
        });
        return jsonResult({
          canvasId: live.canvasId,
          summary: result.pass
            ? `Canvas validation passed for ${result.checkedNodeIds.length} node(s).`
            : `Canvas validation found ${result.issues.length} issue(s).`,
          ...result,
        });
      } catch (error) {
        const payload = {
          error:
            error instanceof Error && "code" in error
              ? String((error as { code: unknown }).code)
              : "validate_canvas_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to validate the live canvas.",
        };
        console.warn("[ai-native-canvas] validate failed", payload);
        return errorResult(payload);
      }
    },
  };
}
