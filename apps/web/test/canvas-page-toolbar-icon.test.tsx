// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReplace = vi.fn();
const mockFetchCanvas = vi.fn();
const mockFetchProject = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams("id=canvas-1"),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    session: { access_token: "token-1" },
    loading: false,
    signOut: vi.fn(),
  }),
}));

vi.mock("@/lib/server-api", () => ({
  ApiAuthError: class ApiAuthError extends Error {},
  fetchCanvas: (...args: unknown[]) => mockFetchCanvas(...args),
  fetchProject: (...args: unknown[]) => mockFetchProject(...args),
}));

vi.mock("@/hooks/use-websocket", () => ({
  useWebSocket: () => undefined,
}));

vi.mock("@/hooks/use-job-fallback-polling", () => ({
  useJobFallbackPolling: () => ({ checkForTimedOutJobs: vi.fn() }),
}));

vi.mock("@/components/canvas-editor", () => ({
  CanvasEditor: ({ onApiReady, onInsertIcon }: Record<string, unknown>) => {
    useEffect(() => {
      if (typeof onApiReady !== "function") return;
      onApiReady({
        flushPendingSave: vi.fn(),
        getFiles: () => ({}),
        getSceneElements: () => [],
      });
    }, [onApiReady]);
    return (
      <button
        type="button"
        onClick={() => {
          if (typeof onInsertIcon === "function") onInsertIcon();
        }}
      >
        Toolbar Insert icon
      </button>
    );
  },
}));

vi.mock("@/components/canvas-design-system-panel", () => ({
  CanvasDesignSystemPanel: ({
    initialTab,
    open,
  }: {
    initialTab?: string;
    open: boolean;
  }) => {
    const [activeTab, setActiveTab] = useState(initialTab ?? "components");

    useEffect(() => {
      if (!open) return;
      setActiveTab(initialTab ?? "components");
    }, [open, initialTab]);

    if (!open) return <div data-testid="design-panel">closed</div>;

    return (
      <div data-testid="design-panel">
        open:{activeTab}
        <button type="button" onClick={() => setActiveTab("components")}>
          Mock Components
        </button>
        <button type="button" onClick={() => setActiveTab("variables")}>
          Mock Variables
        </button>
        {activeTab === "icons" ? (
          <>
            <input aria-label="Search icons" />
            <button type="button">Insert Mail icon</button>
          </>
        ) : null}
      </div>
    );
  },
}));

vi.mock("@/components/canvas-bottom-bar", () => ({
  CanvasBottomBar: ({ onToggleDesign }: { onToggleDesign: () => void }) => (
    <button type="button" onClick={onToggleDesign}>
      Open Design System
    </button>
  ),
}));

vi.mock("@/components/brand-kit-selector", () => ({
  BrandKitSelector: () => null,
}));
vi.mock("@/components/canvas-empty-hint", () => ({
  CanvasEmptyHint: () => null,
}));
vi.mock("@/components/canvas-files-panel", () => ({
  CanvasFilesPanel: () => null,
}));
vi.mock("@/components/canvas-layers-panel", () => ({
  CanvasLayersPanel: () => null,
}));
vi.mock("@/components/canvas-logo-menu", () => ({
  CanvasLogoMenu: () => null,
}));
vi.mock("@/components/chat-sidebar", () => ({
  ChatSidebar: () => null,
}));
vi.mock("@/components/editable-project-name", () => ({
  EditableProjectName: () => null,
}));
vi.mock("@/components/loading-screen", () => ({
  LoadingScreen: () => <div>Loading</div>,
}));

describe("Canvas page toolbar icon handoff", () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockFetchCanvas.mockResolvedValue({
      canvas: {
        id: "canvas-1",
        name: "Canvas",
        projectId: "project-1",
        content: {
          version: "1",
          children: [],
          pages: [{ id: "page-1", name: "Page 1", children: [] }],
          activePageId: "page-1",
        },
      },
    });
    mockFetchProject.mockResolvedValue({
      project: { brand_kit_id: null, name: "Project" },
    });
  });

  it("opens the Design System panel on icons from the toolbar while normal open defaults to components", async () => {
    const user = userEvent.setup();
    const { default: CanvasPage } = await import("@/app/canvas/page");

    render(<CanvasPage />);

    await waitFor(() =>
      expect(screen.getByTestId("design-panel")).toHaveTextContent("closed"),
    );

    await user.click(
      screen.getByRole("button", { name: "Open Design System" }),
    );
    expect(screen.getByTestId("design-panel")).toHaveTextContent(
      "open:components",
    );

    await user.click(
      screen.getByRole("button", { name: "Toolbar Insert icon" }),
    );
    expect(screen.getByTestId("design-panel")).toHaveTextContent("open:icons");
  });

  it("returns an already-open panel to icons after the user switches tabs", async () => {
    const user = userEvent.setup();
    const { default: CanvasPage } = await import("@/app/canvas/page");

    render(<CanvasPage />);

    await waitFor(() =>
      expect(screen.getByTestId("design-panel")).toHaveTextContent("closed"),
    );

    await user.click(
      screen.getByRole("button", { name: "Toolbar Insert icon" }),
    );
    expect(screen.getByTestId("design-panel")).toHaveTextContent("open:icons");
    expect(screen.getByRole("textbox", { name: "Search icons" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Mock Variables" }));
    expect(screen.getByTestId("design-panel")).toHaveTextContent(
      "open:variables",
    );

    await user.click(
      screen.getByRole("button", { name: "Toolbar Insert icon" }),
    );

    expect(screen.getByTestId("design-panel")).toHaveTextContent("open:icons");
    expect(screen.getByRole("textbox", { name: "Search icons" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Insert Mail icon" }),
    ).toBeVisible();
  });
});
