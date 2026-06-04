import {
  type CanvasOperation,
  createCanvasDocument,
  findNode,
  getAgentExecutionMeta,
  withAgentExecutionMeta,
  withAgentExecutionNodeSemantics,
} from "@cucumber/canvas-core";
import { applyCanvasOperation } from "@cucumber/canvas-core";
import type { FrameNode, PenDocument, PenNode } from "@cucumber/pen-types";
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

function createRecordServer(doc: PenDocument) {
  const state = {
    doc: doc as PenDocument & { selection?: string[] },
    version: 7,
  };
  const patchDocument = vi.fn(async (_user, _canvasId, patch) => {
    for (const operation of patch.operations as CanvasOperation[]) {
      state.doc = applyCanvasOperation(state.doc, operation);
    }
    state.doc = {
      ...state.doc,
      selection: patch.selection,
    } as PenDocument & { selection?: string[] };
    state.version += 1;
    return { document: state.doc, version: state.version };
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

function createFinalDeliverableDoc() {
  const doc = createCanvasDocument("Record final deliverable") as PenDocument;
  const page = doc.pages?.[0];
  if (!page) throw new Error("Expected default canvas page fixture.");
  page.children = [
    withAgentExecutionNodeSemantics(
      {
        id: "final-1",
        type: "frame",
        children: [
          {
            id: "final-text",
            type: "text",
            content: "等待最终交付。",
          } as PenNode,
        ],
        name: "最终交付物",
      } as FrameNode,
      {
        agentId: "agent-1",
        kind: "final_deliverable",
        runId: "run-1",
        sessionId: "session-1",
        status: "waiting",
        summary: "等待 Agent 写入最终结果。",
        title: "最终交付物",
        upstreamNodeIds: ["critique-1"],
      },
    ),
    withAgentExecutionMeta({ id: "step-1", type: "frame" } as FrameNode, {
      kind: "task_step",
      status: "done",
      title: "Step",
    }),
  ];
  return doc;
}

describe("record_agent_final_deliverable", () => {
  it("records completed final deliverable state into the durable final node", async () => {
    const { patchDocument, server, state } = createRecordServer(
      createFinalDeliverableDoc(),
    );

    await expect(
      server.callTool(
        "record_agent_final_deliverable",
        {
          finalDeliverableNodeId: "final-1",
          outputSummary:
            "画布中已生成品牌视觉探索交付物，包含主视觉、色彩和版式建议。",
          summary: "品牌视觉探索交付完成。",
          title: "品牌视觉探索最终交付",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        appliedOperationCount: 1,
        finalDeliverableNodeId: "final-1",
        nextDocumentVersion: 8,
        success: true,
      },
    });

    expect(patchDocument).toHaveBeenCalledWith(
      expect.anything(),
      "canvas-1",
      expect.objectContaining({
        selection: ["final-1"],
      }),
    );
    expect(state.doc.selection).toEqual(["final-1"]);
    const updatedNode = findNode(state.doc, "final-1");
    expect(updatedNode).toMatchObject({
      agentBinding: expect.objectContaining({
        agentId: "agent-1",
        status: "completed",
      }),
      containerRole: ["visual"],
      contextSlots: expect.objectContaining({
        rules: ["agent execution node: final_deliverable"],
      }),
      name: "品牌视觉探索最终交付",
      runId: "run-1",
      sessionId: "session-1",
    });
    expect(getAgentExecutionMeta(updatedNode)).toMatchObject({
      details: {
        outputSummary:
          "画布中已生成品牌视觉探索交付物，包含主视觉、色彩和版式建议。",
      },
      kind: "final_deliverable",
      status: "done",
      summary: "品牌视觉探索交付完成。",
      title: "品牌视觉探索最终交付",
      upstreamNodeIds: ["critique-1"],
    });
    expect((updatedNode as FrameNode).children?.[0]).toMatchObject({
      content: expect.stringContaining("交付摘要：品牌视觉探索交付完成。"),
    });
  });

  it("records failed final deliverable recovery context with a clear reason", async () => {
    const { server, state } = createRecordServer(createFinalDeliverableDoc());

    await expect(
      server.callTool(
        "record_agent_final_deliverable",
        {
          errorReason: "最终导出所需的组件规格缺少移动端布局说明。",
          finalDeliverableNodeId: "final-1",
          status: "failed",
          summary: "最终交付未完成，需要补充移动端布局说明。",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        finalDeliverableNodeId: "final-1",
        success: true,
      },
    });

    const updatedNode = findNode(state.doc, "final-1");
    expect(updatedNode).toMatchObject({
      agentBinding: expect.objectContaining({
        status: "error",
      }),
    });
    expect(getAgentExecutionMeta(updatedNode)).toMatchObject({
      details: {
        errorReason: "最终导出所需的组件规格缺少移动端布局说明。",
        outputSummary: "最终交付未完成，需要补充移动端布局说明。",
      },
      failure: {
        attempted: ["写入最终交付物", "同步最终交付节点状态"],
        nextActions: [
          "重试最终交付",
          "改写输入后继续",
          "新建分支尝试另一种方案",
        ],
        reason: "最终导出所需的组件规格缺少移动端布局说明。",
        step: "最终交付物",
      },
      kind: "final_deliverable",
      status: "failed",
    });
    expect((updatedNode as FrameNode).children?.[0]).toMatchObject({
      content: expect.stringContaining(
        "失败原因：最终导出所需的组件规格缺少移动端布局说明。",
      ),
    });
  });

  it("rejects non-final nodes instead of guessing a write target", async () => {
    await expect(
      createRecordServer(createFinalDeliverableDoc()).server.callTool(
        "record_agent_final_deliverable",
        {
          finalDeliverableNodeId: "step-1",
          summary: "Should not write here.",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "record_agent_final_deliverable_failed",
        message: expect.stringContaining(
          "not a durable Agent final deliverable node",
        ),
      },
    });
  });

  it("requires a concrete reason before marking the final deliverable failed", async () => {
    await expect(
      createRecordServer(createFinalDeliverableDoc()).server.callTool(
        "record_agent_final_deliverable",
        {
          finalDeliverableNodeId: "final-1",
          status: "failed",
          summary: "Final deliverable failed.",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "record_agent_final_deliverable_failed",
        message: expect.stringContaining(
          "status failed requires failure.reason or errorReason",
        ),
      },
    });
  });
});
