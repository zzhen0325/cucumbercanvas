// @vitest-environment jsdom

import {
  type CucumberCanvasDocument,
  type PenNode,
  createAgentUserGoalNode,
  findNode,
  getAgentExecutionMeta,
} from "@cucumber/canvas-core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CanvasAgentComposer } from "@/components/canvas-agent-composer";
import type { CanvasApi } from "@/components/canvas/canvas-api";

vi.mock("@/components/agent-model-selector", () => ({
  AgentModelSelector: () => null,
}));

vi.mock("@/components/image-model-preference", () => ({
  ImageModelPreferencePopover: () => null,
}));

vi.mock("@/components/image-attachment-bar", () => ({
  ImageAttachmentBar: () => null,
}));

describe("CanvasAgentComposer", () => {
  it("does not enable send for attachment-only drafts", async () => {
    render(
      <CanvasAgentComposer
        attachments={[
          {
            assetId: "asset-1",
            id: "attachment-1",
            mimeType: "image/png",
            preview: "https://example.com/image.png",
            source: "upload",
            uploading: false,
            url: "https://example.com/image.png",
          },
        ]}
        canvasApi={createCanvasApiHarness()}
        onAddFiles={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
  });

  it("creates, updates, clears, and sends a canvas-first entry chain", async () => {
    const user = userEvent.setup();
    const canvasApi = createCanvasApiHarness();
    const onSend = vi.fn().mockResolvedValue(undefined);
    const onCanvasEntryCreated = vi.fn();

    render(
      <CanvasAgentComposer
        attachments={[]}
        canvasApi={canvasApi}
        onAddFiles={vi.fn()}
        onCanvasEntryCreated={onCanvasEntryCreated}
        onRemoveAttachment={vi.fn()}
        onSend={onSend}
      />,
    );

    const textarea = screen.getByRole("textbox", { name: "输入消息" });
    await user.type(textarea, "生成一张产品海报");

    await waitFor(() => {
      expect(canvasApi.createAgentUserGoal).toHaveBeenCalledTimes(1);
    });
    const draftNode = canvasApi.getDocument().pages?.[0]?.children[0];
    if (!draftNode) throw new Error("expected draft user goal node");
    expect(getAgentExecutionMeta(draftNode)?.summary).toBe("生成一张产品海报");

    await user.type(textarea, "，绿色调");
    expect(canvasApi.updateNode).toHaveBeenCalled();
    expect(getAgentExecutionMeta(draftNode)?.summary).toBe(
      "生成一张产品海报，绿色调",
    );

    await user.clear(textarea);
    await waitFor(() => {
      expect(canvasApi.deleteNode).toHaveBeenCalledWith(draftNode?.id);
    });
    expect(canvasApi.getDocument().pages?.[0]?.children).toHaveLength(0);

    await user.type(textarea, "生成一张视频封面");
    await user.click(screen.getByRole("button", { name: "发送消息" }));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    const sentEntry = onSend.mock.calls[0]?.[2]?.canvasEntry;
    if (!sentEntry) throw new Error("expected canvas entry payload");
    expect(sentEntry.userGoalNodeId).toMatch(/^agent_user_goal_/);
    expect(sentEntry.agentExecutionNodeId).toMatch(/^agent_execution_/);
    expect(onCanvasEntryCreated).toHaveBeenCalledWith(sentEntry);
    expect(canvasApi.insertNode).toHaveBeenCalledTimes(1);
    expect(canvasApi.createConnector).toHaveBeenCalledTimes(1);
    expect(canvasApi.setSelection).toHaveBeenCalledWith([
      sentEntry.agentExecutionNodeId,
    ]);

    const userGoal = findNode(
      canvasApi.getDocument(),
      sentEntry.userGoalNodeId,
    );
    const executionNode = findNode(
      canvasApi.getDocument(),
      sentEntry.agentExecutionNodeId,
    );
    expect(getAgentExecutionMeta(userGoal)?.status).toBe("done");
    expect(getAgentExecutionMeta(executionNode)?.kind).toBe("agent_execution");
    expect(getAgentExecutionMeta(executionNode)?.summary).toBe("Thinking...");
  });

  it("keeps the prompt editable when sending fails", async () => {
    const user = userEvent.setup();
    const canvasApi = createCanvasApiHarness();
    const onSend = vi.fn().mockRejectedValue(new Error("服务暂时不可用"));

    render(
      <CanvasAgentComposer
        attachments={[]}
        canvasApi={canvasApi}
        onAddFiles={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onSend={onSend}
      />,
    );

    const textarea = screen.getByRole("textbox", { name: "输入消息" });
    await user.type(textarea, "生成一个发布会 KV");
    await user.click(screen.getByRole("button", { name: "发送消息" }));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    expect(textarea).toHaveValue("生成一个发布会 KV");
  });
});

function createCanvasApiHarness(): CanvasApi {
  const document: CucumberCanvasDocument = {
    version: "1",
    activePageId: "page-1",
    children: [],
    pages: [{ id: "page-1", name: "Page 1", children: [] }],
  };
  const activePage = () => {
    const page = document.pages?.find(
      (item) => item.id === document.activePageId,
    );
    if (!page) throw new Error("missing active page");
    return page;
  };
  const insertOrUpdate = (node: PenNode) => {
    const page = activePage();
    const index = page.children.findIndex((item) => item.id === node.id);
    if (index >= 0) page.children[index] = node;
    else page.children.push(node);
  };
  const api = {
    getDocument: () => document,
    createAgentUserGoal: vi.fn(
      (opts?: Parameters<CanvasApi["createAgentUserGoal"]>[0]) => {
        const node = createAgentUserGoalNode({
          text: opts?.text,
          x: opts?.x ?? 160,
          y: opts?.y ?? 120,
          width: opts?.width,
        });
        insertOrUpdate(node);
        return node;
      },
    ),
    createConnector: vi.fn((opts) => {
      const node: PenNode = {
        id: `connector-${Date.now()}`,
        type: "line",
        name: "Connector",
        x: opts.start.x,
        y: opts.start.y,
        width: opts.end.x - opts.start.x,
        height: opts.end.y - opts.start.y,
      } as PenNode;
      return node;
    }),
    deleteNode: vi.fn((nodeId: string) => {
      activePage().children = activePage().children.filter(
        (node) => node.id !== nodeId,
      );
    }),
    insertNode: vi.fn((node: PenNode) => insertOrUpdate(node)),
    setSelection: vi.fn(),
    updateNode: vi.fn((nodeId: string, updates: Partial<PenNode>) => {
      const node = findNode(document, nodeId);
      if (!node) throw new Error(`missing node ${nodeId}`);
      Object.assign(node, updates);
    }),
  };
  return api as unknown as CanvasApi;
}
