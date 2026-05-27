// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CanvasLayersPanel } from "@/components/canvas-layers-panel";
import type {
  CanvasApi,
  CanvasAppState,
  CanvasSceneElement,
} from "@/components/canvas/canvas-api";

const appState: CanvasAppState = {
  scrollX: 0,
  scrollY: 0,
  selectedElementIds: { "rect-1": true },
  viewBackgroundColor: "#ffffff",
  zoom: { value: 1 },
};

const sceneElements: CanvasSceneElement[] = [
  {
    id: "frame-1",
    type: "frame",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
  },
  {
    customData: { containerId: "frame-1" },
    depth: 1,
    height: 80,
    id: "rect-1",
    type: "rectangle",
    width: 120,
    x: 24,
    y: 32,
  },
  {
    height: 40,
    id: "text-1",
    text: "Footer note",
    type: "text",
    width: 180,
    x: 0,
    y: 340,
  },
];

function createCanvasApi(
  overrides: Partial<CanvasApi> = {},
): CanvasApi & { emitChange: () => void } {
  let changeListener: Parameters<CanvasApi["onChange"]>[0] | null = null;
  const api = {
    addFiles: vi.fn(),
    addPage: vi.fn(),
    alignSelection: vi.fn(),
    applyBooleanOperation: vi.fn(),
    bindAgentToContainer: vi.fn(),
    canRedo: vi.fn(),
    canUndo: vi.fn(),
    copySelection: vi.fn(),
    createContainer: vi.fn(),
    deleteNode: vi.fn(),
    deletePage: vi.fn(),
    deleteSelection: vi.fn(),
    duplicatePage: vi.fn(),
    duplicateSelection: vi.fn(),
    emitChange: () => {
      changeListener?.(sceneElements, appState, {});
    },
    exportImage: vi.fn(),
    flushPendingSave: vi.fn(),
    getActivePageId: vi.fn(),
    getActiveTool: vi.fn(),
    getAppState: vi.fn(() => appState),
    getDocument: vi.fn(),
    getFiles: vi.fn(() => ({})),
    getPages: vi.fn(),
    getSceneElements: vi.fn(() => sceneElements),
    getViewportBounds: vi.fn(),
    groupSelection: vi.fn(),
    importSvgMarkup: vi.fn(),
    insertImageArtifact: vi.fn(),
    insertNode: vi.fn(),
    insertVideoArtifact: vi.fn(),
    moveNodeToIndex: vi.fn(),
    onChange: vi.fn((listener) => {
      changeListener = listener;
      return vi.fn();
    }),
    pasteClipboard: vi.fn(),
    pasteFromSystemClipboard: vi.fn(),
    redo: vi.fn(),
    renamePage: vi.fn(),
    reorderNode: vi.fn(),
    reorderPage: vi.fn(),
    scrollToContent: vi.fn(),
    setActivePage: vi.fn(),
    setActiveTool: vi.fn(),
    setDocument: vi.fn(),
    setSelection: vi.fn(),
    toggleNodeLocked: vi.fn(),
    toggleNodeVisible: vi.fn(),
    undo: vi.fn(),
    ungroupSelection: vi.fn(),
    updateNode: vi.fn(),
    updateScene: vi.fn(),
    ...overrides,
  } as CanvasApi & { emitChange: () => void };
  return api;
}

function renderLayersPanel(api = createCanvasApi()) {
  render(<CanvasLayersPanel canvasApi={api} onClose={vi.fn()} open />);
  return api;
}

function firstElement<T extends Element>(elements: T[]): T {
  const element = elements[0];
  if (!element) throw new Error("Expected at least one matching element.");
  return element;
}

function elementAt<T extends Element>(elements: T[], index: number): T {
  const element = elements[index];
  if (!element) throw new Error(`Expected matching element at index ${index}.`);
  return element;
}

describe("CanvasLayersPanel", () => {
  it("selects layers and toggles lock and visibility through CanvasApi", async () => {
    const user = userEvent.setup();
    const api = renderLayersPanel();

    await user.click(screen.getByText("Footer note"));
    await user.click(
      firstElement(screen.getAllByRole("button", { name: "Lock layer" })),
    );
    await user.click(
      firstElement(
        screen.getAllByRole("button", { name: "Toggle layer visibility" }),
      ),
    );

    expect(api.setSelection).toHaveBeenCalledWith(["text-1"]);
    expect(api.setSelection).toHaveBeenCalledTimes(1);
    expect(api.toggleNodeLocked).toHaveBeenCalledWith("text-1");
    expect(api.toggleNodeVisible).toHaveBeenCalledWith("text-1");
  });

  it("selects a layer from thumbnail or row padding and only exposes collapse for parent layers", async () => {
    const user = userEvent.setup();
    const api = renderLayersPanel();

    await user.click(screen.getByTestId("layer-row-text-1"));

    expect(api.setSelection).toHaveBeenLastCalledWith(["text-1"]);
    expect(screen.getAllByRole("button", { name: "收起图层" })).toHaveLength(1);
  });

  it("renames, duplicates, and deletes layers from the action menu", async () => {
    const user = userEvent.setup();
    const api = renderLayersPanel();

    await user.dblClick(screen.getByText("Footer note"));
    const renameInput = screen.getByDisplayValue("Footer note");
    await user.clear(renameInput);
    await user.type(renameInput, "Footer summary{Enter}");

    await user.click(
      firstElement(screen.getAllByRole("button", { name: "Layer actions" })),
    );
    await user.click(await screen.findByRole("menuitem", { name: "复制" }));
    await user.click(
      firstElement(screen.getAllByRole("button", { name: "Layer actions" })),
    );
    await user.click(await screen.findByRole("menuitem", { name: "删除" }));

    expect(api.updateNode).toHaveBeenCalledWith("text-1", {
      name: "Footer summary",
    });
    expect(api.setSelection).toHaveBeenCalledWith(["text-1"]);
    expect(api.duplicateSelection).toHaveBeenCalledOnce();
    expect(api.deleteNode).toHaveBeenCalledWith("text-1");
  });

  it("moves a dragged layer to the target parent index", async () => {
    const api = renderLayersPanel();
    const source = screen.getByTestId("layer-row-rect-1");
    const target = screen.getByTestId("layer-row-frame-1");

    fireEvent.dragStart(source);
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    expect(api.moveNodeToIndex).toHaveBeenCalledWith("rect-1", null, 0);
  });

  it("moves a layer into an available parent through the action menu", async () => {
    const user = userEvent.setup();
    const api = renderLayersPanel();

    await user.click(
      firstElement(screen.getAllByRole("button", { name: "Layer actions" })),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Move into Frame" }),
    );

    expect(api.moveNodeToIndex).toHaveBeenCalledWith("text-1", "frame-1", 1);
  });

  it("moves a layer through a keyboard-reachable hierarchy menu", async () => {
    const user = userEvent.setup();
    const api = renderLayersPanel();
    const firstLayerActions = firstElement(
      screen.getAllByRole("button", { name: "Layer actions" }),
    );

    expect(firstLayerActions).not.toHaveClass("invisible");

    for (
      let i = 0;
      i < 8 && document.activeElement !== firstLayerActions;
      i++
    ) {
      await user.tab();
    }
    expect(firstLayerActions).toHaveFocus();

    await user.keyboard("{Enter}");
    const moveIntoFrame = await screen.findByRole("menuitem", {
      name: "Move into Frame",
    });
    act(() => {
      moveIntoFrame.focus();
    });
    expect(moveIntoFrame).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(api.moveNodeToIndex).toHaveBeenCalledWith("text-1", "frame-1", 1);
  });

  it("shows readable disabled hierarchy move state when no target exists", async () => {
    const user = userEvent.setup();
    renderLayersPanel();

    await user.click(
      elementAt(screen.getAllByRole("button", { name: "Layer actions" }), 2),
    );

    expect(
      await screen.findByRole("menuitem", {
        name: "No hierarchy move targets",
      }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("surfaces readable hierarchy move failures", async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const api = renderLayersPanel(
      createCanvasApi({
        moveNodeToIndex: vi.fn(() => {
          throw new Error("Could not move layer into Frame.");
        }),
      }),
    );

    await user.click(
      firstElement(screen.getAllByRole("button", { name: "Layer actions" })),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Move into Frame" }),
    );

    expect(api.moveNodeToIndex).toHaveBeenCalledWith("text-1", "frame-1", 1);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not move layer into Frame.",
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[canvas-layers-panel] layer action failed",
      expect.objectContaining({
        actionName: "move layer",
        error: expect.any(Error),
        message: "Could not move layer into Frame.",
        targetId: "text-1",
        targetIndex: 1,
        targetParentId: "frame-1",
      }),
    );

    consoleError.mockRestore();
  });

  it("surfaces readable CanvasApi failures without leaking raw error codes", async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const api = renderLayersPanel(
      createCanvasApi({
        toggleNodeVisible: vi.fn(() => {
          throw new Error("Could not hide layer because the document is busy.");
        }),
      }),
    );

    await user.click(
      firstElement(
        screen.getAllByRole("button", { name: "Toggle layer visibility" }),
      ),
    );

    expect(api.toggleNodeVisible).toHaveBeenCalledWith("text-1");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not hide layer because the document is busy.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(/null|undefined/);
    expect(consoleError).toHaveBeenCalledWith(
      "[canvas-layers-panel] layer action failed",
      expect.objectContaining({
        actionName: "toggle layer visibility",
        error: expect.any(Error),
        message: "Could not hide layer because the document is busy.",
        targetId: "text-1",
      }),
    );

    consoleError.mockRestore();
  });
});
