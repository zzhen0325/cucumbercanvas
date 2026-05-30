import {
  type CanvasOperation,
  type CanvasViewport,
  type PenDocument,
  applyCanvasTransaction,
  findNode,
  normalizeCanvasPages,
  resolveActivePageId,
} from "@cucumber/canvas-core";
import type { PenNode } from "@cucumber/pen-types";
import { produce } from "immer";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { CanvasTool } from "./canvas-api";

export type CanvasRuntimeState = {
  activePageId: string;
  activeTool: CanvasTool;
  document: PenDocument;
  historyIndex: number;
  historyStack: PenDocument[];
  selection: string[];
  version: number;
  viewport: Partial<CanvasViewport>;
  applyTransaction: (
    operations: CanvasOperation[],
    opts?: { selection?: string[]; transactionId?: string },
  ) => string;
  setActiveTool: (tool: CanvasTool) => void;
  setDocument: (
    document: PenDocument,
    opts?: { captureHistory?: boolean },
  ) => void;
  setSelection: (selection: string[]) => void;
  setViewport: (viewport: Partial<CanvasViewport>) => void;
};

export type CanvasRuntimeStore = ReturnType<typeof createCanvasRuntimeStore>;

export const selectCanvasDocument = (state: CanvasRuntimeState) =>
  state.document;
export const selectCanvasSelection = (state: CanvasRuntimeState) =>
  state.selection;
export const selectCanvasViewport = (state: CanvasRuntimeState) =>
  state.viewport;
export const selectCanvasSelectedCount = (state: CanvasRuntimeState) =>
  state.selection.length;
export const selectCanvasCanUndo = (state: CanvasRuntimeState) =>
  state.historyIndex >= 0;
export const selectCanvasCanRedo = (state: CanvasRuntimeState) =>
  state.historyIndex < state.historyStack.length - 1;
export const selectCanvasSelectedNode = (
  state: CanvasRuntimeState,
): PenNode | null => {
  if (state.selection.length !== 1) return null;
  const nodeId = state.selection[0];
  return nodeId
    ? (findNode(state.document, nodeId, state.activePageId) ?? null)
    : null;
};

export function createCanvasRuntimeStore(initialDocument: PenDocument) {
  const initial = normalizeCanvasPages(initialDocument);
  return createStore<CanvasRuntimeState>()(
    subscribeWithSelector((set, get) => ({
      activePageId: resolveActivePageId(initial),
      activeTool: "select",
      document: initial,
      historyIndex: -1,
      historyStack: [],
      selection: [],
      version: 0,
      viewport: initial.viewport ?? {},
      applyTransaction: (operations, opts) => {
        const current = get();
        const result = applyCanvasTransaction(current.document, operations, {
          activePageId: current.activePageId,
          transactionId: opts?.transactionId,
        });
        get().setDocument(
          {
            ...result.doc,
            selection: opts?.selection ?? current.selection,
          } as PenDocument,
          { captureHistory: true },
        );
        console.info("[canvas-runtime-store] transaction applied", {
          activePageId: current.activePageId,
          operationCount: operations.length,
          transactionId: result.transactionId,
        });
        return result.transactionId;
      },
      setActiveTool: (tool) => {
        set(
          produce<CanvasRuntimeState>((draft) => {
            draft.activeTool = tool;
          }),
        );
      },
      setDocument: (document, opts) => {
        const normalized = normalizeCanvasPages(document);
        const activePageId = resolveActivePageId(normalized);
        const nextSelection =
          (normalized as PenDocument & { selection?: string[] }).selection ??
          get().selection;
        set((state) =>
          produce(state, (draft) => {
            if (opts?.captureHistory !== false) {
              draft.historyStack = [
                ...draft.historyStack.slice(0, draft.historyIndex + 1),
                state.document,
              ];
              draft.historyIndex += 1;
            }
            draft.document = {
              ...normalized,
              activePageId,
            };
            draft.activePageId = activePageId;
            draft.selection = nextSelection.filter((id) =>
              Boolean(findNode(normalized, id, activePageId)),
            );
            draft.version += 1;
          }),
        );
      },
      setSelection: (selection) => {
        set((state) =>
          produce(state, (draft) => {
            draft.selection = selection.filter((id) =>
              Boolean(findNode(state.document, id, state.activePageId)),
            );
          }),
        );
      },
      setViewport: (viewport) => {
        set(
          produce<CanvasRuntimeState>((draft) => {
            draft.viewport = { ...draft.viewport, ...viewport };
          }),
        );
      },
    })),
  );
}
