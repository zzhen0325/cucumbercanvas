import {
  getActivePage,
  isContainerNode,
  resolveContext,
} from "@cucumber/canvas-core";
import type { PenNode } from "@cucumber/pen-types";
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
  indexCanvasNodes,
  summarizeCanvasNode,
  summarizeCanvasNodeFull,
} from "./ai-native-canvas-semantic-model.js";

const TOOL_NAME = "get_selection_context";

const selectionContextSchema = z.object({
  includeAncestors: z.boolean().default(true),
  includeDescendants: z.boolean().default(false),
  includeSiblings: z.boolean().default(false),
  detailLevel: z.enum(["summary", "full"]).default("summary"),
});

type SelectionContextInput = z.infer<typeof selectionContextSchema>;

type Capability = {
  enabled: boolean;
  reason?: string;
};

type SelectionContextResult = Record<string, unknown> & {
  activePageId: string;
  selectedNodeIds: string[];
};

export function createGetSelectionContextMcpTool(
  deps: AiNativeCanvasToolDeps,
): CucumberMcpTool<typeof selectionContextSchema> {
  return {
    name: TOOL_NAME,
    description:
      "Read the current live canvas selection as the user's intent anchor. Returns selected nodes, parent container paths, effective context slots, and editable capability flags without mutating selection or canvas state.",
    schema: selectionContextSchema,
    inputSchema: schemaToJsonSchema(selectionContextSchema),
    execute: async (args, context) => {
      try {
        const input = selectionContextSchema.parse(args);
        const live = await readAiNativeCanvasLiveContext(
          deps,
          context,
          TOOL_NAME,
        );
        const result = buildSelectionContext(live.doc, input, live.canvasId);
        console.info("[ai-native-canvas] selection.context", {
          canvasId: live.canvasId,
          pageId: result.activePageId,
          selectedCount: result.selectedNodeIds.length,
          userId: live.user.id,
        });
        return jsonResult(result);
      } catch (error) {
        const payload = {
          error:
            error instanceof Error && "code" in error
              ? String((error as { code: unknown }).code)
              : "get_selection_context_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to read the live canvas selection context.",
        };
        console.warn("[ai-native-canvas] selection.context failed", payload);
        return errorResult(payload);
      }
    },
  };
}

function buildSelectionContext(
  doc: RuntimeCanvasDocument,
  input: SelectionContextInput,
  canvasId: string,
): SelectionContextResult {
  const page = getActivePage(doc);
  const indexedNodes = indexCanvasNodes(page.children);
  const nodesById = new Map(
    indexedNodes.map((entry) => [entry.node.id, entry]),
  );
  const selectedNodeIds = normalizeSelection(doc.selection ?? [], nodesById);
  const selectedEntries = selectedNodeIds
    .map((nodeId) => nodesById.get(nodeId))
    .filter((entry): entry is IndexedCanvasNode => Boolean(entry));
  const missingSelectedNodeIds = (doc.selection ?? []).filter(
    (nodeId) => !nodesById.has(nodeId),
  );
  const selectedNodes = selectedEntries.map((entry) =>
    input.detailLevel === "full"
      ? summarizeCanvasNodeFull(entry)
      : summarizeCanvasNode(entry, doc, false),
  );
  const parentContainerPaths = selectedEntries.map((entry) =>
    buildParentContainerPath(entry, nodesById),
  );
  const effectiveContextSlots = selectedEntries.map((entry) =>
    compactRecord({
      nodeId: entry.node.id,
      contextSlots: resolveContextForSelection(entry, nodesById, doc),
    }),
  );
  const capabilities = buildSelectionCapabilities(selectedEntries);
  const emptyReason =
    selectedNodeIds.length === 0
      ? "selection_empty: No live canvas nodes are currently selected."
      : undefined;

  return compactRecord({
    canvasId,
    summary:
      selectedNodeIds.length === 0
        ? "No live canvas nodes are currently selected."
        : `Read ${selectedNodeIds.length} selected canvas node(s).`,
    activePageId: page.id,
    activePageName: page.name,
    selectedNodeIds,
    selectedNodes,
    missingSelectedNodeIds,
    emptyReason,
    parentContainerPaths,
    effectiveContextSlots,
    capabilities,
    ancestors: input.includeAncestors
      ? collectAncestors(selectedEntries, nodesById, doc, input.detailLevel)
      : undefined,
    descendants: input.includeDescendants
      ? collectDescendants(selectedEntries, doc, input.detailLevel)
      : undefined,
    siblings: input.includeSiblings
      ? collectSiblings(selectedEntries, nodesById, doc, input.detailLevel)
      : undefined,
  }) as SelectionContextResult;
}

function normalizeSelection(
  selection: readonly string[],
  nodesById: Map<string, IndexedCanvasNode>,
) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const nodeId of selection) {
    if (seen.has(nodeId) || !nodesById.has(nodeId)) continue;
    seen.add(nodeId);
    result.push(nodeId);
  }
  return result;
}

function buildSelectionCapabilities(
  selectedEntries: IndexedCanvasNode[],
): Record<string, Capability> {
  const selectedCount = selectedEntries.length;
  const lockedNodeIds = selectedEntries
    .filter((entry) => entry.node.locked)
    .map((entry) => entry.node.id);
  const hasSelection = selectedCount > 0;
  const hasLocked = lockedNodeIds.length > 0;
  const allWritable = hasSelection && !hasLocked;
  const singleNode = selectedCount === 1 ? selectedEntries[0]?.node : undefined;
  const selectedTypes = new Set(
    selectedEntries.map((entry) => entry.node.type),
  );
  const nonConnectorCount = selectedEntries.filter(
    (entry) => entry.node.type !== "line",
  ).length;

  return {
    canMove: capability(
      allWritable,
      baseWriteReason(hasSelection, lockedNodeIds),
    ),
    canResize: capability(
      allWritable &&
        selectedEntries.every((entry) => entry.node.type !== "line"),
      hasSelection && !hasLocked
        ? "line_selection: Resize uses endpoint editing for line nodes."
        : baseWriteReason(hasSelection, lockedNodeIds),
    ),
    canEditText: capability(
      Boolean(allWritable && singleNode?.type === "text"),
      textEditReason(hasSelection, hasLocked, lockedNodeIds, singleNode),
    ),
    canReplaceAsset: capability(
      Boolean(
        allWritable &&
          singleNode &&
          (singleNode.type === "image" || singleNode.type === "videoEmbed"),
      ),
      replaceAssetReason(hasSelection, hasLocked, lockedNodeIds, singleNode),
    ),
    canConnect: capability(
      allWritable && nonConnectorCount > 0,
      hasSelection && !hasLocked && nonConnectorCount === 0
        ? "connector_selection: Select at least one non-line node to create a durable connection."
        : baseWriteReason(hasSelection, lockedNodeIds),
    ),
    canGroup: capability(
      allWritable && selectedCount >= 2,
      groupReason(hasSelection, hasLocked, lockedNodeIds, selectedCount),
    ),
    canUngroup: capability(
      allWritable &&
        selectedEntries.some((entry) => entry.node.type === "group"),
      ungroupReason(hasSelection, hasLocked, lockedNodeIds, selectedTypes),
    ),
  };
}

function capability(enabled: boolean, disabledReason: string): Capability {
  return enabled ? { enabled } : { enabled, reason: disabledReason };
}

function baseWriteReason(hasSelection: boolean, lockedNodeIds: string[]) {
  if (!hasSelection) return "selection_empty: Select at least one node first.";
  if (lockedNodeIds.length > 0) {
    return `locked_selection: Locked nodes cannot be edited (${lockedNodeIds.join(", ")}).`;
  }
  return "unsupported_selection: The current selection does not support this operation.";
}

function textEditReason(
  hasSelection: boolean,
  hasLocked: boolean,
  lockedNodeIds: string[],
  singleNode: PenNode | undefined,
) {
  if (!hasSelection || hasLocked)
    return baseWriteReason(hasSelection, lockedNodeIds);
  if (!singleNode)
    return "multi_selection: Select exactly one text node to edit text.";
  if (singleNode.type !== "text") {
    return `type_mismatch: Selected node ${singleNode.id} is ${singleNode.type}, not text.`;
  }
  return "unsupported_selection: The current selection does not support text editing.";
}

function replaceAssetReason(
  hasSelection: boolean,
  hasLocked: boolean,
  lockedNodeIds: string[],
  singleNode: PenNode | undefined,
) {
  if (!hasSelection || hasLocked)
    return baseWriteReason(hasSelection, lockedNodeIds);
  if (!singleNode)
    return "multi_selection: Select exactly one image or video node.";
  if (singleNode.type !== "image" && singleNode.type !== "videoEmbed") {
    return `type_mismatch: Selected node ${singleNode.id} is ${singleNode.type}, not image or videoEmbed.`;
  }
  return "unsupported_selection: The current selection does not support asset replacement.";
}

function groupReason(
  hasSelection: boolean,
  hasLocked: boolean,
  lockedNodeIds: string[],
  selectedCount: number,
) {
  if (!hasSelection || hasLocked)
    return baseWriteReason(hasSelection, lockedNodeIds);
  if (selectedCount < 2)
    return "single_selection: Select at least two nodes to group.";
  return "unsupported_selection: The current selection cannot be grouped.";
}

function ungroupReason(
  hasSelection: boolean,
  hasLocked: boolean,
  lockedNodeIds: string[],
  selectedTypes: Set<string>,
) {
  if (!hasSelection || hasLocked)
    return baseWriteReason(hasSelection, lockedNodeIds);
  if (!selectedTypes.has("group")) {
    return "type_mismatch: Select a group node to ungroup.";
  }
  return "unsupported_selection: The current selection cannot be ungrouped.";
}

function buildParentContainerPath(
  entry: IndexedCanvasNode,
  nodesById: Map<string, IndexedCanvasNode>,
) {
  const path = entry.parentPath
    .map((nodeId) => nodesById.get(nodeId))
    .filter((candidate): candidate is IndexedCanvasNode =>
      Boolean(candidate && isContainerNode(candidate.node)),
    )
    .map((ancestor) => ({
      id: ancestor.node.id,
      name: ancestor.node.name ?? ancestor.node.id,
      type: ancestor.node.type,
      role: ancestor.node.containerRole ?? [],
    }));
  return {
    nodeId: entry.node.id,
    path,
  };
}

function resolveContextForSelection(
  entry: IndexedCanvasNode,
  nodesById: Map<string, IndexedCanvasNode>,
  doc: RuntimeCanvasDocument,
) {
  const contextNodeId = isContainerNode(entry.node)
    ? entry.node.id
    : findNearestContainerId(entry, nodesById);
  if (!contextNodeId) return {};
  return resolveContext(doc, contextNodeId);
}

function findNearestContainerId(
  entry: IndexedCanvasNode,
  nodesById: Map<string, IndexedCanvasNode>,
) {
  for (let index = entry.parentPath.length - 1; index >= 0; index -= 1) {
    const ancestor = nodesById.get(entry.parentPath[index] ?? "");
    if (ancestor && isContainerNode(ancestor.node)) return ancestor.node.id;
  }
  return undefined;
}

function collectAncestors(
  selectedEntries: IndexedCanvasNode[],
  nodesById: Map<string, IndexedCanvasNode>,
  doc: RuntimeCanvasDocument,
  detailLevel: "summary" | "full",
) {
  const ancestorIds = uniqueOrdered(
    selectedEntries.flatMap((entry) => entry.parentPath),
  );
  return ancestorIds
    .map((nodeId) => nodesById.get(nodeId))
    .filter((entry): entry is IndexedCanvasNode => Boolean(entry))
    .map((entry) => summarizeForDetail(entry, doc, detailLevel));
}

function collectDescendants(
  selectedEntries: IndexedCanvasNode[],
  doc: RuntimeCanvasDocument,
  detailLevel: "summary" | "full",
) {
  const descendants: Record<string, unknown>[] = [];
  for (const entry of selectedEntries) {
    if (!("children" in entry.node) || !Array.isArray(entry.node.children)) {
      continue;
    }
    descendants.push(
      ...indexCanvasNodes(entry.node.children, entry.node.id, [
        ...entry.parentPath,
        entry.node.id,
      ]).map((descendant) => summarizeForDetail(descendant, doc, detailLevel)),
    );
  }
  return descendants;
}

function collectSiblings(
  selectedEntries: IndexedCanvasNode[],
  nodesById: Map<string, IndexedCanvasNode>,
  doc: RuntimeCanvasDocument,
  detailLevel: "summary" | "full",
) {
  const selectedIds = new Set(selectedEntries.map((entry) => entry.node.id));
  const siblingIds = uniqueOrdered(
    selectedEntries.flatMap((entry) =>
      [...nodesById.values()]
        .filter(
          (candidate) =>
            candidate.parentId === entry.parentId &&
            !selectedIds.has(candidate.node.id),
        )
        .map((candidate) => candidate.node.id),
    ),
  );
  return siblingIds
    .map((nodeId) => nodesById.get(nodeId))
    .filter((entry): entry is IndexedCanvasNode => Boolean(entry))
    .map((entry) => summarizeForDetail(entry, doc, detailLevel));
}

function summarizeForDetail(
  entry: IndexedCanvasNode,
  doc: RuntimeCanvasDocument,
  detailLevel: "summary" | "full",
) {
  return detailLevel === "full"
    ? summarizeCanvasNodeFull(entry)
    : summarizeCanvasNode(entry, doc, false);
}

function uniqueOrdered(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
