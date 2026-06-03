import {
  type CanvasBounds,
  type PenDocument,
  type PenNode,
  findNode,
  getActivePage,
  getNodeSceneBounds,
} from "@cucumber/canvas-core";
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
import { validateCanvasDocument } from "./ai-native-canvas-validation.js";

const TOOL_NAME = "export_canvas_deliverable";

const exportTargetSchema = z.enum([
  "structured_json",
  "flow_spec",
  "component_spec",
  "image",
  "poster",
  "react",
  "html",
  "vue",
  "deck_slices",
]);

const exportCanvasDeliverableSchema = z.object({
  target: exportTargetSchema.default("structured_json"),
  nodeIds: z.array(z.string()).optional(),
  pageId: z.string().optional(),
  title: z.string().optional(),
  includeAssets: z.boolean().default(true),
  includeValidation: z.boolean().default(true),
});

type ExportTarget = z.infer<typeof exportTargetSchema>;

type DeliverableNodeTree = Record<string, unknown> & {
  children?: DeliverableNodeTree[];
};

const SUPPORTED_TARGETS = new Set<ExportTarget>([
  "structured_json",
  "flow_spec",
  "component_spec",
]);

export function createExportCanvasDeliverableMcpTool(
  deps: AiNativeCanvasToolDeps,
): CucumberMcpTool<typeof exportCanvasDeliverableSchema> {
  return {
    name: TOOL_NAME,
    description:
      "Export selected or explicit canvas nodes as a traceable product deliverable spec. Supports structured_json, flow_spec, and component_spec handoffs with source node IDs; rendering/code/deck targets return explicit unsupported reasons.",
    schema: exportCanvasDeliverableSchema,
    inputSchema: schemaToJsonSchema(exportCanvasDeliverableSchema),
    execute: async (args, context) => {
      try {
        const input = exportCanvasDeliverableSchema.parse(args);
        if (!SUPPORTED_TARGETS.has(input.target)) {
          throw new Error(
            `export_canvas_deliverable target ${input.target} is not implemented in this MCP tool yet. Use codegen_export for React/HTML/Vue code, screenshot_canvas for image evidence, or request a dedicated exporter slice.`,
          );
        }
        const live = await readAiNativeCanvasLiveContext(
          deps,
          context,
          TOOL_NAME,
        );
        const result = exportCanvasDeliverable({
          doc: live.doc,
          includeAssets: input.includeAssets,
          includeValidation: input.includeValidation,
          nodeIds: input.nodeIds,
          pageId: input.pageId,
          target: input.target,
          title: input.title,
        });
        console.info("[ai-native-canvas] deliverable.export", {
          canvasId: live.canvasId,
          nodeCount: result.sourceNodeIds.length,
          pageId: input.pageId ?? live.doc.activePageId,
          target: input.target,
          userId: live.user.id,
        });
        return jsonResult({
          canvasId: live.canvasId,
          summary: `Exported ${result.sourceNodeIds.length} source node(s) as ${input.target}.`,
          ...result,
        });
      } catch (error) {
        const payload = {
          error:
            error instanceof Error && "code" in error
              ? String((error as { code: unknown }).code)
              : "export_canvas_deliverable_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to export the canvas deliverable.",
        };
        console.warn("[ai-native-canvas] deliverable.export failed", payload);
        return errorResult(payload);
      }
    },
  };
}

function exportCanvasDeliverable(args: {
  doc: RuntimeCanvasDocument;
  includeAssets: boolean;
  includeValidation: boolean;
  nodeIds?: string[];
  pageId?: string;
  target: ExportTarget;
  title?: string;
}) {
  const page = getActivePage(args.doc, args.pageId);
  const selectedIds = args.nodeIds?.length
    ? args.nodeIds
    : (args.doc.selection ?? []);
  if (selectedIds.length === 0) {
    throw new Error(
      "export_canvas_deliverable requires nodeIds or a current live canvas selection.",
    );
  }
  const roots = selectedIds.map((nodeId) => {
    const node = findNode(args.doc, nodeId, page.id);
    if (!node) {
      throw new Error(
        `export_canvas_deliverable node ${nodeId} does not exist.`,
      );
    }
    return node;
  });
  const sourceNodes = collectSourceNodes(roots);
  const sourceNodeIds = sourceNodes.map((node) => node.id);
  const validation = args.includeValidation
    ? validateCanvasDocument({
        doc: args.doc,
        nodeIds: sourceNodeIds,
        pageId: page.id,
      })
    : undefined;
  const base = {
    target: args.target,
    title: args.title ?? `${page.name ?? page.id} deliverable`,
    page: { id: page.id, name: page.name },
    rootNodeIds: roots.map((node) => node.id),
    sourceNodeIds,
    sourceBounds: sourceNodes.map((node) =>
      compactRecord({
        id: node.id,
        bounds: getNodeSceneBounds(args.doc, node.id, page.id),
      }),
    ),
    assets: args.includeAssets
      ? collectDeliverableAssets(args.doc, sourceNodes)
      : [],
    validationSummary: validation
      ? {
          issueCounts: validation.issueCounts,
          pass: validation.pass,
        }
      : undefined,
  };
  return {
    deliverable: buildTargetDeliverable(args.doc, page.id, roots, sourceNodes, {
      ...base,
      title: base.title,
    }),
    sourceNodeIds,
    target: args.target,
    validationSummary: base.validationSummary,
  };
}

function buildTargetDeliverable(
  doc: PenDocument,
  pageId: string,
  roots: PenNode[],
  sourceNodes: PenNode[],
  base: {
    assets: Record<string, unknown>[];
    page: { id: string; name?: string };
    rootNodeIds: string[];
    sourceBounds: Record<string, unknown>[];
    sourceNodeIds: string[];
    target: ExportTarget;
    title: string;
    validationSummary?: Record<string, unknown>;
  },
) {
  if (base.target === "flow_spec") {
    return {
      ...base,
      nodes: sourceNodes.map(summarizeDeliverableNode),
      edges: sourceNodes
        .filter((node) => node.type === "line" && Boolean(node.connector))
        .map((node) => summarizeFlowEdge(node)),
    };
  }
  if (base.target === "component_spec") {
    return {
      ...base,
      components: roots.map((node) =>
        summarizeComponentRoot(doc, pageId, node),
      ),
    };
  }
  return {
    ...base,
    nodes: roots.map((node) => summarizeNodeTree(doc, pageId, node)),
  };
}

function summarizeNodeTree(
  doc: PenDocument,
  pageId: string,
  node: PenNode,
): DeliverableNodeTree {
  return compactRecord({
    id: node.id,
    type: node.type,
    name: node.name,
    bounds: getNodeSceneBounds(doc, node.id, pageId),
    role: node.role,
    containerRole: node.containerRole,
    contextSlots: node.contextSlots,
    agentBinding: node.agentBinding,
    ioPorts: node.ioPorts,
    children:
      "children" in node && Array.isArray(node.children)
        ? node.children.map((child) => summarizeNodeTree(doc, pageId, child))
        : undefined,
  });
}

function summarizeDeliverableNode(node: PenNode) {
  return compactRecord({
    id: node.id,
    type: node.type,
    name: node.name,
    containerRole: node.containerRole,
    ioPorts: node.ioPorts,
  });
}

function summarizeFlowEdge(node: PenNode) {
  if (node.type !== "line" || !node.connector) {
    throw new Error("summarizeFlowEdge requires a connector line.");
  }
  return compactRecord({
    id: node.id,
    name: node.name,
    arrow: Boolean(node.connector.arrow),
    routing: node.connector.routing ?? "straight",
    source: node.connector.start,
    target: node.connector.end,
  });
}

function summarizeComponentRoot(
  doc: PenDocument,
  pageId: string,
  node: PenNode,
) {
  const descendants = collectSourceNodes([node]).filter(
    (candidate) => candidate.id !== node.id,
  );
  return compactRecord({
    root: summarizeNodeTree(doc, pageId, node),
    childCount: descendants.length,
    componentRef: node.componentRef,
    reusable: "reusable" in node ? node.reusable : undefined,
    slots: "slot" in node ? node.slot : undefined,
    variablesUsed: collectVariableRefs([node]),
  });
}

function collectSourceNodes(roots: PenNode[]) {
  const result: PenNode[] = [];
  const visit = (node: PenNode) => {
    result.push(node);
    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children) visit(child);
    }
  };
  for (const root of roots) visit(root);
  return result;
}

function collectDeliverableAssets(doc: PenDocument, nodes: PenNode[]) {
  const values = new Set<string>();
  for (const node of nodes) {
    if (node.type === "image") values.add(node.src);
    if (node.type === "videoEmbed") {
      values.add(node.src);
      if (node.poster) values.add(node.poster);
    }
    const fill = (node as PenNode & { fill?: unknown }).fill;
    if (Array.isArray(fill)) {
      for (const paint of fill) {
        if (
          isRecord(paint) &&
          paint.type === "image" &&
          typeof paint.url === "string"
        ) {
          values.add(paint.url);
        }
      }
    }
  }
  const assets = Object.values(doc.assets ?? {});
  return assets
    .filter((asset) => values.has(asset.id) || values.has(asset.url))
    .map((asset) => ({
      height: asset.height,
      id: asset.id,
      mimeType: asset.mimeType,
      name: asset.name,
      source: asset.source,
      url: asset.url,
      width: asset.width,
    }));
}

function collectVariableRefs(nodes: PenNode[]) {
  const names = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string" && value.startsWith("$")) {
      names.add(value.slice(1));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (isRecord(value)) {
      for (const item of Object.values(value)) visit(item);
    }
  };
  for (const node of nodes) visit(node);
  return Array.from(names).sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
