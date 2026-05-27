import type { CucumberCanvasDocument } from "@cucumber/canvas-core";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CanvasApi,
  CanvasAppState,
  CanvasSceneElement,
} from "@/components/canvas/canvas-api";
import { SkiaCanvas } from "@/components/canvas/skia-canvas";

const penRendererMockState = vi.hoisted(() => ({
  getNodeBounds: vi.fn<
    () => { x: number; y: number; w: number; h: number } | null
  >(() => null),
  hitTest: vi.fn<() => unknown | null>(() => null),
}));

vi.mock("paper", () => ({
  default: {},
}));

vi.mock("@cucumber/pen-renderer", () => ({
  PenRenderer: class MockPenRenderer {
    init = vi.fn();
    resize = vi.fn();
    dispose = vi.fn();
    zoomToFit = vi.fn();
    setDocument = vi.fn();
    setPage = vi.fn();
    setEditorOverlays = vi.fn();
    getViewport = vi.fn(() => ({ zoom: 1, panX: 0, panY: 0 }));
    getNodeBounds = penRendererMockState.getNodeBounds;
    setViewport = vi.fn();
    hitTest = penRendererMockState.hitTest;
    hitTestSelectionControl = vi.fn(() => null);
  },
  loadCanvasKit: vi.fn(async () => ({})),
  screenToScene: vi.fn(() => ({ x: 0, y: 0 })),
}));

vi.mock("@/components/toast", () => ({
  useToast: () => ({ error: vi.fn() }),
}));

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

const initialDocument: CucumberCanvasDocument = {
  version: "cucumber-canvas-v1",
  children: [],
};

describe("SkiaCanvas selection snapshots", () => {
  beforeEach(() => {
    penRendererMockState.hitTest.mockReset();
    penRendererMockState.hitTest.mockReturnValue(null);
    penRendererMockState.getNodeBounds.mockReset();
    penRendererMockState.getNodeBounds.mockReturnValue(null);
  });

  it("emits coherent onChange snapshots when a canvas action creates and selects a node", async () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;
    const apiRef: { current: CanvasApi | null } = { current: null };

    try {
      const { container } = render(
        <SkiaCanvas
          initialContent={initialDocument}
          onApiReady={(readyApi) => {
            apiRef.current = readyApi;
          }}
        />,
      );

      await waitFor(() => expect(apiRef.current).not.toBeNull());
      await waitFor(() =>
        expect(container.querySelector("canvas")).not.toBeNull(),
      );

      const snapshots: Array<{
        elementIds: string[];
        selectedIds: string[];
      }> = [];
      const readyApi = apiRef.current;
      if (!readyApi) throw new Error("Canvas API was not initialized.");

      const unsubscribe = readyApi.onChange(
        (elements: CanvasSceneElement[], appState: CanvasAppState) => {
          snapshots.push({
            elementIds: elements.map((element) => element.id),
            selectedIds: Object.keys(appState.selectedElementIds),
          });
        },
      );

      let createdNodeId = "";

      await act(async () => {
        createdNodeId = readyApi.createContainer({
          name: "Created then selected",
          x: 10,
          y: 20,
          width: 120,
          height: 80,
        }).id;
      });

      await waitFor(() => {
        expect(snapshots.at(-1)?.selectedIds).toContain(createdNodeId);
      });

      expect(snapshots.at(-1)).toEqual({
        elementIds: [createdNodeId],
        selectedIds: [createdNodeId],
      });
      expect(
        snapshots.filter(
          (snapshot) =>
            snapshot.elementIds.includes(createdNodeId) &&
            !snapshot.selectedIds.includes(createdNodeId),
        ),
      ).toEqual([]);

      unsubscribe?.();
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });

  it("reconciles a stale active page when agents replace the document", async () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;
    const apiRef: { current: CanvasApi | null } = { current: null };

    try {
      const { container } = render(
        <SkiaCanvas
          initialContent={initialDocument}
          onApiReady={(readyApi) => {
            apiRef.current = readyApi;
          }}
        />,
      );

      await waitFor(() => expect(apiRef.current).not.toBeNull());
      await waitFor(() =>
        expect(container.querySelector("canvas")).not.toBeNull(),
      );
      const readyApi = apiRef.current;
      if (!readyApi) throw new Error("Canvas API was not initialized.");

      await act(async () => {
        readyApi.setDocument({
          version: "cucumber-canvas-v1",
          activePageId: "deleted-page",
          pages: [{ id: "page-a", name: "Page A", children: [] }],
          children: [],
        } as CucumberCanvasDocument);
      });

      expect(readyApi.getActivePageId()).toBe("page-a");
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });

  it("reorders root-level nodes through the CanvasApi", async () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;
    const apiRef: { current: CanvasApi | null } = { current: null };

    try {
      const { container } = render(
        <SkiaCanvas
          initialContent={initialDocument}
          onApiReady={(readyApi) => {
            apiRef.current = readyApi;
          }}
        />,
      );

      await waitFor(() => expect(apiRef.current).not.toBeNull());
      await waitFor(() =>
        expect(container.querySelector("canvas")).not.toBeNull(),
      );
      const readyApi = apiRef.current;
      if (!readyApi) throw new Error("Canvas API was not initialized.");

      await act(async () => {
        readyApi.setDocument({
          version: "cucumber-canvas-v1",
          activePageId: "page-a",
          pages: [
            {
              id: "page-a",
              name: "Page A",
              children: [
                {
                  id: "a",
                  type: "rectangle",
                  x: 0,
                  y: 0,
                  width: 10,
                  height: 10,
                },
                {
                  id: "b",
                  type: "rectangle",
                  x: 20,
                  y: 0,
                  width: 10,
                  height: 10,
                },
              ],
            },
          ],
          children: [],
        } as CucumberCanvasDocument);
        readyApi.reorderNode("a", "front");
      });

      expect(
        readyApi.getDocument().pages?.[0]?.children.map((node) => node.id),
      ).toEqual(["b", "a"]);

      await act(async () => {
        readyApi.moveNodeToIndex("a", null, 0);
      });

      expect(
        readyApi.getDocument().pages?.[0]?.children.map((node) => node.id),
      ).toEqual(["a", "b"]);
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });

  it("edits a selected text node from a double-click overlay", async () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;
    const apiRef: { current: CanvasApi | null } = { current: null };
    const textNode = {
      id: "text-1",
      type: "text",
      name: "Heading",
      x: 16,
      y: 24,
      width: 180,
      height: 48,
      content: "Draft title",
      fontSize: 20,
      fill: [{ type: "solid", color: "#111827" }],
    } as const;
    penRendererMockState.hitTest.mockReturnValue(textNode);
    penRendererMockState.getNodeBounds.mockReturnValue({
      x: 16,
      y: 24,
      w: 180,
      h: 48,
    });

    try {
      const { container, getByLabelText } = render(
        <SkiaCanvas
          initialContent={{
            version: "cucumber-canvas-v1",
            children: [textNode],
          }}
          onApiReady={(readyApi) => {
            apiRef.current = readyApi;
          }}
        />,
      );

      await waitFor(() => expect(apiRef.current).not.toBeNull());
      await waitFor(() =>
        expect(container.querySelector("canvas")).not.toBeNull(),
      );
      const canvasElement = container.querySelector("canvas") as HTMLElement;

      await act(async () => {
        fireEvent.dblClick(canvasElement, { clientX: 24, clientY: 32 });
      });

      const editor = getByLabelText("Edit canvas text") as HTMLTextAreaElement;
      expect(editor.value).toBe("Draft title");

      await act(async () => {
        editor.value = "Final title";
        editor.dispatchEvent(new Event("blur", { bubbles: true }));
      });

      const savedTextNode =
        apiRef.current?.getDocument().pages?.[0]?.children[0] ??
        apiRef.current?.getDocument().children[0];
      expect(savedTextNode).toMatchObject({
        id: "text-1",
        content: "Final title",
      });
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });
});
