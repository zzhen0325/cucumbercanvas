import {
  type PenDocument,
  type PenNode,
  findNode,
  findParent,
  flattenNodes,
  getNodeBounds,
  isContainerNode,
  isCucumberCanvasDocument,
  resolveContext,
} from "@cucumber/canvas-core";
import { tool } from "langchain";
import { z } from "zod";

import type { LiveCanvasService } from "../../features/canvas/live-canvas-service.js";
import type { UserSupabaseClient } from "../../supabase/user.js";

const inspectCanvasSchema = z.object({
  detail_level: z
    .enum(["summary", "full"])
    .default("summary")
    .describe(
      "Legacy compatibility detail level: summary (id, type, position, size) or full (raw node properties). Prefer inspect_canvas_semantic, get_selection_context, batch_get, or snapshot_layout for normal canvas reads.",
    ),
  element_id: z.string().optional().describe("Query a specific element by ID"),
  filter_type: z
    .array(z.string())
    .optional()
    .describe(
      "Filter by element type(s), e.g. ['text', 'image', 'video', 'rectangle']. Use 'video' to match video elements (stored internally as image elements with isVideo metadata).",
    ),
  filter_region: z
    .object({
      min_x: z.number(),
      min_y: z.number(),
      max_x: z.number(),
      max_y: z.number(),
    })
    .optional()
    .describe("Filter to elements within a bounding box region"),
});

type ToolRuntimeConfig = {
  configurable?: {
    access_token?: unknown;
    canvas_id?: unknown;
    user_id?: unknown;
  };
};

type InspectableNode = PenNode & {
  assetId?: unknown;
  d?: unknown;
  closed?: unknown;
  effects?: unknown;
  fill?: unknown;
  layout?: unknown;
  gap?: unknown;
  justifyContent?: unknown;
  alignItems?: unknown;
};

function summarizeCanvasNode(node: PenNode, doc: PenDocument) {
  const bounds = getNodeBounds(node);
  const parent = findParent(doc, node.id);
  const inspectableNode = node as InspectableNode;
  const base: Record<string, unknown> = {
    id: node.id,
    type: node.type,
    parentId: parent?.id ?? null,
    title: node.name,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    rotation: node.rotation ?? 0,
    locked: node.locked ?? false,
    visible: node.visible !== false,
  };
  if (node.type === "text")
    base.text =
      typeof node.content === "string"
        ? node.content.length > 50
          ? `${node.content.slice(0, 47)}...`
          : node.content
        : undefined;
  if (node.type === "image") base.assetId = inspectableNode.assetId;
  if (node.type === "videoEmbed") base.mimeType = node.mimeType;
  if (node.type === "path") {
    base.pathD =
      typeof inspectableNode.d === "string"
        ? inspectableNode.d.length > 100
          ? `${inspectableNode.d.slice(0, 97)}...`
          : inspectableNode.d
        : undefined;
    base.closed = inspectableNode.closed;
  }
  if (
    Array.isArray(inspectableNode.effects) &&
    inspectableNode.effects.length > 0
  ) {
    base.effects = inspectableNode.effects;
  }
  const fill = inspectableNode.fill;
  if (
    Array.isArray(fill) &&
    fill.length > 0 &&
    fill[0]?.type &&
    fill[0].type !== "solid"
  ) {
    base.gradientFill = { type: fill[0].type, stops: fill[0].stops };
  }
  if (isContainerNode(node)) {
    base.role = node.containerRole;
    base.agent = node.agentBinding
      ? {
          id: node.agentBinding.agentId,
          name: node.agentBinding.name,
          status: node.agentBinding.status,
        }
      : null;
    const layout = inspectableNode.layout;
    if (layout) {
      base.autoLayout = {
        layout,
        gap: inspectableNode.gap,
        justifyContent: inspectableNode.justifyContent,
        alignItems: inspectableNode.alignItems,
      };
    }
  }
  return base;
}

function summarizeCucumberDocument(
  doc: PenDocument,
  filteredNodes?: PenNode[],
) {
  const allNodes = flattenNodes(doc);
  const nodes = filteredNodes ?? allNodes;
  const containers = allNodes.filter(isContainerNode);
  return {
    schemaVersion: doc.version,
    nodeCount: allNodes.length,
    matchedCount: nodes.length,
    containerCount: containers.length,
    viewport: (doc as { viewport?: unknown }).viewport ?? null,
    containers: containers.map((container) => ({
      id: container.id,
      title: container.name,
      parentId: findParent(doc, container.id)?.id ?? null,
      role: container.containerRole,
      bounds: getNodeBounds(container),
      agentBinding: container.agentBinding
        ? {
            agentId: container.agentBinding.agentId,
            name: container.agentBinding.name,
            status: container.agentBinding.status,
            permissions: container.agentBinding.permissions,
          }
        : null,
      effectiveContext: resolveContext(doc, container.id),
      childCount:
        "children" in container && Array.isArray(container.children)
          ? container.children.length
          : 0,
    })),
    nodes: nodes.map((node) => summarizeCanvasNode(node, doc)),
  };
}

function computeBoundingBox(elements: Record<string, unknown>[]) {
  if (elements.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const el of elements) {
    const x = Number(el.x) || 0;
    const y = Number(el.y) || 0;
    const w = Number(el.width) || 0;
    const h = Number(el.height) || 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Build a compact canvas summary for injecting into user message context.
 * Reuses the existing summarizeElement / computeBoundingBox helpers so the
 * format stays consistent with inspect_canvas output.
 * Returns null if canvas is empty (no visible elements).
 */
export function buildCanvasSummaryForContext(content: unknown): string | null {
  if (!isCucumberCanvasDocument(content)) {
    throw new Error(
      "Unsupported canvas content: expected a Cucumber PenDocument with non-empty pages and a valid activePageId. Legacy flat-map/root-children canvas data is not supported in the agent context path.",
    );
  }

  const nodes = flattenNodes(content);
  if (nodes.length === 0) return null;

  const bbox = computeBoundingBox(
    nodes.map((node) => {
      const bounds = getNodeBounds(node);
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
    }),
  );
  const summaries = nodes.map((node) => summarizeCanvasNode(node, content));
  const lines: string[] = [
    `Canvas: ${nodes.length} nodes, bounds (${Math.round(bbox.minX)},${Math.round(bbox.minY)})→(${Math.round(bbox.maxX)},${Math.round(bbox.maxY)})`,
  ];

  const toShow = summaries.slice(0, 30);
  for (const s of toShow) {
    const parts = [`${s.type}#${s.id}`];
    parts.push(`@(${Math.round(s.x as number)},${Math.round(s.y as number)})`);
    parts.push(
      `${Math.round(s.width as number)}x${Math.round(s.height as number)}`,
    );
    if (s.title) parts.push(`title="${s.title}"`);
    if (s.text) parts.push(`"${s.text}"`);
    if (s.agent && typeof s.agent === "object") {
      const agent = s.agent as {
        id?: string;
        name?: string;
        status?: string;
      };
      parts.push(
        `agent=${agent.name ?? agent.id ?? "unassigned"}:${agent.status ?? "idle"}`,
      );
    }
    lines.push(`  ${parts.join(" ")}`);
  }
  if (summaries.length > 30) {
    lines.push(`  ... and ${summaries.length - 30} more nodes`);
  }
  return lines.join("\n");
}

export function createInspectCanvasTool(deps: {
  createUserClient: (accessToken: string) => UserSupabaseClient;
  liveCanvasService?: LiveCanvasService;
}) {
  return tool(
    async (input, config) => {
      const configurable = (config as ToolRuntimeConfig | undefined)
        ?.configurable;
      const canvasId =
        typeof configurable?.canvas_id === "string"
          ? configurable.canvas_id
          : null;
      const accessToken =
        typeof configurable?.access_token === "string"
          ? configurable.access_token
          : null;
      const userId =
        typeof configurable?.user_id === "string" ? configurable.user_id : null;

      if (!canvasId || !accessToken || !userId) {
        return JSON.stringify({
          error: "no_canvas_context",
          message:
            "This tool requires a canvas context. Ensure the conversation is linked to a canvas.",
        });
      }

      if (!deps.liveCanvasService) {
        return JSON.stringify({
          error: "live_canvas_unavailable",
          message:
            "Canvas tools require an open live editor. Open the canvas page and retry.",
        });
      }

      try {
        const cucumberDoc = await deps.liveCanvasService.getDocument(
          {
            accessToken,
            email: "",
            id: userId,
            userMetadata: {},
          },
          canvasId,
        );
        const nodes = flattenNodes(cucumberDoc);

        if (input.element_id) {
          const found = findNode(cucumberDoc, input.element_id);
          if (!found) {
            return JSON.stringify({
              error: "node_not_found",
              message: `Node ${input.element_id} not found on canvas.`,
            });
          }
          return JSON.stringify(
            input.detail_level === "full"
              ? found
              : summarizeCanvasNode(found, cucumberDoc),
          );
        }

        let filteredNodes = nodes;
        let hasFilter = false;
        if (input.filter_type && input.filter_type.length > 0) {
          const filterTypes = input.filter_type;
          filteredNodes = filteredNodes.filter((node) =>
            filterTypes.includes(node.type),
          );
          hasFilter = true;
        }
        if (input.filter_region) {
          const r = input.filter_region;
          filteredNodes = filteredNodes.filter((node) => {
            const bounds = getNodeBounds(node);
            return !(
              bounds.x + bounds.width < r.min_x ||
              bounds.x > r.max_x ||
              bounds.y + bounds.height < r.min_y ||
              bounds.y > r.max_y
            );
          });
          hasFilter = true;
        }

        return JSON.stringify({
          canvasId,
          ...summarizeCucumberDocument(
            cucumberDoc,
            hasFilter ? filteredNodes : undefined,
          ),
        });
      } catch (error) {
        return JSON.stringify({
          error:
            error instanceof Error && "code" in error
              ? String((error as { code: unknown }).code)
              : "inspect_canvas_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to inspect the live canvas.",
        });
      }
    },
    {
      name: "inspect_canvas",
      description:
        "Legacy compatibility reader for exact Cucumber canvas node fields, raw properties, element_id lookups, type filters, or spatial region filters. Prefer inspect_canvas_semantic, get_selection_context, batch_get, snapshot_layout, or find_empty_space for normal structure, selection, layout, and placement reads.",
      schema: inspectCanvasSchema,
    },
  );
}
