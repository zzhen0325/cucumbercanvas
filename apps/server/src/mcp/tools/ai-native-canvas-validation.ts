import {
  type CanvasBounds,
  type PenDocument,
  type PenNode,
  flattenNodes,
  getActivePage,
  getNodeBounds,
} from "@cucumber/canvas-core";

export type CanvasValidationSeverity = "info" | "warning" | "error";

export type CanvasValidationCheck =
  | "structure"
  | "assets"
  | "variables"
  | "connectors"
  | "text_overflow"
  | "component_refs"
  | "agent_output_visibility";

export type CanvasValidationIssue = {
  severity: CanvasValidationSeverity;
  code: string;
  nodeId?: string;
  fieldPath?: string;
  reason: string;
  suggestedFix: string;
  bounds?: CanvasBounds;
};

export type CanvasValidationResult = {
  checkedNodeIds: string[];
  issueCounts: Record<CanvasValidationSeverity, number>;
  issues: CanvasValidationIssue[];
  pass: boolean;
};

const DEFAULT_CHECKS: CanvasValidationCheck[] = [
  "structure",
  "assets",
  "variables",
  "connectors",
  "text_overflow",
  "component_refs",
  "agent_output_visibility",
];

export function validateCanvasDocument(args: {
  checks?: CanvasValidationCheck[];
  doc: PenDocument;
  nodeIds?: string[];
  pageId?: string;
  severityThreshold?: CanvasValidationSeverity;
}): CanvasValidationResult {
  const checks = args.checks?.length ? args.checks : DEFAULT_CHECKS;
  const page = getActivePage(args.doc, args.pageId);
  const allNodes = flattenNodes(args.doc, page.id);
  const targetIds = args.nodeIds?.length
    ? new Set(args.nodeIds)
    : new Set(allNodes.map((node) => node.id));
  const targetNodes = allNodes.filter((node) => targetIds.has(node.id));
  const allNodeIds = new Set(allNodes.map((node) => node.id));
  const issues: CanvasValidationIssue[] = [];

  if (checks.includes("structure")) {
    validateStructure(args.doc, allNodes, page.id, targetIds, issues);
  }
  if (checks.includes("assets")) {
    validateAssets(args.doc, targetNodes, issues);
  }
  if (checks.includes("variables")) {
    validateVariables(args.doc, targetNodes, issues);
  }
  if (checks.includes("connectors")) {
    validateConnectors(targetNodes, allNodeIds, issues);
  }
  if (checks.includes("text_overflow")) {
    validateTextOverflow(targetNodes, issues);
  }
  if (checks.includes("component_refs")) {
    validateComponentRefs(targetNodes, allNodeIds, issues);
  }
  if (checks.includes("agent_output_visibility")) {
    validateAgentOutputVisibility(targetNodes, issues);
  }

  const filteredIssues = filterIssuesBySeverity(
    issues,
    args.severityThreshold ?? "info",
  );
  return {
    checkedNodeIds: targetNodes.map((node) => node.id),
    issueCounts: countIssues(filteredIssues),
    issues: filteredIssues,
    pass: !filteredIssues.some((issue) => issue.severity === "error"),
  };
}

function validateStructure(
  doc: PenDocument,
  allNodes: PenNode[],
  pageId: string,
  targetIds: Set<string>,
  issues: CanvasValidationIssue[],
) {
  if (!Array.isArray(doc.pages) || doc.pages.length === 0) {
    issues.push({
      severity: "error",
      code: "missing_pages",
      reason: "PenDocument.pages is missing or empty.",
      suggestedFix:
        "Repair the document so it uses PenDocument.pages with a valid activePageId.",
    });
  }
  if (
    !doc.activePageId ||
    !doc.pages?.some((page) => page.id === doc.activePageId)
  ) {
    issues.push({
      severity: "error",
      code: "invalid_active_page",
      fieldPath: "activePageId",
      reason: "PenDocument.activePageId does not reference an existing page.",
      suggestedFix:
        "Set activePageId to an existing page id before editing the canvas.",
    });
  }
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const node of allNodes) {
    if (seen.has(node.id)) duplicates.add(node.id);
    seen.add(node.id);
  }
  for (const nodeId of duplicates) {
    if (!targetIds.has(nodeId)) continue;
    issues.push({
      severity: "error",
      code: "duplicate_node_id",
      nodeId,
      reason: `Node id ${nodeId} appears more than once on page ${pageId}.`,
      suggestedFix:
        "Regenerate duplicate node IDs so every PenNode has a unique id.",
    });
  }
  for (const nodeId of targetIds) {
    if (seen.has(nodeId)) continue;
    issues.push({
      severity: "error",
      code: "node_not_found",
      nodeId,
      reason: `Requested validation node ${nodeId} does not exist on page ${pageId}.`,
      suggestedFix:
        "Refresh the live canvas state and validate an existing node id.",
    });
  }
}

function validateAssets(
  doc: PenDocument,
  nodes: PenNode[],
  issues: CanvasValidationIssue[],
) {
  const assets = Object.values(doc.assets ?? {});
  const assetValues = new Set<string>();
  for (const asset of assets) {
    assetValues.add(asset.id);
    assetValues.add(asset.url);
  }
  for (const node of nodes) {
    if (node.type === "image") {
      validateAssetValue(node, "src", node.src, assetValues, issues);
    }
    if (node.type === "videoEmbed") {
      validateAssetValue(node, "src", node.src, assetValues, issues);
      if (node.poster)
        validateAssetValue(node, "poster", node.poster, assetValues, issues);
    }
    validateImageFills(node, assetValues, issues);
  }
}

function validateAssetValue(
  node: PenNode,
  fieldPath: string,
  value: string,
  assetValues: Set<string>,
  issues: CanvasValidationIssue[],
) {
  if (!looksLikeDocumentAssetReference(value) || assetValues.has(value)) return;
  issues.push({
    severity: "error",
    code: "missing_asset",
    nodeId: node.id,
    fieldPath,
    reason: `Node ${node.id} references missing canvas asset ${value}.`,
    suggestedFix:
      "Add the referenced asset to PenDocument.assets or replace the node source with an existing asset URL.",
    bounds: getNodeBounds(node),
  });
}

function validateImageFills(
  node: PenNode,
  assetValues: Set<string>,
  issues: CanvasValidationIssue[],
) {
  const fill = (node as PenNode & { fill?: unknown }).fill;
  if (!Array.isArray(fill)) return;
  fill.forEach((paint, index) => {
    if (
      !isRecord(paint) ||
      paint.type !== "image" ||
      typeof paint.url !== "string"
    ) {
      return;
    }
    validateAssetValue(
      node,
      `fill.${index}.url`,
      paint.url,
      assetValues,
      issues,
    );
  });
}

function validateVariables(
  doc: PenDocument,
  nodes: PenNode[],
  issues: CanvasValidationIssue[],
) {
  const variables = doc.variables ?? {};
  for (const node of nodes) {
    const names = new Set<string>();
    collectVariableNames(node, names);
    for (const name of names) {
      if (variables[name]) continue;
      issues.push({
        severity: "error",
        code: "missing_variable",
        nodeId: node.id,
        reason: `Node ${node.id} references variable $${name}, but PenDocument.variables does not define it.`,
        suggestedFix: `Define variable ${name} or replace the variable reference with a concrete runtime value.`,
        bounds: getNodeBounds(node),
      });
    }
  }
}

function validateConnectors(
  nodes: PenNode[],
  allNodeIds: Set<string>,
  issues: CanvasValidationIssue[],
) {
  for (const node of nodes) {
    if (node.type !== "line" || !node.connector) continue;
    for (const endpointName of ["start", "end"] as const) {
      const endpoint = node.connector[endpointName];
      if (!endpoint || allNodeIds.has(endpoint.nodeId)) continue;
      issues.push({
        severity: "error",
        code: "dangling_connector",
        nodeId: node.id,
        fieldPath: `connector.${endpointName}.nodeId`,
        reason: `Connector ${node.id} references missing ${endpointName} node ${endpoint.nodeId}.`,
        suggestedFix:
          "Reconnect the endpoint to an existing node or delete the connector.",
        bounds: getNodeBounds(node),
      });
    }
  }
}

function validateTextOverflow(
  nodes: PenNode[],
  issues: CanvasValidationIssue[],
) {
  for (const node of nodes) {
    if (node.type !== "text" || typeof node.content !== "string") continue;
    const width = typeof node.width === "number" ? node.width : undefined;
    const height = typeof node.height === "number" ? node.height : undefined;
    if (!width || !height || node.textGrowth !== "fixed-width-height") continue;
    const fontSize = typeof node.fontSize === "number" ? node.fontSize : 16;
    const lineHeight =
      typeof node.lineHeight === "number" ? node.lineHeight : fontSize * 1.2;
    const approxCharsPerLine = Math.max(
      1,
      Math.floor(width / Math.max(fontSize * 0.55, 1)),
    );
    const explicitLines = node.content.split(/\r?\n/);
    const estimatedLines = explicitLines.reduce(
      (total, line) =>
        total + Math.max(1, Math.ceil(line.length / approxCharsPerLine)),
      0,
    );
    if (estimatedLines * lineHeight <= height) continue;
    issues.push({
      severity: "warning",
      code: "text_overflow",
      nodeId: node.id,
      fieldPath: "content",
      reason: `Text node ${node.id} likely overflows its fixed ${width}x${height} bounds.`,
      suggestedFix:
        "Increase the text box height, reduce font size, or switch textGrowth away from fixed-width-height.",
      bounds: getNodeBounds(node),
    });
  }
}

function validateComponentRefs(
  nodes: PenNode[],
  allNodeIds: Set<string>,
  issues: CanvasValidationIssue[],
) {
  for (const node of nodes) {
    if (node.type === "ref" && !allNodeIds.has(node.ref)) {
      issues.push({
        severity: "warning",
        code: "invalid_component_ref",
        nodeId: node.id,
        fieldPath: "ref",
        reason: `Ref node ${node.id} points to missing component ${node.ref}.`,
        suggestedFix:
          "Point the ref to an existing reusable component node or replace it with editable nodes.",
        bounds: getNodeBounds(node),
      });
    }
  }
}

function validateAgentOutputVisibility(
  nodes: PenNode[],
  issues: CanvasValidationIssue[],
) {
  for (const node of nodes) {
    if (!node.createdByAgentId && !node.runId) continue;
    if (node.visible === false || node.locked) {
      issues.push({
        severity: "warning",
        code: "hidden_or_locked_agent_output",
        nodeId: node.id,
        reason: `Agent output node ${node.id} is ${node.visible === false ? "hidden" : "locked"}.`,
        suggestedFix:
          "Make final Agent output visible and editable unless the user explicitly requested otherwise.",
        bounds: getNodeBounds(node),
      });
    }
  }
}

function filterIssuesBySeverity(
  issues: CanvasValidationIssue[],
  threshold: CanvasValidationSeverity,
) {
  const rank = severityRank(threshold);
  return issues.filter((issue) => severityRank(issue.severity) >= rank);
}

function severityRank(severity: CanvasValidationSeverity) {
  if (severity === "error") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function countIssues(issues: CanvasValidationIssue[]) {
  return {
    info: issues.filter((issue) => issue.severity === "info").length,
    warning: issues.filter((issue) => issue.severity === "warning").length,
    error: issues.filter((issue) => issue.severity === "error").length,
  };
}

function collectVariableNames(value: unknown, names: Set<string>) {
  if (typeof value === "string") {
    if (value.startsWith("$") && value.length > 1) names.add(value.slice(1));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectVariableNames(item, names);
    return;
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    collectVariableNames(item, names);
  }
}

function looksLikeDocumentAssetReference(value: string) {
  return (
    value.startsWith("asset:") ||
    value.startsWith("__asset:") ||
    (!value.includes("/") &&
      !value.startsWith("data:") &&
      !value.startsWith("blob:"))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
