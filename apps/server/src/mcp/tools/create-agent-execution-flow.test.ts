import {
  type CanvasOperation,
  applyCanvasTransaction,
  createCanvasDocument,
  findNode,
  flattenNodes,
  getAgentExecutionMeta,
} from "@cucumber/canvas-core";
import type {
  FrameNode,
  LineNode,
  PenDocument,
  PenNode,
} from "@cucumber/pen-types";
import { describe, expect, it, vi } from "vitest";

import { createCucumberMcpServer } from "../server.js";
import {
  AGENT_EXECUTION_CARD_CORNER_RADIUS,
  AGENT_EXECUTION_CONNECTOR_THICKNESS,
} from "./agent-execution-visual-style.js";

function context() {
  return {
    configurable: {
      access_token: "token",
      canvas_id: "canvas-1",
      user_id: "user-1",
    },
  };
}

function createExecutionDoc() {
  return createCanvasDocument("Agent execution flow") as PenDocument & {
    selection?: string[];
  };
}

function createExecutionServer(
  initialDoc = createExecutionDoc(),
  initialVersion = 11,
) {
  const state = {
    doc: initialDoc,
    patchCalls: [] as {
      baseVersion: number;
      operations: CanvasOperation[];
      selection?: string[];
      transactionId: string;
    }[],
    version: initialVersion,
  };
  const patchDocument = vi.fn(async (_user, _canvasId, patch) => {
    if (patch.baseVersion !== state.version) {
      throw new Error(
        `Canvas patch version mismatch. The live document is at version ${state.version}, but the patch was based on version ${patch.baseVersion}.`,
      );
    }
    const result = applyCanvasTransaction(state.doc, patch.operations, {
      transactionId: patch.transactionId,
    });
    state.doc = {
      ...result.doc,
      selection: patch.selection ?? state.doc.selection,
    } as typeof state.doc;
    state.version += 1;
    state.patchCalls.push(patch);
    return { version: state.version };
  });
  const server = createCucumberMcpServer({} as never, {
    createUserClient: () => ({}),
    liveCanvasService: {
      getDocument: async () => state.doc,
      getDocumentState: async () => ({
        document: state.doc,
        version: state.version,
      }),
      patchDocument,
    } as never,
  });
  return { patchDocument, server, state };
}

describe("create_agent_execution_flow", () => {
  it("creates a durable execution chain with steps, tool calls, critique, final deliverable, and checkpoint", async () => {
    const { server, state } = createExecutionServer();

    const result = await server.callTool(
      "create_agent_execution_flow",
      {
        agentId: "agent-1",
        finalTitle: "品牌海报交付物",
        recipeTitle: "品牌海报 Recipe",
        runId: "run-1",
        sessionId: "session-1",
        steps: [
          {
            status: "done",
            summary: "读取当前画布和用户约束。",
            title: "理解目标",
          },
          {
            status: "running",
            summary: "生成首屏视觉主图。",
            title: "生成视觉资产",
            toolName: "generate_image",
          },
        ],
        userGoal: "为新咖啡品牌做一张活动海报",
      },
      context(),
    );

    expect(result).toMatchObject({
      structuredContent: {
        appliedOperationCount: 15,
        checkpointNodeId: expect.any(String),
        connectorNodeIds: expect.arrayContaining([expect.any(String)]),
        critiqueNodeId: expect.any(String),
        finalDeliverableNodeId: expect.any(String),
        nextDocumentVersion: 12,
        previewedOperationCount: 15,
        recipeNodeId: expect.any(String),
        taskStepNodeIds: [expect.any(String), expect.any(String)],
        toolCallNodeIds: [expect.any(String)],
        userGoalNodeId: expect.any(String),
      },
    });
    const payload = result.structuredContent as {
      checkpointNodeId: string;
      connectorNodeIds: string[];
      critiqueNodeId: string;
      finalDeliverableNodeId: string;
      recipeNodeId: string;
      taskStepNodeIds: string[];
      toolCallNodeIds: string[];
      userGoalNodeId: string;
    };
    const topLevelNodes = state.doc.pages?.[0]?.children ?? [];
    expect(topLevelNodes).toHaveLength(15);
    expect(flattenNodes(state.doc)).toHaveLength(39);
    const [firstStepNodeId, secondStepNodeId] = payload.taskStepNodeIds;
    const [toolCallNodeId] = payload.toolCallNodeIds;
    if (!firstStepNodeId || !secondStepNodeId || !toolCallNodeId) {
      throw new Error(
        "Expected execution flow to create two steps and a tool call.",
      );
    }
    expect(
      getAgentExecutionMeta(findNode(state.doc, payload.userGoalNodeId)),
    ).toMatchObject({
      downstreamNodeIds: [payload.recipeNodeId],
      kind: "user_goal",
      runId: "run-1",
      status: "done",
      title: "用户目标",
    });
    expect(
      getAgentExecutionMeta(findNode(state.doc, payload.recipeNodeId)),
    ).toMatchObject({
      downstreamNodeIds: [firstStepNodeId],
      kind: "recipe_plan",
      status: "done",
      upstreamNodeIds: [payload.userGoalNodeId],
    });
    expect(
      getAgentExecutionMeta(findNode(state.doc, firstStepNodeId)),
    ).toMatchObject({
      downstreamNodeIds: [secondStepNodeId],
      kind: "task_step",
      status: "done",
      upstreamNodeIds: [payload.recipeNodeId],
    });
    expect(
      getAgentExecutionMeta(findNode(state.doc, secondStepNodeId)),
    ).toMatchObject({
      downstreamNodeIds: [toolCallNodeId],
      kind: "task_step",
      status: "running",
      upstreamNodeIds: [firstStepNodeId],
    });
    expect(
      getAgentExecutionMeta(findNode(state.doc, toolCallNodeId)),
    ).toMatchObject({
      downstreamNodeIds: [payload.critiqueNodeId],
      kind: "tool_call",
      status: "waiting",
      toolName: "generate_image",
      upstreamNodeIds: [secondStepNodeId],
    });
    expect(
      getAgentExecutionMeta(findNode(state.doc, payload.critiqueNodeId)),
    ).toMatchObject({
      downstreamNodeIds: [payload.finalDeliverableNodeId],
      kind: "critique",
      status: "waiting",
      upstreamNodeIds: [toolCallNodeId],
    });
    expect(
      getAgentExecutionMeta(
        findNode(state.doc, payload.finalDeliverableNodeId),
      ),
    ).toMatchObject({
      downstreamNodeIds: [payload.checkpointNodeId],
      kind: "final_deliverable",
      status: "waiting",
      upstreamNodeIds: [payload.critiqueNodeId],
    });
    expect(findNode(state.doc, payload.finalDeliverableNodeId)).toMatchObject({
      height: 640,
      width: 600,
    });
    expect(
      getAgentExecutionMeta(findNode(state.doc, payload.checkpointNodeId)),
    ).toMatchObject({
      checkpoint: {
        canRestartFromHere: true,
      },
      kind: "checkpoint",
      upstreamNodeIds: [payload.finalDeliverableNodeId],
    });
    expect(
      getAgentExecutionMeta(findNode(state.doc, payload.checkpointNodeId))
        ?.downstreamNodeIds,
    ).toBeUndefined();
    const executionCardIds = [
      payload.userGoalNodeId,
      payload.recipeNodeId,
      ...payload.taskStepNodeIds,
      ...payload.toolCallNodeIds,
      payload.critiqueNodeId,
      payload.finalDeliverableNodeId,
      payload.checkpointNodeId,
    ];
    for (const nodeId of executionCardIds) {
      const node = findNode(state.doc, nodeId);
      expect(node).toMatchObject({
        agentBinding: expect.objectContaining({ agentId: "agent-1" }),
        containerRole: expect.any(Array),
        cornerRadius: AGENT_EXECUTION_CARD_CORNER_RADIUS,
        runId: "run-1",
        sessionId: "session-1",
      });
      expect(node?.containerRole?.length).toBeGreaterThan(0);
    }
    const recipeNode = findNode(state.doc, payload.recipeNodeId) as
      | FrameNode
      | undefined;
    const recipeChildren = recipeNode?.children as PenNode[] | undefined;
    expect(recipeChildren).toHaveLength(3);
    expect(recipeChildren?.[0]).toMatchObject({
      content: "品牌海报 Recipe",
      fontSize: 18,
      x: 26,
      y: 22,
    });
    expect(recipeChildren?.[1]).toMatchObject({
      content: "Recipe 计划 · 已完成",
      fontSize: 11,
    });
    expect(recipeChildren?.[2]).toMatchObject({
      content: expect.stringContaining("1. 理解目标"),
      fontSize: 14,
      lineHeight: 1.48,
    });
    const connectors = payload.connectorNodeIds.map(
      (id) => findNode(state.doc, id) as LineNode | undefined,
    );
    expect(connectors).toHaveLength(7);
    expect(connectors[0]?.stroke).toMatchObject({
      cap: "round",
      endTip: "line-arrow",
      fill: [{ color: "rgba(79,70,229,0.52)", type: "solid" }],
      thickness: AGENT_EXECUTION_CONNECTOR_THICKNESS,
    });
    expect(connectors[0]).toMatchObject({
      connector: {
        start: { nodeId: payload.userGoalNodeId },
        end: { nodeId: payload.recipeNodeId },
      },
    });
    expect(connectors.at(-1)).toMatchObject({
      connector: {
        start: { nodeId: payload.finalDeliverableNodeId },
        end: { nodeId: payload.checkpointNodeId },
      },
    });
    expect(state.doc.selection).toEqual([payload.finalDeliverableNodeId]);
  });

  it("can omit critique and checkpoint nodes for a compact flow", async () => {
    const { server, state } = createExecutionServer();

    const result = await server.callTool(
      "create_agent_execution_flow",
      {
        includeCheckpoint: false,
        includeCritique: false,
        steps: [{ title: "直接生成方案" }],
        userGoal: "生成一个简单构图",
      },
      context(),
    );

    expect(result).toMatchObject({
      structuredContent: {
        appliedOperationCount: 7,
        checkpointNodeId: undefined,
        connectorNodeIds: [
          expect.any(String),
          expect.any(String),
          expect.any(String),
        ],
        critiqueNodeId: undefined,
        previewedOperationCount: 7,
        taskStepNodeIds: [expect.any(String)],
        toolCallNodeIds: [],
      },
    });
    expect(state.doc.pages?.[0]?.children).toHaveLength(7);
  });

  it("dry-runs without mutating the live document", async () => {
    const { patchDocument, server, state } = createExecutionServer();

    await expect(
      server.callTool(
        "create_agent_execution_flow",
        {
          dryRun: true,
          steps: [{ title: "规划画布结构" }],
          userGoal: "做一个画布方案",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        appliedOperationCount: 0,
        previewedOperationCount: 11,
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
    expect(flattenNodes(state.doc)).toHaveLength(0);
  });

  it("rejects stale baseVersion without patching", async () => {
    const { patchDocument, server } = createExecutionServer();

    await expect(
      server.callTool(
        "create_agent_execution_flow",
        {
          baseVersion: 10,
          steps: [{ title: "规划画布结构" }],
          userGoal: "做一个画布方案",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "create_agent_execution_flow_failed",
        message: expect.stringContaining("version mismatch"),
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
  });

  it("fails clearly when the live editor is unavailable", async () => {
    const server = createCucumberMcpServer({} as never, {
      createUserClient: () => ({}),
    });

    await expect(
      server.callTool(
        "create_agent_execution_flow",
        {
          steps: [{ title: "规划画布结构" }],
          userGoal: "做一个画布方案",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "create_agent_execution_flow_failed",
        message: expect.stringContaining("requires an open live editor"),
      },
    });
  });
});
