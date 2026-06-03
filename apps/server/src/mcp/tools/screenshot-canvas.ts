import type { PersistImageFn } from "../../agent/tools/image-generate.js";
import { createScreenshotCanvasTool } from "../../agent/tools/screenshot-canvas.js";
import type { ConnectionManager } from "../../ws/connection-manager.js";
import type { CucumberMcpTool } from "../types.js";
import { wrapLegacyStructuredToolAsMcpTool } from "./legacy-tool-wrapper.js";

export function createScreenshotCanvasMcpTool(deps: {
  connectionManager?: ConnectionManager;
  persistImage?: PersistImageFn;
}): CucumberMcpTool {
  if (!deps.connectionManager) {
    return {
      name: "screenshot_canvas",
      description:
        "Take a visual screenshot of the current live Cucumber canvas for visual verification or evidence. This is not the structured canvas reader. Requires a live browser connection.",
      schema: {} as never,
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["full", "region", "viewport"] },
          region: { type: "object" },
          max_dimension: { type: "number" },
        },
      },
      execute: async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "live_canvas_unavailable",
              message:
                "screenshot_canvas requires a browser connection manager. Open the canvas page and retry.",
            }),
          },
        ],
        structuredContent: {
          error: "live_canvas_unavailable",
          message:
            "screenshot_canvas requires a browser connection manager. Open the canvas page and retry.",
        },
        isError: true,
      }),
    };
  }
  return wrapLegacyStructuredToolAsMcpTool(
    createScreenshotCanvasTool({
      connectionManager: deps.connectionManager,
      ...(deps.persistImage ? { persistImage: deps.persistImage } : {}),
    }),
  );
}
