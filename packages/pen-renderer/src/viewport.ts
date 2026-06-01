import type { ViewportState } from "./types.js";

export type { ViewportState } from "./types.js";

/**
 * Compute the 3x3 transform matrix for CanvasKit from viewport state.
 * CanvasKit uses column-major [scaleX, skewX, transX, skewY, scaleY, transY, pers0, pers1, pers2]
 * panX/panY are CSS-pixel offsets in canvas-local coordinates. The renderer
 * applies device-pixel-ratio scaling before this matrix, so viewport math always
 * works in browser CSS pixels until scene drawing begins.
 */
export function viewportMatrix(vp: ViewportState): number[] {
  return [vp.zoom, 0, vp.panX, 0, vp.zoom, vp.panY, 0, 0, 1];
}

export function clientToCanvasLocal(
  clientX: number,
  clientY: number,
  canvasRect: Pick<DOMRect, "left" | "top">,
): { x: number; y: number } {
  return {
    x: clientX - canvasRect.left,
    y: clientY - canvasRect.top,
  };
}

export function canvasLocalToScene(
  localX: number,
  localY: number,
  vp: ViewportState,
): { x: number; y: number } {
  return {
    x: (localX - vp.panX) / vp.zoom,
    y: (localY - vp.panY) / vp.zoom,
  };
}

export function sceneToCanvasLocal(
  sceneX: number,
  sceneY: number,
  vp: ViewportState,
): { x: number; y: number } {
  return {
    x: sceneX * vp.zoom + vp.panX,
    y: sceneY * vp.zoom + vp.panY,
  };
}

export function clientDeltaToSceneDelta(
  deltaX: number,
  deltaY: number,
  vp: ViewportState,
): { x: number; y: number } {
  return {
    x: deltaX / vp.zoom,
    y: deltaY / vp.zoom,
  };
}

function assertPositiveFiniteZoom(zoom: number) {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new Error(
      `Viewport zoom must be a positive finite number, received ${zoom}.`,
    );
  }
}

/**
 * Convert screen (client) coordinates to scene coordinates.
 */
export function screenToScene(
  clientX: number,
  clientY: number,
  canvasRect: DOMRect,
  vp: ViewportState,
): { x: number; y: number } {
  const local = clientToCanvasLocal(clientX, clientY, canvasRect);
  return canvasLocalToScene(local.x, local.y, vp);
}

/**
 * Convert scene coordinates to screen coordinates.
 */
export function sceneToScreen(
  sceneX: number,
  sceneY: number,
  canvasRect: DOMRect,
  vp: ViewportState,
): { x: number; y: number } {
  const local = sceneToCanvasLocal(sceneX, sceneY, vp);
  return {
    x: local.x + canvasRect.left,
    y: local.y + canvasRect.top,
  };
}

/**
 * Zoom towards a point (in screen coordinates).
 */
export function zoomToPoint(
  vp: ViewportState,
  screenX: number,
  screenY: number,
  canvasRect: DOMRect,
  newZoom: number,
): ViewportState {
  assertPositiveFiniteZoom(newZoom);
  const sx = screenX - canvasRect.left;
  const sy = screenY - canvasRect.top;

  // The scene point under the cursor should stay fixed
  const scene = canvasLocalToScene(sx, sy, vp);

  return {
    zoom: newZoom,
    panX: sx - scene.x * newZoom,
    panY: sy - scene.y * newZoom,
  };
}

/**
 * Get viewport bounds in scene coordinates.
 */
export function getViewportBounds(
  vp: ViewportState,
  canvasWidth: number,
  canvasHeight: number,
  margin = 0,
) {
  return {
    left: -vp.panX / vp.zoom - margin,
    top: -vp.panY / vp.zoom - margin,
    right: (-vp.panX + canvasWidth) / vp.zoom + margin,
    bottom: (-vp.panY + canvasHeight) / vp.zoom + margin,
  };
}

/**
 * Check if a rect is within the viewport bounds.
 */
export function isRectInViewport(
  rect: { x: number; y: number; w: number; h: number },
  vpBounds: ReturnType<typeof getViewportBounds>,
): boolean {
  return !(
    rect.x + rect.w < vpBounds.left ||
    rect.x > vpBounds.right ||
    rect.y + rect.h < vpBounds.top ||
    rect.y > vpBounds.bottom
  );
}
