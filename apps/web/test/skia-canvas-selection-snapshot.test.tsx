import type { CucumberCanvasDocument } from "@cucumber/canvas-core";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  CanvasApi,
  CanvasAppState,
  CanvasSceneElement,
} from "@/components/canvas/canvas-api";
import { SkiaCanvas } from "@/components/canvas/skia-canvas";

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
    setViewport = vi.fn();
    hitTest = vi.fn(() => null);
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
});
