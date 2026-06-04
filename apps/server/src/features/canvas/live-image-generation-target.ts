import {
  type CanvasBounds,
  type CanvasOperation,
  type CucumberCanvasDocument,
  connectorPointForNodeBounds,
  createNodeId,
  findNode,
  getNodeBounds,
  isContainerNode,
} from "@cucumber/canvas-core";
import type { FrameNode, LineNode, PenNode } from "@cucumber/pen-types";

import { agentExecutionConnectorStroke } from "../../mcp/tools/agent-execution-visual-style.js";
import type { AuthenticatedUser } from "../../supabase/user.js";
import { IMAGE_GENERATION_LOADING_META_ROLE } from "./canvas-element-writer.js";
import type { LiveCanvasService } from "./live-canvas-service.js";

const GENERATED_IMAGE_TARGET_WIDTH = 600;
const GENERATED_IMAGE_TARGET_HEIGHT = 640;
const GENERATED_IMAGE_TARGET_GAP = 64;

export type ImageGenerationTargetResolution = {
  targetContainerId?: string;
  createdTargetContainerId?: string;
  clearExplicitPlacement: boolean;
};

export async function ensureImageGenerationTargetContainer(args: {
  agentExecutionNodeId?: string;
  canvasId: string;
  liveCanvasService: LiveCanvasService;
  requestedTargetContainerId?: string;
  title: string;
  transactionId: string;
  user: AuthenticatedUser;
}): Promise<ImageGenerationTargetResolution> {
  const requestedTargetContainerId = args.requestedTargetContainerId?.trim();
  const agentExecutionNodeId = args.agentExecutionNodeId?.trim();
  if (!agentExecutionNodeId) {
    return {
      ...(requestedTargetContainerId
        ? { targetContainerId: requestedTargetContainerId }
        : {}),
      clearExplicitPlacement: false,
    };
  }

  const liveState = await args.liveCanvasService.getDocumentState(
    args.user,
    args.canvasId,
  );

  if (
    requestedTargetContainerId &&
    requestedTargetContainerId !== agentExecutionNodeId
  ) {
    assertVisibleImageTarget(liveState.document, requestedTargetContainerId);
    return {
      targetContainerId: requestedTargetContainerId,
      clearExplicitPlacement: false,
    };
  }

  const executionNode = findNode(liveState.document, agentExecutionNodeId);
  if (!executionNode) {
    throw new Error(
      `Cannot create image result container because Agent execution node ${agentExecutionNodeId} does not exist on the live canvas.`,
    );
  }
  if (executionNode.visible === false) {
    throw new Error(
      `Cannot create image result container because Agent execution node ${agentExecutionNodeId} is hidden.`,
    );
  }

  const plan = buildImageGenerationTargetPlan({
    doc: liveState.document,
    executionNode,
    title: args.title,
  });
  const patchResult = await args.liveCanvasService.patchDocument(
    args.user,
    args.canvasId,
    {
      baseVersion: liveState.version,
      operations: plan.operations,
      selection: [plan.targetContainerId],
      transactionId: args.transactionId,
    },
  );
  console.info("[live-image-generation-target] created", {
    canvasId: args.canvasId,
    connectorNodeId: plan.connectorNodeId,
    executionNodeId: agentExecutionNodeId,
    nextVersion: patchResult.version,
    targetContainerId: plan.targetContainerId,
  });
  return {
    clearExplicitPlacement: true,
    createdTargetContainerId: plan.targetContainerId,
    targetContainerId: plan.targetContainerId,
  };
}

function assertVisibleImageTarget(
  doc: CucumberCanvasDocument,
  targetContainerId: string,
): void {
  const target = findNode(doc, targetContainerId);
  if (!target) {
    throw new Error(
      `Target image container ${targetContainerId} does not exist on the live canvas.`,
    );
  }
  const targetType = (target as PenNode).type;
  if (!isContainerNode(target)) {
    throw new Error(
      `Target image container ${targetContainerId} is type ${targetType}, but generated images require a visible frame or group container.`,
    );
  }
  if (target.visible === false) {
    throw new Error(
      `Target image container ${targetContainerId} is hidden and cannot receive generated images.`,
    );
  }
}

export function buildImageGenerationTargetPlan(args: {
  doc: CucumberCanvasDocument;
  executionNode: PenNode;
  title: string;
}): {
  connectorNodeId: string;
  operations: CanvasOperation[];
  targetContainerId: string;
} {
  const executionBounds = getNodeBounds(args.executionNode);
  const targetBounds = {
    x: executionBounds.x + executionBounds.width + GENERATED_IMAGE_TARGET_GAP,
    y: executionBounds.y,
    width: GENERATED_IMAGE_TARGET_WIDTH,
    height: GENERATED_IMAGE_TARGET_HEIGHT,
  };
  const targetContainerId = createNodeId("agent_image_result");
  const targetNode: FrameNode = {
    id: targetContainerId,
    type: "frame",
    name: args.title || "图片生成结果",
    x: targetBounds.x,
    y: targetBounds.y,
    width: targetBounds.width,
    height: targetBounds.height,
    children: createImageGenerationLoadingChildren(targetBounds),
    clipContent: false,
    containerRole: ["visual"],
    contextSlots: {
      rules: ["generated image result container"],
    },
    permissions: {
      canRead: [],
      canWrite: [],
      isolationLevel: "open",
      owner: "agent",
    },
  };
  const connector = buildImageGenerationConnector(
    args.executionNode,
    targetNode,
  );
  return {
    connectorNodeId: connector.id,
    operations: [
      { type: "insertNode", node: targetNode },
      { type: "insertNode", node: connector },
    ],
    targetContainerId,
  };
}

function createImageGenerationLoadingChildren(bounds: CanvasBounds): PenNode[] {
  const panelWidth = Math.max(120, bounds.width - 88);
  const panelHeight = Math.max(120, bounds.height - 168);
  const panelX = Math.round((bounds.width - panelWidth) / 2);
  const panelY = 88;
  const centerY = panelY + Math.round(panelHeight / 2);
  return [
    {
      id: createNodeId("image_loading_panel"),
      type: "rectangle",
      name: "生成图片加载区域",
      x: panelX,
      y: panelY,
      width: panelWidth,
      height: panelHeight,
      cornerRadius: 14,
      fill: [{ color: "rgba(248,250,252,0.86)", type: "solid" }],
      stroke: {
        fill: [{ color: "rgba(79,70,229,0.22)", type: "solid" }],
        thickness: 1,
      },
      meta: {
        agentCanvasRole: IMAGE_GENERATION_LOADING_META_ROLE,
        diagnosticRole: "visual_placeholder",
      },
    } as PenNode,
    {
      id: createNodeId("image_loading_text"),
      type: "text",
      name: "生成图片状态",
      x: panelX + 36,
      y: Math.max(panelY + 24, centerY - 28),
      width: Math.max(80, panelWidth - 72),
      height: 56,
      content: "图片生成中...",
      fill: [{ color: "rgba(51,65,85,0.74)", type: "solid" }],
      fontFamily: "system-ui, sans-serif",
      fontSize: 18,
      fontWeight: 500,
      lineHeight: 1.3,
      textAlign: "center",
      textAlignVertical: "middle",
      textGrowth: "fixed-width-height",
      meta: {
        agentCanvasRole: IMAGE_GENERATION_LOADING_META_ROLE,
        diagnosticRole: "visual_placeholder",
      },
    } as PenNode,
  ];
}

function buildImageGenerationConnector(
  source: PenNode,
  target: PenNode,
): LineNode {
  const sourceBounds = getNodeBounds(source);
  const targetBounds = getNodeBounds(target);
  const start = connectorPointForNodeBounds(source, sourceBounds, "right", 0.5);
  const end = connectorPointForNodeBounds(target, targetBounds, "left", 0.5);
  return {
    id: createNodeId("connector"),
    type: "line",
    explain: "生成图片",
    name: "生成图片",
    x: start.x,
    y: start.y,
    x2: end.x,
    y2: end.y,
    connector: {
      arrow: false,
      routing: "smooth",
      start: { nodeId: source.id, ratio: 0.5, side: "right" },
      end: { nodeId: target.id, ratio: 0.5, side: "left" },
    },
    stroke: agentExecutionConnectorStroke("accent"),
  };
}
