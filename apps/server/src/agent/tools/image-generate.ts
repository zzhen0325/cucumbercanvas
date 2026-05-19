import { tool } from "langchain";
import { z } from "zod";

import { randomUUID } from "node:crypto";

import { generateImage } from "../../generation/image-generation.js";
import {
  type AvailableModel,
  getAvailableImageModels,
  resolveImageProviderName,
} from "../../generation/providers/registry.js";
import type { ImageQuality, OutputFormat } from "../../generation/types.js";
import { aspectRatioToDimensions } from "../../generation/utils.js";

const DEFAULT_MODEL = "bytedance/seedream-4.6";

/**
 * Build the zod schema dynamically from the models available in the registry.
 * Falls back to a plain string field when no providers are registered.
 */
function buildImageGenerateSchema(models: AvailableModel[]) {
  const modelIds = models.map((m) => m.id);
  const defaultModel = modelIds.includes(DEFAULT_MODEL)
    ? DEFAULT_MODEL
    : (modelIds[0] ?? DEFAULT_MODEL);

  const modelDescription = models.length
    ? `Model to use. Available:\n${models.map((m) => `- ${m.id}: ${m.displayName} — ${m.description}`).join("\n")}`
    : "Model identifier (no providers currently registered)";

  // Keep this as a string instead of z.enum. The agent sometimes emits a
  // display name like "Seedream 4.6"; strict enum parsing throws before the
  // tool body runs and turns a recoverable model-choice issue into run.failed.
  const modelField = z
    .string()
    .optional()
    .default(defaultModel)
    .describe(
      `${modelDescription}\nUse the exact model id when possible; display names are accepted and normalized by the server.`,
    );

  return z.object({
    title: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "Optional short descriptive title for the generated image. If omitted, the server derives one from the prompt.",
      ),
    prompt: z.string().min(1).describe("Detailed image generation prompt"),
    model: modelField,
    aspectRatio: z
      .string()
      .optional()
      .default("1:1")
      .describe(
        "Aspect ratio (e.g. 1:1, 16:9, 9:16, 4:3, 3:4, 4:5, 5:4, 2:3, 3:2). Provider auto-normalizes unsupported ratios to nearest match.",
      ),
    quality: z
      .string()
      .optional()
      .default("hd")
      .describe(
        "Image quality/resolution level. Accepted values: standard, hd/high, ultra/4k.",
      ),
    outputFormat: z
      .string()
      .optional()
      .describe("Output image format. Accepted values: png, jpg/jpeg, webp."),
    inputImages: z
      .array(z.string())
      .optional()
      .describe("Reference image URLs for Seedream image generation."),
    placementX: z
      .number()
      .optional()
      .describe(
        "Left edge x coordinate on canvas. Use inspect_canvas to determine position.",
      ),
    placementY: z
      .number()
      .optional()
      .describe(
        "Top edge y coordinate on canvas. Use inspect_canvas to determine position.",
      ),
    placementWidth: z
      .number()
      .optional()
      .describe(
        "Optional display width on canvas. If omitted, the server preserves the generated aspect ratio.",
      ),
    placementHeight: z
      .number()
      .optional()
      .describe(
        "Optional display height on canvas. If omitted, the server preserves the generated aspect ratio.",
      ),
  });
}

type ImageGenerateInput = {
  title?: string;
  prompt: string;
  model?: string;
  aspectRatio?: string;
  quality?: string;
  outputFormat?: string;
  inputImages?: string[];
  placementX?: number;
  placementY?: number;
  placementWidth?: number;
  placementHeight?: number;
};

type ResolvedImageGenerateInput = Omit<
  ImageGenerateInput,
  "model" | "title" | "quality" | "outputFormat"
> & {
  model: string;
  title: string;
  quality?: ImageQuality;
  outputFormat?: OutputFormat;
};

type ImageToolConfig = {
  configurable?: {
    user_attachment_map?: Record<string, string>;
  };
};

type ImageGenerateResult = {
  summary: string;
  title?: string;
  elementId?: string;
  imageUrl?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  error?: string;
  jobId?: string;
  jobType?: "image_generation";
  placement?: { x: number; y: number; width: number; height: number };
};

type Placement = { x: number; y: number; width: number; height: number };

function normalizeModelToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function resolveRequestedImageModel(
  requestedModel: string | undefined,
  models: AvailableModel[],
): { model: string; warning?: Record<string, unknown> } {
  const fallbackModel =
    models.find((m) => m.id === DEFAULT_MODEL)?.id ??
    models[0]?.id ??
    DEFAULT_MODEL;
  const requested = requestedModel?.trim();

  if (!requested) {
    return {
      model: fallbackModel,
      warning: {
        reason: "missing_model",
        fallbackModel,
      },
    };
  }

  const exact = models.find((m) => m.id === requested);
  if (exact) return { model: exact.id };

  const requestedToken = normalizeModelToken(requested);
  const aliasMatch = models.find(
    (m) =>
      normalizeModelToken(m.id) === requestedToken ||
      normalizeModelToken(m.displayName) === requestedToken,
  );
  if (aliasMatch) {
    return {
      model: aliasMatch.id,
      warning: {
        reason: "alias_model",
        requestedModel: requested,
        resolvedModel: aliasMatch.id,
      },
    };
  }

  return {
    model: fallbackModel,
    warning: {
      reason: "unknown_model",
      requestedModel: requested,
      fallbackModel,
      availableModels: models.map((m) => m.id),
    },
  };
}

function resolveImageTitle(
  requestedTitle: string | undefined,
  prompt: string,
): { title: string; warning?: Record<string, unknown> } {
  const title = requestedTitle?.trim();
  if (title) return { title: title.slice(0, 120) };

  const promptTitle = prompt.trim().replace(/\s+/g, " ").slice(0, 80);
  const fallbackTitle = promptTitle || "Generated image";
  return {
    title: fallbackTitle,
    warning: {
      reason: "missing_title",
      fallbackTitle,
    },
  };
}

function resolveImageQuality(requestedQuality: string | undefined): {
  quality: ImageQuality;
  warning?: Record<string, unknown>;
} {
  const normalized = requestedQuality?.trim().toLowerCase();
  if (!normalized || normalized === "hd") return { quality: "hd" };
  if (normalized === "standard" || normalized === "low") {
    return { quality: "standard" };
  }
  if (normalized === "high") {
    return {
      quality: "hd",
      warning: {
        reason: "quality_alias",
        requestedQuality,
        resolvedQuality: "hd",
      },
    };
  }
  if (normalized === "ultra" || normalized === "4k") {
    return { quality: "ultra" };
  }

  return {
    quality: "hd",
    warning: {
      reason: "unknown_quality",
      requestedQuality,
      fallbackQuality: "hd",
    },
  };
}

function resolveOutputFormat(requestedFormat: string | undefined): {
  outputFormat?: OutputFormat;
  warning?: Record<string, unknown>;
} {
  const normalized = requestedFormat?.trim().toLowerCase();
  if (!normalized) return {};
  if (normalized === "png" || normalized === "jpg" || normalized === "webp") {
    return { outputFormat: normalized };
  }
  if (normalized === "jpeg") {
    return {
      outputFormat: "jpg",
      warning: {
        reason: "output_format_alias",
        requestedFormat,
        resolvedFormat: "jpg",
      },
    };
  }

  return {
    warning: {
      reason: "unknown_output_format",
      requestedFormat,
      availableFormats: ["png", "jpg", "webp"],
    },
  };
}

function scalePlacementToFit(
  width: number,
  height: number,
  maxSize: number,
): { width: number; height: number } {
  if (width <= maxSize && height <= maxSize) {
    return { width, height };
  }

  const scale = Math.min(maxSize / width, maxSize / height);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

function resolvePlacementDimensions(options: {
  placementWidth?: number;
  placementHeight?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  aspectRatio?: string;
  defaultMaxSize?: number;
}): { width: number; height: number } {
  const placementWidth =
    options.placementWidth != null && options.placementWidth > 0
      ? options.placementWidth
      : undefined;
  const placementHeight =
    options.placementHeight != null && options.placementHeight > 0
      ? options.placementHeight
      : undefined;

  const sourceDimensions =
    options.sourceWidth != null &&
    options.sourceWidth > 0 &&
    options.sourceHeight != null &&
    options.sourceHeight > 0
      ? {
          width: options.sourceWidth,
          height: options.sourceHeight,
        }
      : aspectRatioToDimensions(options.aspectRatio ?? "1:1");

  if (placementWidth != null && placementHeight != null) {
    return { width: placementWidth, height: placementHeight };
  }

  if (placementWidth != null) {
    return {
      width: placementWidth,
      height: Math.round(
        placementWidth * (sourceDimensions.height / sourceDimensions.width),
      ),
    };
  }

  if (placementHeight != null) {
    return {
      width: Math.round(
        placementHeight * (sourceDimensions.width / sourceDimensions.height),
      ),
      height: placementHeight,
    };
  }

  return scalePlacementToFit(
    sourceDimensions.width,
    sourceDimensions.height,
    options.defaultMaxSize ?? 512,
  );
}

export function resolveImagePlacement(options: {
  placementX?: number;
  placementY?: number;
  placementWidth?: number;
  placementHeight?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  aspectRatio?: string;
  defaultMaxSize?: number;
}): Placement | undefined {
  if (options.placementX == null || options.placementY == null) {
    return undefined;
  }

  const { width, height } = resolvePlacementDimensions(options);
  return {
    x: options.placementX,
    y: options.placementY,
    width,
    height,
  };
}

/**
 * Optional function to persist a generated image to OSS.
 * Accepts the ephemeral URL and returns a persistent signed URL.
 */
export type PersistImageFn = (
  sourceUrl: string,
  mimeType: string,
  prompt: string,
) => Promise<string>;

/**
 * Submit an image generation job and wait for it to complete.
 * Returns the final result: signed_url on success, error on failure.
 */
export type SubmitImageJobFn = (input: {
  prompt: string;
  title: string;
  model: string;
  aspectRatio: string;
  inputImages?: string[];
  quality?: ImageQuality;
}) => Promise<{
  jobId: string;
  elementId?: string;
  imageUrl?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  error?: string;
}>;

export async function runImageGenerate(
  input: ImageGenerateInput,
  persistImage?: PersistImageFn,
  submitImageJob?: SubmitImageJobFn,
  attachmentMap?: Record<string, string>,
  availableModels: AvailableModel[] = getAvailableImageModels(),
): Promise<ImageGenerateResult> {
  const t0 = Date.now();
  const lap = (label: string, extra?: Record<string, unknown>) => {
    console.log(
      `[generate_image] ${label} +${Date.now() - t0}ms`,
      extra ? JSON.stringify(extra) : "",
    );
  };

  const modelResolution = resolveRequestedImageModel(
    input.model,
    availableModels,
  );
  const model = modelResolution.model;
  if (modelResolution.warning) {
    // TODO(model-routing): Surface normalized model-choice warnings in the UI
    // once users can choose among multiple image providers.
    lap("model_normalized", modelResolution.warning);
  }
  const titleResolution = resolveImageTitle(input.title, input.prompt);
  if (titleResolution.warning) {
    lap("title_normalized", titleResolution.warning);
  }
  const qualityResolution = resolveImageQuality(input.quality);
  if (qualityResolution.warning) {
    lap("quality_normalized", qualityResolution.warning);
  }
  const outputFormatResolution = resolveOutputFormat(input.outputFormat);
  if (outputFormatResolution.warning) {
    lap("output_format_normalized", outputFormatResolution.warning);
  }
  let request: ResolvedImageGenerateInput = {
    prompt: input.prompt,
    model,
    title: titleResolution.title,
    ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
    quality: qualityResolution.quality,
    ...(outputFormatResolution.outputFormat
      ? { outputFormat: outputFormatResolution.outputFormat }
      : {}),
    ...(input.inputImages ? { inputImages: input.inputImages } : {}),
    ...(input.placementX != null ? { placementX: input.placementX } : {}),
    ...(input.placementY != null ? { placementY: input.placementY } : {}),
    ...(input.placementWidth != null
      ? { placementWidth: input.placementWidth }
      : {}),
    ...(input.placementHeight != null
      ? { placementHeight: input.placementHeight }
      : {}),
  };

  // Resolve assetId references in inputImages to base64 data URIs
  if (request.inputImages?.length && attachmentMap) {
    request = {
      ...request,
      inputImages: request.inputImages.map((ref) => attachmentMap[ref] ?? ref),
    };
  }

  // Filter out invalid image references — only keep valid URLs.
  // Agent may pass canvas element IDs or unresolved assetIds that aren't
  // in the attachmentMap. These would cause provider input errors.
  if (request.inputImages?.length) {
    const validImages = request.inputImages.filter(
      (img) =>
        img.startsWith("http://") ||
        img.startsWith("https://") ||
        img.startsWith("data:"),
    );
    if (validImages.length !== request.inputImages.length) {
      lap("filtered_invalid_refs", {
        before: request.inputImages.length,
        after: validImages.length,
        dropped: request.inputImages.filter(
          (img) =>
            !img.startsWith("http://") &&
            !img.startsWith("https://") &&
            !img.startsWith("data:"),
        ),
      });
    }
    request =
      validImages.length > 0
        ? { ...request, inputImages: validImages }
        : { ...request, inputImages: [] };
  }

  // Job mode: submit to PGMQ and wait for worker to complete
  if (submitImageJob) {
    try {
      lap("job_submit", { model });
      const jobResult = await submitImageJob({
        prompt: request.prompt,
        title: request.title,
        model,
        aspectRatio: request.aspectRatio ?? "1:1",
        ...(request.inputImages ? { inputImages: request.inputImages } : {}),
      });

      if (jobResult.error) {
        lap("job_failed", { error: jobResult.error });
        const isTimeout = jobResult.error.includes("timed out");
        return {
          summary: isTimeout
            ? "Image is still being generated by the server. It will automatically appear on the canvas once ready - no action needed from the user."
            : `Image generation failed with model ${model}: ${jobResult.error}. Consider trying a different model or simplifying the prompt.`,
          error: jobResult.error,
          // Expose jobId so frontend can poll for late-arriving results
          // (worker may still succeed after agent poll timeout)
          jobId: jobResult.jobId,
          jobType: "image_generation" as const,
        };
      }
      lap("job_complete", { jobId: jobResult.jobId });

      const result: ImageGenerateResult = {
        summary: `Generated image (${jobResult.width ?? 0}x${jobResult.height ?? 0}) via ${model}`,
        title: request.title,
        ...(jobResult.elementId != null
          ? { elementId: jobResult.elementId }
          : {}),
        imageUrl: jobResult.imageUrl ?? "",
        mimeType: jobResult.mimeType ?? "image/png",
        ...(jobResult.width != null ? { width: jobResult.width } : {}),
        ...(jobResult.height != null ? { height: jobResult.height } : {}),
      };
      const placement = resolveImagePlacement({
        placementX: request.placementX,
        placementY: request.placementY,
        placementWidth: request.placementWidth,
        placementHeight: request.placementHeight,
        sourceWidth: jobResult.width,
        sourceHeight: jobResult.height,
        aspectRatio: request.aspectRatio,
      });
      if (placement) result.placement = placement;
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        summary: `Image generation failed with model ${model}: ${message}. Consider trying a different model or simplifying the prompt.`,
        error: message,
      };
    }
  }

  // Direct generation: resolve provider from model ID via registry
  try {
    lap("direct_generate_start", { model });
    const providerName = resolveImageProviderName(model);
    const result = await generateImage(providerName, {
      prompt: request.prompt,
      model,
      ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}),
      ...(request.quality ? { quality: request.quality } : {}),
      ...(request.outputFormat ? { outputFormat: request.outputFormat } : {}),
      ...(request.inputImages?.length
        ? { inputImages: request.inputImages }
        : {}),
    });
    lap("direct_generate_done", { width: result.width, height: result.height });

    let imageUrl = result.url;
    if (persistImage) {
      try {
        imageUrl = await persistImage(
          result.url,
          result.mimeType,
          request.prompt,
        );
        lap("persist_image_done");
      } catch {
        // Fall back to ephemeral URL if upload fails
      }
    }

    const directResult: ImageGenerateResult = {
      summary: `Generated image (${result.width}x${result.height}) via ${model}`,
      title: request.title,
      imageUrl,
      mimeType: result.mimeType,
      width: result.width,
      height: result.height,
    };
    const placement = resolveImagePlacement({
      placementX: request.placementX,
      placementY: request.placementY,
      placementWidth: request.placementWidth,
      placementHeight: request.placementHeight,
      sourceWidth: result.width,
      sourceHeight: result.height,
      aspectRatio: request.aspectRatio,
    });
    if (placement) directResult.placement = placement;
    return directResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      summary: `Image generation failed: ${message}`,
      error: message,
    };
  }
}

export function createImageGenerateTool(deps?: {
  persistImage?: PersistImageFn;
  submitImageJob?: SubmitImageJobFn;
  /** Override for testing — defaults to querying the provider registry. */
  availableModels?: AvailableModel[];
}) {
  const models = deps?.availableModels ?? getAvailableImageModels();

  const modelSummary = models.length
    ? models.map((m) => `${m.displayName} (${m.id})`).join(", ")
    : "No models available";

  return tool(
    async (input: ImageGenerateInput, config) => {
      const attachmentMap = (config as ImageToolConfig | undefined)
        ?.configurable?.user_attachment_map;
      return await runImageGenerate(
        input,
        deps?.persistImage,
        deps?.submitImageJob,
        attachmentMap,
        models,
      );
    },
    {
      name: "generate_image",
      description: `Generate an image using AI. Available models: ${modelSummary}. Returns the generated image URL.`,
      schema: buildImageGenerateSchema(models),
    },
  );
}
