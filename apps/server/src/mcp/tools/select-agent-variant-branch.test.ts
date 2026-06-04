import {
  type CanvasOperation,
  applyCanvasTransaction,
  createCanvasDocument,
  findNode,
  flattenNodes,
  getAgentExecutionMeta,
  withAgentExecutionMeta,
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

function createVariantDoc() {
  return createCanvasDocument("Agent branch selection") as PenDocument & {
    selection?: string[];
  };
}

function createVariantServer(
  initialDoc = createVariantDoc(),
  initialVersion = 3,
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

async function createThreeBranches(
  server: ReturnType<typeof createVariantServer>["server"],
) {
  const result = await server.callTool(
    "create_agent_variant_branches",
    {
      comparisonTitle: "三方向对比",
      recommendationReason: "方向 B 更适合品牌活动首发。",
      variants: [
        {
          branchId: "branch-a",
          risks: ["可能偏保守"],
          strengths: ["识别度稳定"],
          summary: "稳健品牌主视觉。",
          title: "方向 A",
          useCases: ["官网首屏"],
        },
        {
          branchId: "branch-b",
          recommended: true,
          risks: ["制作成本较高"],
          strengths: ["传播张力强"],
          summary: "活动感强的视觉方向。",
          title: "方向 B",
          useCases: ["活动海报"],
        },
        {
          branchId: "branch-c",
          risks: ["需要更精细的字体控制"],
          strengths: ["文化感强"],
          summary: "文字系统驱动的方向。",
          title: "方向 C",
          useCases: ["展览物料"],
        },
      ],
    },
    context(),
  );
  return result.structuredContent as {
    comparisonNodeId: string;
    variantBranchNodeIds: string[];
  };
}

function textContents(node: PenNode | undefined): string[] {
  if (!node || !("children" in node) || !Array.isArray(node.children)) {
    return [];
  }
  return node.children
    .filter((child) => child.type === "text")
    .map((child) => (child as { content?: string }).content ?? "");
}

describe("select_agent_variant_branch", () => {
  it("selects one branch as the durable mainline and updates the comparison", async () => {
    const { server, state } = createVariantServer();
    const created = await createThreeBranches(server);
    const branchCId = created.variantBranchNodeIds[2];
    if (!branchCId) throw new Error("Expected branch C node.");

    const result = await server.callTool(
      "select_agent_variant_branch",
      {
        branchNodeId: branchCId,
        comparisonNodeId: created.comparisonNodeId,
        recommendationReason: "方向 C 更适合形成可延展的文字系统。",
      },
      context(),
    );

    expect(result).toMatchObject({
      structuredContent: {
        appliedOperationCount: 4,
        comparisonNodeId: created.comparisonNodeId,
        nextDocumentVersion: 5,
        previewedOperationCount: 4,
        recommendedBranchId: "branch-c",
        selectedBranchNodeId: branchCId,
        updatedBranchNodeIds: created.variantBranchNodeIds,
      },
    });
    const [branchAId, branchBId] = created.variantBranchNodeIds;
    if (!branchAId || !branchBId) {
      throw new Error("Expected branch A and B nodes.");
    }
    expect(getAgentExecutionMeta(findNode(state.doc, branchAId))).toMatchObject(
      {
        branch: { isMainline: false, isRecommended: false },
        branchId: "branch-a",
      },
    );
    expect(getAgentExecutionMeta(findNode(state.doc, branchBId))).toMatchObject(
      {
        branch: { isMainline: false, isRecommended: false },
        branchId: "branch-b",
      },
    );
    expect(getAgentExecutionMeta(findNode(state.doc, branchCId))).toMatchObject(
      {
        branch: { isMainline: true, isRecommended: true },
        branchId: "branch-c",
      },
    );
    expect(
      getAgentExecutionMeta(findNode(state.doc, created.comparisonNodeId)),
    ).toMatchObject({
      comparison: {
        branchNodeIds: created.variantBranchNodeIds,
        recommendedBranchId: "branch-c",
        recommendationReason: "方向 C 更适合形成可延展的文字系统。",
      },
      kind: "comparison",
    });
    const branchC = findNode(state.doc, branchCId) as FrameNode | undefined;
    expect(branchC?.fill).toEqual([
      { type: "solid", color: "rgba(178,242,187,0.34)" },
    ]);
    const comparison = findNode(state.doc, created.comparisonNodeId) as
      | FrameNode
      | undefined;
    expect(textContents(comparison).join("\n")).toContain("推荐选择：方向 C");
    expect(state.doc.selection).toEqual([branchCId]);
  });

  it("dry-runs without mutating the selected mainline", async () => {
    const { patchDocument, server, state } = createVariantServer();
    const created = await createThreeBranches(server);
    patchDocument.mockClear();
    const branchAId = created.variantBranchNodeIds[0];
    const branchBId = created.variantBranchNodeIds[1];
    if (!branchAId || !branchBId) {
      throw new Error("Expected branch A and B nodes.");
    }

    await expect(
      server.callTool(
        "select_agent_variant_branch",
        {
          branchNodeId: branchAId,
          dryRun: true,
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        appliedOperationCount: 0,
        previewedOperationCount: 4,
        recommendedBranchId: "branch-a",
      },
    });

    expect(patchDocument).not.toHaveBeenCalled();
    expect(getAgentExecutionMeta(findNode(state.doc, branchBId))).toMatchObject(
      {
        branch: { isMainline: true, isRecommended: true },
        branchId: "branch-b",
      },
    );
  });

  it("rejects stale baseVersion without patching", async () => {
    const { patchDocument, server } = createVariantServer();
    const created = await createThreeBranches(server);
    patchDocument.mockClear();
    const branchAId = created.variantBranchNodeIds[0];
    if (!branchAId) throw new Error("Expected branch A node.");

    await expect(
      server.callTool(
        "select_agent_variant_branch",
        {
          baseVersion: 3,
          branchNodeId: branchAId,
        },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "select_agent_variant_branch_failed",
        message: expect.stringContaining("version mismatch"),
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
  });

  it("fails clearly when no comparison references the branch", async () => {
    const doc = createVariantDoc();
    const branch = createStandaloneBranch("branch-orphan");
    const firstPage = doc.pages?.[0];
    if (!firstPage) throw new Error("Expected default canvas page.");
    doc.pages = [{ ...firstPage, children: [branch] }];
    const { patchDocument, server } = createVariantServer(doc);

    await expect(
      server.callTool(
        "select_agent_variant_branch",
        {
          branchNodeId: branch.id,
        },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "select_agent_variant_branch_failed",
        message: expect.stringContaining("No comparison node references"),
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
  });
});

function createStandaloneBranch(branchId: string): PenNode {
  const node: FrameNode = {
    id: "branch-orphan-node",
    type: "frame",
    name: "孤立分支",
    x: 0,
    y: 0,
    width: 240,
    height: 160,
    children: [],
  };
  return withAgentExecutionMeta(node, {
    branchId,
    branchLabel: "孤立分支",
    kind: "variant_branch",
    status: "done",
    title: "孤立分支",
  });
}
