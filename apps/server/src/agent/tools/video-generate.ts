import { tool } from "langchain";
import { z } from "zod";

import {
  type AvailableModel,
  getAvailableVideoModels,
  resolveVideoProviderName,
} from "../../generation/providers/registry.js";
import { generateVideo } from "../../generation/video-generation.js";

const DEFAULT_MODEL = "bytedance/seedream-video";

// ── Submit function type ───────────────────────────────────────────────────

export type SubmitVideoJobFn = (input: {
  title: string;
  prompt: string;
  model: string;
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
  inputImages?: string[];
  inputVideo?: string;
  enableAudio?: boolean;
  placementX?: number;
  placementY?: number;
  placementWidth?: number;
  placementHeight?: number;
}) => Promise<{
  jobId: string;
  elementId?: string;
  videoUrl?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  mimeType?: string;
  error?: string;
}>;

// ── Dynamic schema builder ─────────────────────────────────────────────────

function buildVideoGenerateSchema(models: AvailableModel[]) {
  const modelIds = models.map((m) => m.id);
  const defaultModel = modelIds.includes(DEFAULT_MODEL)
    ? DEFAULT_MODEL
    : (modelIds[0] ?? DEFAULT_MODEL);

  const modelDescription = models.length
    ? `Video model to use. Available:\n${models.map((m) => `- ${m.id}: ${m.description}`).join("\n")}`
    : "Model identifier (no video providers currently registered)";

  const modelField =
    modelIds.length >= 1
      ? z
          .enum(modelIds as [string, ...string[]])
          .default(defaultModel as (typeof modelIds)[number])
          .describe(modelDescription)
      : z.string().default(DEFAULT_MODEL).describe(modelDescription);

  return z.object({
    title: z
      .string()
      .min(1)
      .describe(
        "Short descriptive title for the generated video, used as metadata so the video content is understood without re-analysis (e.g. 'Autumn forest bus scene', '恐龙追逐镜头')",
      ),
    prompt: z
      .string()
      .min(1)
      .describe(
        "Detailed video generation prompt. Be specific about motion, camera angles, lighting, mood, action, and scene transitions.",
      ),
    model: modelField,
    duration: z
      .number()
      .int()
      .min(3)
      .max(16)
      .optional()
      .default(5)
      .describe(
        "Video duration in seconds. Seedream defaults to 5 seconds unless the model configuration says otherwise.",
      ),
    resolution: z
      .enum(["480p", "720p", "1080p", "4k"])
      .optional()
      .default("720p")
      .describe(
        "Output resolution. 720p is recommended for balance of quality and speed.",
      ),
    aspectRatio: z
      .enum(["1:1", "16:9", "9:16", "4:3", "3:4"])
      .optional()
      .default("16:9")
      .describe(
        "Video aspect ratio. 16:9 for landscape, 9:16 for portrait/mobile.",
      ),
    inputImages: z
      .array(z.string())
      .max(7)
      .optional()
      .describe(
        "Reference image URLs for image-to-video. First image used as first frame. Only for models with I2V capability.",
      ),
    inputVideo: z
      .string()
      .optional()
      .describe(
        "Source video URL for video-to-video editing when supported by Seedream.",
      ),
    enableAudio: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Generate synchronized audio (dialogue, sound effects, ambient). Not all models support this — ignored for models without audio capability.",
      ),
    placementX: z
      .number()
      .optional()
      .describe(
        "Canvas X coordinate for video placement. Use canvas_state, find_empty_space, batch_get, or snapshot_layout to find a good position.",
      ),
    placementY: z
      .number()
      .optional()
      .describe(
        "Canvas Y coordinate for video placement. Use canvas_state, find_empty_space, batch_get, or snapshot_layout to find a good position.",
      ),
    placementWidth: z
      .number()
      .optional()
      .describe("Width on canvas (default: 640)"),
    placementHeight: z
      .number()
      .optional()
      .describe("Height on canvas (default: 360)"),
  });
}

// ── Result type ────────────────────────────────────────────────────────────

// Infer input type from schema — includes the new `title` field
type VideoGenerateInput = z.infer<ReturnType<typeof buildVideoGenerateSchema>>;

type VideoGenerateResult = {
  summary: string;
  title?: string;
  prompt?: string;
  elementId?: string;
  videoUrl?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  placement?: { x: number; y: number; width: number; height: number };
  error?: string;
  jobId?: string;
  jobType?: "video_generation";
};

// ── Run function ───────────────────────────────────────────────────────────

export async function runVideoGenerate(
  input: VideoGenerateInput,
  submitVideoJob?: SubmitVideoJobFn,
): Promise<VideoGenerateResult> {
  const t0 = Date.now();
  const lap = (label: string, extra?: Record<string, unknown>) => {
    console.log(
      `[generate_video] ${label} +${Date.now() - t0}ms`,
      extra ? JSON.stringify(extra) : "",
    );
  };

  // Filter invalid image references
  const normalizedInput: VideoGenerateInput = (() => {
    if (!input.inputImages?.length) return input;
    const validImages = input.inputImages.filter((img) =>
      /^(https?:\/\/|data:)/i.test(img),
    );
    if (validImages.length > 0) {
      return { ...input, inputImages: validImages };
    }
    const { inputImages: _droppedInputImages, ...rest } = input;
    return rest as VideoGenerateInput;
  })();

  // Job mode: submit to PGMQ and wait for worker
  if (submitVideoJob) {
    try {
      lap("job_submit", { model: normalizedInput.model });
      const jobResult = await submitVideoJob({
        title: normalizedInput.title,
        prompt: normalizedInput.prompt,
        model: normalizedInput.model,
        duration: normalizedInput.duration,
        resolution: normalizedInput.resolution,
        aspectRatio: normalizedInput.aspectRatio,
        ...(normalizedInput.inputImages
          ? { inputImages: normalizedInput.inputImages }
          : {}),
        ...(normalizedInput.inputVideo
          ? { inputVideo: normalizedInput.inputVideo }
          : {}),
        enableAudio: normalizedInput.enableAudio,
        ...(normalizedInput.placementX != null
          ? { placementX: normalizedInput.placementX }
          : {}),
        ...(normalizedInput.placementY != null
          ? { placementY: normalizedInput.placementY }
          : {}),
        ...(normalizedInput.placementWidth != null
          ? { placementWidth: normalizedInput.placementWidth }
          : {}),
        ...(normalizedInput.placementHeight != null
          ? { placementHeight: normalizedInput.placementHeight }
          : {}),
      });

      if (jobResult.error) {
        lap("job_failed", { error: jobResult.error });
        const isTimeout = jobResult.error.includes("timed out");
        return {
          summary: isTimeout
            ? "Video is still being generated by the server. It will automatically appear on the canvas once ready — no action needed from the user."
            : `Video generation failed with model ${normalizedInput.model}: ${jobResult.error}. Consider trying a different model or simplifying the prompt.`,
          error: jobResult.error,
          // Expose jobId so frontend can poll for late-arriving results
          // (worker may still succeed after agent poll timeout)
          jobId: jobResult.jobId,
          jobType: "video_generation" as const,
        };
      }
      lap("job_complete", { jobId: jobResult.jobId });

      const result: VideoGenerateResult = {
        summary: `Generated ${jobResult.durationSeconds ?? normalizedInput.duration}s video (${jobResult.width ?? 0}x${jobResult.height ?? 0}) via ${normalizedInput.model}`,
        title: normalizedInput.title,
        prompt: normalizedInput.prompt,
        ...(jobResult.elementId != null
          ? { elementId: jobResult.elementId }
          : {}),
        mimeType: jobResult.mimeType ?? "video/mp4",
        ...(jobResult.videoUrl != null ? { videoUrl: jobResult.videoUrl } : {}),
        ...(jobResult.width != null ? { width: jobResult.width } : {}),
        ...(jobResult.height != null ? { height: jobResult.height } : {}),
        ...(jobResult.durationSeconds != null
          ? { durationSeconds: jobResult.durationSeconds }
          : {}),
      };
      if (
        normalizedInput.placementX != null &&
        normalizedInput.placementY != null
      ) {
        result.placement = {
          x: normalizedInput.placementX,
          y: normalizedInput.placementY,
          width: normalizedInput.placementWidth ?? 640,
          height: normalizedInput.placementHeight ?? 360,
        };
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        summary: `Video generation failed with model ${normalizedInput.model}: ${message}`,
        error: message,
      };
    }
  }

  // Direct mode: call provider directly
  try {
    lap("direct_generate_start", { model: normalizedInput.model });
    const providerName = resolveVideoProviderName(normalizedInput.model);
    const result = await generateVideo(providerName, {
      prompt: normalizedInput.prompt,
      model: normalizedInput.model,
      duration: normalizedInput.duration,
      aspectRatio: normalizedInput.aspectRatio,
      ...(normalizedInput.resolution
        ? {
            resolution: normalizedInput.resolution as "480p" | "720p" | "1080p",
          }
        : {}),
      ...(normalizedInput.inputImages
        ? { inputImages: normalizedInput.inputImages }
        : {}),
      ...(normalizedInput.inputVideo
        ? { inputVideo: normalizedInput.inputVideo }
        : {}),
      ...(normalizedInput.enableAudio != null
        ? { enableAudio: normalizedInput.enableAudio }
        : {}),
    });
    lap("direct_generate_done");

    const directResult: VideoGenerateResult = {
      summary: `Generated ${result.durationSeconds}s video (${result.width}x${result.height}) via ${normalizedInput.model}`,
      title: normalizedInput.title,
      prompt: normalizedInput.prompt,
      videoUrl: result.url,
      mimeType: result.mimeType,
      width: result.width,
      height: result.height,
      durationSeconds: result.durationSeconds,
    };
    if (
      normalizedInput.placementX != null &&
      normalizedInput.placementY != null
    ) {
      directResult.placement = {
        x: normalizedInput.placementX,
        y: normalizedInput.placementY,
        width: normalizedInput.placementWidth ?? 640,
        height: normalizedInput.placementHeight ?? 360,
      };
    }
    return directResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      summary: `Video generation failed: ${message}`,
      error: message,
    };
  }
}

// ── Tool factory ───────────────────────────────────────────────────────────

export function createVideoGenerateTool(deps?: {
  submitVideoJob?: SubmitVideoJobFn;
  availableModels?: AvailableModel[];
}) {
  const models = deps?.availableModels ?? getAvailableVideoModels();

  const modelSummary = models.length
    ? models.map((m) => `${m.displayName} (${m.id})`).join(", ")
    : "No video models available";

  return tool(
    async (input: VideoGenerateInput) => {
      return await runVideoGenerate(input, deps?.submitVideoJob);
    },
    {
      name: "generate_video",
      description: `Generate a video using AI. Available models: ${modelSummary}. Supports text-to-video, image-to-video, and video editing. Returns the generated video URL.`,
      schema: buildVideoGenerateSchema(models),
    },
  );
}
