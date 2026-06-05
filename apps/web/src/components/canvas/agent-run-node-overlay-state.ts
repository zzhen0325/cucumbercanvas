import {
  type AgentExecutionContainer,
  type CanvasViewport,
  type CucumberCanvasDocument,
  flattenNodes,
  getAgentExecutionCanvasCollapsed,
  getAgentExecutionContainerMeta,
  getAgentExecutionMeta,
  getNodeSceneBounds,
  isDescendantOf,
} from "@cucumber/canvas-core";
import {
  type TransformPreviewState,
  type ViewportState,
  sceneToCanvasLocal,
} from "@cucumber/pen-renderer";
import type { PenNode } from "@cucumber/pen-types";

export type AgentRunNodeOverlayState = {
  collapsed: boolean;
  container: AgentExecutionContainer;
  height: number;
  node: PenNode;
  width: number;
  x: number;
  y: number;
  zoom: number;
};

export function getAgentRunNodeOverlayStates(input: {
  activePageId: string | null | undefined;
  document: CucumberCanvasDocument;
  transformPreview?: TransformPreviewState | null;
  viewport: Partial<CanvasViewport>;
}): AgentRunNodeOverlayState[] {
  const viewport = toRendererViewport(input.viewport);
  return flattenNodes(input.document, input.activePageId)
    .map((node) => {
      const container = getAgentExecutionContainerMeta(node);
      if (!container || container.kind !== "agent_run_node") {
        return null;
      }
      const executionShell = getAgentExecutionMeta(node);
      const collapsed = getAgentExecutionCanvasCollapsed(executionShell);
      const bounds = getNodeSceneBounds(
        input.document,
        node.id,
        input.activePageId,
      );
      if (!bounds) return null;
      const previewBounds = applyTransformPreviewToBounds({
        activePageId: input.activePageId,
        bounds,
        document: input.document,
        node,
        transformPreview: input.transformPreview ?? null,
      });
      const topLeft = sceneToCanvasLocal(
        previewBounds.x,
        previewBounds.y,
        viewport,
      );
      const bottomRight = sceneToCanvasLocal(
        previewBounds.x + previewBounds.width,
        previewBounds.y + previewBounds.height,
        viewport,
      );
      const width = Math.max(1, bottomRight.x - topLeft.x);
      const height = Math.max(1, bottomRight.y - topLeft.y);
      return {
        collapsed,
        container,
        height,
        node,
        width,
        x: topLeft.x,
        y: topLeft.y,
        zoom: viewport.zoom,
      } satisfies AgentRunNodeOverlayState;
    })
    .filter((state): state is AgentRunNodeOverlayState => state !== null);
}

function applyTransformPreviewToBounds(input: {
  activePageId: string | null | undefined;
  bounds: { height: number; width: number; x: number; y: number };
  document: CucumberCanvasDocument;
  node: PenNode;
  transformPreview: TransformPreviewState | null;
}) {
  const { activePageId, bounds, document, node, transformPreview } = input;
  if (!transformPreview || !activePageId) return bounds;
  if (transformPreview.kind === "move") {
    const moved = transformPreview.nodeIds.some(
      (nodeId) =>
        nodeId === node.id ||
        isDescendantOf(document, node.id, nodeId, activePageId),
    );
    if (!moved) return bounds;
    return {
      ...bounds,
      x: bounds.x + transformPreview.dx,
      y: bounds.y + transformPreview.dy,
    };
  }
  if (
    transformPreview.kind === "resize" &&
    transformPreview.nodeId === node.id
  ) {
    return transformPreview.bounds;
  }
  return bounds;
}

function toRendererViewport(viewport: Partial<CanvasViewport>): ViewportState {
  const zoom =
    typeof viewport.zoom === "number" && Number.isFinite(viewport.zoom)
      ? viewport.zoom
      : 1;
  return {
    zoom: zoom > 0 ? zoom : 1,
    panX:
      typeof viewport.x === "number" && Number.isFinite(viewport.x)
        ? viewport.x
        : 0,
    panY:
      typeof viewport.y === "number" && Number.isFinite(viewport.y)
        ? viewport.y
        : 0,
  };
}
