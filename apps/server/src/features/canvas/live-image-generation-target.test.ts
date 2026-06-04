import {
  type CanvasOperation,
  applyCanvasTransaction,
  createEmptyDocument,
  findNode,
} from "@cucumber/canvas-core";
import type { FrameNode, LineNode, PenNode } from "@cucumber/pen-types";
import { describe, expect, it, vi } from "vitest";

import { IMAGE_GENERATION_LOADING_META_ROLE } from "./canvas-element-writer.js";
import { ensureImageGenerationTargetContainer } from "./live-image-generation-target.js";

const user = {
  accessToken: "token",
  email: "",
  id: "user-1",
  userMetadata: {},
};

function createDoc() {
  let doc = createEmptyDocument();
  doc = applyCanvasTransaction(
    doc,
    [
      {
        type: "insertNode",
        node: {
          id: "agent_execution_1",
          type: "frame",
          name: "Agent 执行",
          x: 750,
          y: 506,
          width: 240,
          height: 36,
          children: [],
        } as PenNode,
      },
    ],
    { transactionId: "seed" },
  ).doc;
  return doc;
}

function createService(initialDoc = createDoc(), initialVersion = 4) {
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
  const service = {
    getDocumentState: vi.fn(async () => ({
      document: state.doc,
      version: state.version,
    })),
    patchDocument: vi.fn(async (_user, _canvasId, patch) => {
      const result = applyCanvasTransaction(state.doc, patch.operations, {
        transactionId: patch.transactionId,
      });
      state.doc = result.doc;
      state.version += 1;
      state.patchCalls.push(patch);
      return { version: state.version };
    }),
  };
  return { service, state };
}

describe("ensureImageGenerationTargetContainer", () => {
  it("creates a visible image result container with loading and a connector before job submission", async () => {
    const { service, state } = createService();

    const result = await ensureImageGenerationTargetContainer({
      agentExecutionNodeId: "agent_execution_1",
      canvasId: "canvas-1",
      liveCanvasService: service as never,
      requestedTargetContainerId: "agent_execution_1",
      title: "小狗图片",
      transactionId: "image-target-tx",
      user,
    });

    expect(result).toMatchObject({
      clearExplicitPlacement: true,
      createdTargetContainerId: expect.any(String),
      targetContainerId: expect.any(String),
    });
    expect(state.patchCalls).toHaveLength(1);
    expect(state.patchCalls[0]).toMatchObject({
      baseVersion: 4,
      selection: [result.targetContainerId],
      transactionId: "image-target-tx",
    });

    const target = findNode(
      state.doc,
      result.targetContainerId ?? "",
    ) as FrameNode;
    expect(target).toMatchObject({
      name: "小狗图片",
      type: "frame",
      x: 1054,
      y: 506,
      width: 600,
      height: 640,
      containerRole: ["visual"],
    });
    const loadingChildren = (target.children ?? []).filter(
      (child) =>
        child.meta?.agentCanvasRole === IMAGE_GENERATION_LOADING_META_ROLE,
    );
    expect(loadingChildren).toHaveLength(2);
    expect(loadingChildren.map((child) => child.type)).toEqual([
      "rectangle",
      "text",
    ]);

    const connector = (state.doc.pages?.[0]?.children ?? []).find(
      (node) => node.type === "line",
    ) as LineNode | undefined;
    expect(connector).toMatchObject({
      connector: {
        end: { nodeId: result.targetContainerId, side: "left" },
        start: { nodeId: "agent_execution_1", side: "right" },
      },
      name: "生成图片",
    });
  });

  it("uses an existing visible target container without adding another loading container", async () => {
    let doc = createDoc();
    doc = applyCanvasTransaction(
      doc,
      [
        {
          type: "insertNode",
          node: {
            id: "existing_result",
            type: "frame",
            name: "Existing result",
            x: 1080,
            y: 506,
            width: 600,
            height: 640,
            children: [],
          } as PenNode,
        },
      ],
      { transactionId: "existing" },
    ).doc;
    const { service, state } = createService(doc);

    await expect(
      ensureImageGenerationTargetContainer({
        agentExecutionNodeId: "agent_execution_1",
        canvasId: "canvas-1",
        liveCanvasService: service as never,
        requestedTargetContainerId: "existing_result",
        title: "小狗图片",
        transactionId: "image-target-tx",
        user,
      }),
    ).resolves.toEqual({
      clearExplicitPlacement: false,
      targetContainerId: "existing_result",
    });
    expect(state.patchCalls).toHaveLength(0);
  });
});
