import { z } from "zod";

import type { CucumberMcpTool } from "../types.js";
import { schemaToJsonSchema } from "../utils.js";
import { queryCanvasAssets } from "./ai-native-canvas-assets.js";
import {
  type AiNativeCanvasToolDeps,
  errorResult,
  jsonResult,
  readAiNativeCanvasLiveContext,
} from "./ai-native-canvas-context.js";

const TOOL_NAME = "query_canvas_assets";

const queryCanvasAssetsSchema = z.object({
  type: z.enum(["image", "video", "all"]).default("all"),
  source: z.enum(["upload", "generated", "canvas-ref"]).optional(),
  referencedOnly: z.boolean().default(false),
  nodeIds: z.array(z.string()).optional(),
  pageId: z.string().optional(),
});

export function createQueryCanvasAssetsMcpTool(
  deps: AiNativeCanvasToolDeps,
): CucumberMcpTool<typeof queryCanvasAssetsSchema> {
  return {
    name: TOOL_NAME,
    description:
      "Query live Cucumber canvas assets from PenDocument.assets and node references. Returns asset metadata, referenced node IDs, concrete node field references, and missing asset references without mutating the canvas.",
    schema: queryCanvasAssetsSchema,
    inputSchema: schemaToJsonSchema(queryCanvasAssetsSchema),
    execute: async (args, context) => {
      try {
        const input = queryCanvasAssetsSchema.parse(args);
        const live = await readAiNativeCanvasLiveContext(
          deps,
          context,
          TOOL_NAME,
        );
        const result = queryCanvasAssets({
          doc: live.doc,
          ...(input.nodeIds ? { nodeIds: input.nodeIds } : {}),
          ...(input.pageId ? { pageId: input.pageId } : {}),
          referencedOnly: input.referencedOnly,
          ...(input.source ? { source: input.source } : {}),
          type: input.type,
        });
        console.info("[ai-native-canvas] assets.query", {
          assetCount: result.assets.length,
          canvasId: live.canvasId,
          missingReferenceCount: result.missingAssetReferences.length,
          pageId: input.pageId ?? live.doc.activePageId,
          referencedNodeCount: result.referencedNodeIds.length,
          userId: live.user.id,
        });
        return jsonResult({
          canvasId: live.canvasId,
          summary: `Found ${result.assets.length} canvas asset(s) and ${result.missingAssetReferences.length} missing asset reference(s).`,
          ...result,
        });
      } catch (error) {
        const payload = {
          error:
            error instanceof Error && "code" in error
              ? String((error as { code: unknown }).code)
              : "query_canvas_assets_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to query canvas assets.",
        };
        console.warn("[ai-native-canvas] assets.query failed", payload);
        return errorResult(payload);
      }
    },
  };
}
