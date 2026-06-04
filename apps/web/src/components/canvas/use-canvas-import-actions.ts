import {
  type CanvasBounds,
  type ClipboardImportPayload,
  type CucumberCanvasDocument,
  getCanvasImportBounds,
  insertCanvasImportResult,
  parseClipboardImport,
} from "@cucumber/canvas-core";
import type { PenRenderer, ViewportState } from "@cucumber/pen-renderer";
import type { PenDocument } from "@cucumber/pen-types";
import { useCallback, useRef, useState } from "react";

import {
  hasCanvasNodeTemplateDragPayload,
  readCanvasNodeTemplateDragPayload,
} from "./agent-node-template-drag";
import {
  getClipboardImportStrategy,
  summarizeImportedNodes,
} from "./canvas-import-diagnostics";
import {
  computeImportGridPlacements,
  describeImportGridPlacements,
  hasFileDataTransfer,
} from "./canvas-import-placement";
import {
  shouldUploadClipboardRasterFile,
  uploadRasterFilesInPayload,
} from "./canvas-raster-upload";
import type { CanvasRuntimeCommitResult } from "./canvas-runtime-store";
import { getPrimarySelectedContainerId } from "./canvas-selection-helpers";
import {
  type ClipboardImportContext,
  readClipboardImportPayload,
  readDataTransferImportPayloads,
  useCanvasClipboardImport,
} from "./use-canvas-clipboard-import";

type MutableRef<T> = {
  current: T;
};

type ImportToast = {
  error: (message: string) => void;
  toast: (message: string) => void;
};

type LiveViewportPlacement = {
  rect: Pick<DOMRect, "height" | "width"> | null;
  viewport: ViewportState | null;
};

export function useCanvasImportActions({
  accessToken,
  activePageIdRef,
  commitDocument,
  docRef,
  getLiveViewportPlacement,
  getPointerScenePoint,
  notifySelectionForDoc,
  projectId,
  rendererRef,
  selectedIdsRef,
  setSelection,
  toast,
  onCreateAgentUserGoal,
}: {
  accessToken?: string;
  activePageIdRef: MutableRef<string>;
  commitDocument: (
    next: PenDocument,
    opts?: {
      captureHistory?: boolean;
      notify?: boolean;
      selection?: string[];
    },
  ) => CanvasRuntimeCommitResult;
  docRef: MutableRef<PenDocument>;
  getLiveViewportPlacement: () => LiveViewportPlacement;
  getPointerScenePoint: (event: { clientX: number; clientY: number }) => {
    x: number;
    y: number;
  } | null;
  notifySelectionForDoc: (nextDoc: PenDocument, nodeIds: string[]) => void;
  projectId?: string;
  rendererRef: MutableRef<PenRenderer | null>;
  selectedIdsRef: MutableRef<string[]>;
  setSelection: (
    nodeIds: string[],
    opts?: { notifyScene?: boolean; notifySelection?: boolean },
  ) => void;
  toast: ImportToast;
  onCreateAgentUserGoal?: (opts: {
    text?: string;
    x: number;
    y: number;
  }) => void;
}) {
  const [isFileDragActive, setIsFileDragActive] = useState(false);
  const fileDragDepthRef = useRef(0);

  const importFromPayload = useCallback(
    (
      payload: ClipboardImportPayload,
      context?: ClipboardImportContext,
      options?: { scenePoint?: { x: number; y: number } },
    ) => {
      const parsed = parseClipboardImport(payload);
      if (!parsed) {
        console.info("[skia-canvas] clipboard.import.ignored", {
          trigger: context?.trigger ?? "unknown",
          mimeTypes: context?.mimeTypes ?? [],
          itemTypes: context?.itemTypes ?? [],
          fileTypes: context?.fileTypes ?? [],
          hasHtml: Boolean(payload.html),
          hasText: Boolean(payload.text),
          hasSvg: Boolean(payload.svg),
          itemCount: payload.items?.length ?? 0,
          fileCount: payload.files?.length ?? 0,
        });
        return [];
      }
      const importBounds = getCanvasImportBounds(parsed);
      const placementContext = getLiveViewportPlacement();
      const viewport = placementContext.viewport ?? {
        zoom: 1,
        panX: 0,
        panY: 0,
      };
      const viewportCenter = {
        x:
          ((placementContext.rect?.width ?? 0) / 2 - viewport.panX) /
          viewport.zoom,
        y:
          ((placementContext.rect?.height ?? 0) / 2 - viewport.panY) /
          viewport.zoom,
      };
      const targetCenter = options?.scenePoint ?? viewportCenter;
      const offsetX = importBounds
        ? targetCenter.x - (importBounds.x + importBounds.width / 2)
        : 0;
      const offsetY = importBounds
        ? targetCenter.y - (importBounds.y + importBounds.height / 2)
        : 0;
      const inserted = insertCanvasImportResult(docRef.current, parsed, {
        parentId: getPrimarySelectedContainerId(
          docRef.current as CucumberCanvasDocument,
          selectedIdsRef.current,
          activePageIdRef.current,
        ),
        offsetX,
        offsetY,
      });
      commitDocument(inserted.doc, { selection: inserted.insertedIds });
      setSelection(inserted.insertedIds, { notifyScene: false });
      notifySelectionForDoc(inserted.doc, inserted.insertedIds);
      if (parsed.warnings.length > 0) {
        toast.toast(
          `导入存在 ${parsed.warnings.length} 条兼容性提醒，请查看画布顶部说明。`,
        );
      }
      console.info("[skia-canvas] clipboard.imported", {
        trigger: context?.trigger ?? "unknown",
        mimeTypes: context?.mimeTypes ?? [],
        itemTypes: context?.itemTypes ?? [],
        fileTypes: context?.fileTypes ?? [],
        source: parsed.source,
        strategy: getClipboardImportStrategy(parsed),
        importSessionId: parsed.importSessionId,
        placement: options?.scenePoint ? "drop-point" : "viewport-center",
        targetCenter,
        viewport,
        rootCount: parsed.rootNodeIds.length,
        assetCount: parsed.assets.length,
        insertedCount: inserted.insertedIds.length,
        warningCount: parsed.warnings.length,
        warnings: parsed.warnings.map((warning) => ({
          code: warning.code,
          message: warning.message,
          originNodeType: warning.originNodeType,
          originNodeId: warning.originNodeId,
        })),
        nodeSummary: summarizeImportedNodes(parsed),
      });
      return inserted.insertedIds;
    },
    [
      activePageIdRef,
      commitDocument,
      docRef,
      getLiveViewportPlacement,
      notifySelectionForDoc,
      selectedIdsRef,
      setSelection,
      toast,
    ],
  );

  const importDropPayloadsInGrid = useCallback(
    async (
      results: Array<{
        payload: ClipboardImportPayload;
        context: ClipboardImportContext;
      }>,
      scenePoint?: { x: number; y: number },
    ) => {
      const preparedResults = await Promise.all(
        results.map(async (result) => ({
          ...result,
          payload: await uploadRasterFilesInPayload(result.payload, {
            accessToken,
            projectId,
          }),
        })),
      );
      const parsedEntries = preparedResults.flatMap((result) => {
        const parsed = parseClipboardImport(result.payload);
        if (!parsed) return [];
        return [
          {
            ...result,
            parsed,
            bounds: getCanvasImportBounds(parsed),
          },
        ];
      });
      if (parsedEntries.length === 0) return [];

      const placementContext = getLiveViewportPlacement();
      const viewport = placementContext.viewport ?? {
        zoom: 1,
        panX: 0,
        panY: 0,
      };
      const targetCenter =
        scenePoint ??
        ({
          x:
            ((placementContext.rect?.width ?? 0) / 2 - viewport.panX) /
            viewport.zoom,
          y:
            ((placementContext.rect?.height ?? 0) / 2 - viewport.panY) /
            viewport.zoom,
        } satisfies { x: number; y: number });
      const placements = computeImportGridPlacements(
        parsedEntries.map((entry) => entry.bounds),
        targetCenter,
      );
      const targetParentId = getPrimarySelectedContainerId(
        docRef.current as CucumberCanvasDocument,
        selectedIdsRef.current,
        activePageIdRef.current,
      );

      let nextDoc: PenDocument = docRef.current;
      const insertedIds: string[] = [];
      let warningCount = 0;

      parsedEntries.forEach((entry, index) => {
        const bounds = entry.bounds;
        const placement = placements[index] ?? targetCenter;
        const offsetX = bounds
          ? placement.x - (bounds.x + bounds.width / 2)
          : 0;
        const offsetY = bounds
          ? placement.y - (bounds.y + bounds.height / 2)
          : 0;
        const inserted = insertCanvasImportResult(nextDoc, entry.parsed, {
          parentId: targetParentId,
          offsetX,
          offsetY,
        });
        nextDoc = inserted.doc;
        insertedIds.push(...inserted.insertedIds);
        warningCount += entry.parsed.warnings.length;
      });

      commitDocument(nextDoc, { selection: insertedIds });
      setSelection(insertedIds, { notifyScene: false });
      notifySelectionForDoc(nextDoc, insertedIds);
      if (warningCount > 0) {
        toast.toast(
          `导入存在 ${warningCount} 条兼容性提醒，请查看画布顶部说明。`,
        );
      }
      console.info("[skia-canvas] file-drop.grid-imported", {
        activePageId: activePageIdRef.current,
        itemCount: results.length,
        importedItemCount: parsedEntries.length,
        unsupportedItemCount: results.length - parsedEntries.length,
        insertedCount: insertedIds.length,
        parentId: targetParentId,
        placement: parsedEntries.length > 1 ? "grid" : "drop-point",
        grid: describeImportGridPlacements(
          parsedEntries.map((entry) => entry.bounds as CanvasBounds | null),
        ),
        targetCenter,
        warningCount,
        mimeTypes: Array.from(
          new Set(results.flatMap((result) => result.context.mimeTypes)),
        ),
        fileTypes: Array.from(
          new Set(results.flatMap((result) => result.context.fileTypes ?? [])),
        ),
        viewport,
      });
      return insertedIds;
    },
    [
      accessToken,
      activePageIdRef,
      commitDocument,
      docRef,
      getLiveViewportPlacement,
      notifySelectionForDoc,
      projectId,
      selectedIdsRef,
      setSelection,
      toast,
    ],
  );

  const resetFileDragState = useCallback(() => {
    fileDragDepthRef.current = 0;
    setIsFileDragActive(false);
  }, []);

  const handleDragEnter = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (hasCanvasNodeTemplateDragPayload(event.dataTransfer)) {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
        return;
      }
      if (!hasFileDataTransfer(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      fileDragDepthRef.current += 1;
      event.dataTransfer.dropEffect = "copy";
      setIsFileDragActive(true);
    },
    [],
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (hasCanvasNodeTemplateDragPayload(event.dataTransfer)) {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
        return;
      }
      if (!hasFileDataTransfer(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
    },
    [],
  );

  const handleDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasFileDataTransfer(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
      if (fileDragDepthRef.current === 0) {
        setIsFileDragActive(false);
      }
    },
    [],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (hasCanvasNodeTemplateDragPayload(event.dataTransfer)) {
        event.preventDefault();
        event.stopPropagation();
        resetFileDragState();
        try {
          const payload = readCanvasNodeTemplateDragPayload(event.dataTransfer);
          const scenePoint = getPointerScenePoint(event);
          if (!scenePoint) {
            throw new Error(
              "无法确定节点放置位置，请把用户目标节点拖到画布区域后再松开。",
            );
          }
          if (!onCreateAgentUserGoal) {
            throw new Error("当前画布没有接入用户目标节点创建能力。");
          }
          onCreateAgentUserGoal({
            ...(payload.text ? { text: payload.text } : {}),
            x: scenePoint.x,
            y: scenePoint.y,
          });
          console.info("[skia-canvas] node-template-drop.created", {
            activePageId: activePageIdRef.current,
            scenePoint,
            templateType: payload.type,
          });
        } catch (error) {
          console.warn("[skia-canvas] node-template-drop.failed", {
            activePageId: activePageIdRef.current,
            error,
          });
          toast.error(
            error instanceof Error
              ? error.message
              : "节点模板创建失败，请从工具栏重新拖出节点。",
          );
        }
        return;
      }
      if (!hasFileDataTransfer(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();

      const dataTransfer = event.dataTransfer;
      const renderer = rendererRef.current;
      const scenePoint = getPointerScenePoint(event) ?? undefined;
      resetFileDragState();

      console.info("[skia-canvas] file-drop.detected", {
        activePageId: activePageIdRef.current,
        mimeTypes: Array.from(dataTransfer.types ?? []),
        fileCount: dataTransfer.files?.length ?? 0,
        scenePoint,
        viewport: renderer?.getViewport() ?? { zoom: 1, panX: 0, panY: 0 },
      });

      void readDataTransferImportPayloads(dataTransfer).then(
        async (results) => {
          try {
            const importedIds = await importDropPayloadsInGrid(
              results,
              scenePoint,
            );
            if (importedIds.length > 0) return;
            console.info("[skia-canvas] file-drop.import.ignored", {
              activePageId: activePageIdRef.current,
              itemCount: results.length,
              mimeTypes: results.flatMap((result) => result.context.mimeTypes),
              fileTypes: results.flatMap(
                (result) => result.context.fileTypes ?? [],
              ),
            });
            toast.error(
              "暂不支持拖入这些文件。请使用 PNG、JPG、WebP、GIF 或 SVG 文件。",
            );
          } catch (error) {
            console.warn("[skia-canvas] file-drop.import.failed", {
              activePageId: activePageIdRef.current,
              error,
            });
            toast.error(
              error instanceof Error
                ? error.message
                : "文件导入失败，请确认文件内容可读取后重试。",
            );
          }
        },
        (error) => {
          console.warn("[skia-canvas] file-drop.read.failed", {
            activePageId: activePageIdRef.current,
            error,
          });
          toast.error("文件读取失败，请确认文件内容可读取后重试。");
        },
      );
    },
    [
      activePageIdRef,
      getPointerScenePoint,
      importDropPayloadsInGrid,
      onCreateAgentUserGoal,
      rendererRef,
      resetFileDragState,
      toast,
    ],
  );

  const pasteFromSystemClipboard = useCallback(async () => {
    const { payload, context } = await readClipboardImportPayload();
    if (
      !payload.html &&
      !payload.text &&
      !payload.svg &&
      !payload.items?.length &&
      !payload.files?.length
    ) {
      return [];
    }
    try {
      const preparedPayload = await uploadRasterFilesInPayload(payload, {
        accessToken,
        projectId,
      });
      return importFromPayload(preparedPayload, context);
    } catch (error) {
      console.warn("[skia-canvas] clipboard.import.failed", {
        trigger: context.trigger,
        mimeTypes: context.mimeTypes,
        error,
      });
      toast.error(
        error instanceof Error ? error.message : "剪贴板导入失败，请重试。",
      );
      return [];
    }
  }, [accessToken, importFromPayload, projectId, toast]);

  const importSvgMarkup = useCallback(
    (svgMarkup: string) => {
      try {
        return importFromPayload(
          { text: svgMarkup },
          {
            trigger: "clipboard-api",
            mimeTypes: ["image/svg+xml", "text/plain"],
            hasHtml: false,
            hasText: true,
          },
        );
      } catch (error) {
        console.warn("[skia-canvas] svg.import.failed", { error });
        toast.error(error instanceof Error ? error.message : "SVG 导入失败。");
        return [];
      }
    },
    [importFromPayload, toast],
  );

  useCanvasClipboardImport({
    onImportPayload: (payload, context) => {
      if (payload.files?.some(shouldUploadClipboardRasterFile)) {
        void uploadRasterFilesInPayload(payload, {
          accessToken,
          projectId,
        })
          .then((preparedPayload) => {
            importFromPayload(preparedPayload, context);
          })
          .catch((error) => {
            console.warn("[skia-canvas] clipboard.import.failed", {
              trigger: context.trigger,
              mimeTypes: context.mimeTypes,
              error,
            });
            toast.error(
              error instanceof Error
                ? error.message
                : "剪贴板导入失败，请重试。",
            );
          });
        return true;
      }
      try {
        return importFromPayload(payload, context).length > 0;
      } catch (error) {
        console.warn("[skia-canvas] clipboard.import.failed", {
          trigger: context.trigger,
          mimeTypes: context.mimeTypes,
          error,
        });
        toast.error(
          error instanceof Error ? error.message : "剪贴板导入失败，请重试。",
        );
        return false;
      }
    },
  });

  return {
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    importSvgMarkup,
    isFileDragActive,
    pasteFromSystemClipboard,
  };
}
