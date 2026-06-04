// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatSidebar } from "../src/components/chat-sidebar";
import { ToastProvider } from "../src/components/toast";
import type { WebSocketHandle } from "../src/hooks/use-websocket";

const {
  cancelRunMock,
  createRunMock,
  createSessionMock,
  deleteSessionMock,
  fetchImageModelsMock,
  fetchMessagesMock,
  fetchModelsMock,
  fetchSessionsMock,
  fetchWorkspaceSkillsMock,
  pauseRunMock,
  saveMessageMock,
  startStreamMock,
  updateSessionTitleMock,
} = vi.hoisted(() => ({
  cancelRunMock: vi.fn(),
  createRunMock: vi.fn(),
  createSessionMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  fetchImageModelsMock: vi.fn(),
  fetchMessagesMock: vi.fn(),
  fetchModelsMock: vi.fn(),
  fetchSessionsMock: vi.fn(),
  fetchWorkspaceSkillsMock: vi.fn(),
  pauseRunMock: vi.fn(),
  saveMessageMock: vi.fn(),
  startStreamMock: vi.fn(),
  updateSessionTitleMock: vi.fn(),
}));

vi.mock("../src/lib/server-api", () => ({
  cancelRun: cancelRunMock,
  createRun: createRunMock,
  createSession: createSessionMock,
  deleteSession: deleteSessionMock,
  fetchImageModels: fetchImageModelsMock,
  fetchMessages: fetchMessagesMock,
  fetchModels: fetchModelsMock,
  fetchSessions: fetchSessionsMock,
  fetchWorkspaceSkills: fetchWorkspaceSkillsMock,
  pauseRun: pauseRunMock,
  saveMessage: saveMessageMock,
  updateSessionTitle: updateSessionTitleMock,
}));

vi.mock("../src/hooks/use-sse-stream", () => ({
  useSseStream: () => ({
    startStream: startStreamMock,
  }),
}));

function createMockWs(): WebSocketHandle {
  return {
    bindCanvas: vi.fn(),
    connected: true,
    registerRPC: vi.fn(() => () => {}),
  };
}

describe("ChatSidebar", () => {
  let mockWs: WebSocketHandle;

  beforeEach(() => {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
      writable: true,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: false,
        media: "",
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      })),
      writable: true,
    });
    mockWs = createMockWs();
    cancelRunMock.mockReset();
    cancelRunMock.mockResolvedValue({ runId: "run_123", status: "canceling" });
    pauseRunMock.mockReset();
    pauseRunMock.mockResolvedValue({ runId: "run_123", status: "pausing" });
    createRunMock.mockReset();
    createRunMock.mockResolvedValue({ runId: "run_123" });
    createSessionMock.mockReset();
    createSessionMock.mockResolvedValue({
      session: {
        id: "session-created",
        title: "New Chat",
        updatedAt: "2026-03-24T00:00:00.000Z",
      },
    });
    deleteSessionMock.mockReset();
    fetchMessagesMock.mockReset();
    fetchMessagesMock.mockResolvedValue({ messages: [] });
    fetchSessionsMock.mockReset();
    fetchSessionsMock.mockResolvedValue({
      sessions: [
        {
          id: "session-real",
          title: "Existing Chat",
          updatedAt: "2026-03-24T00:00:00.000Z",
        },
      ],
    });
    fetchImageModelsMock.mockReset();
    fetchImageModelsMock.mockResolvedValue({ models: [] });
    fetchModelsMock.mockReset();
    fetchModelsMock.mockResolvedValue({ models: [] });
    fetchWorkspaceSkillsMock.mockReset();
    fetchWorkspaceSkillsMock.mockResolvedValue({ skills: [] });
    saveMessageMock.mockReset();
    saveMessageMock.mockResolvedValue(undefined);
    startStreamMock.mockReset();
    startStreamMock.mockReturnValue({
      done: Promise.resolve(),
      stop: vi.fn(),
    });
    updateSessionTitleMock.mockReset();
    updateSessionTitleMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("starts runs via HTTP createRun with the active real session id", async () => {
    render(
      <ToastProvider>
        <ChatSidebar
          accessToken="token_abc"
          canvasId="canvas-1"
          open
          onToggle={() => {}}
          ws={mockWs}
        />
      </ToastProvider>,
    );

    const input = await screen.findByPlaceholderText(/start with an idea/i);
    await userEvent.type(input, "hello cucumber{Enter}");

    await waitFor(() =>
      expect(createRunMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-real",
          conversationId: "canvas-1",
          prompt: "hello cucumber",
          canvasId: "canvas-1",
        }),
        expect.objectContaining({
          accessToken: "token_abc",
        }),
      ),
    );
    expect(createRunMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-canvas-1",
      }),
      expect.anything(),
    );
    expect(startStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        canvasId: "canvas-1",
        onEvent: expect.any(Function),
      }),
    );
  });

  it("prefills the input when a canvas Agent node requests continuation", async () => {
    render(
      <ToastProvider>
        <ChatSidebar
          accessToken="token_abc"
          agentContinueDraftRequest={{
            intent: "new_branch",
            message: "继续深化「方向 C」",
            mode: "new_branch",
            requestId: 1,
          }}
          canvasId="canvas-1"
          open
          onToggle={() => {}}
          selectedCanvasElements={[
            {
              agentExecution: {
                branchId: "branch-c",
                kind: "variant_branch",
                schemaVersion: 1,
                status: "done",
                title: "方向 C",
              },
              height: 160,
              id: "branch-node-c",
              type: "frame",
              width: 260,
              x: 0,
              y: 0,
            },
          ]}
          ws={mockWs}
        />
      </ToastProvider>,
    );

    const input = await screen.findByLabelText("输入消息");

    await waitFor(() => expect(input).toHaveValue("继续深化「方向 C」"));
    expect(screen.getByText("方案分支 · 方向 C")).toBeVisible();
    expect(screen.getByRole("button", { name: "新分支继续" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await userEvent.type(input, "{Enter}");

    await waitFor(() =>
      expect(createRunMock).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("intent: new_branch"),
        }),
        expect.anything(),
      ),
    );
    expect(createRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("intent_instruction: 复制为新分支继续"),
      }),
      expect.anything(),
    );
  });

  it("reports attachment count when continuing from a waiting Agent node", async () => {
    const onAgentContinuationSubmit = vi.fn();

    render(
      <ToastProvider>
        <ChatSidebar
          accessToken="token_abc"
          canvasId="canvas-1"
          open
          onAgentContinuationSubmit={onAgentContinuationSubmit}
          onToggle={() => {}}
          selectedCanvasElements={[
            {
              agentExecution: {
                kind: "ask_user_more",
                schemaVersion: 1,
                status: "waiting",
                title: "等待品牌资料",
                waitingForUser: {
                  acceptsFiles: true,
                  prompt: "请补充品牌图片。",
                },
              },
              height: 160,
              id: "ask-node-1",
              type: "frame",
              width: 260,
              x: 0,
              y: 0,
            },
            {
              fileId: "asset-logo",
              height: 96,
              id: "image-node-1",
              storageUrl: "https://example.test/logo.png",
              type: "image",
              width: 96,
              x: 320,
              y: 0,
            },
          ]}
          ws={mockWs}
        />
      </ToastProvider>,
    );

    const input = await screen.findByLabelText("输入消息");
    await userEvent.type(input, "继续并使用这张参考图{Enter}");

    await waitFor(() =>
      expect(createRunMock).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [
            expect.objectContaining({
              assetId: "image-node-1",
              source: "canvas-ref",
              url: "https://example.test/logo.png",
            }),
          ],
          prompt: expect.stringContaining("waiting_attachment_count: 1"),
        }),
        expect.anything(),
      ),
    );
    expect(onAgentContinuationSubmit).toHaveBeenCalledWith({
      attachmentCount: 1,
      nodeId: "ask-node-1",
      text: "继续并使用这张参考图",
    });
  });

  it("keeps tool progress out of canvas containers while preserving artifact insertion", async () => {
    const onImageGenerated = vi.fn();

    render(
      <ToastProvider>
        <ChatSidebar
          accessToken="token_abc"
          canvasId="canvas-1"
          open
          onImageGenerated={onImageGenerated}
          onToggle={() => {}}
          ws={mockWs}
        />
      </ToastProvider>,
    );

    const input = await screen.findByPlaceholderText(/start with an idea/i);
    await userEvent.type(input, "make an image{Enter}");

    await waitFor(() => expect(startStreamMock).toHaveBeenCalled());
    const streamOptions = startStreamMock.mock.calls[0]?.[0];

    act(() => {
      streamOptions.onEvent({
        runId: "run_123",
        timestamp: "2026-03-24T00:00:00.000Z",
        toolCallId: "tool_1",
        toolName: "generate_image",
        type: "tool.started",
      });

      streamOptions.onEvent({
        artifacts: [
          {
            height: 512,
            type: "image",
            url: "https://example.test/generated.png",
            width: 512,
          },
        ],
        outputSummary: "Generated image",
        runId: "run_123",
        timestamp: "2026-03-24T00:00:01.000Z",
        toolCallId: "tool_1",
        toolName: "generate_image",
        type: "tool.completed",
      });
    });

    expect(onImageGenerated).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "image",
        url: "https://example.test/generated.png",
      }),
    );
  });

  it("exposes a real run stop handler that calls the cancel endpoint", async () => {
    const stopStream = vi.fn();
    const onRunControlStateChange = vi.fn();
    const onRunStopChange = vi.fn();
    const onRunStopped = vi.fn();
    startStreamMock.mockReturnValue({
      done: new Promise<void>(() => {}),
      stop: stopStream,
    });

    render(
      <ToastProvider>
        <ChatSidebar
          accessToken="token_abc"
          canvasId="canvas-1"
          open
          onRunControlStateChange={onRunControlStateChange}
          onRunStopChange={onRunStopChange}
          onRunStopped={onRunStopped}
          onToggle={() => {}}
          ws={mockWs}
        />
      </ToastProvider>,
    );

    const input = await screen.findByPlaceholderText(/start with an idea/i);
    await userEvent.type(input, "make a poster{Enter}");

    await waitFor(() =>
      expect(onRunStopChange).toHaveBeenCalledWith(expect.any(Function)),
    );
    const stopHandler = onRunStopChange.mock.calls.find(
      ([handler]) => typeof handler === "function",
    )?.[0] as (() => void) | undefined;
    expect(stopHandler).toBeDefined();

    await act(async () => {
      stopHandler?.();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(cancelRunMock).toHaveBeenCalledWith("run_123", {
        accessToken: "token_abc",
      }),
    );
    expect(onRunStopped).toHaveBeenCalledWith({ runId: "run_123" });
    expect(stopStream).toHaveBeenCalled();
    expect(onRunControlStateChange).toHaveBeenCalledWith({
      activeRunId: "run_123",
      canceling: true,
      streaming: true,
    });
    expect(onRunControlStateChange).toHaveBeenLastCalledWith({
      streaming: false,
    });
  });

  it("exposes a real run pause handler that calls the pause endpoint", async () => {
    const stopStream = vi.fn();
    const onRunControlStateChange = vi.fn();
    const onRunPauseChange = vi.fn();
    const onRunPaused = vi.fn();
    startStreamMock.mockReturnValue({
      done: new Promise<void>(() => {}),
      stop: stopStream,
    });

    render(
      <ToastProvider>
        <ChatSidebar
          accessToken="token_abc"
          canvasId="canvas-1"
          open
          onRunControlStateChange={onRunControlStateChange}
          onRunPauseChange={onRunPauseChange}
          onRunPaused={onRunPaused}
          onToggle={() => {}}
          ws={mockWs}
        />
      </ToastProvider>,
    );

    const input = await screen.findByPlaceholderText(/start with an idea/i);
    await userEvent.type(input, "make a poster{Enter}");

    await waitFor(() =>
      expect(onRunPauseChange).toHaveBeenCalledWith(expect.any(Function)),
    );
    const pauseHandler = onRunPauseChange.mock.calls.find(
      ([handler]) => typeof handler === "function",
    )?.[0] as (() => void) | undefined;
    expect(pauseHandler).toBeDefined();

    await act(async () => {
      pauseHandler?.();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(pauseRunMock).toHaveBeenCalledWith("run_123", {
        accessToken: "token_abc",
      }),
    );
    expect(onRunPaused).toHaveBeenCalledWith({ runId: "run_123" });
    expect(stopStream).toHaveBeenCalled();
    expect(onRunControlStateChange).toHaveBeenCalledWith({
      activeRunId: "run_123",
      pausing: true,
      streaming: true,
    });
    expect(onRunControlStateChange).toHaveBeenLastCalledWith({
      streaming: false,
    });
  });
});
