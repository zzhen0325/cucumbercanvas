import {
  type CanvasOperation,
  applyCanvasTransaction,
  createCanvasDocument,
  findNode,
  getAgentExecutionMeta,
  withAgentExecutionMeta,
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
  const doc = createCanvasDocument("Agent ask user more") as PenDocument & {
    selection?: string[];
  };
  const upstream = withAgentExecutionMeta(
    {
      children: [],
      height: 160,
      id: "step-1",
      name: "生成视觉资产",
      type: "frame",
      width: 280,
      x: 120,
      y: 80,
    } as FrameNode,
    {
      kind: "task_step",
      runId: "run-1",
      status: "running",
      summary: "需要用户补充品牌参考。",
      title: "生成视觉资产",
    },
  );
  doc.pages = doc.pages?.map((page) =>
    page.id === doc.activePageId ? { ...page, children: [upstream] } : page,
  );
  return doc;
}

function createAskUserMoreServer(
  initialDoc = createExecutionDoc(),
  initialVersion = 7,
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

describe("create_agent_ask_user_more", () => {
  it("creates a durable waiting node and links it from the upstream execution node", async () => {
    const { server, state } = createAskUserMoreServer();

    const result = await server.callTool(
      "create_agent_ask_user_more",
      {
        acceptsFiles: true,
        agentId: "agent-1",
        prompt: "请补充品牌 Logo 和主色参考图。",
        runId: "run-1",
        sessionId: "session-1",
        summary: "等待用户补充 Logo 与主色素材。",
        upstreamNodeId: "step-1",
      },
      context(),
    );

    expect(result).toMatchObject({
      structuredContent: {
        appliedOperationCount: 3,
        askUserMoreNodeId: expect.any(String),
        connectorNodeId: expect.any(String),
        nextDocumentVersion: 8,
        previewedOperationCount: 3,
        upstreamNodeId: "step-1",
      },
    });
    const payload = result.structuredContent as {
      askUserMoreNodeId: string;
      connectorNodeId: string;
    };
    expect(state.doc.selection).toEqual([payload.askUserMoreNodeId]);
    expect(getAgentExecutionMeta(findNode(state.doc, "step-1"))).toMatchObject({
      downstreamNodeIds: [payload.askUserMoreNodeId],
      kind: "task_step",
    });
    expect(
      getAgentExecutionMeta(findNode(state.doc, payload.askUserMoreNodeId)),
    ).toMatchObject({
      agentId: "agent-1",
      kind: "ask_user_more",
      runId: "run-1",
      sessionId: "session-1",
      status: "waiting",
      upstreamNodeIds: ["step-1"],
      waitingForUser: {
        acceptsFiles: true,
        prompt: "请补充品牌 Logo 和主色参考图。",
      },
    });
    expect(findNode(state.doc, payload.askUserMoreNodeId)).toMatchObject({
      agentBinding: expect.objectContaining({
        agentId: "agent-1",
        status: "idle",
      }),
      containerRole: ["task", "context"],
      cornerRadius: AGENT_EXECUTION_CARD_CORNER_RADIUS,
      contextSlots: expect.objectContaining({
        rules: ["agent execution node: ask_user_more"],
      }),
      runId: "run-1",
      sessionId: "session-1",
    });
    const askNode = findNode(state.doc, payload.askUserMoreNodeId) as
      | FrameNode
      | undefined;
    const askChildren = askNode?.children as PenNode[] | undefined;
    expect(askChildren).toHaveLength(3);
    expect(askChildren?.[1]).toMatchObject({
      content: "等待用户补充 · 等待中",
      fontSize: 11,
    });
    expect(askChildren?.[2]).toMatchObject({
      content: expect.stringContaining("等待用户补充 Logo 与主色素材。"),
      fontSize: 14,
      x: 26,
    });
    expect(
      findNode(state.doc, payload.connectorNodeId) as LineNode,
    ).toMatchObject({
      connector: {
        end: { nodeId: payload.askUserMoreNodeId },
        start: { nodeId: "step-1" },
      },
      stroke: {
        fill: [{ color: "rgba(217,119,6,0.56)", type: "solid" }],
        thickness: AGENT_EXECUTION_CONNECTOR_THICKNESS,
      },
    });
  });

  it("dry-runs without mutating the live document", async () => {
    const { patchDocument, server, state } = createAskUserMoreServer();

    await expect(
      server.callTool(
        "create_agent_ask_user_more",
        {
          dryRun: true,
          prompt: "请补充参考图。",
          upstreamNodeId: "step-1",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        appliedOperationCount: 0,
        previewedOperationCount: 3,
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
    expect(
      getAgentExecutionMeta(findNode(state.doc, "step-1"))?.downstreamNodeIds,
    ).toBeUndefined();
  });

  it("fails clearly when the upstream node is missing", async () => {
    const { patchDocument, server } = createAskUserMoreServer();

    await expect(
      server.callTool(
        "create_agent_ask_user_more",
        {
          prompt: "请补充参考图。",
          upstreamNodeId: "missing-node",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "create_agent_ask_user_more_failed",
        message: expect.stringContaining("does not exist"),
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
  });

  it("rejects stale baseVersion without patching", async () => {
    const { patchDocument, server } = createAskUserMoreServer();

    await expect(
      server.callTool(
        "create_agent_ask_user_more",
        {
          baseVersion: 6,
          prompt: "请补充参考图。",
          upstreamNodeId: "step-1",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "create_agent_ask_user_more_failed",
        message: expect.stringContaining("version mismatch"),
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
  });
});
