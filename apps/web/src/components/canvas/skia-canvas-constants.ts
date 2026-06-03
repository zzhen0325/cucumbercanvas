"use client";

export const CANVAS_SELECTION_COLOR = "#37BFF9";
export const KEYBOARD_ZOOM_STEP = 1.1;
export const MIN_DRAW_SIZE = 2;
export const MOVE_COMMIT_THRESHOLD_PX = 2;
export const TEXT_DRAG_THRESHOLD_PX = 4;
export const WHEEL_ZOOM_SENSITIVITY = 0.002;

export function assertPositiveFiniteZoom(zoom: number) {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new Error(`画布缩放比例必须是大于 0 的有限数字，当前值为 ${zoom}。`);
  }
}

export function normalizeWheelDeltaY(event: WheelEvent): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * 16;
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * window.innerHeight;
  }
  return event.deltaY;
}
