"use client";

import { useCallback, useEffect, useRef } from "react";

import {
  createAgentRunNode,
  findNode,
  getAgentExecutionMeta,
  getAgentExecutionNodePresentationUpdates,
  getAgentExecutionNodeSemanticUpdates,
  withAgentExecutionCanvasPresentation,
} from "@cucumber/canvas-core";
import type { PenNode } from "@cucumber/pen-types";
import type { CanvasEntry } from "@cucumber/shared";
import type { CanvasApi } from "./canvas-api";

type DraftState = {
  committed: boolean;
  nodeId: string;
};

function getNodeWidth(node: PenNode): number | undefined {
  const width = (node as { width?: unknown }).width;
  return typeof width === "number" && Number.isFinite(width)
    ? width
    : undefined;
}

function getNodeHeight(node: PenNode): number | undefined {
  const height = (node as { height?: unknown }).height;
  return typeof height === "number" && Number.isFinite(height)
    ? height
    : undefined;
}

export function useCanvasPromptDraftNode(canvasApi: CanvasApi | null) {
  const draftRef = useRef<DraftState | null>(null);

  const updateInputNode = useCallback(
    (nodeId: string, text: string, status: "waiting" | "done") => {
      if (!canvasApi) {
        throw new Error("画布尚未初始化，无法同步底部输入节点。");
      }
      const node = findNode(canvasApi.getDocument(), nodeId);
      const execution = getAgentExecutionMeta(node);
      if (!node || !execution) {
        throw new Error(`找不到用户输入节点 ${nodeId}，无法继续同步输入。`);
      }
      const nextExecution = withAgentExecutionCanvasPresentation(
        {
          ...execution,
          status,
          summary: text.trim() || "描述你的目标，Agent 会从这里开始执行。",
        },
        { collapsed: false },
      );
      const updates: Partial<PenNode> = {
        ...getAgentExecutionNodeSemanticUpdates(node, nextExecution, {
          containerRole: ["context"],
        }),
        ...getAgentExecutionNodePresentationUpdates({
          execution: nextExecution,
          node,
          width: getNodeWidth(node),
        }),
      } as Partial<PenNode>;
      canvasApi.updateNode(nodeId, updates);
    },
    [canvasApi],
  );

  const syncDraftText = useCallback(
    (value: string) => {
      if (!canvasApi) return;
      const text = value.trim();
      const draft = draftRef.current;
      if (!text) {
        if (draft && !draft.committed) {
          canvasApi.deleteNode(draft.nodeId);
          console.info("[canvas-agent-composer] draft_input_node.deleted", {
            nodeId: draft.nodeId,
          });
        }
        draftRef.current = null;
        return;
      }
      if (!draft) {
        const node = canvasApi.createAgentInputNode({ text });
        draftRef.current = { committed: false, nodeId: node.id };
        console.info("[canvas-agent-composer] draft_input_node.created", {
          nodeId: node.id,
        });
        return;
      }
      if (!draft.committed) {
        updateInputNode(draft.nodeId, text, "waiting");
      }
    },
    [canvasApi, updateInputNode],
  );

  const prepareEntryForSend = useCallback(
    (value: string): CanvasEntry => {
      if (!canvasApi) {
        throw new Error("画布尚未初始化，无法创建 AgentRunNode。");
      }
      const text = value.trim();
      if (!text) {
        throw new Error("请输入明确目标后再发送。");
      }
      if (!draftRef.current) {
        const node = canvasApi.createAgentInputNode({ text });
        draftRef.current = { committed: false, nodeId: node.id };
      }
      const userGoalNodeId = draftRef.current.nodeId;
      draftRef.current.committed = true;
      updateInputNode(userGoalNodeId, text, "done");
      const userGoalNode = findNode(canvasApi.getDocument(), userGoalNodeId);
      if (!userGoalNode) {
        throw new Error(
          `找不到用户输入节点 ${userGoalNodeId}，无法创建执行链。`,
        );
      }

      const x = userGoalNode.x ?? 0;
      const y =
        (userGoalNode.y ?? 0) + (getNodeHeight(userGoalNode) ?? 84) + 40;
      const width = getNodeWidth(userGoalNode) ?? 240;
      const executionNode = createAgentRunNode({
        summary: "Thinking...",
        title: "AgentRunNode",
        upstreamNodeIds: [userGoalNodeId],
        width,
        x,
        y,
      });
      canvasApi.insertNode(executionNode);
      canvasApi.createConnector({
        start: {
          x: x + width / 2,
          y: (userGoalNode.y ?? 0) + (getNodeHeight(userGoalNode) ?? 84),
        },
        end: {
          x: x + width / 2,
          y,
        },
      });
      canvasApi.setSelection([executionNode.id]);
      draftRef.current = null;
      console.info("[canvas-agent-composer] agent_run_node.created", {
        agentExecutionNodeId: executionNode.id,
        userGoalNodeId,
      });
      return {
        agentExecutionNodeId: executionNode.id,
        userGoalNodeId,
      };
    },
    [canvasApi, updateInputNode],
  );

  useEffect(() => {
    return () => {
      const draft = draftRef.current;
      if (canvasApi && draft && !draft.committed) {
        canvasApi.deleteNode(draft.nodeId);
      }
      draftRef.current = null;
    };
  }, [canvasApi]);

  return { prepareEntryForSend, syncDraftText };
}
