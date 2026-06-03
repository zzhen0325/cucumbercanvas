import { type CanvasBounds, getNodeSceneBounds } from "@cucumber/canvas-core";
import type { ViewportState } from "@cucumber/pen-renderer";
import type { PenDocument } from "@cucumber/pen-types";

import { getCanvasApiRuntimeState } from "./canvas-runtime-utils";

export function getDefaultCanvasNodeBounds(
  doc: PenDocument,
  _type: string,
  parentId?: string | null,
  viewport?: ViewportState | null,
  viewportRect?: Pick<DOMRect, "width" | "height"> | null,
): CanvasBounds {
  const runtimeState = getCanvasApiRuntimeState(doc);
  const viewportState = runtimeState.viewport;
  const width = 300;
  const height = 200;
  const sceneCenter =
    viewport && viewportRect
      ? {
          x: ((viewportRect.width ?? 0) / 2 - viewport.panX) / viewport.zoom,
          y: ((viewportRect.height ?? 0) / 2 - viewport.panY) / viewport.zoom,
        }
      : {
          x: -((viewportState.x ?? 0) / (viewportState.zoom ?? 1)) + 200,
          y: -((viewportState.y ?? 0) / (viewportState.zoom ?? 1)) + 200,
        };
  const sceneBounds = {
    x: sceneCenter.x - width / 2,
    y: sceneCenter.y - height / 2,
    width,
    height,
  };
  if (!parentId) return sceneBounds;

  const parentBounds = getNodeSceneBounds(doc, parentId);
  if (!parentBounds) {
    throw new Error(
      `Cannot place node because parent ${parentId} was not found.`,
    );
  }
  return {
    ...sceneBounds,
    x: sceneBounds.x - parentBounds.x,
    y: sceneBounds.y - parentBounds.y,
  };
}
