import {
  type CanvasOperation,
  applyCanvasTransaction,
  createCanvasDocument,
  findNode,
  flattenNodes,
  getAgentExecutionMeta,
} from "@cucumber/canvas-core";
import type { LineNode, PenDocument, PenNode } from "@cucumber/pen-types";
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

function createVariantDoc() {
  return createCanvasDocument("Agent variants") as PenDocument & {
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

function textContents(node: PenNode | undefined): string[] {
  if (!node || !("children" in node) || !Array.isArray(node.children)) {
    return [];
  }
  return node.children
    .filter((child) => child.type === "text")
    .map((child) => (child as { content?: string }).content ?? "");
}

describe("create_agent_variant_branches", () => {
  it("creates durable variant branches and a comparison node", async () => {
    const { server, state } = createVariantServer();

    const result = await server.callTool(
      "create_agent_variant_branches",
      {
        agentId: "agent-1",
        comparisonTitle: "三方向对比",
        recommendationReason: "方向 B 更适合品牌活动首发。",
        runId: "run-1",
        sessionId: "session-1",
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
            critiqueSummary: "传播张力强，但需要控制制作成本。",
            deliverableSummary: "活动首发海报和社交媒体主视觉。",
            planSummary: "先生成高冲击主视觉，再扩展社交媒体比例。",
            recommended: true,
            risks: ["制作成本较高"],
            strengths: ["传播张力强"],
            summary: "活动感强的视觉方向。",
            title: "方向 B",
            useCases: ["活动海报", "社交媒体"],
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

    expect(result).toMatchObject({
      structuredContent: {
        appliedOperationCount: 11,
        comparisonNodeId: expect.any(String),
        connectorNodeIds: expect.arrayContaining([expect.any(String)]),
        nextDocumentVersion: 4,
        previewedOperationCount: 11,
        recommendedBranchId: "branch-b",
        variantBranchNodeIds: [
          expect.any(String),
          expect.any(String),
          expect.any(String),
        ],
      },
    });
    const payload = result.structuredContent as {
      comparisonNodeId: string;
      connectorNodeIds: string[];
      variantBranchNodeIds: string[];
    };
    expect(state.doc.pages?.[0]?.children).toHaveLength(11);
    expect(flattenNodes(state.doc)).toHaveLength(22);
    const [branchAId, branchBId] = payload.variantBranchNodeIds;
    if (!branchAId || !branchBId) {
      throw new Error("Expected at least two variant branch nodes.");
    }
    expect(getAgentExecutionMeta(findNode(state.doc, branchAId))).toMatchObject(
      {
        branch: {
          isMainline: false,
          isRecommended: false,
          strengths: ["识别度稳定"],
        },
        branchId: "branch-a",
        kind: "variant_branch",
        runId: "run-1",
        status: "done",
        canvasPresentation: {
          layoutVersion: 2,
          collapsed: false,
        },
      },
    );
    expect(getAgentExecutionMeta(findNode(state.doc, branchBId))).toMatchObject(
      {
        branch: {
          critiqueSummary: "传播张力强，但需要控制制作成本。",
          deliverableSummary: "活动首发海报和社交媒体主视觉。",
          isMainline: true,
          isRecommended: true,
          planSummary: "先生成高冲击主视觉，再扩展社交媒体比例。",
        },
        branchId: "branch-b",
        kind: "variant_branch",
      },
    );
    const branchB = findNode(state.doc, branchBId) as PenNode | undefined;
    const branchBText = textContents(branchB).join("\n");
    expect(branchBText).toContain(
      "计划：先生成高冲击主视觉，再扩展社交媒体比例。",
    );
    expect(branchBText).toContain("产物：活动首发海报和社交媒体主视觉。");
    expect(branchBText).toContain("评审：传播张力强，但需要控制制作成本。");
    expect(
      getAgentExecutionMeta(findNode(state.doc, payload.comparisonNodeId)),
    ).toMatchObject({
      comparison: {
        branchNodeIds: payload.variantBranchNodeIds,
        recommendedBranchId: "branch-b",
        recommendationReason: "方向 B 更适合品牌活动首发。",
      },
      kind: "comparison",
      status: "done",
      upstreamNodeIds: payload.variantBranchNodeIds,
      canvasPresentation: {
        layoutVersion: 2,
        collapsed: false,
      },
    });
    for (const nodeId of [
      ...payload.variantBranchNodeIds,
      payload.comparisonNodeId,
    ]) {
      const node = findNode(state.doc, nodeId);
      expect(node).toMatchObject({
        agentBinding: expect.objectContaining({
          agentId: "agent-1",
          status: "completed",
        }),
        containerRole: ["task", "context"],
        cornerRadius: AGENT_EXECUTION_CARD_CORNER_RADIUS,
        runId: "run-1",
        sessionId: "session-1",
      });
      expect(node?.contextSlots?.rules).toEqual(
        expect.arrayContaining([
          expect.stringContaining("agent execution node:"),
        ]),
      );
    }
    const connectors = payload.connectorNodeIds.map(
      (id) => findNode(state.doc, id) as LineNode | undefined,
    );
    expect(connectors).toHaveLength(6);
    expect(connectors[0]?.stroke).toMatchObject({
      fill: [{ color: "rgba(15,23,42,0.12)", type: "solid" }],
      thickness: AGENT_EXECUTION_CONNECTOR_THICKNESS,
    });
    expect(connectors[0]).toMatchObject({
      connector: {
        end: { nodeId: branchAId },
      },
    });
    expect(
      connectors.some(
        (connector) =>
          connector?.connector?.start?.nodeId === branchAId &&
          connector.connector.end?.nodeId === payload.comparisonNodeId,
      ),
    ).toBe(true);
    expect(state.doc.selection).toEqual([payload.comparisonNodeId]);
  });

  it("dry-runs without mutating the live document", async () => {
    const { patchDocument, server, state } = createVariantServer();

    await expect(
      server.callTool(
        "create_agent_variant_branches",
        {
          dryRun: true,
          variants: [
            { summary: "方向一", title: "方向一" },
            { summary: "方向二", title: "方向二" },
          ],
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        appliedOperationCount: 0,
        previewedOperationCount: 8,
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
    expect(flattenNodes(state.doc)).toHaveLength(0);
  });

  it("rejects stale baseVersion without patching", async () => {
    const { patchDocument, server } = createVariantServer();

    await expect(
      server.callTool(
        "create_agent_variant_branches",
        {
          baseVersion: 2,
          variants: [
            { summary: "方向一", title: "方向一" },
            { summary: "方向二", title: "方向二" },
          ],
        },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "create_agent_variant_branches_failed",
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
        "create_agent_variant_branches",
        {
          variants: [
            { summary: "方向一", title: "方向一" },
            { summary: "方向二", title: "方向二" },
          ],
        },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "create_agent_variant_branches_failed",
        message: expect.stringContaining("requires an open live editor"),
      },
    });
  });
});
