import { describe, expect, it, vi } from "vitest";

import { createRunFailedEvent } from "./run-failure.js";

describe("createRunFailedEvent", () => {
  it("emits the shared run.failed shape with a client-safe message", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    try {
      const event = createRunFailedEvent({
        error: new Error("fetch failed"),
        now: () => "2026-05-25T00:00:00.000Z",
        runId: "run-test",
        source: "runtime",
      });

      expect(event).toEqual({
        error: {
          code: "run_failed",
          details: {
            errorName: "Error",
            source: "runtime",
          },
          message: "AI 服务暂时不可用，请稍后重试。",
        },
        runId: "run-test",
        timestamp: "2026-05-25T00:00:00.000Z",
        type: "run.failed",
      });
      expect(errorSpy).toHaveBeenCalled();
      expect(infoSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      infoSpy.mockRestore();
    }
  });
});
