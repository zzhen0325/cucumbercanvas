import { useCallback, useRef, useState } from "react";
import type { PenPathAnchor } from "@cucumber/canvas-core";

export type PenAnchor = PenPathAnchor;

export interface PenPreviewData {
  points: PenAnchor[];
  cursorPos: { x: number; y: number } | null;
  isDraggingHandle: boolean;
}

const PEN_CLOSE_HIT_THRESHOLD = 12; // scene units
const PEN_MIN_DRAG = 2;

export type PenToolCallback = {
  onCommit: (anchors: PenAnchor[], closed: boolean) => void;
  onCancel: () => void;
};

/**
 * Headless pen tool state machine. Manages anchor placement, handle dragging,
 * path closing, and preview data. Returns preview data for rendering and
 * mouse/key handlers for the canvas.
 */
export function usePenTool(callbacks: PenToolCallback) {
  const [preview, setPreview] = useState<PenPreviewData | null>(null);
  const pointsRef = useRef<PenAnchor[]>([]);
  const draggingHandleRef = useRef(false);
  const cursorPosRef = useRef<{ x: number; y: number } | null>(null);
  const activeRef = useRef(false);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  // Keep refs in sync with preview to avoid stale closures
  const syncPreview = useCallback(() => {
    if (!activeRef.current || pointsRef.current.length === 0) {
      setPreview(null);
    } else {
      setPreview({
        points: pointsRef.current.map((p) => ({ ...p, handleIn: p.handleIn ? { ...p.handleIn } : null, handleOut: p.handleOut ? { ...p.handleOut } : null })),
        cursorPos: cursorPosRef.current ? { ...cursorPosRef.current } : null,
        isDraggingHandle: draggingHandleRef.current,
      });
    }
  }, []);

  const cancel = useCallback(() => {
    if (!activeRef.current) return false;
    activeRef.current = false;
    pointsRef.current = [];
    draggingHandleRef.current = false;
    cursorPosRef.current = null;
    setPreview(null);
    callbacksRef.current.onCancel();
    return true;
  }, []);

  const finalize = useCallback(
    (closed: boolean) => {
      const points = pointsRef.current;
      if (points.length < 2) {
        cancel();
        return;
      }
      activeRef.current = false;
      const anchors = points.map((p) => ({
        ...p,
        handleIn: p.handleIn ? { ...p.handleIn } : null,
        handleOut: p.handleOut ? { ...p.handleOut } : null,
      }));
      pointsRef.current = [];
      draggingHandleRef.current = false;
      cursorPosRef.current = null;
      setPreview(null);
      callbacksRef.current.onCommit(anchors, closed);
    },
    [cancel],
  );

  const onMouseDown = useCallback(
    (scene: { x: number; y: number }, _zoom: number): boolean => {
      if (!activeRef.current) {
        // First click — start a new path
        activeRef.current = true;
        pointsRef.current = [
          { x: scene.x, y: scene.y, handleIn: null, handleOut: null, pointType: "corner" },
        ];
        draggingHandleRef.current = true;
        cursorPosRef.current = scene;
        syncPreview();
        return true;
      }

      // Check if clicking near the first point to close the path
      if (pointsRef.current.length >= 3) {
        const first = pointsRef.current[0]!;
        const threshold = PEN_CLOSE_HIT_THRESHOLD;
        if (Math.hypot(scene.x - first.x, scene.y - first.y) < threshold) {
          finalize(true);
          return true;
        }
      }

      // Add a new anchor point
      pointsRef.current = [
        ...pointsRef.current,
        { x: scene.x, y: scene.y, handleIn: null, handleOut: null, pointType: "corner" },
      ];
      draggingHandleRef.current = true;
      syncPreview();
      return true;
    },
    [finalize, syncPreview],
  );

  const onMouseMove = useCallback(
    (scene: { x: number; y: number }): boolean => {
      if (!activeRef.current || pointsRef.current.length === 0) return false;

      if (draggingHandleRef.current) {
        const lastIdx = pointsRef.current.length - 1;
        const pt = pointsRef.current[lastIdx]!;
        const dx = scene.x - pt.x;
        const dy = scene.y - pt.y;
        if (Math.hypot(dx, dy) > PEN_MIN_DRAG) {
          pointsRef.current = pointsRef.current.map((p, i) =>
            i === lastIdx
              ? { ...p, handleOut: { x: dx, y: dy }, handleIn: { x: -dx, y: -dy }, pointType: "mirrored" as const }
              : p,
          );
        } else {
          // Not dragged far enough, remain corner
          pointsRef.current = pointsRef.current.map((p, i) =>
            i === lastIdx ? { ...p, handleOut: null, handleIn: null, pointType: "corner" as const } : p,
          );
        }
      }
      cursorPosRef.current = scene;
      syncPreview();
      return true;
    },
    [syncPreview],
  );

  const onMouseUp = useCallback((): boolean => {
    if (!activeRef.current) return false;
    draggingHandleRef.current = false;
    syncPreview();
    return true;
  }, [syncPreview]);

  const onDblClick = useCallback((): boolean => {
    if (!activeRef.current) return false;
    if (pointsRef.current.length > 1) {
      pointsRef.current = pointsRef.current.slice(0, -1);
    }
    finalize(false);
    return true;
  }, [finalize]);

  const onKeyDown = useCallback(
    (key: string): boolean => {
      if (!activeRef.current) return false;

      if (key === "Enter") {
        finalize(false);
        return true;
      }
      if (key === "Escape") {
        cancel();
        return true;
      }
      if (key === "Backspace") {
        if (pointsRef.current.length > 1) {
          pointsRef.current = pointsRef.current.slice(0, -1);
          syncPreview();
        } else {
          cancel();
        }
        return true;
      }
      return false;
    },
    [finalize, cancel, syncPreview],
  );

  const isActive = activeRef.current;

  return {
    preview,
    isActive,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onDblClick,
    onKeyDown,
    cancel,
  };
}

/**
 * Build SVG path data from pen anchors.
 */
export function buildPenPathSvg(points: PenAnchor[], closed: boolean): string {
  if (points.length === 0) return "";
  const parts: string[] = [];
  const first = points[0]!;
  parts.push(`M ${first.x} ${first.y}`);
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    if (!prev.handleOut && !curr.handleIn) {
      parts.push(`L ${curr.x} ${curr.y}`);
    } else {
      const cx1 = prev.x + (prev.handleOut?.x ?? 0);
      const cy1 = prev.y + (prev.handleOut?.y ?? 0);
      const cx2 = curr.x + (curr.handleIn?.x ?? 0);
      const cy2 = curr.y + (curr.handleIn?.y ?? 0);
      parts.push(`C ${cx1} ${cy1} ${cx2} ${cy2} ${curr.x} ${curr.y}`);
    }
  }
  if (closed && points.length > 1) {
    const last = points[points.length - 1]!;
    if (!last.handleOut && !first.handleIn) {
      parts.push(`L ${first.x} ${first.y}`);
    } else {
      const cx1 = last.x + (last.handleOut?.x ?? 0);
      const cy1 = last.y + (last.handleOut?.y ?? 0);
      const cx2 = first.x + (first.handleIn?.x ?? 0);
      const cy2 = first.y + (first.handleIn?.y ?? 0);
      parts.push(`C ${cx1} ${cy1} ${cx2} ${cy2} ${first.x} ${first.y}`);
    }
    parts.push("Z");
  }
  return parts.join(" ");
}

/**
 * Compute bounds of the pen path in scene coordinates.
 */
export function getPenPathBounds(
  anchors: PenAnchor[],
): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const a of anchors) {
    minX = Math.min(minX, a.x);
    minY = Math.min(minY, a.y);
    maxX = Math.max(maxX, a.x);
    maxY = Math.max(maxY, a.y);
  }
  return {
    x: minX === Infinity ? 0 : minX,
    y: minY === Infinity ? 0 : minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/**
 * Convert pen anchors to a path node's data (document coordinates relative to parent).
 */
export function bakePenAnchorsToPathData(
  sceneAnchors: PenAnchor[],
  closed: boolean,
  parentSceneOrigin: { x: number; y: number },
): {
  x: number;
  y: number;
  width: number;
  height: number;
  d: string;
  anchors: PenAnchor[];
  closed: boolean;
} | null {
  if (sceneAnchors.length < 2) return null;

  const sceneBounds = getPenPathBounds(sceneAnchors);
  if (sceneBounds.width < 1 && sceneBounds.height < 1) return null;

  // Normalize anchors relative to bounds origin
  const normalizedAnchors = sceneAnchors.map((a) => ({
    ...a,
    x: a.x - sceneBounds.x,
    y: a.y - sceneBounds.y,
  }));

  return {
    x: sceneBounds.x - parentSceneOrigin.x,
    y: sceneBounds.y - parentSceneOrigin.y,
    width: Math.max(sceneBounds.width, 48),
    height: Math.max(sceneBounds.height, 48),
    closed,
    d: buildPenPathSvg(normalizedAnchors, closed),
    anchors: normalizedAnchors,
  };
}
