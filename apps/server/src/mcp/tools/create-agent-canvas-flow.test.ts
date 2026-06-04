import {
  type CanvasOperation,
  applyCanvasTransaction,
  createCanvasDocument,
  findNode,
  flattenNodes,
  getAgentExecutionMeta,
} from "@cucumber/canvas-core";
import type { LineNode, PenDocument } from "@cucumber/pen-types";
import { describe, expect, it, vi } from "vitest";

import { createCucumberMcpServer } from "../server.js";

function context() {
  return {
    configurable: {
      access_token: "token",
      canvas_id: "canvas-1",
      user_id: "user-1",
    },
  };
}

function createFlowDoc() {
  return createCanvasDocument("Agent flow") as PenDocument & {
    selection?: string[];
  };
}

function createFlowServer(initialDoc = createFlowDoc(), initialVersion = 7) {
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

describe("create_agent_canvas_flow", () => {
  it("creates a simple image-generation flow with sticky nodes, result container, and connectors", async () => {
    const { server, state } = createFlowServer();

    const result = await server.callTool(
      "create_agent_canvas_flow",
      {
        agentId: "agent-1",
        mode: "simple_image_generation",
        optimizedPrompt:
          "A warm, high quality square portrait of a playful puppy.",
        runId: "run-1",
        sessionId: "session-1",
        userInput: "帮我生成一张小狗的图片",
      },
      context(),
    );

    expect(result).toMatchObject({
      structuredContent: {
        appliedOperationCount: 5,
        connectorNodeIds: [expect.any(String), expect.any(String)],
        imagePlacement: { x: 44, y: 88, width: 512, height: 512 },
        inputNodeId: expect.any(String),
        loadingNodeIds: [expect.any(String), expect.any(String)],
        mode: "simple_image_generation",
        nextDocumentVersion: 8,
        optimizedPrompt:
          "A warm, high quality square portrait of a playful puppy.",
        promptNodeId: expect.any(String),
        resultContainerId: expect.any(String),
      },
    });
    const payload = result.structuredContent as {
      connectorNodeIds: string[];
      inputNodeId: string;
      loadingNodeIds: string[];
      promptNodeId: string;
      resultContainerId: string;
    };
    const topLevelNodes = state.doc.pages?.[0]?.children ?? [];
    expect(topLevelNodes).toHaveLength(5);
    expect(findNode(state.doc, payload.inputNodeId)).toMatchObject({
      agentBinding: expect.objectContaining({
        agentId: "agent-1",
        status: "completed",
      }),
      containerRole: ["context"],
      meta: { boardKind: "sticky", containerType: "sticky_note" },
      name: "用户原始输入",
      runId: "run-1",
      sessionId: "session-1",
    });
    expect(
      getAgentExecutionMeta(findNode(state.doc, payload.inputNodeId)),
    ).toMatchObject({
      kind: "user_goal",
      runId: "run-1",
      status: "done",
      title: "用户原始输入",
    });
    expect(findNode(state.doc, payload.promptNodeId)).toMatchObject({
      agentBinding: expect.objectContaining({
        agentId: "agent-1",
        status: "completed",
      }),
      containerRole: ["context"],
      meta: { boardKind: "sticky", containerType: "sticky_note" },
      name: "优化后的图片 Prompt",
    });
    expect(
      getAgentExecutionMeta(findNode(state.doc, payload.promptNodeId)),
    ).toMatchObject({
      kind: "recipe_plan",
      status: "done",
      upstreamNodeIds: [payload.inputNodeId],
    });
    expect(findNode(state.doc, payload.resultContainerId)).toMatchObject({
      agentBinding: expect.objectContaining({
        agentId: "agent-1",
        status: "running",
      }),
      containerRole: ["visual"],
      name: "图片结果容器",
      type: "frame",
    });
    expect(
      getAgentExecutionMeta(findNode(state.doc, payload.resultContainerId)),
    ).toMatchObject({
      kind: "final_deliverable",
      status: "running",
      upstreamNodeIds: [payload.promptNodeId],
    });
    const resultContainer = findNode(state.doc, payload.resultContainerId) as
      | { children?: Array<{ id: string; meta?: Record<string, unknown> }> }
      | undefined;
    expect(resultContainer?.children?.map((node) => node.id)).toEqual(
      payload.loadingNodeIds,
    );
    expect(resultContainer?.children).toEqual([
      expect.objectContaining({
        agentBinding: expect.objectContaining({
          agentId: "agent-1",
          status: "running",
          toolName: "generate_image",
        }),
        containerRole: ["dataflow", "task"],
        contextSlots: expect.objectContaining({
          rules: ["agent execution node: tool_call"],
        }),
        meta: expect.objectContaining({
          agentCanvasRole: "image_generation_loading",
        }),
        runId: "run-1",
        sessionId: "session-1",
      }),
      expect.objectContaining({
        agentBinding: expect.objectContaining({
          agentId: "agent-1",
          status: "running",
          toolName: "generate_image",
        }),
        containerRole: ["dataflow", "task"],
        content: expect.stringContaining("图片生成中"),
        contextSlots: expect.objectContaining({
          rules: ["agent execution node: tool_call"],
        }),
        meta: expect.objectContaining({
          agentCanvasRole: "image_generation_loading",
        }),
        runId: "run-1",
        sessionId: "session-1",
      }),
    ]);
    const executionNodes = flattenNodes(state.doc).filter((node) =>
      Boolean(getAgentExecutionMeta(node)),
    );
    expect(executionNodes).toHaveLength(5);
    for (const node of executionNodes) {
      expect(node).toMatchObject({
        agentBinding: expect.objectContaining({ agentId: "agent-1" }),
        containerRole: expect.any(Array),
        runId: "run-1",
        sessionId: "session-1",
      });
      expect(node.containerRole?.length).toBeGreaterThan(0);
    }
    const connectors = payload.connectorNodeIds.map(
      (id) => findNode(state.doc, id) as LineNode | undefined,
    );
    expect(connectors).toEqual([
      expect.objectContaining({
        connector: expect.objectContaining({
          start: expect.objectContaining({ nodeId: payload.inputNodeId }),
          end: expect.objectContaining({ nodeId: payload.promptNodeId }),
        }),
      }),
      expect.objectContaining({
        connector: expect.objectContaining({
          start: expect.objectContaining({ nodeId: payload.promptNodeId }),
          end: expect.objectContaining({ nodeId: payload.resultContainerId }),
        }),
      }),
    ]);
    expect(state.doc.selection).toEqual([payload.resultContainerId]);
  });

  it("dry-runs without mutating the live document", async () => {
    const { patchDocument, server, state } = createFlowServer();

    await expect(
      server.callTool(
        "create_agent_canvas_flow",
        {
          dryRun: true,
          mode: "simple_image_generation",
          optimizedPrompt: "A puppy in soft studio light.",
          userInput: "小狗图片",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        appliedOperationCount: 0,
        previewedOperationCount: 5,
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
    expect(flattenNodes(state.doc)).toHaveLength(0);
  });

  it("rejects stale baseVersion without patching", async () => {
    const { patchDocument, server } = createFlowServer();

    await expect(
      server.callTool(
        "create_agent_canvas_flow",
        {
          baseVersion: 6,
          mode: "simple_image_generation",
          optimizedPrompt: "A puppy in soft studio light.",
          userInput: "小狗图片",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "create_agent_canvas_flow_failed",
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
        "create_agent_canvas_flow",
        {
          mode: "simple_image_generation",
          optimizedPrompt: "A puppy in soft studio light.",
          userInput: "小狗图片",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "create_agent_canvas_flow_failed",
        message: expect.stringContaining("requires an open live editor"),
      },
    });
  });
});
