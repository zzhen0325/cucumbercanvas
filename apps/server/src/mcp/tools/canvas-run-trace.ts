import {
  type PenDocument,
  type PenNode,
  findNode,
  getActivePage,
  getNodeSceneBounds,
} from "@cucumber/canvas-core";
import type { StreamEvent } from "@cucumber/shared";
import { z } from "zod";

import type { CucumberMcpTool } from "../types.js";
import { schemaToJsonSchema } from "../utils.js";
import {
  type AiNativeCanvasToolDeps,
  compactRecord,
  errorResult,
  jsonResult,
  readAiNativeCanvasLiveContext,
} from "./ai-native-canvas-context.js";

const TOOL_NAME = "canvas_run_trace";

const canvasRunTraceSchema = z.object({
  runId: z.string().optional(),
  sessionId: z.string().optional(),
  nodeIds: z.array(z.string()).optional(),
  pageId: z.string().optional(),
  includeEvents: z.boolean().default(true),
  includeCanvasNodes: z.boolean().default(true),
  includeToolPayloads: z.boolean().default(false),
  maxEvents: z.number().int().min(1).max(500).default(100),
});

type TraceToolCall = {
  completedAt?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  outputSummary?: string;
  startedAt?: string;
  status: "running" | "completed";
  toolCallId: string;
  toolName: string;
};

export function createCanvasRunTraceMcpTool(
  deps: AiNativeCanvasToolDeps,
): CucumberMcpTool<typeof canvasRunTraceSchema> {
  return {
    name: TOOL_NAME,
    description:
      "Read the recent Agent run trace for the live canvas from the event buffer and live PenDocument metadata. Returns run/tool/canvas patch events, affected node IDs, and run-bound canvas nodes without mutating the canvas.",
    schema: canvasRunTraceSchema,
    inputSchema: schemaToJsonSchema(canvasRunTraceSchema),
    execute: async (args, context) => {
      try {
        const input = canvasRunTraceSchema.parse(args);
        const live = await readAiNativeCanvasLiveContext(
          deps,
          context,
          TOOL_NAME,
        );
        const result = readCanvasRunTrace({
          doc: live.doc,
          canvasId: live.canvasId,
          deps,
          includeCanvasNodes: input.includeCanvasNodes,
          includeEvents: input.includeEvents,
          includeToolPayloads: input.includeToolPayloads,
          maxEvents: input.maxEvents,
          nodeIds: input.nodeIds,
          pageId: input.pageId,
          runId: input.runId,
          sessionId: input.sessionId,
        });
        console.info("[ai-native-canvas] run_trace.read", {
          canvasId: live.canvasId,
          eventCount: result.events.length,
          linkedNodeCount: result.linkedNodes.length,
          runId: input.runId,
          userId: live.user.id,
        });
        return jsonResult({
          canvasId: live.canvasId,
          summary: `Read ${result.events.length} trace event(s) and ${result.linkedNodes.length} linked canvas node(s).`,
          ...result,
        });
      } catch (error) {
        const payload = {
          error:
            error instanceof Error && "code" in error
              ? String((error as { code: unknown }).code)
              : "canvas_run_trace_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to read the canvas run trace.",
        };
        console.warn("[ai-native-canvas] run_trace.read failed", payload);
        return errorResult(payload);
      }
    },
  };
}

function readCanvasRunTrace(args: {
  canvasId: string;
  deps: AiNativeCanvasToolDeps;
  doc: PenDocument;
  includeCanvasNodes: boolean;
  includeEvents: boolean;
  includeToolPayloads: boolean;
  maxEvents: number;
  nodeIds?: string[];
  pageId?: string;
  runId?: string;
  sessionId?: string;
}) {
  const activeRun = args.deps.eventBuffer?.getActiveRun(args.canvasId);
  const events = args.includeEvents
    ? readTraceEvents({
        activeRunId: activeRun?.runId,
        canvasId: args.canvasId,
        deps: args.deps,
        maxEvents: args.maxEvents,
        runId: args.runId,
        sessionId: args.sessionId,
      })
    : [];
  const linkedNodes = args.includeCanvasNodes
    ? collectRunLinkedNodes({
        doc: args.doc,
        nodeIds: args.nodeIds,
        pageId: args.pageId,
        runId: args.runId,
        sessionId: args.sessionId,
      })
    : [];
  const canvasPatches = events
    .filter((event) => event.type === "canvas.patch")
    .map((event) => summarizeCanvasPatch(event));
  const affectedNodeIds = uniqueSorted(
    canvasPatches.flatMap((patch) => patch.affectedNodeIds),
  );

  return {
    run: compactRecord({
      activeRun,
      requestedRunId: args.runId,
      sessionId: args.sessionId,
      runIdsInEvents: uniqueSorted(events.map((event) => event.runId)),
      status: inferRunStatus(events, activeRun?.runId ?? args.runId),
    }),
    sources: {
      eventBuffer: args.includeEvents,
      liveCanvasDocument: args.includeCanvasNodes,
    },
    events: events.map((event) => summarizeTraceEvent(event)),
    toolCalls: summarizeToolCalls(events, args.includeToolPayloads),
    canvasPatches,
    affectedNodeIds,
    linkedNodeIds: linkedNodes.map((node) => node.id),
    linkedNodes,
  };
}

function readTraceEvents(args: {
  activeRunId?: string;
  canvasId: string;
  deps: AiNativeCanvasToolDeps;
  maxEvents: number;
  runId?: string;
  sessionId?: string;
}): StreamEvent[] {
  if (!args.deps.eventBuffer) {
    throw new Error(
      "canvas_run_trace requires the Agent event buffer when includeEvents is true.",
    );
  }
  const targetRunId = args.runId ?? args.activeRunId;
  return args.deps.eventBuffer
    .getAfter(args.canvasId)
    .map((entry) => entry.event)
    .filter((event) => {
      if (targetRunId && event.runId !== targetRunId) return false;
      if (args.sessionId && "sessionId" in event) {
        return event.sessionId === args.sessionId;
      }
      return true;
    })
    .slice(-args.maxEvents);
}

function summarizeTraceEvent(event: StreamEvent) {
  return compactRecord({
    type: event.type,
    runId: event.runId,
    timestamp: event.timestamp,
    toolCallId: "toolCallId" in event ? event.toolCallId : undefined,
    toolName: "toolName" in event ? event.toolName : undefined,
    transactionId: "transactionId" in event ? event.transactionId : undefined,
    operationCount:
      "operations" in event && Array.isArray(event.operations)
        ? event.operations.length
        : undefined,
    affectedNodeIds:
      event.type === "canvas.patch"
        ? summarizeCanvasPatch(event).affectedNodeIds
        : undefined,
  });
}

function summarizeToolCalls(
  events: StreamEvent[],
  includePayloads: boolean,
): TraceToolCall[] {
  const calls = new Map<string, TraceToolCall>();
  for (const event of events) {
    if (event.type === "tool.started") {
      calls.set(event.toolCallId, {
        ...(includePayloads && event.input ? { input: event.input } : {}),
        startedAt: event.timestamp,
        status: "running",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
      });
      continue;
    }
    if (event.type === "tool.completed") {
      const existing = calls.get(event.toolCallId);
      calls.set(event.toolCallId, {
        ...(existing ?? {
          status: "running",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
        }),
        completedAt: event.timestamp,
        ...(includePayloads && event.output ? { output: event.output } : {}),
        ...(event.outputSummary ? { outputSummary: event.outputSummary } : {}),
        status: "completed",
      });
    }
  }
  return Array.from(calls.values());
}

function summarizeCanvasPatch(
  event: Extract<StreamEvent, { type: "canvas.patch" }>,
) {
  const affectedNodeIds = uniqueSorted(
    event.operations.flatMap((operation) =>
      extractOperationNodeIds(operation as Record<string, unknown>),
    ),
  );
  return {
    affectedNodeIds,
    baseVersion: event.baseVersion,
    operationCount: event.operations.length,
    operations: event.operations.map((operation) =>
      compactRecord({
        type:
          typeof operation.type === "string" ? operation.type : "unknown_patch",
        nodeIds: extractOperationNodeIds(operation as Record<string, unknown>),
      }),
    ),
    runId: event.runId,
    timestamp: event.timestamp,
    transactionId: event.transactionId,
  };
}

function collectRunLinkedNodes(args: {
  doc: PenDocument;
  nodeIds?: string[];
  pageId?: string;
  runId?: string;
  sessionId?: string;
}) {
  const page = getActivePage(args.doc, args.pageId);
  const explicitNodeIds = args.nodeIds?.length ? args.nodeIds : undefined;
  const nodes = explicitNodeIds
    ? explicitNodeIds.map((nodeId) => {
        const node = findNode(args.doc, nodeId, page.id);
        if (!node) {
          throw new Error(`canvas_run_trace node ${nodeId} does not exist.`);
        }
        return node;
      })
    : collectNodes(page.children);
  return nodes
    .filter((node) => matchesTraceNode(node, args.runId, args.sessionId))
    .map((node) =>
      compactRecord({
        id: node.id,
        type: node.type,
        name: node.name,
        bounds: getNodeSceneBounds(args.doc, node.id, page.id),
        agentBinding: node.agentBinding,
        createdByAgentId: node.createdByAgentId,
        runId: node.runId,
        sessionId: node.sessionId,
      }),
    );
}

function matchesTraceNode(node: PenNode, runId?: string, sessionId?: string) {
  if (runId && node.runId !== runId) return false;
  if (sessionId && node.sessionId !== sessionId) return false;
  if (runId || sessionId) return true;
  return Boolean(node.runId || node.sessionId || node.agentBinding);
}

function collectNodes(nodes: PenNode[]) {
  const result: PenNode[] = [];
  const visit = (node: PenNode) => {
    result.push(node);
    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children) visit(child);
    }
  };
  for (const node of nodes) visit(node);
  return result;
}

function extractOperationNodeIds(operation: Record<string, unknown>) {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && value.trim()) ids.add(value);
  };
  add(operation.nodeId);
  add(operation.parentId);
  add(operation.newParentId);
  if (Array.isArray(operation.nodeIds)) {
    for (const nodeId of operation.nodeIds) add(nodeId);
  }
  const node = operation.node;
  if (isRecord(node)) add(node.id);
  return Array.from(ids);
}

function inferRunStatus(events: StreamEvent[], runId?: string) {
  if (runId && events.every((event) => event.runId !== runId)) {
    return undefined;
  }
  const terminal = [...events]
    .reverse()
    .find((event) =>
      ["run.completed", "run.failed", "run.canceled", "run.paused"].includes(
        event.type,
      ),
    );
  if (!terminal) return events.length > 0 ? "running" : undefined;
  if (terminal.type === "run.completed") return "completed";
  if (terminal.type === "run.failed") return "failed";
  return "canceled";
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
