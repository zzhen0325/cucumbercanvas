import {
  type CanvasBounds,
  type CanvasOperation,
  type CucumberCanvasDocument,
  applyCanvasTransaction,
  findNode,
  flattenNodes,
  getNodeBounds,
} from "@cucumber/canvas-core";
import type { PenDocument, PenNode } from "@cucumber/pen-types";

export type CanvasTransactionAnalysis = {
  affectedNodeIds: string[];
  boundingRegion: CanvasBounds | null;
  createdNodeIds: string[];
  deletedNodeIds: string[];
  highRiskChanges: CanvasTransactionRisk[];
  movedNodeIds: string[];
  nextDoc: CucumberCanvasDocument;
  operationCount: number;
  operationsByType: Record<string, number>;
  transactionId: string;
  updatedNodeIds: string[];
  validationPreviewWarnings: CanvasTransactionWarning[];
};

export type CanvasTransactionRisk = {
  code: string;
  message: string;
  nodeId?: string;
  operationIndex?: number;
};

export type CanvasTransactionWarning = {
  code: string;
  message: string;
  nodeId?: string;
  operationIndex?: number;
};

export function analyzeCanvasTransaction(args: {
  agentId?: string;
  doc: CucumberCanvasDocument;
  operations: CanvasOperation[];
  pageId?: string;
  transactionId?: string;
}): CanvasTransactionAnalysis {
  const beforeNodes = buildNodeMap(args.doc, args.pageId);
  const transaction = applyCanvasTransaction(args.doc, args.operations, {
    ...(args.agentId ? { agentId: args.agentId } : {}),
    ...(args.pageId ? { activePageId: args.pageId } : {}),
    ...(args.transactionId ? { transactionId: args.transactionId } : {}),
  });
  const nextDoc = transaction.doc as CucumberCanvasDocument;
  const afterNodes = buildNodeMap(nextDoc, args.pageId);
  const createdNodeIds = collectCreatedNodeIds(args.operations, afterNodes);
  const deletedNodeIds = collectDeletedNodeIds(args.operations, beforeNodes);
  const updatedNodeIds = collectUpdatedNodeIds(
    args.operations,
    beforeNodes,
    afterNodes,
  );
  const movedNodeIds = collectMovedNodeIds(
    args.operations,
    beforeNodes,
    afterNodes,
  );
  const affectedNodeIds = uniqueStrings([
    ...createdNodeIds,
    ...deletedNodeIds,
    ...updatedNodeIds,
    ...movedNodeIds,
    ...collectExplicitAffectedNodeIds(args.operations),
  ]);
  const highRiskChanges = collectHighRiskChanges(args.operations, beforeNodes);
  const validationPreviewWarnings = collectPreviewWarnings(
    args.operations,
    beforeNodes,
  );

  return {
    affectedNodeIds,
    boundingRegion: unionNodeBounds(affectedNodeIds, beforeNodes, afterNodes),
    createdNodeIds,
    deletedNodeIds,
    highRiskChanges,
    movedNodeIds,
    nextDoc,
    operationCount: args.operations.length,
    operationsByType: countOperationsByType(args.operations),
    transactionId: transaction.transactionId,
    updatedNodeIds,
    validationPreviewWarnings,
  };
}

function buildNodeMap(doc: PenDocument, pageId?: string) {
  return new Map(flattenNodes(doc, pageId).map((node) => [node.id, node]));
}

function collectCreatedNodeIds(
  operations: CanvasOperation[],
  afterNodes: Map<string, PenNode>,
) {
  const result: string[] = [];
  for (const operation of operations) {
    if (operation.type === "insertNode") {
      collectNodeIds(operation.node, result);
    }
    if (operation.type === "groupNodes") {
      result.push(operation.groupId);
    }
    if (
      operation.type === "createDataFlowEdge" &&
      afterNodes.has(operation.edgeId)
    ) {
      result.push(operation.edgeId);
    }
  }
  return uniqueStrings(result);
}

function collectDeletedNodeIds(
  operations: CanvasOperation[],
  beforeNodes: Map<string, PenNode>,
) {
  const result: string[] = [];
  for (const operation of operations) {
    if (operation.type !== "deleteNode") continue;
    const node = beforeNodes.get(operation.nodeId);
    if (node) collectNodeIds(node, result);
  }
  return uniqueStrings(result);
}

function collectUpdatedNodeIds(
  operations: CanvasOperation[],
  beforeNodes: Map<string, PenNode>,
  afterNodes: Map<string, PenNode>,
) {
  const result: string[] = [];
  for (const operation of operations) {
    if (operation.type === "updateNode" || operation.type === "bindAgent") {
      const nodeId =
        operation.type === "updateNode" ? operation.nodeId : operation.nodeId;
      if (nodeId && beforeNodes.has(nodeId) && afterNodes.has(nodeId)) {
        result.push(nodeId);
      }
    }
    if (operation.type === "alignNodes") result.push(...operation.nodeIds);
  }
  return uniqueStrings(result);
}

function collectMovedNodeIds(
  operations: CanvasOperation[],
  beforeNodes: Map<string, PenNode>,
  afterNodes: Map<string, PenNode>,
) {
  const result: string[] = [];
  for (const operation of operations) {
    if (operation.type === "moveNode" || operation.type === "reorderNode") {
      if (
        beforeNodes.has(operation.nodeId) &&
        afterNodes.has(operation.nodeId)
      ) {
        result.push(operation.nodeId);
      }
    }
    if (operation.type === "updateNode") {
      const before = beforeNodes.get(operation.nodeId);
      const after = afterNodes.get(operation.nodeId);
      if (!before || !after) continue;
      if (
        (before.x ?? 0) !== (after.x ?? 0) ||
        (before.y ?? 0) !== (after.y ?? 0)
      ) {
        result.push(operation.nodeId);
      }
    }
  }
  return uniqueStrings(result);
}

function collectExplicitAffectedNodeIds(operations: CanvasOperation[]) {
  const result: string[] = [];
  for (const operation of operations) {
    switch (operation.type) {
      case "insertNode":
        if (operation.parentId) result.push(operation.parentId);
        break;
      case "updateNode":
      case "deleteNode":
      case "moveNode":
      case "reorderNode":
        result.push(operation.nodeId);
        break;
      case "groupNodes":
        result.push(operation.groupId, ...operation.nodeIds);
        break;
      case "ungroupNode":
        result.push(operation.groupId);
        break;
      case "alignNodes":
      case "setSelection":
        result.push(...operation.nodeIds);
        break;
      case "bindAgent":
        if (operation.nodeId) result.push(operation.nodeId);
        break;
      case "createDataFlowEdge":
        result.push(operation.sourceNodeId, operation.targetNodeId);
        break;
      case "removeDataFlowEdge":
        result.push(operation.edgeId);
        break;
    }
  }
  return uniqueStrings(result);
}

function collectHighRiskChanges(
  operations: CanvasOperation[],
  beforeNodes: Map<string, PenNode>,
) {
  const risks: CanvasTransactionRisk[] = [];
  operations.forEach((operation, operationIndex) => {
    if (operation.type === "deleteNode") {
      risks.push({
        code: "delete_node",
        message: `Operation ${operationIndex} deletes node ${operation.nodeId}.`,
        nodeId: operation.nodeId,
        operationIndex,
      });
    }
    if (operation.type === "updateNode") {
      const before = beforeNodes.get(operation.nodeId);
      if (isAssetReplacementUpdate(operation.updates)) {
        risks.push({
          code: "asset_replacement",
          message: `Operation ${operationIndex} changes asset-bearing fields on node ${operation.nodeId}.`,
          nodeId: operation.nodeId,
          operationIndex,
        });
      }
      if ("visible" in operation.updates || "locked" in operation.updates) {
        risks.push({
          code: "visibility_or_lock_change",
          message: `Operation ${operationIndex} changes visibility or lock state on node ${operation.nodeId}.`,
          nodeId: operation.nodeId,
          operationIndex,
        });
      }
      if (before && isLargeMove(before, operation.updates)) {
        risks.push({
          code: "large_move",
          message: `Operation ${operationIndex} moves node ${operation.nodeId} by more than 600 canvas units.`,
          nodeId: operation.nodeId,
          operationIndex,
        });
      }
    }
  });
  return risks;
}

function collectPreviewWarnings(
  operations: CanvasOperation[],
  beforeNodes: Map<string, PenNode>,
) {
  const warnings: CanvasTransactionWarning[] = [];
  operations.forEach((operation, operationIndex) => {
    if (operation.type === "updateNode" && !beforeNodes.has(operation.nodeId)) {
      warnings.push({
        code: "node_not_found",
        message: `Operation ${operationIndex} references missing node ${operation.nodeId}.`,
        nodeId: operation.nodeId,
        operationIndex,
      });
    }
    if (operation.type === "deleteNode" && !beforeNodes.has(operation.nodeId)) {
      warnings.push({
        code: "node_not_found",
        message: `Operation ${operationIndex} deletes missing node ${operation.nodeId}.`,
        nodeId: operation.nodeId,
        operationIndex,
      });
    }
  });
  return warnings;
}

function countOperationsByType(operations: CanvasOperation[]) {
  const counts: Record<string, number> = {};
  for (const operation of operations) {
    counts[operation.type] = (counts[operation.type] ?? 0) + 1;
  }
  return counts;
}

function unionNodeBounds(
  nodeIds: string[],
  beforeNodes: Map<string, PenNode>,
  afterNodes: Map<string, PenNode>,
): CanvasBounds | null {
  const bounds: CanvasBounds[] = [];
  for (const nodeId of nodeIds) {
    const before = beforeNodes.get(nodeId);
    const after = afterNodes.get(nodeId);
    if (before) bounds.push(getNodeBounds(before));
    if (after) bounds.push(getNodeBounds(after));
  }
  if (bounds.length === 0) return null;
  const minX = Math.min(...bounds.map((bound) => bound.x));
  const minY = Math.min(...bounds.map((bound) => bound.y));
  const maxX = Math.max(...bounds.map((bound) => bound.x + bound.width));
  const maxY = Math.max(...bounds.map((bound) => bound.y + bound.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function collectNodeIds(node: PenNode, output: string[]) {
  output.push(node.id);
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) collectNodeIds(child, output);
  }
}

function isAssetReplacementUpdate(updates: Partial<PenNode>) {
  return (
    "src" in updates ||
    "poster" in updates ||
    "fill" in updates ||
    "stroke" in updates ||
    "assetId" in updates
  );
}

function isLargeMove(node: PenNode, updates: Partial<PenNode>) {
  const nextX = typeof updates.x === "number" ? updates.x : (node.x ?? 0);
  const nextY = typeof updates.y === "number" ? updates.y : (node.y ?? 0);
  const deltaX = Math.abs(nextX - (node.x ?? 0));
  const deltaY = Math.abs(nextY - (node.y ?? 0));
  return deltaX > 600 || deltaY > 600;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export function findNodeInTransactionDoc(
  doc: PenDocument,
  nodeId: string,
  pageId?: string,
) {
  return findNode(doc, nodeId, pageId);
}
