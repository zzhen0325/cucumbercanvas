import {
  type CanvasOperation,
  applyCanvasTransaction,
  createCanvasDocument,
  findNode,
  getAgentExecutionMeta,
  withAgentExecutionNodeSemantics,
} from "@cucumber/canvas-core";
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

function createToolCallDoc() {
  const doc = createCanvasDocument("Agent tool call record") as PenDocument & {
    selection?: string[];
  };
  const toolNode = withAgentExecutionNodeSemantics(
    createFrame("tool-1", "generate_image", 120, 80),
    {
      agentId: "agent-1",
      kind: "tool_call",
      runId: "run-1",
      sessionId: "session-1",
      status: "running",
      summary: "生成首屏视觉主图。",
      title: "generate_image",
      toolName: "generate_image",
      upstreamNodeIds: ["step-1"],
    },
  );
  const taskNode = withAgentExecutionNodeSemantics(
    createFrame("step-1", "生成视觉资产", 120, 300),
    {
      agentId: "agent-1",
      kind: "task_step",
      runId: "run-1",
      sessionId: "session-1",
      status: "running",
      summary: "调用图片模型生成主视觉。",
      title: "生成视觉资产",
    },
  );
  const nonExecutionNode = createFrame("frame-1", "普通容器", 520, 80);
  doc.pages = doc.pages?.map((page) =>
    page.id === doc.activePageId
      ? { ...page, children: [toolNode, taskNode, nonExecutionNode] }
      : page,
  );
  return doc;
}

function createToolCallServer(
  initialDoc = createToolCallDoc(),
  initialVersion = 13,
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

function textContents(node: PenNode | undefined): string[] {
  if (!node || !("children" in node) || !Array.isArray(node.children)) {
    return [];
  }
  return node.children
    .filter((child) => child.type === "text")
    .map((child) => (child as { content?: string }).content ?? "");
}

describe("record_agent_tool_call", () => {
  it("records tool input and output details into a durable tool_call node", async () => {
    const { server, state } = createToolCallServer();

    const result = await server.callTool(
      "record_agent_tool_call",
      {
        executionNodeId: "tool-1",
        inputSummary: "prompt: 暖色咖啡活动海报主视觉",
        outputSummary: "生成 job img-123，目标容器已更新。",
        reasoningSummary: "使用品牌主色和活动文案约束生成首屏视觉。",
        status: "done",
        summary: "图片生成完成。",
        toolCallId: "call-1",
        toolName: "generate_image",
      },
      context(),
    );

    expect(result).toMatchObject({
      structuredContent: {
        appliedOperationCount: 1,
        executionNodeId: "tool-1",
        nextDocumentVersion: 14,
        previewedOperationCount: 1,
      },
    });
    expect(state.doc.selection).toEqual(["tool-1"]);
    expect(getAgentExecutionMeta(findNode(state.doc, "tool-1"))).toMatchObject({
      details: {
        inputSummary: "prompt: 暖色咖啡活动海报主视觉",
        outputSummary: "生成 job img-123，目标容器已更新。",
        reasoningSummary: "使用品牌主色和活动文案约束生成首屏视觉。",
      },
      kind: "tool_call",
      status: "done",
      summary: "图片生成完成。",
      toolCallId: "call-1",
      toolName: "generate_image",
    });
    const updatedNode = findNode(state.doc, "tool-1") as FrameNode | undefined;
    expect(updatedNode).toMatchObject({
      agentBinding: expect.objectContaining({
        agentId: "agent-1",
        status: "completed",
        toolName: "generate_image",
      }),
      containerRole: ["dataflow", "task"],
      contextSlots: expect.objectContaining({
        rules: ["agent execution node: tool_call"],
      }),
      runId: "run-1",
      sessionId: "session-1",
    });
    expect(getAgentExecutionMeta(updatedNode)?.canvasPresentation).toEqual({
      layoutVersion: 2,
      collapsed: true,
    });
    expect(textContents(updatedNode)).toEqual(
      expect.arrayContaining(["已完成...", "v"]),
    );
  });

  it("records failed task-step recovery context without raw error codes", async () => {
    const { server, state } = createToolCallServer();

    await expect(
      server.callTool(
        "record_agent_tool_call",
        {
          errorReason: "图片模型返回的品牌参考图不可读取。",
          executionNodeId: "step-1",
          failure: {
            attempted: ["读取参考图", "重新请求压缩版本"],
            nextActions: ["补充可访问图片", "跳过参考图继续"],
            reason: "参考图无法读取。",
            step: "读取品牌参考图",
          },
          status: "failed",
          summary: "生成视觉资产失败，需要用户补充可访问参考图。",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        executionNodeId: "step-1",
      },
    });
    expect(getAgentExecutionMeta(findNode(state.doc, "step-1"))).toMatchObject({
      details: {
        errorReason: "图片模型返回的品牌参考图不可读取。",
      },
      failure: {
        attempted: ["读取参考图", "重新请求压缩版本"],
        nextActions: ["补充可访问图片", "跳过参考图继续"],
        reason: "参考图无法读取。",
        step: "读取品牌参考图",
      },
      kind: "task_step",
      status: "failed",
    });
    expect(findNode(state.doc, "step-1")).toMatchObject({
      agentBinding: expect.objectContaining({
        agentId: "agent-1",
        status: "error",
      }),
      containerRole: ["task"],
      runId: "run-1",
      sessionId: "session-1",
    });

    await expect(
      server.callTool(
        "record_agent_tool_call",
        {
          appendAttempted: ["改写输入后重新生成", "读取参考图"],
          appendNextActions: ["新建分支尝试另一种方案"],
          errorReason: "改写输入后仍无法读取参考图。",
          executionNodeId: "step-1",
          status: "failed",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        executionNodeId: "step-1",
      },
    });
    expect(getAgentExecutionMeta(findNode(state.doc, "step-1"))).toMatchObject({
      failure: {
        attempted: ["读取参考图", "重新请求压缩版本", "改写输入后重新生成"],
        nextActions: [
          "补充可访问图片",
          "跳过参考图继续",
          "新建分支尝试另一种方案",
        ],
        reason: "参考图无法读取。",
        step: "读取品牌参考图",
      },
      status: "failed",
    });

    await expect(
      server.callTool(
        "record_agent_tool_call",
        {
          executionNodeId: "step-1",
          outputSummary: "已用新参考图完成视觉资产生成。",
          status: "done",
          summary: "视觉资产生成完成。",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        executionNodeId: "step-1",
      },
    });
    expect(getAgentExecutionMeta(findNode(state.doc, "step-1"))).toMatchObject({
      details: {
        outputSummary: "已用新参考图完成视觉资产生成。",
      },
      status: "done",
      summary: "视觉资产生成完成。",
    });
    expect(
      getAgentExecutionMeta(findNode(state.doc, "step-1"))?.failure,
    ).toBeUndefined();
  });

  it("dry-runs without mutating the live document", async () => {
    const { patchDocument, server, state } = createToolCallServer();

    await expect(
      server.callTool(
        "record_agent_tool_call",
        {
          dryRun: true,
          executionNodeId: "tool-1",
          outputSummary: "预览写回。",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        appliedOperationCount: 0,
        previewedOperationCount: 1,
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
    expect(getAgentExecutionMeta(findNode(state.doc, "tool-1"))?.status).toBe(
      "running",
    );
  });

  it("rejects a new failed state without a concrete failure reason", async () => {
    const { patchDocument, server } = createToolCallServer();

    await expect(
      server.callTool(
        "record_agent_tool_call",
        {
          executionNodeId: "step-1",
          status: "failed",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "record_agent_tool_call_failed",
        message: expect.stringContaining(
          "requires failure.reason or errorReason",
        ),
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
  });

  it("rejects non tool-call or task-step nodes", async () => {
    const { patchDocument, server } = createToolCallServer();

    await expect(
      server.callTool(
        "record_agent_tool_call",
        {
          executionNodeId: "frame-1",
          outputSummary: "不应该写入普通节点。",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "record_agent_tool_call_failed",
        message: expect.stringContaining("tool_call or task_step"),
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
  });

  it("rejects stale baseVersion without patching", async () => {
    const { patchDocument, server } = createToolCallServer();

    await expect(
      server.callTool(
        "record_agent_tool_call",
        {
          baseVersion: 12,
          executionNodeId: "tool-1",
          outputSummary: "版本过期。",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "record_agent_tool_call_failed",
        message: expect.stringContaining("version mismatch"),
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
  });
});

function createFrame(
  id: string,
  name: string,
  x: number,
  y: number,
): FrameNode {
  return {
    children: [
      {
        content: `${name} 等待写回。`,
        height: 72,
        id: `${id}-text`,
        name: `${name} 内容`,
        type: "text",
        width: 220,
        x: 16,
        y: 48,
      } as PenNode,
    ],
    height: 160,
    id,
    name,
    type: "frame",
    width: 280,
    x,
    y,
  } as FrameNode;
}
