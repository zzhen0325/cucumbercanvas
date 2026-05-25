import { describe, expect, it } from "vitest";

import { CanvasEventBuffer } from "./event-buffer.js";

describe("CanvasEventBuffer", () => {
  it("rejects malformed stream events before they reach SSE serialization", () => {
    const buffer = new CanvasEventBuffer();

    expect(() =>
      buffer.publish("canvas-1", {
        error: new Error("hidden"),
        runId: "run-1",
        timestamp: "2026-05-25T00:00:00.000Z",
        type: "run.failed",
      } as never),
    ).toThrow();
  });
});
