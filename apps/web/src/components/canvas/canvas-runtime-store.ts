"use client";

import {
  type CanvasOperation,
  type CanvasViewport,
  type PenDocument,
  type PenPage,
  applyCanvasTransaction,
  findNode,
  getCanvasPages,
  normalizeCanvasPages,
  resolveActivePageId,
} from "@cucumber/canvas-core";
import type { PenNode } from "@cucumber/pen-types";
import { produce } from "immer";
import {
  type PropsWithChildren,
  createContext,
  createElement,
  useContext,
  useRef,
} from "react";
import { useStore } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { createStore } from "zustand/vanilla";
import type {
  CanvasApiDocument,
  CanvasApiViewportState,
  CanvasTool,
} from "./canvas-api";

type SelectionUpdateOptions = {
  notifyScene?: boolean;
  notifySelection?: boolean;
  source?: string;
};

type DocumentCommitOptions = {
  captureHistory?: boolean;
  notify?: boolean;
  selection?: string[];
  source?: string;
};

export type CanvasRuntimeCommitResult = {
  activePageId: string;
  document: CanvasApiDocument;
  selection: string[];
  selectionChanged: boolean;
  version: number;
};

export type CanvasRuntimeDocumentCommit = {
  notifyDocumentChange: boolean;
  source: string;
  version: number;
};

export type CanvasRuntimeSelectionCommit = {
  notifyScene: boolean;
  notifySelection: boolean;
  revision: number;
  source: string;
};

export type CanvasRuntimeState = {
  activePageId: string;
  activeTool: CanvasTool;
  document: CanvasApiDocument;
  historyFuture: CanvasApiDocument[];
  historyPast: CanvasApiDocument[];
  lastDocumentCommit: CanvasRuntimeDocumentCommit | null;
  lastSelectionCommit: CanvasRuntimeSelectionCommit | null;
  selection: string[];
  selectionRevision: number;
  version: number;
  viewport: Partial<CanvasViewport>;
  applyTransaction: (
    operations: CanvasOperation[],
    opts?: { selection?: string[]; transactionId?: string },
  ) => string;
  commitDocument: (
    document: PenDocument,
    opts?: DocumentCommitOptions,
  ) => CanvasRuntimeCommitResult;
  redo: () => CanvasRuntimeCommitResult | null;
  setActivePage: (pageId: string) => CanvasRuntimeCommitResult | null;
  setActiveTool: (tool: CanvasTool) => void;
  setDocument: (
    document: PenDocument,
    opts?: { captureHistory?: boolean },
  ) => CanvasRuntimeCommitResult;
  setSelection: (
    selection: string[],
    opts?: SelectionUpdateOptions,
  ) => string[];
  setViewport: (viewport: Partial<CanvasViewport>) => void;
  setViewportSnapshot: (viewport: Partial<CanvasViewport>) => void;
  undo: () => CanvasRuntimeCommitResult | null;
};

export type CanvasRuntimeStore = ReturnType<typeof createCanvasRuntimeStore>;

const CanvasRuntimeStoreContext = createContext<CanvasRuntimeStore | null>(
  null,
);
const CANVAS_HISTORY_LIMIT = 100;

function areStringArraysEqual(a: readonly string[], b: readonly string[]) {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function normalizeRuntimeSelection(
  document: PenDocument,
  selection: readonly string[],
  activePageId: string,
) {
  return selection.filter((id) =>
    Boolean(findNode(document, id, activePageId)),
  );
}

function getDocumentSelectionFallback(
  document: PenDocument,
  fallback: readonly string[],
) {
  const maybeSelection = (document as PenDocument & { selection?: unknown })
    .selection;
  if (Array.isArray(maybeSelection)) {
    return maybeSelection.filter((id): id is string => typeof id === "string");
  }
  return [...fallback];
}

function toRuntimeDocument(
  document: PenDocument,
  activePageId: string,
  selection: readonly string[],
) {
  return {
    ...document,
    activePageId,
    selection: [...selection],
  } as CanvasApiDocument;
}

type PreparedRuntimeCommit = {
  documentCommit: CanvasRuntimeDocumentCommit;
  result: CanvasRuntimeCommitResult;
  selectionCommit: CanvasRuntimeSelectionCommit | null;
};

function prepareRuntimeCommit(
  state: CanvasRuntimeState,
  document: PenDocument,
  opts?: DocumentCommitOptions,
): PreparedRuntimeCommit {
  const normalized = normalizeCanvasPages(document);
  const activePageId = resolveActivePageId(normalized);
  const requestedSelection =
    opts && "selection" in opts
      ? (opts.selection ?? [])
      : getDocumentSelectionFallback(normalized, state.selection);
  const selection = normalizeRuntimeSelection(
    normalized,
    requestedSelection,
    activePageId,
  );
  const previousSelection = state.selection;
  const selectionChanged = !areStringArraysEqual(previousSelection, selection);
  const nextVersion = state.version + 1;
  const committed = toRuntimeDocument(normalized, activePageId, selection);

  return {
    documentCommit: {
      notifyDocumentChange: opts?.notify !== false,
      source: opts?.source ?? "document.commit",
      version: nextVersion,
    },
    result: {
      activePageId,
      document: committed,
      selection,
      selectionChanged,
      version: nextVersion,
    },
    selectionCommit: selectionChanged
      ? {
          notifyScene: false,
          notifySelection: true,
          revision: state.selectionRevision + 1,
          source: opts?.source ?? "document.commit",
        }
      : null,
  };
}

function applyPreparedRuntimeCommit(
  state: CanvasRuntimeState,
  prepared: PreparedRuntimeCommit,
  opts?: DocumentCommitOptions,
) {
  const { result } = prepared;
  if (opts?.captureHistory !== false) {
    state.historyPast.push(
      toRuntimeDocument(state.document, state.activePageId, state.selection),
    );
    if (state.historyPast.length > CANVAS_HISTORY_LIMIT) {
      state.historyPast.splice(
        0,
        state.historyPast.length - CANVAS_HISTORY_LIMIT,
      );
      console.info("[canvas-runtime-store] history trimmed", {
        limit: CANVAS_HISTORY_LIMIT,
      });
    }
    state.historyFuture = [];
  }
  state.document = result.document;
  state.activePageId = result.activePageId;
  state.selection = result.selection;
  state.version = result.version;
  state.lastDocumentCommit = prepared.documentCommit;
  if (prepared.selectionCommit) {
    state.selectionRevision = prepared.selectionCommit.revision;
    state.lastSelectionCommit = prepared.selectionCommit;
  }
}

function commitRuntimeDocument(
  state: CanvasRuntimeState,
  document: PenDocument,
  opts?: DocumentCommitOptions,
): CanvasRuntimeCommitResult {
  const prepared = prepareRuntimeCommit(state, document, opts);
  applyPreparedRuntimeCommit(state, prepared, opts);
  return prepared.result;
}

export const selectCanvasDocument = (state: CanvasRuntimeState) =>
  state.document;
export const selectCanvasActivePageId = (state: CanvasRuntimeState) =>
  state.activePageId;
export const selectCanvasActiveTool = (state: CanvasRuntimeState) =>
  state.activeTool;
export const selectCanvasSelection = (state: CanvasRuntimeState) =>
  state.selection;
export const selectCanvasViewport = (state: CanvasRuntimeState) =>
  state.viewport;
export const selectCanvasSelectedCount = (state: CanvasRuntimeState) =>
  state.selection.length;
export const selectCanvasCanUndo = (state: CanvasRuntimeState) =>
  state.historyPast.length > 0;
export const selectCanvasCanRedo = (state: CanvasRuntimeState) =>
  state.historyFuture.length > 0;
export const selectCanvasPages = (state: CanvasRuntimeState): PenPage[] =>
  state.document.pages ?? getCanvasPages(state.document);
export const selectCanvasSelectedNode = (
  state: CanvasRuntimeState,
): PenNode | null => {
  if (state.selection.length !== 1) return null;
  const nodeId = state.selection[0];
  return nodeId
    ? (findNode(state.document, nodeId, state.activePageId) ?? null)
    : null;
};

export const selectCanvasToolbarState = (state: CanvasRuntimeState) => ({
  activeTool: state.activeTool,
  canRedo: selectCanvasCanRedo(state),
  canUndo: selectCanvasCanUndo(state),
  selectedCount: state.selection.length,
});

export const selectCanvasBooleanInputState = (state: CanvasRuntimeState) => ({
  activePageId: state.activePageId,
  document: state.document,
  selection: state.selection,
});

export const selectCanvasPageTabsState = (state: CanvasRuntimeState) => ({
  activePageId: state.activePageId,
  pages: selectCanvasPages(state),
});

export const selectCanvasSelectedNodePanelState = (
  state: CanvasRuntimeState,
) => ({
  node: selectCanvasSelectedNode(state),
  styleDefinitions: state.document.styleDefinitions,
  variables: state.document.variables,
});

export function getCanvasApiDocument(
  state: Pick<
    CanvasRuntimeState,
    "activePageId" | "document" | "selection" | "viewport"
  >,
) {
  return {
    ...state.document,
    activePageId: state.activePageId,
    selection: [...state.selection],
    viewport: {
      ...(state.document.viewport ?? {}),
      ...(state.viewport as CanvasApiViewportState),
    },
  } as CanvasApiDocument;
}

export function createCanvasRuntimeStore(initialDocument: PenDocument) {
  const initial = normalizeCanvasPages(initialDocument);
  const initialActivePageId = resolveActivePageId(initial);
  const initialSelection = normalizeRuntimeSelection(
    initial,
    getDocumentSelectionFallback(initial, []),
    initialActivePageId,
  );
  const initialRuntimeDocument = toRuntimeDocument(
    initial,
    initialActivePageId,
    initialSelection,
  );

  return createStore<CanvasRuntimeState>()(
    subscribeWithSelector((set, get) => ({
      activePageId: initialActivePageId,
      activeTool: "select",
      document: initialRuntimeDocument,
      historyFuture: [],
      historyPast: [],
      lastDocumentCommit: null,
      lastSelectionCommit: null,
      selection: initialSelection,
      selectionRevision: 0,
      version: 0,
      viewport: initial.viewport ?? {},
      applyTransaction: (operations, opts) => {
        const current = get();
        const result = applyCanvasTransaction(current.document, operations, {
          activePageId: current.activePageId,
          transactionId: opts?.transactionId,
        });
        get().commitDocument(result.doc, {
          captureHistory: true,
          selection: opts?.selection ?? current.selection,
          source: "document.transaction",
        });
        console.info("[canvas-runtime-store] transaction applied", {
          activePageId: current.activePageId,
          operationCount: operations.length,
          transactionId: result.transactionId,
        });
        return result.transactionId;
      },
      commitDocument: (document, opts) => {
        let result: CanvasRuntimeCommitResult | null = null;
        set((state) =>
          produce(state, (draft) => {
            result = commitRuntimeDocument(draft, document, opts);
          }),
        );
        const committed = result as unknown as CanvasRuntimeCommitResult | null;
        if (!committed) {
          throw new Error("Canvas document commit did not produce a result.");
        }
        console.info("[canvas-runtime-store] document committed", {
          activePageId: committed.activePageId,
          captureHistory: opts?.captureHistory !== false,
          selectionCount: committed.selection.length,
          source: opts?.source ?? "document.commit",
          version: committed.version,
        });
        return committed;
      },
      redo: () => {
        const current = get();
        const next = current.historyFuture[0];
        if (!next) return null;
        const prepared = prepareRuntimeCommit(current, next, {
          captureHistory: false,
          notify: true,
          selection: getDocumentSelectionFallback(next, current.selection),
          source: "history.redo",
        });
        set((state) =>
          produce(state, (draft) => {
            draft.historyFuture = draft.historyFuture.slice(1);
            draft.historyPast.push(
              toRuntimeDocument(
                state.document,
                state.activePageId,
                state.selection,
              ),
            );
            if (draft.historyPast.length > CANVAS_HISTORY_LIMIT) {
              draft.historyPast.splice(
                0,
                draft.historyPast.length - CANVAS_HISTORY_LIMIT,
              );
            }
            applyPreparedRuntimeCommit(draft, prepared, {
              captureHistory: false,
            });
          }),
        );
        console.info("[canvas-runtime-store] history.redone", {
          activePageId: prepared.result.activePageId,
          version: prepared.result.version,
        });
        return prepared.result;
      },
      setActivePage: (pageId) => {
        const current = get();
        if (pageId.trim() === current.activePageId) return null;
        const activePageId = resolveActivePageId(current.document, pageId);
        return get().commitDocument(
          { ...current.document, activePageId, selection: [] } as PenDocument,
          {
            selection: [],
            source: "page.active.change",
          },
        );
      },
      setActiveTool: (tool) => {
        set(
          produce<CanvasRuntimeState>((draft) => {
            draft.activeTool = tool;
          }),
        );
      },
      setDocument: (document, opts) =>
        get().commitDocument(document, {
          captureHistory: opts?.captureHistory,
          source: "document.set",
        }),
      setSelection: (selection, opts) => {
        const current = get();
        const validSelection = normalizeRuntimeSelection(
          current.document,
          selection,
          current.activePageId,
        );
        if (areStringArraysEqual(validSelection, current.selection)) {
          return current.selection;
        }
        set((state) =>
          produce(state, (draft) => {
            draft.selection = validSelection;
            draft.selectionRevision += 1;
            draft.lastSelectionCommit = {
              notifyScene: opts?.notifyScene !== false,
              notifySelection: opts?.notifySelection !== false,
              revision: draft.selectionRevision,
              source: opts?.source ?? "selection.set",
            };
          }),
        );
        console.info("[canvas-runtime-store] selection updated", {
          activePageId: current.activePageId,
          selectedCount: validSelection.length,
          source: opts?.source ?? "selection.set",
        });
        return validSelection;
      },
      setViewport: (viewport) => {
        get().setViewportSnapshot(viewport);
      },
      setViewportSnapshot: (viewport) => {
        set(
          produce<CanvasRuntimeState>((draft) => {
            draft.viewport = { ...draft.viewport, ...viewport };
          }),
        );
      },
      undo: () => {
        const current = get();
        const previous = current.historyPast[current.historyPast.length - 1];
        if (!previous) return null;
        const prepared = prepareRuntimeCommit(current, previous, {
          captureHistory: false,
          notify: true,
          selection: getDocumentSelectionFallback(previous, current.selection),
          source: "history.undo",
        });
        set((state) =>
          produce(state, (draft) => {
            draft.historyPast = draft.historyPast.slice(0, -1);
            draft.historyFuture.unshift(
              toRuntimeDocument(
                state.document,
                state.activePageId,
                state.selection,
              ),
            );
            if (draft.historyFuture.length > CANVAS_HISTORY_LIMIT) {
              draft.historyFuture.splice(CANVAS_HISTORY_LIMIT);
            }
            applyPreparedRuntimeCommit(draft, prepared, {
              captureHistory: false,
            });
          }),
        );
        console.info("[canvas-runtime-store] history.undone", {
          activePageId: prepared.result.activePageId,
          version: prepared.result.version,
        });
        return prepared.result;
      },
    })),
  );
}

export function CanvasRuntimeStoreProvider({
  children,
  initialDocument,
  store,
}: PropsWithChildren<{
  initialDocument?: PenDocument;
  store?: CanvasRuntimeStore;
}>) {
  const storeRef = useRef<CanvasRuntimeStore | null>(store ?? null);
  if (!storeRef.current) {
    if (!initialDocument) {
      throw new Error(
        "CanvasRuntimeStoreProvider requires a store or initialDocument.",
      );
    }
    storeRef.current = createCanvasRuntimeStore(initialDocument);
  }
  return createElement(
    CanvasRuntimeStoreContext.Provider,
    { value: storeRef.current },
    children,
  );
}

export function useCanvasRuntimeStoreApi() {
  const store = useContext(CanvasRuntimeStoreContext);
  if (!store) {
    throw new Error(
      "useCanvasRuntimeStoreApi must be used inside CanvasRuntimeStoreProvider.",
    );
  }
  return store;
}

export function useCanvasRuntimeSelector<T>(
  selector: (state: CanvasRuntimeState) => T,
) {
  return useStore(useCanvasRuntimeStoreApi(), selector);
}

export function useCanvasRuntimeShallowSelector<T>(
  selector: (state: CanvasRuntimeState) => T,
) {
  return useStore(useCanvasRuntimeStoreApi(), useShallow(selector));
}
