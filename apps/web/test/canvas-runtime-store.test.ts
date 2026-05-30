import {
  type PenDocument,
  type PenNode,
  applyCanvasOperation,
  createEmptyDocument,
} from "@cucumber/canvas-core";
import { describe, expect, it, vi } from "vitest";
import {
  createCanvasRuntimeStore,
  selectCanvasCanRedo,
  selectCanvasCanUndo,
  selectCanvasDocument,
  selectCanvasSelectedCount,
  selectCanvasSelectedNode,
  selectCanvasViewport,
} from "../src/components/canvas/canvas-runtime-store";

function documentWithNodes(): PenDocument {
  let doc = createEmptyDocument();
  const a: PenNode = {
    id: "a",
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  };
  const b: PenNode = {
    id: "b",
    type: "rectangle",
    x: 120,
    y: 0,
    width: 100,
    height: 100,
  };
  doc = applyCanvasOperation(doc, { type: "insertNode", node: a });
  doc = applyCanvasOperation(doc, { type: "insertNode", node: b });
  return doc;
}

describe("canvas runtime store", () => {
  it("keeps document subscribers quiet for selection-only updates", () => {
    const store = createCanvasRuntimeStore(documentWithNodes());
    const onDocument = vi.fn();
    const onSelectionCount = vi.fn();
    const initialVersion = store.getState().version;

    store.subscribe(selectCanvasDocument, onDocument);
    store.subscribe(selectCanvasSelectedCount, onSelectionCount);

    store.getState().setSelection(["a"]);

    expect(onDocument).not.toHaveBeenCalled();
    expect(onSelectionCount).toHaveBeenCalledTimes(1);
    expect(store.getState().version).toBe(initialVersion);
    expect(selectCanvasSelectedNode(store.getState())?.id).toBe("a");
  });

  it("keeps selected-node subscribers quiet for active-tool updates", () => {
    const store = createCanvasRuntimeStore(documentWithNodes());
    const onSelectedNode = vi.fn();

    store.getState().setSelection(["a"]);
    store.subscribe(selectCanvasSelectedNode, onSelectedNode);

    store.getState().setActiveTool("text");

    expect(onSelectedNode).not.toHaveBeenCalled();
    expect(selectCanvasSelectedNode(store.getState())?.id).toBe("a");
  });

  it("keeps selected-node subscribers quiet for viewport-only updates", () => {
    const store = createCanvasRuntimeStore(documentWithNodes());
    const onSelectedNode = vi.fn();
    const onViewport = vi.fn();

    store.getState().setSelection(["a"]);
    store.subscribe(selectCanvasSelectedNode, onSelectedNode);
    store.subscribe(selectCanvasViewport, onViewport);

    store.getState().setViewport({ zoom: 2 });

    expect(onSelectedNode).not.toHaveBeenCalled();
    expect(onViewport).toHaveBeenCalledTimes(1);
  });

  it("applies multiple operations as one transaction and one history entry", () => {
    const store = createCanvasRuntimeStore(documentWithNodes());

    store.getState().applyTransaction(
      [
        {
          type: "updateNode",
          nodeId: "a",
          updates: { x: 10 } as Partial<PenNode>,
        },
        {
          type: "updateNode",
          nodeId: "b",
          updates: { x: 140 } as Partial<PenNode>,
        },
      ],
      { selection: ["a", "b"], transactionId: "tx-test" },
    );

    const state = store.getState();
    expect(state.historyPast).toHaveLength(1);
    expect(state.historyFuture).toHaveLength(0);
    expect(state.selection).toEqual(["a", "b"]);
    expect(state.version).toBe(1);
  });

  it("undoes and redoes document history with selection and active page", () => {
    const store = createCanvasRuntimeStore(documentWithNodes());

    store.getState().applyTransaction(
      [
        {
          type: "updateNode",
          nodeId: "a",
          updates: { x: 10 } as Partial<PenNode>,
        },
      ],
      { selection: ["a"], transactionId: "tx-history" },
    );

    expect(selectCanvasCanUndo(store.getState())).toBe(true);
    expect(selectCanvasCanRedo(store.getState())).toBe(false);
    expect(selectCanvasSelectedNode(store.getState())?.id).toBe("a");

    store.getState().undo();

    expect(selectCanvasCanUndo(store.getState())).toBe(false);
    expect(selectCanvasCanRedo(store.getState())).toBe(true);
    expect(store.getState().selection).toEqual([]);
    expect(selectCanvasSelectedNode(store.getState())).toBeNull();

    store.getState().redo();

    expect(selectCanvasCanUndo(store.getState())).toBe(true);
    expect(selectCanvasCanRedo(store.getState())).toBe(false);
    expect(store.getState().selection).toEqual(["a"]);
    expect(selectCanvasSelectedNode(store.getState())?.id).toBe("a");
  });
});
