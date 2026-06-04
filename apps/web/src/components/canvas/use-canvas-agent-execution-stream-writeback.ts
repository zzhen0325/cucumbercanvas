"use client";

import { useCallback } from "react";

import {
  type AgentExecutionNodeMeta,
  type AgentExecutionStreamEntry,
  type AgentExecutionStreamEntryStatus,
  createAgentExecutionContainerFromNodeMeta,
  findNode,
  getAgentExecutionContainerMeta,
  getAgentExecutionContainerMetaUpdates,
  getAgentExecutionMeta,
  getAgentExecutionNodeSemanticUpdates,
  reduceAgentExecutionContainerStreamEvent,
  withAgentExecutionCanvasPresentation,
} from "@cucumber/canvas-core";
import type { PenNode } from "@cucumber/pen-types";
import type { StreamEvent } from "@cucumber/shared";
import type { CanvasApi } from "./canvas-api";

const MAX_ENTRY_COUNT = 12;
const MAX_TEXT_LENGTH = 1800;

export function useCanvasAgentExecutionStreamWriteback(
  canvasApi: CanvasApi | null,
) {
  return useCallback(
    (agentExecutionNodeId: string, event: StreamEvent) => {
      if (!canvasApi) return;
      const node = findNode(canvasApi.getDocument(), agentExecutionNodeId);
      if (!node) return;
      const updates = getAgentExecutionStreamWritebackUpdates(node, event);
      if (!updates) return;
      canvasApi.updateNode(agentExecutionNodeId, updates);
    },
    [canvasApi],
  );
}

export function getAgentExecutionStreamWritebackUpdates(
  node: PenNode,
  event: StreamEvent,
): Partial<PenNode> | null {
  const execution = getAgentExecutionMeta(node);
  if (!execution) return null;
  const currentContainer =
    getAgentExecutionContainerMeta(node) ??
    createAgentExecutionContainerFromNodeMeta({
      containerId: node.id,
      execution,
      legacyDisplayText: getLegacyExecutionDisplayText(node),
    });
  const nextContainer = reduceAgentExecutionContainerStreamEvent(
    currentContainer,
    event,
  );
  const nextExecution = reduceAgentExecutionStreamEvent(execution, event);
  if (nextContainer === currentContainer && nextExecution === execution) {
    return null;
  }
  const semanticUpdates = getAgentExecutionNodeSemanticUpdates(
    node,
    nextExecution,
    {
      containerRole: ["task", "context"],
    },
  );
  const nodeWithSemanticMeta = {
    ...node,
    meta: semanticUpdates.meta ?? node.meta,
  } as PenNode;
  const containerUpdates = getAgentExecutionContainerMetaUpdates(
    nodeWithSemanticMeta,
    nextContainer,
  );
  return {
    ...semanticUpdates,
    meta: containerUpdates.meta,
  };
}

export function reduceAgentExecutionStreamEvent(
  execution: AgentExecutionNodeMeta,
  event: StreamEvent,
): AgentExecutionNodeMeta {
  switch (event.type) {
    case "run.started":
      return present({
        ...execution,
        status: "running",
        summary: execution.summary || "Thinking...",
      });
    case "agent.stage": {
      const entryStatus = mapStageStatus(event.status);
      const label = stageLabel(event.stage);
      return present({
        ...execution,
        status: entryStatus === "failed" ? "failed" : "running",
        summary: event.summary ?? label,
        streamEntries: upsertEntry(execution.streamEntries, {
          id: event.stageId,
          type: "stage",
          label,
          status: entryStatus,
          ...(event.summary ? { content: event.summary } : {}),
          timestamp: event.timestamp,
        }),
      });
    }
    case "thinking.delta": {
      const previous = execution.details?.reasoningSummary ?? "";
      const nextText = clampText(`${previous}${event.delta}`);
      return present({
        ...execution,
        status: "running",
        details: {
          ...(execution.details ?? {}),
          reasoningSummary: nextText,
        },
        streamEntries: upsertEntry(execution.streamEntries, {
          id: `thinking:${event.messageId}`,
          type: "thinking",
          label: "思考",
          status: "running",
          content: nextText,
          timestamp: event.timestamp,
        }),
        summary: "Thinking...",
      });
    }
    case "message.delta": {
      const previous = execution.details?.outputSummary ?? "";
      const nextText = clampText(`${previous}${event.delta}`);
      return present({
        ...execution,
        status: "running",
        details: {
          ...(execution.details ?? {}),
          outputSummary: nextText,
        },
        streamEntries: upsertEntry(execution.streamEntries, {
          id: `message:${event.messageId}`,
          type: "message",
          label: "输出",
          status: "running",
          content: nextText,
          timestamp: event.timestamp,
        }),
        summary: nextText,
      });
    }
    case "tool.started":
      return present({
        ...execution,
        status: "running",
        streamEntries: upsertEntry(execution.streamEntries, {
          id: `tool:${event.toolCallId}`,
          type: "tool",
          label: `调用 ${event.toolName}`,
          status: "running",
          toolName: event.toolName,
          content: summarizeObject(event.input),
          timestamp: event.timestamp,
        }),
        summary: `正在调用 ${event.toolName}`,
      });
    case "tool.completed":
      return present({
        ...execution,
        status: "running",
        artifactNodeIds: collectArtifactNodeIds(
          execution.artifactNodeIds,
          event,
        ),
        streamEntries: upsertEntry(execution.streamEntries, {
          id: `tool:${event.toolCallId}`,
          type: "tool",
          label: `完成 ${event.toolName}`,
          status: "done",
          toolName: event.toolName,
          content: event.outputSummary ?? summarizeObject(event.output),
          timestamp: event.timestamp,
        }),
        summary: event.outputSummary ?? `已完成 ${event.toolName}`,
      });
    case "run.completed":
      return present({
        ...execution,
        status: "done",
        streamEntries: markRunningEntries(execution.streamEntries, "done"),
        summary: execution.summary || "Agent 执行完成。",
      });
    case "run.paused":
      return present({
        ...execution,
        status: "paused",
        streamEntries: markRunningEntries(execution.streamEntries, "paused"),
        summary: event.reason ?? "用户已暂停当前 Agent 执行。",
      });
    case "run.canceled":
      return present({
        ...execution,
        status: "paused",
        streamEntries: markRunningEntries(execution.streamEntries, "paused"),
        summary: "用户已停止当前 Agent 执行。",
      });
    case "run.failed": {
      const reason = getRunFailedReason(event.error);
      return present({
        ...execution,
        failure: {
          step: "Agent 执行",
          reason,
        },
        status: "failed",
        streamEntries: markRunningEntries(execution.streamEntries, "failed"),
        summary: `处理失败：${reason}`,
      });
    }
    default:
      return execution;
  }
}

function present(execution: AgentExecutionNodeMeta): AgentExecutionNodeMeta {
  return withAgentExecutionCanvasPresentation(execution, { collapsed: false });
}

function upsertEntry(
  entries: AgentExecutionStreamEntry[] | undefined,
  next: AgentExecutionStreamEntry,
): AgentExecutionStreamEntry[] {
  const current = entries ?? [];
  const index = current.findIndex((entry) => entry.id === next.id);
  const merged =
    index >= 0
      ? current.map((entry, entryIndex) =>
          entryIndex === index ? { ...entry, ...next } : entry,
        )
      : [...current, next];
  return merged.slice(-MAX_ENTRY_COUNT);
}

function markRunningEntries(
  entries: AgentExecutionStreamEntry[] | undefined,
  status: AgentExecutionStreamEntryStatus,
): AgentExecutionStreamEntry[] | undefined {
  if (!entries?.length) return entries;
  return entries.map((entry) =>
    entry.status === "running" ? { ...entry, status } : entry,
  );
}

function mapStageStatus(
  status: Extract<StreamEvent, { type: "agent.stage" }>["status"],
): AgentExecutionStreamEntry["status"] {
  if (status === "completed") return "done";
  if (status === "failed" || status === "blocked") return "failed";
  return "running";
}

function stageLabel(
  stage: Extract<StreamEvent, { type: "agent.stage" }>["stage"],
): string {
  switch (stage) {
    case "critique":
      return "评审";
    case "design":
      return "设计";
    case "export":
      return "导出";
    case "planning":
      return "规划";
    case "prompt_layering":
      return "理解目标";
    case "replay_checkpoint":
      return "重放检查点";
    case "research":
      return "检索资料";
    case "tool_execution":
      return "执行工具";
  }
}

function summarizeObject(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  try {
    return clampText(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

function getRunFailedReason(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message.trim();
  }
  if (typeof error === "string" && error.trim()) return error.trim();
  return "服务端没有返回具体失败原因，请查看服务端日志。";
}

function collectArtifactNodeIds(
  current: string[] | undefined,
  event: Extract<StreamEvent, { type: "tool.completed" }>,
): string[] | undefined {
  const nodeIds = new Set(current ?? []);
  const outputElementId =
    event.output && typeof event.output.elementId === "string"
      ? event.output.elementId
      : undefined;
  if (outputElementId) nodeIds.add(outputElementId);
  return nodeIds.size ? Array.from(nodeIds) : undefined;
}

function clampText(value: string): string {
  if (value.length <= MAX_TEXT_LENGTH) return value;
  return value.slice(value.length - MAX_TEXT_LENGTH);
}

function getLegacyExecutionDisplayText(node: PenNode): string | undefined {
  const children = (node as { children?: unknown }).children;
  if (!Array.isArray(children)) return undefined;
  const text = children
    .map((child) =>
      child &&
      typeof child === "object" &&
      "characters" in child &&
      typeof (child as { characters?: unknown }).characters === "string"
        ? (child as { characters: string }).characters
        : undefined,
    )
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n")
    .trim();
  return text || undefined;
}
