"use client";

import { getAgentRunNodeViewModel, getNodeBounds } from "@cucumber/canvas-core";
import type { PenNode } from "@cucumber/pen-types";
import { useCallback, useMemo, useRef } from "react";

import { AgentRunNodeContentView } from "./agent-run-node-content-view";
import {
  type AgentRunNodeOverlayState,
  getAgentRunNodeOverlayStates,
} from "./agent-run-node-overlay-state";
import type { CanvasApi } from "./canvas-api";
import {
  useCanvasRuntimeShallowSelector,
  useCanvasRuntimeStoreApi,
} from "./canvas-runtime-store";
import {
  AGENT_RUN_NODE_SIZE_WRITEBACK_EPSILON,
  useAgentRunNodeAutosize,
} from "./use-agent-run-node-autosize";

export { getAgentRunNodeOverlayStates };

type AgentRunNodeContentLayerProps = {
  api: CanvasApi;
};

export function AgentRunNodeContentLayer({
  api,
}: AgentRunNodeContentLayerProps) {
  const store = useCanvasRuntimeStoreApi();
  const { activePageId, document, transformPreview, viewport } =
    useCanvasRuntimeShallowSelector((state) => ({
      activePageId: state.activePageId,
      document: state.document,
      transformPreview: state.transformPreview,
      viewport: state.viewport,
    }));
  const overlays = useMemo(
    () =>
      getAgentRunNodeOverlayStates({
        activePageId,
        document,
        transformPreview,
        viewport,
      }),
    [activePageId, document, transformPreview, viewport],
  );

  const handleResize = useCallback(
    (node: PenNode, size: { height: number; width: number }) => {
      const currentBounds = getNodeBounds(node);
      if (
        Math.abs(currentBounds.width - size.width) <
          AGENT_RUN_NODE_SIZE_WRITEBACK_EPSILON &&
        Math.abs(currentBounds.height - size.height) <
          AGENT_RUN_NODE_SIZE_WRITEBACK_EPSILON
      ) {
        return;
      }
      api.updateNode(node.id, {
        height: size.height,
        width: size.width,
      });
      console.info("[canvas-agent-run-node] content.resize", {
        height: size.height,
        nodeId: node.id,
        width: size.width,
      });
    },
    [api],
  );

  if (overlays.length === 0) return null;

  return (
    <div
      aria-label="AgentRunNode content layer"
      className="pointer-events-none absolute inset-0 z-10"
      data-canvas-overlay="agent-run-node-content-layer"
    >
      {overlays.map((overlay) =>
        overlay.collapsed ? null : (
          <AgentRunNodeContentOverlay
            key={overlay.node.id}
            overlay={overlay}
            onResize={handleResize}
            onSelectArtifact={(nodeId) => {
              store.getState().setSelection([nodeId], {
                source: "agent-run-node-content.artifact.select",
              });
              console.info("[canvas-agent-run-node] artifact.select", {
                agentRunNodeId: overlay.node.id,
                artifactNodeId: nodeId,
              });
            }}
          />
        ),
      )}
    </div>
  );
}

function AgentRunNodeContentOverlay({
  overlay,
  onResize,
  onSelectArtifact,
}: {
  overlay: AgentRunNodeOverlayState;
  onResize: (node: PenNode, size: { height: number; width: number }) => void;
  onSelectArtifact: (nodeId: string) => void;
}) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const viewModel = getAgentRunNodeViewModel(overlay.container);
  useAgentRunNodeAutosize({
    enabled: !overlay.collapsed,
    node: overlay.node,
    onResize,
    sectionRef,
    zoom: overlay.zoom,
  });

  return (
    <section
      ref={sectionRef}
      aria-label={`AgentRunNode：${viewModel.title}`}
      className="pointer-events-auto absolute overflow-hidden rounded-[18px] border border-success/20 bg-[#F8FFBF] text-foreground shadow-card"
      data-canvas-overlay="agent-run-node-content"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDownCapture={(event) => {
        if (shouldKeepPointerInContent(event.target)) {
          event.stopPropagation();
        }
      }}
      onWheel={(event) => event.stopPropagation()}
      style={{
        height: overlay.height,
        left: overlay.x,
        top: overlay.y,
        width: overlay.width,
      }}
    >
      <AgentRunNodeContentView
        onSelectArtifact={onSelectArtifact}
        viewModel={viewModel}
      />
    </section>
  );
}

function shouldKeepPointerInContent(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'button,a,input,textarea,select,[role="button"],pre,[data-agent-run-node-scroll-region]',
    ),
  );
}
