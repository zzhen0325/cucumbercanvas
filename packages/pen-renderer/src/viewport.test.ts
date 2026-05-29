import { describe, expect, it } from "vitest";
import {
  canvasLocalToScene,
  clientDeltaToSceneDelta,
  clientToCanvasLocal,
  sceneToCanvasLocal,
  sceneToScreen,
  screenToScene,
  viewportMatrix,
  zoomToPoint,
} from "./viewport.js";

describe("viewport coordinate transforms", () => {
  const rect = {
    left: 100,
    top: 50,
  } as DOMRect;
  const viewport = { zoom: 2, panX: 30, panY: -10 };

  it("round trips client, canvas-local, and scene coordinates", () => {
    const local = clientToCanvasLocal(170, 100, rect);
    expect(local).toEqual({ x: 70, y: 50 });

    const scene = canvasLocalToScene(local.x, local.y, viewport);
    expect(scene).toEqual({ x: 20, y: 30 });

    expect(sceneToCanvasLocal(scene.x, scene.y, viewport)).toEqual(local);
    expect(screenToScene(170, 100, rect, viewport)).toEqual(scene);
    expect(sceneToScreen(scene.x, scene.y, rect, viewport)).toEqual({
      x: 170,
      y: 100,
    });
  });

  it("returns the CanvasKit viewport matrix shape", () => {
    expect(viewportMatrix(viewport)).toEqual([2, 0, 30, 0, 2, -10, 0, 0, 1]);
  });

  it("converts client deltas to scene deltas through zoom", () => {
    expect(clientDeltaToSceneDelta(20, -8, viewport)).toEqual({
      x: 10,
      y: -4,
    });
  });

  it("keeps the scene point under the cursor fixed when zooming", () => {
    const before = screenToScene(170, 100, rect, viewport);
    const zoomed = zoomToPoint(viewport, 170, 100, rect, 4);
    const after = screenToScene(170, 100, rect, zoomed);

    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(zoomed).toEqual({ zoom: 4, panX: -10, panY: -70 });
  });
});
