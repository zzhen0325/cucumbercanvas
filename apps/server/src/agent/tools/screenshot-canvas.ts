import type { ScreenshotResult } from "@cucumber/shared";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

import type { ConnectionManager } from "../../ws/connection-manager.js";
import type { PersistImageFn } from "./image-generate.js";

const screenshotCanvasSchema = z.object({
  mode: z
    .enum(["full", "region", "viewport"])
    .describe(
      "full: all elements; region: specific area; viewport: current user view",
    ),
  region: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional()
    .describe("Required when mode is 'region'. Defines the crop rectangle."),
  max_dimension: z
    .number()
    .default(1024)
    .describe(
      "Max width or height in pixels. 512=low, 1024=medium, 2048=high quality",
    ),
});

type ScreenshotToolConfig = {
  configurable?: {
    user_id?: unknown;
  };
};

type ScreenshotCanvasResult = ScreenshotResult & {
  actualBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export function createScreenshotCanvasTool(deps: {
  connectionManager: ConnectionManager;
  persistImage?: PersistImageFn;
  rpcTimeout?: number;
}) {
  const timeout = deps.rpcTimeout ?? 10_000;

  return new DynamicStructuredTool({
    name: "screenshot_canvas",
    description:
      "Take a visual screenshot of the canvas to inspect layout, design quality, color harmony, and spatial relationships. Use this to visually verify your changes or understand the current canvas state. Supports full canvas, specific region, or current viewport capture.",
    schema: screenshotCanvasSchema,
    func: async (input, _runManager, config): Promise<string> => {
      const userId = (config as ScreenshotToolConfig | undefined)?.configurable
        ?.user_id;

      if (typeof userId !== "string" || userId.length === 0) {
        return JSON.stringify({
          error: "no_user_context",
          message:
            "screenshot_canvas requires a user context to communicate with the browser.",
        });
      }

      try {
        const result = await deps.connectionManager.rpc<ScreenshotCanvasResult>(
          userId,
          "canvas.screenshot",
          {
            mode: input.mode,
            ...(input.region ? { region: input.region } : {}),
            max_dimension: input.max_dimension,
          },
          timeout,
        );

        // Upload screenshot to storage to get a short HTTPS URL.
        // Returning the raw data: URI (~1-2 MB base64) in the ToolMessage
        // would be serialized as text by LangChain adapters (Google Gemini,
        // OpenAI) since tool responses only support string content — this
        // causes the conversation to instantly exceed the model's token limit.
        // Pattern: same as generate_image — short URL in JSON, stream-adapter
        // extracts screenshotUrl as a frontend artifact.
        let screenshotUrl: string | undefined;
        if (deps.persistImage) {
          try {
            const mimeType = result.url.startsWith("data:image/svg+xml")
              ? "image/svg+xml"
              : "image/png";
            screenshotUrl = await deps.persistImage(
              result.url,
              mimeType,
              `canvas-screenshot-${input.mode}`,
            );
          } catch {
            // Non-fatal: fall back to text-only summary
          }
        }

        const output: Record<string, unknown> = {
          summary: `Canvas screenshot captured (${result.width}x${result.height}, mode: ${input.mode})`,
          width: result.width,
          height: result.height,
        };
        if (result.actualBounds) {
          output.actualBounds = result.actualBounds;
        }

        if (screenshotUrl) {
          output.screenshotUrl = screenshotUrl;
        }

        return JSON.stringify(output);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Screenshot failed";
        return JSON.stringify({
          error: "screenshot_failed",
          message: `Screenshot failed: ${message}`,
        });
      }
    },
  });
}
