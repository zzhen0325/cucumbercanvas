// @vitest-environment jsdom

import {
  AGENT_EXECUTION_CONTAINER_META_KEY,
  type PenDocument,
  applyCanvasOperation,
  createAgentRunNode,
  createEmptyDocument,
  getAgentExecutionContainerMeta,
  getAgentExecutionMeta,
  reduceAgentExecutionContainerStreamEvent,
  setAgentExecutionCanvasCollapsed,
} from "@cucumber/canvas-core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  AgentRunNodeContentLayer,
  getAgentRunNodeOverlayStates,
} from "@/components/canvas/agent-run-node-content-layer";
import type { CanvasApi } from "@/components/canvas/canvas-api";
import {
  CanvasRuntimeStoreProvider,
  createCanvasRuntimeStore,
} from "@/components/canvas/canvas-runtime-store";

function createDocument(
  node: ReturnType<typeof createAgentRunNode>,
): PenDocument {
  return applyCanvasOperation(createEmptyDocument(), {
    node,
    type: "insertNode",
  });
}

function createRichAgentRunNode() {
  const node = createAgentRunNode({
    runId: "run-1",
    summary: "Thinking...",
    title: "生成封面图",
    x: 40,
    y: 80,
  });
  const container = getAgentExecutionContainerMeta(node);
  if (!container) throw new Error("missing agent execution container");
  const events = [
    {
      delta: "先分析画布上的品牌风格。",
      messageId: "thinking-1",
      runId: "run-1",
      timestamp: "2026-06-04T00:00:00.000Z",
      type: "thinking.delta" as const,
    },
    {
      input: { prompt: "cover", size: "1024x1024" },
      runId: "run-1",
      timestamp: "2026-06-04T00:00:01.000Z",
      toolCallId: "tool-1",
      toolName: "generate_image",
      type: "tool.started" as const,
    },
    {
      output: { elementId: "image-node-1", model: "seedream" },
      outputSummary: "图片容器已创建",
      runId: "run-1",
      timestamp: "2026-06-04T00:00:02.000Z",
      toolCallId: "tool-1",
      toolName: "generate_image",
      type: "tool.completed" as const,
    },
    {
      output: {
        todos: [
          { content: "读取画布", status: "completed" },
          { activeForm: "进行中", content: "生成图片", status: "in_progress" },
        ],
      },
      runId: "run-1",
      timestamp: "2026-06-04T00:00:03.000Z",
      toolCallId: "tool-2",
      toolName: "write_todos",
      type: "tool.completed" as const,
    },
    {
      delta: "**完成**，图片已经放到画布。",
      messageId: "message-1",
      runId: "run-1",
      timestamp: "2026-06-04T00:00:04.000Z",
      type: "message.delta" as const,
    },
  ];
  const nextContainer = events.reduce(
    reduceAgentExecutionContainerStreamEvent,
    container,
  );
  return {
    ...node,
    meta: {
      ...(node.meta ?? {}),
      [AGENT_EXECUTION_CONTAINER_META_KEY]: nextContainer,
    },
  };
}

describe("AgentRunNodeContentLayer", () => {
  it("positions expanded agent_run_node content from canvas bounds and viewport", () => {
    const node = createRichAgentRunNode();
    const document = createDocument(node);

    expect(
      getAgentRunNodeOverlayStates({
        activePageId: document.activePageId,
        document,
        viewport: { backgroundColor: "#fff", x: 10, y: 20, zoom: 2 },
      }),
    ).toEqual([
      expect.objectContaining({
        container: expect.objectContaining({ containerId: node.id }),
        height: expect.any(Number),
        node: expect.objectContaining({ id: node.id }),
        collapsed: false,
        width: expect.any(Number),
        x: 90,
        y: 180,
      }),
    ]);
  });

  it("renders reasoning, tools, queue tasks, messages, and blocks wheel bubbling", async () => {
    const node = createRichAgentRunNode();
    const document = createDocument(node);
    const store = createCanvasRuntimeStore(document);
    const api = { updateNode: vi.fn() } as unknown as CanvasApi;
    const onWheel = vi.fn();

    render(
      <div onWheel={onWheel}>
        <CanvasRuntimeStoreProvider store={store}>
          <AgentRunNodeContentLayer api={api} />
        </CanvasRuntimeStoreProvider>
      </div>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByLabelText("AgentRunNode：生成封面图")).toBeVisible();
    expect(screen.getByText("先分析画布上的品牌风格。")).toBeVisible();
    expect(screen.getByText("generate image")).toBeVisible();
    expect(screen.getByText("读取画布")).toBeVisible();
    expect(screen.getByText("生成图片")).toBeVisible();
    expect(screen.getByText(/图片已经放到画布/)).toBeVisible();
    expect(screen.getByLabelText("收起 AgentRunNode")).toBeVisible();

    fireEvent.wheel(screen.getByLabelText("AgentRunNode：生成封面图"));
    expect(onWheel).not.toHaveBeenCalled();
  });

  it("writes measured content size back to the durable node bounds", async () => {
    const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return 900;
      },
    });
    const node = createRichAgentRunNode();
    const document = createDocument(node);
    const store = createCanvasRuntimeStore(document);
    const api = { updateNode: vi.fn() } as unknown as CanvasApi;

    try {
      render(
        <CanvasRuntimeStoreProvider store={store}>
          <AgentRunNodeContentLayer api={api} />
        </CanvasRuntimeStoreProvider>,
      );

      await waitFor(() => {
        expect(api.updateNode).toHaveBeenCalledWith(
          node.id,
          expect.objectContaining({
            height: 760,
            width: 460,
          }),
        );
      });
    } finally {
      if (scrollHeightDescriptor) {
        Object.defineProperty(
          HTMLElement.prototype,
          "scrollHeight",
          scrollHeightDescriptor,
        );
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
      }
    }
  });

  it("does not mount full React content for collapsed agent_run_node nodes", () => {
    const node = setAgentExecutionCanvasCollapsed(
      createRichAgentRunNode(),
      true,
    );
    const document = createDocument(node);
    const store = createCanvasRuntimeStore(document);
    const api = { updateNode: vi.fn() } as unknown as CanvasApi;

    render(
      <CanvasRuntimeStoreProvider store={store}>
        <AgentRunNodeContentLayer api={api} />
      </CanvasRuntimeStoreProvider>,
    );

    expect(screen.queryByLabelText("AgentRunNode：生成封面图")).toBeNull();
    expect(screen.getByLabelText("展开 AgentRunNode")).toBeVisible();
  });

  it("writes collapsed and expanded state back to the durable AgentRunNode", async () => {
    const user = userEvent.setup();
    const node = createRichAgentRunNode();
    const document = createDocument(node);
    const store = createCanvasRuntimeStore(document);
    const api = { updateNode: vi.fn() } as unknown as CanvasApi;

    render(
      <CanvasRuntimeStoreProvider store={store}>
        <AgentRunNodeContentLayer api={api} />
      </CanvasRuntimeStoreProvider>,
    );

    await user.click(screen.getByLabelText("收起 AgentRunNode"));

    const updates = vi.mocked(api.updateNode).mock.calls[0]?.[1];
    const execution = updates?.meta
      ? getAgentExecutionMeta({ ...node, meta: updates.meta })
      : null;
    expect(vi.mocked(api.updateNode).mock.calls[0]?.[0]).toBe(node.id);
    expect(execution?.canvasPresentation?.collapsed).toBe(true);

    const collapsedNode = setAgentExecutionCanvasCollapsed(node, true);
    const collapsedDocument = createDocument(collapsedNode);
    const collapsedStore = createCanvasRuntimeStore(collapsedDocument);
    const collapsedApi = { updateNode: vi.fn() } as unknown as CanvasApi;
    render(
      <CanvasRuntimeStoreProvider store={collapsedStore}>
        <AgentRunNodeContentLayer api={collapsedApi} />
      </CanvasRuntimeStoreProvider>,
    );

    await user.click(screen.getByLabelText("展开 AgentRunNode"));

    const expandUpdates = vi.mocked(collapsedApi.updateNode).mock.calls[0]?.[1];
    const expandedExecution = expandUpdates?.meta
      ? getAgentExecutionMeta({ ...collapsedNode, meta: expandUpdates.meta })
      : null;
    expect(vi.mocked(collapsedApi.updateNode).mock.calls[0]?.[0]).toBe(node.id);
    expect(expandedExecution?.canvasPresentation?.collapsed).toBe(false);
  });
});
