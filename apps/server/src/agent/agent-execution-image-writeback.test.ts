import {
  type CanvasOperation,
  applyCanvasTransaction,
  createCanvasDocument,
  findNode,
  getAgentExecutionMeta,
  withAgentExecutionMeta,
} from "@cucumber/canvas-core";
import type { FrameNode, PenDocument, PenNode } from "@cucumber/pen-types";
import { describe, expect, it, vi } from "vitest";

import { recordImageGenerationExecutionNode } from "./agent-execution-image-writeback.js";

function createDoc() {
  const doc = createCanvasDocument(
    "Image execution writeback",
  ) as PenDocument & {
    selection?: string[];
  };
  const toolNode = withAgentExecutionMeta(
    createFrame("tool-1", "generate_image"),
    {
      kind: "tool_call",
      runId: "run-1",
      status: "running",
      summary: "等待图片生成。",
      title: "generate_image",
      toolName: "generate_image",
    },
  );
  doc.pages = doc.pages?.map((page) =>
    page.id === doc.activePageId
      ? { ...page, children: [toolNode, createFrame("frame-1", "普通容器")] }
      : page,
  );
  return doc;
}

function createHarness(initialDoc = createDoc(), initialVersion = 4) {
  const state = {
    doc: initialDoc,
    patches: [] as Array<{
      baseVersion: number;
      operations: CanvasOperation[];
      selection?: string[];
      transactionId: string;
    }>,
    version: initialVersion,
  };
  const liveCanvasService = {
    getDocumentState: vi.fn(async () => ({
      document: state.doc,
      version: state.version,
    })),
    patchDocument: vi.fn(async (_user, _canvasId, patch) => {
      const result = applyCanvasTransaction(state.doc, patch.operations, {
        transactionId: patch.transactionId,
      });
      state.doc = {
        ...result.doc,
        selection: patch.selection ?? state.doc.selection,
      } as typeof state.doc;
      state.version += 1;
      state.patches.push(patch);
      return { version: state.version };
    }),
  };
  return { liveCanvasService, state };
}

describe("recordImageGenerationExecutionNode", () => {
  it("writes successful image job details into the durable tool_call node", async () => {
    const { liveCanvasService, state } = createHarness();

    await expect(
      recordImageGenerationExecutionNode({
        canvasId: "canvas-1",
        elementId: "image-1",
        jobId: "job-1",
        liveCanvasService: liveCanvasService as never,
        nodeId: "tool-1",
        status: "done",
        title: "生成首屏主图",
        user: user(),
      }),
    ).resolves.toEqual({ updated: true });

    expect(state.patches).toHaveLength(1);
    expect(state.doc.selection).toEqual(["tool-1"]);
    expect(getAgentExecutionMeta(findNode(state.doc, "tool-1"))).toMatchObject({
      details: {
        outputSummary: expect.stringContaining("jobId=job-1"),
      },
      kind: "tool_call",
      status: "done",
      summary: expect.stringContaining("image-1"),
      toolName: "generate_image",
    });
    const updatedNode = findNode(state.doc, "tool-1") as PenNode | undefined;
    expect(getAgentExecutionMeta(updatedNode)?.canvasPresentation).toEqual({
      layoutVersion: 2,
      collapsed: true,
    });
    expect(updatedNode).toMatchObject({
      clipContent: false,
      height: expect.any(Number),
      width: expect.any(Number),
    });
    expect(textContents(updatedNode)).toEqual(["generate_image 等待写回。"]);
  });

  it("writes failed image job recovery context without throwing", async () => {
    const { liveCanvasService, state } = createHarness();

    await expect(
      recordImageGenerationExecutionNode({
        canvasId: "canvas-1",
        errorReason: "图片模型未能处理当前参考图。",
        jobId: "job-2",
        liveCanvasService: liveCanvasService as never,
        nodeId: "tool-1",
        status: "failed",
        title: "生成首屏主图",
        user: user(),
      }),
    ).resolves.toEqual({ updated: true });

    expect(getAgentExecutionMeta(findNode(state.doc, "tool-1"))).toMatchObject({
      details: {
        errorReason: "图片模型未能处理当前参考图。",
      },
      failure: {
        attempted: ["提交图片生成任务", "等待后台图片生成完成"],
        nextActions: [
          "重试此步骤",
          "改写提示词后继续",
          "新建分支尝试另一种方案",
        ],
        reason: "图片模型未能处理当前参考图。",
      },
      status: "failed",
    });
  });

  it("skips nodes that are not durable tool_call or task_step execution nodes", async () => {
    const { liveCanvasService, state } = createHarness();

    await expect(
      recordImageGenerationExecutionNode({
        canvasId: "canvas-1",
        jobId: "job-3",
        liveCanvasService: liveCanvasService as never,
        nodeId: "frame-1",
        status: "done",
        title: "生成首屏主图",
        user: user(),
      }),
    ).resolves.toEqual({
      reason: "not_tool_call_or_task_step",
      updated: false,
    });

    expect(state.patches).toHaveLength(0);
  });
});

function createFrame(id: string, name: string): FrameNode {
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
    x: 120,
    y: id === "tool-1" ? 80 : 300,
  } as FrameNode;
}

function textContents(node: PenNode | undefined): string[] {
  if (!node || !("children" in node) || !Array.isArray(node.children)) {
    return [];
  }
  return node.children
    .filter((child) => child.type === "text")
    .map((child) => (child as { content?: string }).content ?? "");
}

function user() {
  return {
    accessToken: "token",
    email: "",
    id: "user-1",
    userMetadata: {},
  };
}
