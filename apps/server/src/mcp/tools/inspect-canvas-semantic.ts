import { getActivePage, isContainerNode } from "@cucumber/canvas-core";
import { z } from "zod";

import type { CucumberMcpTool } from "../types.js";
import { schemaToJsonSchema } from "../utils.js";
import {
  type AiNativeCanvasToolDeps,
  type RuntimeCanvasDocument,
  compactRecord,
  errorResult,
  jsonResult,
  readAiNativeCanvasLiveContext,
} from "./ai-native-canvas-context.js";
import {
  type IndexedCanvasNode,
  type SemanticWarning,
  addVisibilityWarnings,
  collectAssetReferences,
  collectVariableSummary,
  indexCanvasNodes,
  shouldIncludeCanvasNode,
  summarizeCanvasContainer,
  summarizeCanvasNode,
  summarizeDataflowEdge,
  uniqueStrings,
} from "./ai-native-canvas-semantic-model.js";

const TOOL_NAME = "inspect_canvas_semantic";

const inspectCanvasSemanticSchema = z.object({
  pageId: z.string().optional(),
  includeHidden: z.boolean().default(false),
  includeLocked: z.boolean().default(true),
  includeAssets: z.boolean().default(true),
  includeVariables: z.boolean().default(false),
  includeRunMetadata: z.boolean().default(false),
  maxDepth: z.number().int().min(0).max(20).default(8),
  focusNodeIds: z.array(z.string()).default([]),
});

type InspectCanvasSemanticInput = z.infer<typeof inspectCanvasSemanticSchema>;

type SemanticInspectionResult = Record<string, unknown> & {
  document: {
    activePageId: string;
  };
  semanticContainers: Record<string, unknown>[];
  dataflowEdges: Record<string, unknown>[];
  warnings: SemanticWarning[];
};

export function createInspectCanvasSemanticMcpTool(
  deps: AiNativeCanvasToolDeps,
): CucumberMcpTool<typeof inspectCanvasSemanticSchema> {
  return {
    name: TOOL_NAME,
    description:
      "Read the live Cucumber canvas as semantic AI workspace context. Returns page summary, semantic containers, focus/selected nodes, connector dataflow edges, asset references, optional variables/themes, and warnings without mutating the canvas.",
    schema: inspectCanvasSemanticSchema,
    inputSchema: schemaToJsonSchema(inspectCanvasSemanticSchema),
    execute: async (args, context) => {
      try {
        const input = inspectCanvasSemanticSchema.parse(args);
        const live = await readAiNativeCanvasLiveContext(
          deps,
          context,
          TOOL_NAME,
        );
        const result = buildSemanticInspection(live.doc, input, live.canvasId);
        console.info("[ai-native-canvas] semantic.inspect", {
          canvasId: live.canvasId,
          containerCount: result.semanticContainers.length,
          dataflowEdgeCount: result.dataflowEdges.length,
          pageId: result.document.activePageId,
          userId: live.user.id,
          warningCount: result.warnings.length,
        });
        return jsonResult(result);
      } catch (error) {
        const payload = {
          error:
            error instanceof Error && "code" in error
              ? String((error as { code: unknown }).code)
              : "inspect_canvas_semantic_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to inspect the live canvas semantically.",
        };
        console.warn("[ai-native-canvas] semantic.inspect failed", payload);
        return errorResult(payload);
      }
    },
  };
}

function buildSemanticInspection(
  doc: RuntimeCanvasDocument,
  input: InspectCanvasSemanticInput,
  canvasId: string,
): SemanticInspectionResult {
  const page = getActivePage(doc, input.pageId);
  const indexedNodes = indexCanvasNodes(page.children);
  const visibleFilteredNodes = indexedNodes.filter((entry) =>
    shouldIncludeCanvasNode(entry.node, input),
  );
  const nodesById = new Map(
    indexedNodes.map((entry) => [entry.node.id, entry]),
  );
  const warnings: SemanticWarning[] = [];

  addVisibilityWarnings(indexedNodes, input, warnings);

  const selectedNodeIds = Array.isArray(doc.selection) ? doc.selection : [];
  const focusNodeIds = uniqueStrings([
    ...selectedNodeIds,
    ...input.focusNodeIds,
  ]);
  const focusNodes = buildFocusNodes(
    focusNodeIds,
    nodesById,
    doc,
    input.includeRunMetadata,
  );
  const missingFocusNodeIds = focusNodeIds.filter(
    (nodeId) => !nodesById.has(nodeId),
  );
  for (const nodeId of missingFocusNodeIds) {
    warnings.push({
      code: "focus_node_not_found",
      message: `Focus node ${nodeId} does not exist on page ${page.id}.`,
      nodeId,
    });
  }

  const semanticContainers = visibleFilteredNodes
    .filter((entry) => isContainerNode(entry.node))
    .filter((entry) => entry.depth <= input.maxDepth)
    .map((entry) =>
      summarizeCanvasContainer(entry, doc, input.includeRunMetadata),
    );
  const dataflowEdges = visibleFilteredNodes
    .filter(
      (entry) => entry.node.type === "line" && Boolean(entry.node.connector),
    )
    .map((entry) => summarizeDataflowEdge(entry, nodesById, warnings));
  const assetReferences = collectAssetReferences(
    visibleFilteredNodes,
    doc,
    warnings,
  );
  const variableSummary = input.includeVariables
    ? collectVariableSummary(visibleFilteredNodes, doc)
    : undefined;

  return compactRecord({
    canvasId,
    summary: `Inspected page ${page.name} with ${visibleFilteredNodes.length} semantic node(s), ${semanticContainers.length} container(s), and ${dataflowEdges.length} connector edge(s).`,
    document: {
      version: doc.version,
      pageCount: doc.pages?.length ?? 0,
      activePageId: page.id,
      activePageName: page.name,
      requestedPageId: input.pageId,
    },
    selectedNodeIds,
    focusNodes,
    missingFocusNodeIds,
    semanticContainers,
    dataflowEdges,
    assets: input.includeAssets
      ? {
          documentAssetCount: Object.keys(doc.assets ?? {}).length,
          references: assetReferences,
        }
      : undefined,
    variables: variableSummary,
    warnings,
  }) as SemanticInspectionResult;
}

function buildFocusNodes(
  focusNodeIds: string[],
  nodesById: Map<string, IndexedCanvasNode>,
  doc: RuntimeCanvasDocument,
  includeRunMetadata: boolean,
) {
  return focusNodeIds
    .map((nodeId) => nodesById.get(nodeId))
    .filter((entry): entry is IndexedCanvasNode => Boolean(entry))
    .map((entry) => summarizeCanvasNode(entry, doc, includeRunMetadata));
}
