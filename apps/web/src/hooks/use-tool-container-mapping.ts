"use client";

import { useCallback, useRef } from "react";

import {
  type PenNode,
  createNodeId,
  type AgentBinding,
} from "@cucumber/canvas-core";
import type { ToolArtifact } from "@cucumber/shared";

import type { CanvasApi } from "../components/canvas/canvas-surface";

// ── Helpers ──────────────────────────────────────────────────

const TOOL_TITLE_MAP: Record<string, string> = {
  generate_image: "Image Generation",
  generate_video: "Video Generation",
  screenshot_canvas: "Screenshot",
  web_search: "Web Search",
  manipulate_canvas: "Canvas Manipulation",
};

function toolContainerTitle(toolName: string): string {
  return TOOL_TITLE_MAP[toolName] ?? toolName;
}

const DEFAULT_IMAGE_SIZE = { width: 320, height: 220 };

// ── Hook ─────────────────────────────────────────────────────

type UseToolContainerMappingOptions = {
  canvasApi: CanvasApi | null;
};

/**
 * Manages the mapping between stream toolCallIds and canvas container nodes.
 * Creates containers on tool.started, populates content on tool.completed,
 * and marks errors on run.failed/canceled.
 */
export function useToolContainerMapping({
  canvasApi,
}: UseToolContainerMappingOptions) {
  // toolCallId → containerId
  const mappingRef = useRef<Map<string, string>>(new Map());
  // Track which toolCallIds we've handled so we don't create duplicates
  const seenRef = useRef<Set<string>>(new Set());

  const createToolContainer = useCallback(
    (toolCallId: string, toolName: string) => {
      if (!canvasApi) return;
      if (seenRef.current.has(toolCallId)) return;
      seenRef.current.add(toolCallId);

      const container = canvasApi.createContainer({
        name: toolContainerTitle(toolName),
      });

      const binding: AgentBinding = {
        status: "running",
        toolCallId,
        toolName,
        createdAt: Date.now(),
        role: "assistant",
        name: toolName,
      };
      canvasApi.bindAgentToContainer(container.id, binding);

      mappingRef.current.set(toolCallId, container.id);
      console.info("[tool-container] created", {
        toolCallId,
        toolName,
        containerId: container.id,
      });
    },
    [canvasApi],
  );

  const completeToolContainer = useCallback(
    (
      toolCallId: string,
      toolName: string,
      output?: Record<string, unknown>,
      outputSummary?: string,
      artifacts?: ToolArtifact[],
      backendInserted?: boolean,
    ) => {
      const containerId = mappingRef.current.get(toolCallId);
      if (!canvasApi || !containerId) return;

      // When backend already inserted the element, skip child node creation
      // (canvas.sync will show the server-side content)
      if (!backendInserted) {
        // Insert child content based on tool type
        if (toolName === "generate_image" || toolName === "screenshot_canvas") {
          const artifact = artifacts?.[0];
          if (artifact?.url) {
            const imageId = createNodeId("image");
            const assetId = createNodeId("asset");
            const imageNode = {
              id: imageId,
              type: "image",
              x: 32,
              y: 48,
              width: artifact.width ?? DEFAULT_IMAGE_SIZE.width,
              height: artifact.height ?? DEFAULT_IMAGE_SIZE.height,
              name: outputSummary ?? "Generated image",
              assetId,
              src: artifact.url,
              alt: outputSummary,
              meta: { source: "generated" },
            } as any;
            canvasApi.insertNode(imageNode, containerId);
          }
        } else if (toolName === "generate_video") {
          const artifact = artifacts?.[0];
          if (artifact?.url) {
            const vid = artifact as { durationSeconds?: number; mimeType?: string };
            const videoId = createNodeId("videoEmbed");
            const videoNode = {
              id: videoId,
              type: "videoEmbed",
              x: 32,
              y: 48,
              width: artifact.width ?? 360,
              height: artifact.height ?? 220,
              name: outputSummary ?? "Generated video",
              src: artifact.url,
              mimeType: vid.mimeType ?? "video/mp4",
              durationSeconds: vid.durationSeconds,
            } as any;
            canvasApi.insertNode(videoNode, containerId);
          }
        } else {
          // Generic tool: insert TextNode with output summary
          const textContent =
            outputSummary ?? (output ? JSON.stringify(output, null, 2) : "");
          if (textContent) {
            const textId = createNodeId("text");
            const textNode = {
              id: textId,
              type: "text",
              x: 16, y: 48, width: 328, height: 160,
              content: textContent,
              fontSize: 13,
              color: "#374151",
            } as any;
            canvasApi.insertNode(textNode, containerId);
          }
        }
      }

      // Update agent binding status to completed
      canvasApi.updateNode(containerId, {
        agentBinding: {
          status: "completed",
          toolCallId,
          toolName,
        },
      } as Partial<PenNode>);

      // Update container title with summary if available
      if (outputSummary) {
        canvasApi.updateNode(containerId, {
          name: outputSummary.length > 60
              ? `${outputSummary.slice(0, 57)}...`
              : outputSummary,
        } as Partial<PenNode>);
      }

      mappingRef.current.delete(toolCallId);
      console.info("[tool-container] completed", {
        toolCallId,
        containerId,
      });
    },
    [canvasApi],
  );

  const failToolContainer = useCallback(
    (toolCallId: string) => {
      const containerId = mappingRef.current.get(toolCallId);
      if (!canvasApi || !containerId) return;

      canvasApi.updateNode(containerId, {
        agentBinding: { status: "error", toolCallId } as AgentBinding,
      } as Partial<PenNode>);
      mappingRef.current.delete(toolCallId);
      console.info("[tool-container] failed", { toolCallId, containerId });
    },
    [canvasApi],
  );

  /** Mark all currently running containers as error (run.failed/canceled) */
  const failAllPending = useCallback(() => {
    for (const [toolCallId, containerId] of mappingRef.current) {
      if (canvasApi) {
        canvasApi.updateNode(containerId, {
          agentBinding: { status: "error", toolCallId } as AgentBinding,
        } as Partial<PenNode>);
      }
      console.info("[tool-container] failed (batch)", {
        toolCallId,
        containerId,
      });
    }
    mappingRef.current.clear();
    seenRef.current.clear();
  }, [canvasApi]);

  /** Check if we have a container tracking for this toolCallId */
  const hasContainer = useCallback(
    (toolCallId: string) => mappingRef.current.has(toolCallId),
    [],
  );

  return {
    createToolContainer,
    completeToolContainer,
    failToolContainer,
    failAllPending,
    hasContainer,
  };
}
