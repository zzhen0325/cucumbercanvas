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
  screenToScene: vi.fn((clientX: number, clientY: number) => ({
    x: clientX,
    y: clientY,
  })),
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
  screenToScene: penRendererMockState.screenToScene,
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
  activePageId: "page-default",
  pages: [{ id: "page-default", name: "Page 1", children: [] }],
  children: [],
  viewport: { x: 0, y: 0, zoom: 1, backgroundColor: "#ffffff" },
};

describe("SkiaCanvas selection snapshots", () => {
  beforeEach(() => {
    penRendererMockState.hitTest.mockReset();
    penRendererMockState.hitTest.mockReturnValue(null);
    penRendererMockState.getNodeBounds.mockReset();
    penRendererMockState.getNodeBounds.mockReturnValue(null);
    penRendererMockState.screenToScene.mockReset();
    penRendererMockState.screenToScene.mockImplementation(
      (clientX: number, clientY: number) => ({
        x: clientX,
        y: clientY,
      }),
    );
  });

  it("emits coherent onChange snapshots when a canvas action creates and selects a node", async () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    const originalSetPointerCapture = HTMLElement.prototype.setPointerCapture;
    const originalReleasePointerCapture =
      HTMLElement.prototype.releasePointerCapture;
    const originalHasPointerCapture = HTMLElement.prototype.hasPointerCapture;
    globalThis.ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
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

  it("rejects a stale active page when agents replace the document", async () => {
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

      expect(() =>
        readyApi.setDocument({
          version: "cucumber-canvas-v1",
          activePageId: "deleted-page",
          pages: [{ id: "page-a", name: "Page A", children: [] }],
          children: [],
          viewport: { x: 0, y: 0, zoom: 1, backgroundColor: "#ffffff" },
        } as CucumberCanvasDocument),
      ).toThrow("Page deleted-page does not exist.");
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
            activePageId: "page-default",
            pages: [
              { id: "page-default", name: "Page 1", children: [textNode] },
            ],
            children: [],
            viewport: { x: 0, y: 0, zoom: 1, backgroundColor: "#ffffff" },
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
        fireEvent.blur(editor, { target: { value: "Final title" } });
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

  it("draws lines, arrows, and frames from the pointer drag bounds", async () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    const originalSetPointerCapture = HTMLElement.prototype.setPointerCapture;
    const originalReleasePointerCapture =
      HTMLElement.prototype.releasePointerCapture;
    const originalHasPointerCapture = HTMLElement.prototype.hasPointerCapture;
    globalThis.ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
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
      const canvasElement = container.querySelector("canvas") as HTMLElement;
      const stage = canvasElement.parentElement?.parentElement;
      if (!stage) throw new Error("Canvas stage was not initialized.");
      const firePointerEvent = (
        type: "pointerdown" | "pointermove" | "pointerup",
        options: { clientX: number; clientY: number; pointerId: number },
      ) => {
        const event = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: options.clientX,
          clientY: options.clientY,
        });
        Object.defineProperty(event, "pointerId", {
          configurable: true,
          value: options.pointerId,
        });
        fireEvent(stage, event);
      };

      await act(async () => {
        apiRef.current?.setActiveTool("line");
      });
      await waitFor(() => expect(apiRef.current?.getActiveTool()).toBe("line"));
      await act(async () => {
        firePointerEvent("pointerdown", {
          clientX: 10,
          clientY: 20,
          pointerId: 1,
        });
        firePointerEvent("pointermove", {
          clientX: 110,
          clientY: 70,
          pointerId: 1,
        });
        firePointerEvent("pointerup", {
          clientX: 110,
          clientY: 70,
          pointerId: 1,
        });
      });

      await act(async () => {
        apiRef.current?.setActiveTool("arrow");
      });
      await waitFor(() =>
        expect(apiRef.current?.getActiveTool()).toBe("arrow"),
      );
      await act(async () => {
        firePointerEvent("pointerdown", {
          clientX: 200,
          clientY: 90,
          pointerId: 2,
        });
        firePointerEvent("pointermove", {
          clientX: 260,
          clientY: 150,
          pointerId: 2,
        });
        firePointerEvent("pointerup", {
          clientX: 260,
          clientY: 150,
          pointerId: 2,
        });
      });

      await act(async () => {
        apiRef.current?.setActiveTool("container");
      });
      await waitFor(() =>
        expect(apiRef.current?.getActiveTool()).toBe("container"),
      );
      await act(async () => {
        firePointerEvent("pointerdown", {
          clientX: 50,
          clientY: 60,
          pointerId: 3,
        });
        firePointerEvent("pointermove", {
          clientX: 250,
          clientY: 210,
          pointerId: 3,
        });
        firePointerEvent("pointerup", {
          clientX: 250,
          clientY: 210,
          pointerId: 3,
        });
      });

      const nodes = readyApi.getDocument().pages?.[0]?.children ?? [];
      expect(nodes).toHaveLength(3);
      expect(nodes[0]).toMatchObject({
        type: "line",
        x: 10,
        y: 20,
        x2: 110,
        y2: 70,
      });
      expect(nodes[1]).toMatchObject({
        type: "line",
        x: 200,
        y: 90,
        x2: 260,
        y2: 150,
        _connectorType: "arrow",
      });
      expect(nodes[2]).toMatchObject({
        type: "frame",
        x: 50,
        y: 60,
        width: 200,
        height: 150,
        clipContent: true,
      });
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
      HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
      HTMLElement.prototype.releasePointerCapture =
        originalReleasePointerCapture;
      HTMLElement.prototype.hasPointerCapture = originalHasPointerCapture;
    }
  });
});
