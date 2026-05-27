// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatSidebar } from "../src/components/chat-sidebar";
import { ToastProvider } from "../src/components/toast";
import type { WebSocketHandle } from "../src/hooks/use-websocket";

const {
  createRunMock,
  createSessionMock,
  deleteSessionMock,
  fetchImageModelsMock,
  fetchMessagesMock,
  fetchModelsMock,
  fetchSessionsMock,
  fetchWorkspaceSkillsMock,
  saveMessageMock,
  startStreamMock,
  updateSessionTitleMock,
} = vi.hoisted(() => ({
  createRunMock: vi.fn(),
  createSessionMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  fetchImageModelsMock: vi.fn(),
  fetchMessagesMock: vi.fn(),
  fetchModelsMock: vi.fn(),
  fetchSessionsMock: vi.fn(),
  fetchWorkspaceSkillsMock: vi.fn(),
  saveMessageMock: vi.fn(),
  startStreamMock: vi.fn(),
  updateSessionTitleMock: vi.fn(),
}));

vi.mock("../src/lib/server-api", () => ({
  createRun: createRunMock,
  createSession: createSessionMock,
  deleteSession: deleteSessionMock,
  fetchImageModels: fetchImageModelsMock,
  fetchMessages: fetchMessagesMock,
  fetchModels: fetchModelsMock,
  fetchSessions: fetchSessionsMock,
  fetchWorkspaceSkills: fetchWorkspaceSkillsMock,
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
});
