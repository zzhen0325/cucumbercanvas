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

function createEvidenceDoc() {
  const doc = createCanvasDocument("Agent evidence") as PenDocument & {
    selection?: string[];
  };
  const upstream = withAgentExecutionMeta(
    {
      children: [],
      height: 160,
      id: "step-1",
      name: "调研参考资料",
      type: "frame",
      width: 280,
      x: 120,
      y: 80,
    } as FrameNode,
    {
      kind: "task_step",
      runId: "run-1",
      status: "running",
      summary: "收集品牌和竞品参考。",
      title: "调研参考资料",
    },
  );
  doc.pages = doc.pages?.map((page) =>
    page.id === doc.activePageId ? { ...page, children: [upstream] } : page,
  );
  return doc;
}

function createEvidenceServer(
  initialDoc = createEvidenceDoc(),
  initialVersion = 5,
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

describe("create_agent_evidence", () => {
  it("creates a durable evidence node and links it from an upstream execution node", async () => {
    const { server, state } = createEvidenceServer();

    const result = await server.callTool(
      "create_agent_evidence",
      {
        agentId: "agent-1",
        confidence: 0.82,
        runId: "run-1",
        sessionId: "session-1",
        sourceLabel: "竞品活动页",
        sourceType: "url",
        summary: "竞品使用暖色咖啡豆特写和限时折扣文案。",
        title: "竞品海报参考",
        upstreamNodeId: "step-1",
        url: "https://example.com/poster",
      },
      context(),
    );

    expect(result).toMatchObject({
      structuredContent: {
        appliedOperationCount: 3,
        connectorNodeId: expect.any(String),
        evidenceNodeId: expect.any(String),
        nextDocumentVersion: 6,
        previewedOperationCount: 3,
        upstreamNodeId: "step-1",
      },
    });
    const payload = result.structuredContent as {
      connectorNodeId: string;
      evidenceNodeId: string;
    };
    expect(state.doc.selection).toEqual([payload.evidenceNodeId]);
    expect(getAgentExecutionMeta(findNode(state.doc, "step-1"))).toMatchObject({
      downstreamNodeIds: [payload.evidenceNodeId],
      kind: "task_step",
    });
    expect(
      getAgentExecutionMeta(findNode(state.doc, payload.evidenceNodeId)),
    ).toMatchObject({
      agentId: "agent-1",
      evidence: {
        confidence: 0.82,
        sourceLabel: "竞品活动页",
        sourceType: "url",
        url: "https://example.com/poster",
      },
      kind: "evidence",
      runId: "run-1",
      sessionId: "session-1",
      status: "done",
      upstreamNodeIds: ["step-1"],
    });
    expect(findNode(state.doc, payload.evidenceNodeId)).toMatchObject({
      agentBinding: expect.objectContaining({
        agentId: "agent-1",
        status: "completed",
      }),
      containerRole: ["context"],
      cornerRadius: AGENT_EXECUTION_CARD_CORNER_RADIUS,
      contextSlots: expect.objectContaining({
        rules: ["agent execution node: evidence"],
      }),
      runId: "run-1",
      sessionId: "session-1",
    });
    const evidenceNode = findNode(state.doc, payload.evidenceNodeId) as
      | FrameNode
      | undefined;
    const evidenceChildren = evidenceNode?.children as PenNode[] | undefined;
    expect(evidenceChildren).toHaveLength(3);
    expect(evidenceChildren?.[0]).toMatchObject({
      content: "竞品海报参考",
      fontSize: 18,
    });
    expect(evidenceChildren?.[1]).toMatchObject({
      content: "证据 · 已完成",
      fontSize: 11,
    });
    expect(evidenceChildren?.[2]).toMatchObject({
      content: expect.stringContaining("来源：竞品活动页"),
      lineHeight: 1.48,
    });
    expect(
      findNode(state.doc, payload.connectorNodeId) as LineNode,
    ).toMatchObject({
      connector: {
        end: { nodeId: payload.evidenceNodeId },
        start: { nodeId: "step-1" },
      },
      stroke: {
        fill: [{ color: "rgba(79,70,229,0.52)", type: "solid" }],
        thickness: AGENT_EXECUTION_CONNECTOR_THICKNESS,
      },
    });
  });

  it("dry-runs without mutating the live document", async () => {
    const { patchDocument, server, state } = createEvidenceServer();

    await expect(
      server.callTool(
        "create_agent_evidence",
        {
          dryRun: true,
          sourceType: "asset",
          summary: "上传的品牌 Logo 可作为视觉参考。",
          title: "品牌 Logo",
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
    const { patchDocument, server } = createEvidenceServer();

    await expect(
      server.callTool(
        "create_agent_evidence",
        {
          summary: "找不到上游节点。",
          title: "缺失证据",
          upstreamNodeId: "missing-node",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "create_agent_evidence_failed",
        message: expect.stringContaining("does not exist"),
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
  });

  it("rejects stale baseVersion without patching", async () => {
    const { patchDocument, server } = createEvidenceServer();

    await expect(
      server.callTool(
        "create_agent_evidence",
        {
          baseVersion: 4,
          summary: "版本过期。",
          title: "过期证据",
          upstreamNodeId: "step-1",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "create_agent_evidence_failed",
        message: expect.stringContaining("version mismatch"),
      },
    });
    expect(patchDocument).not.toHaveBeenCalled();
  });
});
