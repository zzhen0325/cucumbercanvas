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
  const state = { doc, version: 1 };
  const patchDocument = vi.fn(async (_user, _canvasId, patch) => {
    for (const operation of patch.operations as CanvasOperation[]) {
      state.doc = applyCanvasOperation(state.doc, operation);
    }
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

describe("record_agent_critique", () => {
  it("records validation and critique results into an existing durable critique node", async () => {
    const doc = createCanvasDocument("Record critique") as PenDocument;
    const page = doc.pages?.[0];
    if (!page) throw new Error("Expected default canvas page fixture.");
    const critiqueNode = withAgentExecutionNodeSemantics(
      {
        id: "critique-1",
        type: "frame",
        children: [
          {
            id: "critique-text",
            type: "text",
            content: "Pending critique",
          } as PenNode,
        ],
        name: "验证与评审",
      } as FrameNode,
      {
        agentId: "agent-1",
        kind: "critique",
        runId: "run-1",
        sessionId: "session-1",
        status: "waiting",
        title: "验证与评审",
      },
    );
    page.children = [critiqueNode];
    const { patchDocument, server, state } = createRecordServer(doc);

    await expect(
      server.callTool(
        "record_agent_critique",
        {
          critiqueNodeId: "critique-1",
          findings: [
            {
              nodeId: "hero",
              reason: "Hero text may overflow.",
              severity: "warning",
              suggestedFix: "Increase container height.",
            },
          ],
          summary: "Canvas validation found one issue.",
          title: "验证结果",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        appliedOperationCount: 1,
        critiqueNodeId: "critique-1",
        success: true,
      },
    });

    expect(patchDocument).toHaveBeenCalledWith(
      expect.anything(),
      "canvas-1",
      expect.objectContaining({
        selection: ["critique-1"],
      }),
    );
    const updatedNode = findNode(state.doc, "critique-1");
    expect(updatedNode).toMatchObject({
      agentBinding: expect.objectContaining({
        agentId: "agent-1",
        status: "completed",
      }),
      containerRole: ["task"],
      contextSlots: expect.objectContaining({
        rules: ["agent execution node: critique"],
      }),
      runId: "run-1",
      sessionId: "session-1",
    });
    expect(getAgentExecutionMeta(updatedNode)).toMatchObject({
      critique: {
        findings: [
          expect.objectContaining({
            nodeId: "hero",
            reason: "Hero text may overflow.",
            severity: "warning",
            suggestedFix: "Increase container height.",
          }),
        ],
        issueCounts: {
          error: 0,
          info: 0,
          warning: 1,
        },
        pass: true,
      },
      details: {
        outputSummary: expect.stringContaining("Hero text may overflow."),
      },
      kind: "critique",
      status: "done",
      summary: "Canvas validation found one issue.",
      title: "验证结果",
    });
    expect((updatedNode as FrameNode).children?.[0]).toMatchObject({
      content: expect.stringContaining("Increase container height."),
    });
  });

  it("rejects non-critique nodes instead of guessing a write target", async () => {
    const doc = createCanvasDocument("Reject critique") as PenDocument;
    const page = doc.pages?.[0];
    if (!page) throw new Error("Expected default canvas page fixture.");
    page.children = [
      withAgentExecutionMeta({ id: "step-1", type: "frame" } as FrameNode, {
        kind: "task_step",
        status: "done",
        title: "Step",
      }),
    ];

    await expect(
      createRecordServer(doc).server.callTool(
        "record_agent_critique",
        {
          critiqueNodeId: "step-1",
          summary: "Should not write here.",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "record_agent_critique_failed",
        message: expect.stringContaining("not a durable Agent critique node"),
      },
    });
  });

  it("keeps structured critique pass false when the recorded critique status failed", async () => {
    const doc = createCanvasDocument("Failed critique") as PenDocument;
    const page = doc.pages?.[0];
    if (!page) throw new Error("Expected default canvas page fixture.");
    page.children = [
      withAgentExecutionNodeSemantics(
        { id: "critique-1", type: "frame", name: "验证与评审" } as FrameNode,
        {
          kind: "critique",
          status: "waiting",
          title: "验证与评审",
        },
      ),
    ];
    const { server, state } = createRecordServer(doc);

    await expect(
      server.callTool(
        "record_agent_critique",
        {
          critiqueNodeId: "critique-1",
          findings: [
            {
              reason: "视觉层级仍需人工复核。",
              severity: "warning",
            },
          ],
          status: "failed",
          summary: "验证未能确认画布质量。",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      structuredContent: {
        success: true,
      },
    });

    expect(
      getAgentExecutionMeta(findNode(state.doc, "critique-1")),
    ).toMatchObject({
      critique: {
        issueCounts: {
          error: 0,
          info: 0,
          warning: 1,
        },
        pass: false,
      },
      status: "failed",
    });
  });
});
