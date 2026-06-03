import {
  type PenNode,
  getActivePage,
  getNodeBounds,
} from "@cucumber/canvas-core";
import { z } from "zod";

import type { CucumberMcpTool } from "../types.js";
import { schemaToJsonSchema } from "../utils.js";
import {
  type AiNativeCanvasToolDeps,
  errorResult,
  jsonResult,
  readAiNativeCanvasLiveContext,
} from "./ai-native-canvas-context.js";
import { indexCanvasNodes } from "./ai-native-canvas-semantic-model.js";
import { validateCanvasDocument } from "./ai-native-canvas-validation.js";

const TOOL_NAME = "critique_canvas";

const critiqueCheckSchema = z.enum([
  "design_hierarchy",
  "visual_consistency",
  "brand_style_adherence",
  "readability",
  "container_role_clarity",
  "deliverable_completeness",
  "validation_summary",
]);

const critiqueCanvasSchema = z.object({
  pageId: z.string().optional(),
  nodeIds: z.array(z.string()).optional(),
  checks: z.array(critiqueCheckSchema).optional(),
  includeValidation: z.boolean().default(true),
  severityThreshold: z.enum(["info", "warning", "error"]).default("info"),
});

type CritiqueSeverity = "info" | "warning" | "error";

type CritiqueFinding = {
  severity: CritiqueSeverity;
  code: string;
  category: z.infer<typeof critiqueCheckSchema>;
  nodeId?: string;
  reason: string;
  suggestedFix: string;
};

const DEFAULT_CHECKS: z.infer<typeof critiqueCheckSchema>[] = [
  "design_hierarchy",
  "visual_consistency",
  "brand_style_adherence",
  "readability",
  "container_role_clarity",
  "deliverable_completeness",
  "validation_summary",
];

export function createCritiqueCanvasMcpTool(
  deps: AiNativeCanvasToolDeps,
): CucumberMcpTool<typeof critiqueCanvasSchema> {
  return {
    name: TOOL_NAME,
    description:
      "Run a deterministic critique pass over the live canvas for hierarchy, visual consistency, brand/style context, readability, container role clarity, deliverable completeness, and validation issue summary. This tool is read-only.",
    schema: critiqueCanvasSchema,
    inputSchema: schemaToJsonSchema(critiqueCanvasSchema),
    execute: async (args, context) => {
      try {
        const input = critiqueCanvasSchema.parse(args);
        const live = await readAiNativeCanvasLiveContext(
          deps,
          context,
          TOOL_NAME,
        );
        const checks = input.checks?.length ? input.checks : DEFAULT_CHECKS;
        const result = critiqueCanvas({
          checks,
          includeValidation: input.includeValidation,
          nodeIds: input.nodeIds,
          pageId: input.pageId,
          severityThreshold: input.severityThreshold,
          doc: live.doc,
        });
        console.info("[ai-native-canvas] critique", {
          canvasId: live.canvasId,
          findingCount: result.findings.length,
          pageId: input.pageId ?? live.doc.activePageId,
          userId: live.user.id,
        });
        return jsonResult({
          canvasId: live.canvasId,
          summary: `Canvas critique produced ${result.findings.length} finding(s).`,
          ...result,
        });
      } catch (error) {
        const payload = {
          error:
            error instanceof Error && "code" in error
              ? String((error as { code: unknown }).code)
              : "critique_canvas_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to critique the live canvas.",
        };
        console.warn("[ai-native-canvas] critique failed", payload);
        return errorResult(payload);
      }
    },
  };
}

function critiqueCanvas(args: {
  checks: z.infer<typeof critiqueCheckSchema>[];
  doc: Parameters<typeof validateCanvasDocument>[0]["doc"];
  includeValidation: boolean;
  nodeIds?: string[];
  pageId?: string;
  severityThreshold: CritiqueSeverity;
}) {
  const page = getActivePage(args.doc, args.pageId);
  const indexed = indexCanvasNodes(page.children);
  const targetIds = args.nodeIds?.length ? new Set(args.nodeIds) : null;
  const targets = targetIds
    ? indexed.filter((entry) => targetIds.has(entry.node.id))
    : indexed;
  const findings: CritiqueFinding[] = [];

  if (args.checks.includes("design_hierarchy")) {
    critiqueHierarchy(targets, findings);
  }
  if (args.checks.includes("visual_consistency")) {
    critiqueVisualConsistency(
      targets.map((entry) => entry.node),
      findings,
    );
  }
  if (args.checks.includes("brand_style_adherence")) {
    critiqueBrandStyle(
      args.doc,
      targets.map((entry) => entry.node),
      findings,
    );
  }
  if (args.checks.includes("container_role_clarity")) {
    critiqueContainerRoles(
      targets.map((entry) => entry.node),
      findings,
    );
  }
  if (args.checks.includes("deliverable_completeness")) {
    critiqueDeliverableCompleteness(
      targets.map((entry) => entry.node),
      findings,
    );
  }

  const validation =
    args.includeValidation || args.checks.includes("validation_summary")
      ? validateCanvasDocument({
          doc: args.doc,
          nodeIds: args.nodeIds,
          pageId: args.pageId,
          severityThreshold: args.severityThreshold,
        })
      : undefined;
  if (validation && args.checks.includes("validation_summary")) {
    for (const issue of validation.issues) {
      findings.push({
        category: "validation_summary",
        code: `validation_${issue.code}`,
        nodeId: issue.nodeId,
        reason: issue.reason,
        severity: issue.severity,
        suggestedFix: issue.suggestedFix,
      });
    }
  }
  const filteredFindings = findings.filter((finding) =>
    passesSeverityThreshold(finding.severity, args.severityThreshold),
  );
  return {
    checkedNodeIds: targets.map((entry) => entry.node.id),
    findingCounts: countFindings(filteredFindings),
    findings: filteredFindings,
    pass: !filteredFindings.some((finding) => finding.severity === "error"),
    validationSummary: validation
      ? {
          issueCounts: validation.issueCounts,
          pass: validation.pass,
        }
      : undefined,
  };
}

function critiqueHierarchy(
  targets: ReturnType<typeof indexCanvasNodes>,
  findings: CritiqueFinding[],
) {
  for (const entry of targets) {
    if (entry.depth > 6) {
      findings.push({
        category: "design_hierarchy",
        code: "deep_hierarchy",
        nodeId: entry.node.id,
        reason: `Node ${entry.node.id} is nested ${entry.depth} levels deep, which can make Agent edits and user inspection harder.`,
        severity: "warning",
        suggestedFix:
          "Flatten incidental wrappers or group the content into clearer Agent output containers.",
      });
    }
  }
}

function critiqueVisualConsistency(
  nodes: PenNode[],
  findings: CritiqueFinding[],
) {
  const textSizes = uniqueNumbers(
    nodes
      .filter((node) => node.type === "text")
      .map((node) => node.fontSize)
      .filter((value): value is number => typeof value === "number"),
  );
  if (textSizes.length > 5) {
    findings.push({
      category: "visual_consistency",
      code: "too_many_text_sizes",
      reason: `Canvas uses ${textSizes.length} text sizes in the critiqued scope.`,
      severity: "warning",
      suggestedFix:
        "Consolidate text sizes into a smaller hierarchy of title, section, body, and caption styles.",
    });
  }
}

function critiqueBrandStyle(
  doc: Parameters<typeof validateCanvasDocument>[0]["doc"],
  nodes: PenNode[],
  findings: CritiqueFinding[],
) {
  const hasStyleContext =
    Object.keys(doc.variables ?? {}).length > 0 ||
    nodes.some((node) => node.contextSlots?.style || node.contextSlots?.tokens);
  if (!hasStyleContext && nodes.length > 0) {
    findings.push({
      category: "brand_style_adherence",
      code: "missing_style_context",
      reason:
        "The critiqued scope has no document variables or container style/token context for brand/style adherence checks.",
      severity: "info",
      suggestedFix:
        "Attach style context to the Agent output container or define document variables before final visual refinement.",
    });
  }
}

function critiqueContainerRoles(nodes: PenNode[], findings: CritiqueFinding[]) {
  for (const node of nodes) {
    if (!isContainerNode(node)) continue;
    const childCount = node.children.length;
    if (
      childCount > 0 &&
      (!node.containerRole || node.containerRole.length === 0)
    ) {
      findings.push({
        category: "container_role_clarity",
        code: "missing_container_role",
        nodeId: node.id,
        reason: `Container ${node.id} has ${childCount} child node(s) but no containerRole.`,
        severity: "warning",
        suggestedFix:
          "Set containerRole to visual, context, task, or dataflow so future Agent passes understand the container purpose.",
      });
    }
  }
}

function critiqueDeliverableCompleteness(
  nodes: PenNode[],
  findings: CritiqueFinding[],
) {
  const containers = nodes.filter(isContainerNode);
  if (containers.length === 0) {
    findings.push({
      category: "deliverable_completeness",
      code: "no_output_container",
      reason:
        "The critiqued scope has no frame/group container for a durable deliverable.",
      severity: "warning",
      suggestedFix:
        "Create an Agent output container before finalizing or exporting this work.",
    });
    return;
  }
  for (const container of containers) {
    if (container.children.length === 0) {
      findings.push({
        category: "deliverable_completeness",
        code: "empty_container",
        nodeId: container.id,
        reason: `Container ${container.id} is empty.`,
        severity: "warning",
        suggestedFix:
          "Add the intended output content or remove the empty container.",
      });
    }
  }
}

function isContainerNode(
  node: PenNode,
): node is PenNode & { children: PenNode[] } {
  return (
    (node.type === "frame" || node.type === "group") &&
    "children" in node &&
    Array.isArray(node.children)
  );
}

function uniqueNumbers(values: number[]) {
  return Array.from(new Set(values));
}

function passesSeverityThreshold(
  severity: CritiqueSeverity,
  threshold: CritiqueSeverity,
) {
  const rank: Record<CritiqueSeverity, number> = {
    info: 0,
    warning: 1,
    error: 2,
  };
  return rank[severity] >= rank[threshold];
}

function countFindings(findings: CritiqueFinding[]) {
  return findings.reduce(
    (counts, finding) => {
      counts[finding.severity] += 1;
      return counts;
    },
    { error: 0, info: 0, warning: 0 } as Record<CritiqueSeverity, number>,
  );
}
