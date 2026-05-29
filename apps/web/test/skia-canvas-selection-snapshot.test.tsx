import type { CucumberCanvasDocument, PenNode } from "@cucumber/canvas-core";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CanvasApi,
  CanvasAppState,
  CanvasSceneElement,
} from "@/components/canvas/canvas-api";
import { SkiaCanvas } from "@/components/canvas/skia-canvas";

const penRendererMockState = vi.hoisted(() => ({
  currentDocument: null as {
    activePageId?: string | null;
    children?: TestPenNode[];
    pages?: Array<{ id: string; children: TestPenNode[] }>;
  } | null,
  currentPageId: null as string | null,
  getNodeBounds: vi.fn<
    () => { x: number; y: number; w: number; h: number } | null
  >(() => null),
  hitTest: vi.fn<(screenX: number, screenY: number) => unknown | undefined>(
    () => undefined,
  ),
  hitTestSelectionControl: vi.fn<
    () =>
      | { type: "resize"; nodeId: string; handle: "e" | "s" | "se" }
      | { type: "rotate"; nodeId: string }
      | null
  >(() => null),
  hitTestRect: vi.fn<() => unknown[]>(() => []),
  setInteractionMode: vi.fn(),
  setTransformPreview: vi.fn(),
  clearTransformPreview: vi.fn(),
  viewport: { zoom: 1, panX: 0, panY: 0 },
  screenToScene: vi.fn(
    (
      clientX: number,
      clientY: number,
      rect: { left: number; top: number },
      viewport: { zoom: number; panX: number; panY: number },
    ) => ({
      x: (clientX - rect.left - viewport.panX) / viewport.zoom,
      y: (clientY - rect.top - viewport.panY) / viewport.zoom,
    }),
  ),
}));

type TestPenNode = {
  children?: TestPenNode[];
  height?: number;
  id: string;
  locked?: boolean;
  visible?: boolean;
  width?: number;
  x?: number;
  y?: number;
};

function getMockActiveChildren(): TestPenNode[] {
  const doc = penRendererMockState.currentDocument;
  if (!doc) return [];
  const pageId = penRendererMockState.currentPageId ?? doc.activePageId;
  const page =
    doc.pages?.find((candidate) => candidate.id === pageId) ?? doc.pages?.[0];
  return page?.children ?? doc.children ?? [];
}

function findTopMockHit(
  nodes: TestPenNode[],
  sceneX: number,
  sceneY: number,
  offsetX = 0,
  offsetY = 0,
): TestPenNode | null {
  for (const node of nodes) {
    if (node.visible === false || node.locked === true) continue;
    const x = offsetX + (node.x ?? 0);
    const y = offsetY + (node.y ?? 0);
    const width = node.width ?? 0;
    const height = node.height ?? 0;
    const contains =
      sceneX >= x && sceneX <= x + width && sceneY >= y && sceneY <= y + height;
    if (!contains) continue;
    const childHit = node.children?.length
      ? findTopMockHit(node.children, sceneX, sceneY, x, y)
      : null;
    return childHit ?? node;
  }
  return null;
}

vi.mock("paper", () => ({
  default: {},
}));

vi.mock("@cucumber/pen-renderer", () => ({
  PenRenderer: class MockPenRenderer {
    init = vi.fn();
    resize = vi.fn();
    dispose = vi.fn();
    zoomToFit = vi.fn();
    setDocument = vi.fn((doc) => {
      penRendererMockState.currentDocument = doc;
      penRendererMockState.currentPageId = doc.activePageId ?? null;
    });
    setPage = vi.fn((pageId: string) => {
      penRendererMockState.currentPageId = pageId;
    });
    setEditorOverlays = vi.fn();
    getViewport = vi.fn(() => penRendererMockState.viewport);
    getNodeBounds = penRendererMockState.getNodeBounds;
    setViewport = vi.fn((zoom: number, panX: number, panY: number) => {
      penRendererMockState.viewport = { zoom, panX, panY };
    });
    hitTest = vi.fn((screenX: number, screenY: number) => {
      const override = penRendererMockState.hitTest(screenX, screenY);
      if (override !== undefined) return override;
      return findTopMockHit(getMockActiveChildren(), screenX, screenY);
    });
    hitTestSelectionControl = penRendererMockState.hitTestSelectionControl;
    hitTestRect = penRendererMockState.hitTestRect;
    setInteractionMode = penRendererMockState.setInteractionMode;
    setTransformPreview = penRendererMockState.setTransformPreview;
    clearTransformPreview = penRendererMockState.clearTransformPreview;
  },
  loadCanvasKit: vi.fn(async () => ({})),
  screenToScene: penRendererMockState.screenToScene,
  sceneToCanvasLocal: (
    sceneX: number,
    sceneY: number,
    viewport: { zoom: number; panX: number; panY: number },
  ) => ({
    x: sceneX * viewport.zoom + viewport.panX,
    y: sceneY * viewport.zoom + viewport.panY,
  }),
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

function fireCanvasPointerEvent(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  options: { clientX: number; clientY: number; pointerId: number },
) {
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
  fireEvent(target, event);
}

describe("SkiaCanvas selection snapshots", () => {
  beforeEach(() => {
    penRendererMockState.currentDocument = null;
    penRendererMockState.currentPageId = null;
    penRendererMockState.hitTest.mockReset();
    penRendererMockState.hitTest.mockReturnValue(undefined);
    penRendererMockState.hitTestSelectionControl.mockReset();
    penRendererMockState.hitTestSelectionControl.mockReturnValue(null);
    penRendererMockState.hitTestRect.mockReset();
    penRendererMockState.hitTestRect.mockReturnValue([]);
    penRendererMockState.setInteractionMode.mockReset();
    penRendererMockState.setTransformPreview.mockReset();
    penRendererMockState.clearTransformPreview.mockReset();
    penRendererMockState.getNodeBounds.mockReset();
    penRendererMockState.getNodeBounds.mockReturnValue(null);
    penRendererMockState.viewport = { zoom: 1, panX: 0, panY: 0 };
    penRendererMockState.screenToScene.mockReset();
    penRendererMockState.screenToScene.mockImplementation(
      (
        clientX: number,
        clientY: number,
        rect: { left: number; top: number },
        viewport: { zoom: number; panX: number; panY: number },
      ) => ({
        x: (clientX - rect.left - viewport.panX) / viewport.zoom,
        y: (clientY - rect.top - viewport.panY) / viewport.zoom,
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

  it("keeps root and nested CanvasApi reorder aligned with renderer hit-testing", async () => {
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
    const initialLayerDocument: CucumberCanvasDocument = {
      version: "cucumber-canvas-v1",
      activePageId: "page-a",
      pages: [
        {
          id: "page-a",
          name: "Page A",
          children: [
            {
              id: "root-top",
              type: "rectangle",
              x: 10,
              y: 10,
              width: 100,
              height: 100,
            } as PenNode,
            {
              id: "root-bottom",
              type: "rectangle",
              x: 10,
              y: 10,
              width: 100,
              height: 100,
            } as PenNode,
            {
              children: [
                {
                  id: "child-top",
                  type: "rectangle",
                  x: 0,
                  y: 0,
                  width: 100,
                  height: 100,
                } as PenNode,
                {
                  id: "child-bottom",
                  type: "rectangle",
                  x: 0,
                  y: 0,
                  width: 100,
                  height: 100,
                } as PenNode,
              ],
              id: "parent-frame",
              type: "frame",
              x: 200,
              y: 10,
              width: 120,
              height: 120,
            } as PenNode,
          ],
        },
      ],
      children: [],
      viewport: { x: 0, y: 0, zoom: 1, backgroundColor: "#ffffff" },
    };

    try {
      const { container } = render(
        <SkiaCanvas
          initialContent={initialLayerDocument}
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
      const clickScenePoint = async (
        point: { x: number; y: number },
        pointerId: number,
      ) => {
        const firePointerEvent = (
          type: "pointerdown" | "pointerup",
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
          firePointerEvent("pointerdown", {
            clientX: point.x,
            clientY: point.y,
            pointerId,
          });
          firePointerEvent("pointerup", {
            clientX: point.x,
            clientY: point.y,
            pointerId,
          });
        });
      };

      await clickScenePoint({ x: 24, y: 24 }, 21);
      expect(readyApi.getDocument().selection).toEqual(["root-top"]);

      await act(async () => {
        readyApi.reorderNode("root-bottom", "front");
      });
      expect(
        readyApi.getDocument().pages?.[0]?.children.map((node) => node.id),
      ).toEqual(["root-bottom", "root-top", "parent-frame"]);
      await clickScenePoint({ x: 24, y: 24 }, 22);
      expect(readyApi.getDocument().selection).toEqual(["root-bottom"]);

      await clickScenePoint({ x: 224, y: 24 }, 23);
      expect(readyApi.getDocument().selection).toEqual(["child-top"]);

      await act(async () => {
        readyApi.reorderNode("child-bottom", "front");
      });
      const parentFrame = readyApi
        .getDocument()
        .pages?.[0]?.children.find((node) => node.id === "parent-frame") as
        | (PenNode & { children?: PenNode[] })
        | undefined;
      expect(parentFrame?.children?.map((node) => node.id)).toEqual([
        "child-bottom",
        "child-top",
      ]);
      await clickScenePoint({ x: 224, y: 24 }, 24);
      expect(readyApi.getDocument().selection).toEqual(["child-bottom"]);

      await act(async () => {
        readyApi.moveNodeToIndex("child-bottom", "parent-frame", 1);
      });
      await clickScenePoint({ x: 224, y: 24 }, 25);
      expect(readyApi.getDocument().selection).toEqual(["child-top"]);
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
      HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
      HTMLElement.prototype.releasePointerCapture =
        originalReleasePointerCapture;
      HTMLElement.prototype.hasPointerCapture = originalHasPointerCapture;
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

  it("creates an auto-width text layer from a text-tool click and grows while typing", async () => {
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
      const { container, getByLabelText } = render(
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

      await act(async () => {
        readyApi.setActiveTool("text");
      });
      await act(async () => {
        fireCanvasPointerEvent(stage, "pointerdown", {
          clientX: 80,
          clientY: 90,
          pointerId: 31,
        });
        fireCanvasPointerEvent(stage, "pointerup", {
          clientX: 80,
          clientY: 90,
          pointerId: 31,
        });
      });

      const editor = getByLabelText("Edit canvas text") as HTMLTextAreaElement;
      expect(editor.value).toBe("");
      const initialWidth = Number.parseFloat(editor.style.width);

      await act(async () => {
        fireEvent.change(editor, {
          target: { value: "Hello cucumber studio" },
        });
      });
      expect(Number.parseFloat(editor.style.width)).toBeGreaterThan(
        initialWidth,
      );

      await act(async () => {
        fireEvent.change(editor, {
          target: { value: "Hello cucumber studio\nSecond line" },
        });
        fireEvent.blur(editor);
      });

      const savedTextNode = readyApi.getDocument().pages?.[0]?.children[0];
      const savedTextBounds = savedTextNode as
        | (PenNode & { height?: number; width?: number })
        | undefined;
      expect(savedTextNode).toMatchObject({
        type: "text",
        content: "Hello cucumber studio\nSecond line",
        textGrowth: "auto",
      });
      expect(savedTextBounds?.width).toBeGreaterThan(initialWidth);
      expect(savedTextBounds?.height).toBeGreaterThan(50);
      expect(apiRef.current?.getActiveTool()).toBe("text");
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
      HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
      HTMLElement.prototype.releasePointerCapture =
        originalReleasePointerCapture;
      HTMLElement.prototype.hasPointerCapture = originalHasPointerCapture;
    }
  });

  it("creates an auto-height fixed-width text box from a text-tool drag", async () => {
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
      const { container, getByLabelText } = render(
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

      await act(async () => {
        readyApi.setActiveTool("text");
      });
      await act(async () => {
        fireCanvasPointerEvent(stage, "pointerdown", {
          clientX: 20,
          clientY: 30,
          pointerId: 41,
        });
        fireCanvasPointerEvent(stage, "pointermove", {
          clientX: 140,
          clientY: 80,
          pointerId: 41,
        });
        fireCanvasPointerEvent(stage, "pointerup", {
          clientX: 140,
          clientY: 80,
          pointerId: 41,
        });
      });

      const editor = getByLabelText("Edit canvas text") as HTMLTextAreaElement;
      await act(async () => {
        fireEvent.change(editor, {
          target: {
            value:
              "This is a long text box value that should wrap across several rows.",
          },
        });
        fireEvent.blur(editor);
      });

      const savedTextNode = readyApi.getDocument().pages?.[0]?.children[0];
      const savedTextBounds = savedTextNode as
        | (PenNode & { height?: number; width?: number })
        | undefined;
      expect(savedTextNode).toMatchObject({
        type: "text",
        textGrowth: "fixed-width",
      });
      expect(Math.round(Number(savedTextBounds?.width))).toBe(120);
      expect(savedTextBounds?.height).toBeGreaterThan(50);
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
      HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
      HTMLElement.prototype.releasePointerCapture =
        originalReleasePointerCapture;
      HTMLElement.prototype.hasPointerCapture = originalHasPointerCapture;
    }
  });

  it("removes a newly created empty text layer when editing ends", async () => {
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
      const { container, getByLabelText } = render(
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

      await act(async () => {
        readyApi.setActiveTool("text");
      });
      await act(async () => {
        fireCanvasPointerEvent(stage, "pointerdown", {
          clientX: 80,
          clientY: 90,
          pointerId: 51,
        });
        fireCanvasPointerEvent(stage, "pointerup", {
          clientX: 80,
          clientY: 90,
          pointerId: 51,
        });
      });

      const editor = getByLabelText("Edit canvas text") as HTMLTextAreaElement;
      await act(async () => {
        fireEvent.blur(editor);
      });

      expect(readyApi.getDocument().pages?.[0]?.children).toEqual([]);
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
      HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
      HTMLElement.prototype.releasePointerCapture =
        originalReleasePointerCapture;
      HTMLElement.prototype.hasPointerCapture = originalHasPointerCapture;
    }
  });

  it("enters text editing from selection mode with Enter", async () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;
    const apiRef: { current: CanvasApi | null } = { current: null };
    const textNode = {
      id: "text-enter",
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
      await act(async () => {
        apiRef.current?.setSelection(["text-enter"]);
      });
      await waitFor(() =>
        expect(apiRef.current?.getDocument().selection).toEqual(["text-enter"]),
      );

      await act(async () => {
        fireEvent.keyDown(document, { key: "Enter" });
      });

      await waitFor(() =>
        expect(getByLabelText("Edit canvas text")).toHaveValue("Draft title"),
      );
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });

  it("converts text growth modes during selection resize gestures", async () => {
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
    const onDocumentChange = vi.fn();
    const textNode = {
      id: "text-resize",
      type: "text",
      name: "Heading",
      x: 20,
      y: 30,
      width: 80,
      height: 40,
      content: "Resize text content",
      textGrowth: "auto",
      fontSize: 20,
      fill: [{ type: "solid", color: "#111827" }],
    } as const;

    try {
      const { container } = render(
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
          onDocumentChange={onDocumentChange}
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
      await act(async () => {
        readyApi.setSelection(["text-resize"]);
      });

      penRendererMockState.hitTestSelectionControl.mockReturnValue({
        type: "resize",
        nodeId: "text-resize",
        handle: "e",
      });
      await act(async () => {
        fireCanvasPointerEvent(stage, "pointerdown", {
          clientX: 100,
          clientY: 50,
          pointerId: 61,
        });
        fireCanvasPointerEvent(stage, "pointermove", {
          clientX: 180,
          clientY: 50,
          pointerId: 61,
        });
        fireCanvasPointerEvent(stage, "pointerup", {
          clientX: 180,
          clientY: 50,
          pointerId: 61,
        });
      });
      let resizedTextNode = readyApi
        .getDocument()
        .pages?.[0]?.children.find((node) => node.id === "text-resize");
      expect(resizedTextNode).toMatchObject({
        textGrowth: "fixed-width",
      });
      expect(
        Math.round(
          Number(
            (resizedTextNode as (PenNode & { width?: number }) | undefined)
              ?.width,
          ),
        ),
      ).toBe(160);

      penRendererMockState.hitTestSelectionControl.mockReturnValue({
        type: "resize",
        nodeId: "text-resize",
        handle: "s",
      });
      await act(async () => {
        fireCanvasPointerEvent(stage, "pointerdown", {
          clientX: 100,
          clientY: 70,
          pointerId: 62,
        });
        fireCanvasPointerEvent(stage, "pointermove", {
          clientX: 100,
          clientY: 110,
          pointerId: 62,
        });
        fireCanvasPointerEvent(stage, "pointerup", {
          clientX: 100,
          clientY: 110,
          pointerId: 62,
        });
      });
      resizedTextNode = readyApi
        .getDocument()
        .pages?.[0]?.children.find((node) => node.id === "text-resize");
      expect(resizedTextNode).toMatchObject({
        textGrowth: "fixed-width-height",
      });
      expect(
        (resizedTextNode as (PenNode & { height?: number }) | undefined)
          ?.height,
      ).toBeGreaterThan(40);
      expect(onDocumentChange).toHaveBeenCalled();
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
      HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
      HTMLElement.prototype.releasePointerCapture =
        originalReleasePointerCapture;
      HTMLElement.prototype.hasPointerCapture = originalHasPointerCapture;
    }
  });

  it("uses scene deltas for selection resize gestures at zoom 2", async () => {
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
    const rectNode = {
      id: "rect-resize",
      type: "rectangle",
      x: 20,
      y: 30,
      width: 80,
      height: 40,
    } as const;
    penRendererMockState.viewport = { zoom: 2, panX: 0, panY: 0 };

    try {
      const { container } = render(
        <SkiaCanvas
          initialContent={{
            version: "cucumber-canvas-v1",
            activePageId: "page-default",
            pages: [
              { id: "page-default", name: "Page 1", children: [rectNode] },
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
      const readyApi = apiRef.current;
      if (!readyApi) throw new Error("Canvas API was not initialized.");
      const canvasElement = container.querySelector("canvas") as HTMLElement;
      const stage = canvasElement.parentElement?.parentElement;
      if (!stage) throw new Error("Canvas stage was not initialized.");
      await act(async () => {
        readyApi.setSelection(["rect-resize"]);
      });

      penRendererMockState.hitTestSelectionControl.mockReturnValue({
        type: "resize",
        nodeId: "rect-resize",
        handle: "e",
      });
      await act(async () => {
        fireCanvasPointerEvent(stage, "pointerdown", {
          clientX: 100,
          clientY: 50,
          pointerId: 63,
        });
        fireCanvasPointerEvent(stage, "pointermove", {
          clientX: 180,
          clientY: 50,
          pointerId: 63,
        });
        fireCanvasPointerEvent(stage, "pointerup", {
          clientX: 180,
          clientY: 50,
          pointerId: 63,
        });
      });

      const resizedNode = readyApi
        .getDocument()
        .pages?.[0]?.children.find((node) => node.id === "rect-resize");
      expect(resizedNode).toMatchObject({
        x: 20,
        y: 30,
        width: 120,
        height: 40,
      });
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
      HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
      HTMLElement.prototype.releasePointerCapture =
        originalReleasePointerCapture;
      HTMLElement.prototype.hasPointerCapture = originalHasPointerCapture;
    }
  });

  it("drags an unselected node from the initial pointer gesture", async () => {
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
    const onDocumentChange = vi.fn();
    const rectNode = {
      id: "rect-1",
      type: "rectangle",
      x: 20,
      y: 30,
      width: 80,
      height: 60,
    } as const;
    penRendererMockState.hitTest.mockReturnValue(rectNode);

    try {
      const { container } = render(
        <SkiaCanvas
          initialContent={{
            version: "cucumber-canvas-v1",
            activePageId: "page-default",
            pages: [
              { id: "page-default", name: "Page 1", children: [rectNode] },
            ],
            children: [],
            viewport: { x: 0, y: 0, zoom: 1, backgroundColor: "#ffffff" },
          }}
          onApiReady={(readyApi) => {
            apiRef.current = readyApi;
          }}
          onDocumentChange={onDocumentChange}
        />,
      );

      await waitFor(() => expect(apiRef.current).not.toBeNull());
      await waitFor(() =>
        expect(container.querySelector("canvas")).not.toBeNull(),
      );
      onDocumentChange.mockClear();
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
        firePointerEvent("pointerdown", {
          clientX: 10,
          clientY: 10,
          pointerId: 11,
        });
        firePointerEvent("pointermove", {
          clientX: 50,
          clientY: 35,
          pointerId: 11,
        });
      });

      expect(
        apiRef.current?.getDocument().pages?.[0]?.children[0],
      ).toMatchObject({
        id: "rect-1",
        x: 20,
        y: 30,
      });
      expect(onDocumentChange).not.toHaveBeenCalled();
      expect(penRendererMockState.setTransformPreview).toHaveBeenLastCalledWith(
        {
          kind: "move",
          nodeIds: ["rect-1"],
          dx: 40,
          dy: 25,
        },
      );

      await act(async () => {
        firePointerEvent("pointerup", {
          clientX: 50,
          clientY: 35,
          pointerId: 11,
        });
      });

      const movedNode = apiRef.current?.getDocument().pages?.[0]?.children[0];
      expect(movedNode).toMatchObject({
        id: "rect-1",
        x: 60,
        y: 55,
      });
      expect(apiRef.current?.getDocument().selection).toEqual(["rect-1"]);
      expect(onDocumentChange).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
      HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
      HTMLElement.prototype.releasePointerCapture =
        originalReleasePointerCapture;
      HTMLElement.prototype.hasPointerCapture = originalHasPointerCapture;
    }
  });

  it("drags an unselected node by scene delta at zoom 2", async () => {
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
    const rectNode = {
      id: "rect-zoom",
      type: "rectangle",
      x: 20,
      y: 30,
      width: 80,
      height: 60,
    } as const;
    penRendererMockState.hitTest.mockReturnValue(rectNode);
    penRendererMockState.viewport = { zoom: 2, panX: 0, panY: 0 };

    try {
      const { container } = render(
        <SkiaCanvas
          initialContent={{
            version: "cucumber-canvas-v1",
            activePageId: "page-default",
            pages: [
              { id: "page-default", name: "Page 1", children: [rectNode] },
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
      const stage = canvasElement.parentElement?.parentElement;
      if (!stage) throw new Error("Canvas stage was not initialized.");

      await act(async () => {
        fireCanvasPointerEvent(stage, "pointerdown", {
          clientX: 10,
          clientY: 10,
          pointerId: 71,
        });
        fireCanvasPointerEvent(stage, "pointermove", {
          clientX: 50,
          clientY: 34,
          pointerId: 71,
        });
        fireCanvasPointerEvent(stage, "pointerup", {
          clientX: 50,
          clientY: 34,
          pointerId: 71,
        });
      });

      const movedNode = apiRef.current?.getDocument().pages?.[0]?.children[0];
      expect(movedNode).toMatchObject({
        id: "rect-zoom",
        x: 40,
        y: 42,
      });
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
      HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
      HTMLElement.prototype.releasePointerCapture =
        originalReleasePointerCapture;
      HTMLElement.prototype.hasPointerCapture = originalHasPointerCapture;
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

  it("draws shape and text bounds in scene coordinates at zoom 2", async () => {
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
    penRendererMockState.viewport = { zoom: 2, panX: 0, panY: 0 };

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

      await act(async () => {
        readyApi.setActiveTool("rect");
      });
      await act(async () => {
        fireCanvasPointerEvent(stage, "pointerdown", {
          clientX: 20,
          clientY: 20,
          pointerId: 81,
        });
        fireCanvasPointerEvent(stage, "pointermove", {
          clientX: 220,
          clientY: 120,
          pointerId: 81,
        });
        fireCanvasPointerEvent(stage, "pointerup", {
          clientX: 220,
          clientY: 120,
          pointerId: 81,
        });
      });

      await act(async () => {
        readyApi.setActiveTool("text");
      });
      await act(async () => {
        fireCanvasPointerEvent(stage, "pointerdown", {
          clientX: 40,
          clientY: 60,
          pointerId: 82,
        });
        fireCanvasPointerEvent(stage, "pointermove", {
          clientX: 240,
          clientY: 160,
          pointerId: 82,
        });
        fireCanvasPointerEvent(stage, "pointerup", {
          clientX: 240,
          clientY: 160,
          pointerId: 82,
        });
      });

      const nodes = readyApi.getDocument().pages?.[0]?.children ?? [];
      expect(nodes[0]).toMatchObject({
        type: "rectangle",
        x: 10,
        y: 10,
        width: 100,
        height: 50,
      });
      expect(nodes[1]).toMatchObject({
        type: "text",
        x: 20,
        y: 30,
        width: 100,
        height: 50,
        textGrowth: "fixed-width",
      });
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
      HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
      HTMLElement.prototype.releasePointerCapture =
        originalReleasePointerCapture;
      HTMLElement.prototype.hasPointerCapture = originalHasPointerCapture;
    }
  });

  it("reports live renderer viewport through app state", async () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;
    const apiRef: { current: CanvasApi | null } = { current: null };
    penRendererMockState.viewport = { zoom: 1.75, panX: 24, panY: -16 };
    let unmount: (() => void) | undefined;

    try {
      const rendered = render(
        <SkiaCanvas
          initialContent={initialDocument}
          onApiReady={(readyApi) => {
            apiRef.current = readyApi;
          }}
        />,
      );
      unmount = rendered.unmount;

      await waitFor(() => expect(apiRef.current).not.toBeNull());
      await waitFor(() =>
        expect(rendered.container.querySelector("canvas")).not.toBeNull(),
      );
      expect(apiRef.current?.getAppState()).toMatchObject({
        zoom: { value: 1.75 },
        scrollX: 24,
        scrollY: -16,
      });

      act(() => {
        apiRef.current?.updateScene({
          appState: {
            zoom: { value: 2 },
            scrollX: 40,
            scrollY: 12,
          },
        });
      });

      expect(apiRef.current?.getAppState()).toMatchObject({
        zoom: { value: 2 },
        scrollX: 40,
        scrollY: 12,
      });
    } finally {
      unmount?.();
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });
});
