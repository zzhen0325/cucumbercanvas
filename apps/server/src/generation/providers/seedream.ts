import { createHash, createHmac } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import type {
  GeneratedImage,
  GeneratedVideo,
  ImageGenerateParams,
  ImageProvider,
  VideoGenerateParams,
  VideoProvider,
} from "../types.js";
import {
  GenerationError,
  aspectRatioToDimensions,
  fetchAsBase64,
} from "../utils.js";
import { normalizeSeedreamImagePrompt } from "./seedream-prompt.js";

const IMAGE_MODEL_ID = "bytedance/seedream-4.6";
const VIDEO_MODEL_ID = "bytedance/seedream-video";
const SEEDANCE_VIDEO_MODEL_ID = "bytedance/seedance-3.0-pro";
const SEEDANCE_VIDEO_REQ_KEY = "jimeng_ti2v_v30_pro";
const SEEDANCE_VIDEO_PROMPT_MAX_CHARS = 800;
const SEEDANCE_ALLOWED_ASPECT_RATIOS = [
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
  "21:9",
] as const;
const SEEDANCE_VIDEO_DIMENSIONS: Record<
  string,
  { width: number; height: number }
> = {
  "21:9": { width: 2176, height: 928 },
  "16:9": { width: 1920, height: 1088 },
  "4:3": { width: 1664, height: 1248 },
  "1:1": { width: 1440, height: 1440 },
  "3:4": { width: 1248, height: 1664 },
  "9:16": { width: 1088, height: 1920 },
};
const SEEDANCE_DURATION_TO_FRAMES = new Map([
  [5, 121],
  [10, 241],
]);

type SeedreamConfig = {
  accessKeyId: string;
  secretAccessKey: string;
  reqKey: string;
  videoReqKey?: string;
  host: string;
  region: string;
  service: string;
  version: string;
};

type SignedPostResult = {
  status: number;
  body: Record<string, unknown>;
};

class SeedreamClient {
  constructor(private readonly config: SeedreamConfig) {}

  async signedPost(
    action: "CVSync2AsyncSubmitTask" | "CVSync2AsyncGetResult",
    body: Record<string, unknown>,
  ): Promise<SignedPostResult> {
    const payload = JSON.stringify(body);
    const payloadHash = createHash("sha256").update(payload).digest("hex");
    const now = new Date();
    const xDate = formatAmzDate(now);
    const dateStamp = xDate.slice(0, 8);
    const query = new URLSearchParams({
      Action: action,
      Version: this.config.version,
    }).toString();
    const contentType = "application/json";
    const signedHeaders = "content-type;host;x-content-sha256;x-date";
    const canonicalHeaders = [
      `content-type:${contentType}`,
      `host:${this.config.host}`,
      `x-content-sha256:${payloadHash}`,
      `x-date:${xDate}`,
      "",
    ].join("\n");
    const canonicalRequest = [
      "POST",
      "/",
      query,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const credentialScope = `${dateStamp}/${this.config.region}/${this.config.service}/request`;
    const stringToSign = [
      "HMAC-SHA256",
      xDate,
      credentialScope,
      createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");
    const signature = createHmac(
      "sha256",
      signingKey(
        this.config.secretAccessKey,
        dateStamp,
        this.config.region,
        this.config.service,
      ),
    )
      .update(stringToSign)
      .digest("hex");
    const authorization = [
      `HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(", ");

    const response = await fetch(`https://${this.config.host}?${query}`, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": contentType,
        Host: this.config.host,
        "X-Content-Sha256": payloadHash,
        "X-Date": xDate,
      },
      body: payload,
    });

    const text = await response.text();
    const parsed = parseJsonObject(text);
    return { status: response.status, body: parsed };
  }

  async submitAndPoll(
    reqKey: string,
    body: Record<string, unknown>,
    options: {
      providerName?: string;
      pollReqJson?: Record<string, unknown>;
    } = {},
  ) {
    const providerName = options.providerName ?? "seedream";
    const traceId = createHash("sha256")
      .update(`${reqKey}:${JSON.stringify(body)}:${Date.now()}`)
      .digest("hex")
      .slice(0, 12);
    const tag = `[${providerName}:${traceId}]`;
    console.log(
      `${tag} submit_start`,
      JSON.stringify({
        reqKey,
        ...summarizeSeedreamBody(body),
      }),
    );
    const submit = await this.signedPost("CVSync2AsyncSubmitTask", {
      req_key: reqKey,
      ...body,
    });
    console.log(
      `${tag} submit_response`,
      JSON.stringify({
        reqKey,
        httpStatus: submit.status,
        code: submit.body.code ?? null,
        message:
          typeof submit.body.message === "string" ? submit.body.message : null,
        requestId: getRequestId(submit.body),
      }),
    );
    assertSeedreamOk(providerName, "submit", submit);

    const taskId = getNestedString(submit.body, ["data", "task_id"]);
    if (!taskId) {
      throw new GenerationError(
        providerName,
        "no_task_id",
        "Volcengine video service did not return task_id",
      );
    }
    console.log(
      `${tag} submit_ok`,
      JSON.stringify({
        reqKey,
        taskId,
        requestId: getRequestId(submit.body),
      }),
    );

    let last: Record<string, unknown> | null = null;
    for (let attempt = 1; attempt <= 30; attempt++) {
      await delay(attempt <= 10 ? 4_000 : 8_000);
      const pollBody: Record<string, unknown> = {
        req_key: reqKey,
        task_id: taskId,
      };
      if (options.pollReqJson) {
        pollBody.req_json = JSON.stringify(options.pollReqJson);
      }
      const result = await this.signedPost("CVSync2AsyncGetResult", pollBody);
      console.log(
        `${tag} poll_response`,
        JSON.stringify({
          reqKey,
          taskId,
          attempt,
          httpStatus: result.status,
          code: result.body.code ?? null,
          message:
            typeof result.body.message === "string"
              ? result.body.message
              : null,
          taskStatus: getNestedString(result.body, ["data", "status"]) ?? null,
          hasVideoUrl:
            typeof getNestedString(result.body, ["data", "video_url"]) ===
            "string",
          imageUrlCount: getNestedArray(result.body, ["data", "image_urls"])
            .length,
          videoUrlCount: getNestedArray(result.body, ["data", "video_urls"])
            .length,
          requestId: getRequestId(result.body),
        }),
      );
      assertSeedreamOk(providerName, "poll", result);
      last = result.body;

      const status = getNestedString(result.body, ["data", "status"]);
      if (status === "done") {
        console.log(
          `${tag} poll_done`,
          JSON.stringify({
            reqKey,
            taskId,
            attempt,
            imageUrlCount: getNestedArray(result.body, ["data", "image_urls"])
              .length,
            videoUrlCount: getNestedArray(result.body, ["data", "video_urls"])
              .length,
            requestId: getRequestId(result.body),
          }),
        );
        return result.body;
      }
      if (status === "not_found" || status === "expired") {
        throw new GenerationError(
          providerName,
          `task_${status}`,
          `Volcengine video task ${status}: ${taskId}`,
        );
      }
    }

    throw new GenerationError(
      providerName,
      "timeout",
      `Volcengine video task timed out: ${JSON.stringify(last)}`,
    );
  }
}

export class SeedreamImageProvider implements ImageProvider {
  readonly name = "seedream";
  readonly models = [
    {
      id: IMAGE_MODEL_ID,
      displayName: "Seedream 4.6",
      description: "即梦 Seedream 图像生成，支持文生图和参考图生成。",
    },
  ] as const;

  private readonly client: SeedreamClient;

  constructor(private readonly config: SeedreamConfig) {
    this.client = new SeedreamClient(config);
  }

  async generate(params: ImageGenerateParams): Promise<GeneratedImage> {
    const { width, height } = aspectRatioToDimensions(
      params.aspectRatio ?? "1:1",
    );
    const promptNormalization = normalizeSeedreamImagePrompt(params.prompt);
    if (!promptNormalization.prompt) {
      throw new GenerationError(
        "seedream",
        "invalid_prompt",
        "Seedream image prompt is empty after applying provider prompt constraints.",
      );
    }
    if (
      promptNormalization.truncated ||
      promptNormalization.removedSpecialSymbolCount > 0
    ) {
      console.log(
        "[seedream] image_prompt_normalized",
        JSON.stringify({
          originalLength: promptNormalization.originalLength,
          normalizedLength: promptNormalization.normalizedLength,
          truncated: promptNormalization.truncated,
          removedSpecialSymbolCount:
            promptNormalization.removedSpecialSymbolCount,
        }),
      );
    }
    const body: Record<string, unknown> = {
      prompt: promptNormalization.prompt,
      size: width * height,
      force_single: true,
    };
    if (params.inputImages?.length) {
      body.image_urls = params.inputImages;
    }

    const result = await this.client.submitAndPoll(this.config.reqKey, body);
    const urls = getNestedArray(result, ["data", "image_urls"]);
    const url = urls.find((item): item is string => typeof item === "string");
    if (!url) {
      throw new GenerationError(
        "seedream",
        "no_output",
        "Seedream returned no image URL",
      );
    }

    return { url, mimeType: "image/png", width, height };
  }
}

export class SeedreamVideoProvider implements VideoProvider {
  readonly name = "seedream-video";
  readonly models = [
    {
      id: VIDEO_MODEL_ID,
      displayName: "Seedream Video",
      description: "即梦 Seedream 视频生成。",
      capabilities: {
        textToVideo: true,
        imageToVideo: true,
        videoToVideo: false,
        audio: false,
      },
      limits: {
        maxDuration: 8,
        allowedDurations: [4, 5, 6, 8] as number[],
        maxResolution: "1080p",
        maxInputImages: 1,
      },
    },
    {
      id: SEEDANCE_VIDEO_MODEL_ID,
      displayName: "Seedance 3.0 Pro",
      description:
        "即梦同源 Seedance 视频 3.0 Pro，支持文生视频和首帧图生视频，5/10 秒 1080P 输出。",
      capabilities: {
        textToVideo: true,
        imageToVideo: true,
        videoToVideo: false,
        audio: false,
      },
      limits: {
        maxDuration: 10,
        allowedDurations: [5, 10] as number[],
        maxResolution: "1080p",
        maxInputImages: 1,
      },
    },
  ] as const;

  private readonly client: SeedreamClient;

  constructor(private readonly config: SeedreamConfig) {
    this.client = new SeedreamClient(config);
  }

  async generate(params: VideoGenerateParams): Promise<GeneratedVideo> {
    if (params.model === SEEDANCE_VIDEO_MODEL_ID) {
      return this.generateSeedanceVideo(params);
    }

    const reqKey = this.config.videoReqKey ?? this.config.reqKey;
    const { width, height } = aspectRatioToDimensions(
      params.aspectRatio ?? "16:9",
    );
    const body: Record<string, unknown> = {
      prompt: params.prompt,
      duration: params.duration ?? 5,
      resolution: params.resolution ?? "720p",
      aspect_ratio: params.aspectRatio ?? "16:9",
    };
    if (params.inputImages?.length) {
      body.image_urls = params.inputImages.slice(0, 1);
    }

    const result = await this.client.submitAndPoll(reqKey, body, {
      pollReqJson: { return_url: true },
    });
    const videoUrl =
      getNestedString(result, ["data", "video_url"]) ??
      getNestedArray(result, ["data", "video_urls"]).find(
        (item): item is string => typeof item === "string",
      );
    if (!videoUrl) {
      throw new GenerationError(
        "seedream-video",
        "no_output",
        "Seedream returned no video URL",
      );
    }

    return {
      url: videoUrl,
      mimeType: "video/mp4",
      width,
      height,
      durationSeconds: params.duration ?? 5,
    };
  }

  private async generateSeedanceVideo(
    params: VideoGenerateParams,
  ): Promise<GeneratedVideo> {
    const aspectRatio = params.aspectRatio ?? "16:9";
    if (!isSeedanceAspectRatio(aspectRatio)) {
      throw new GenerationError(
        "seedance-video",
        "invalid_aspect_ratio",
        `Seedance 3.0 Pro only supports aspect ratios: ${SEEDANCE_ALLOWED_ASPECT_RATIOS.join(", ")}`,
      );
    }

    const durationSeconds = params.duration ?? 5;
    const frames = SEEDANCE_DURATION_TO_FRAMES.get(durationSeconds);
    if (!frames) {
      throw new GenerationError(
        "seedance-video",
        "invalid_duration",
        "Seedance 3.0 Pro only supports 5s or 10s video generation.",
      );
    }

    const prompt = params.prompt.trim();
    if (!prompt && !params.inputImages?.length) {
      throw new GenerationError(
        "seedance-video",
        "invalid_input",
        "Seedance 3.0 Pro requires a prompt for text-to-video, or one first-frame image for image-to-video.",
      );
    }
    if (prompt.length > SEEDANCE_VIDEO_PROMPT_MAX_CHARS) {
      throw new GenerationError(
        "seedance-video",
        "invalid_prompt",
        `Seedance 3.0 Pro prompt must be ${SEEDANCE_VIDEO_PROMPT_MAX_CHARS} characters or fewer.`,
      );
    }
    if ((params.inputImages?.length ?? 0) > 1) {
      throw new GenerationError(
        "seedance-video",
        "invalid_input_image_count",
        "Seedance 3.0 Pro image-to-video only supports one first-frame image.",
      );
    }

    const body: Record<string, unknown> = {
      frames,
      aspect_ratio: aspectRatio,
    };
    if (prompt) {
      body.prompt = prompt;
    }

    const inputImage = params.inputImages?.[0];
    if (inputImage) {
      if (/^data:/i.test(inputImage)) {
        const encoded = await fetchAsBase64("seedance-video", inputImage);
        if (
          encoded.mimeType !== "image/jpeg" &&
          encoded.mimeType !== "image/png"
        ) {
          throw new GenerationError(
            "seedance-video",
            "invalid_input_image_type",
            "Seedance 3.0 Pro first-frame image must be JPEG or PNG.",
          );
        }
        body.binary_data_base64 = [encoded.data];
      } else if (/^https?:\/\//i.test(inputImage)) {
        body.image_urls = [inputImage];
      } else {
        throw new GenerationError(
          "seedance-video",
          "invalid_input_image_url",
          "Seedance 3.0 Pro first-frame image must be an HTTP(S) URL or a JPEG/PNG data URI.",
        );
      }
    }

    console.log(
      "[seedance-video] request_prepared",
      JSON.stringify({
        durationSeconds,
        frames,
        aspectRatio,
        hasPrompt: prompt.length > 0,
        promptLength: prompt.length,
        imageCount: inputImage ? 1 : 0,
        imageTransport: body.binary_data_base64
          ? "base64"
          : inputImage
            ? "url"
            : null,
      }),
    );

    const result = await this.client.submitAndPoll(
      SEEDANCE_VIDEO_REQ_KEY,
      body,
      { providerName: "seedance-video" },
    );
    const videoUrl = getNestedString(result, ["data", "video_url"]);
    if (!videoUrl) {
      throw new GenerationError(
        "seedance-video",
        "no_output",
        "Seedance 3.0 Pro returned no video URL",
      );
    }

    const dimensions = SEEDANCE_VIDEO_DIMENSIONS[aspectRatio];
    if (!dimensions) {
      throw new GenerationError(
        "seedance-video",
        "invalid_aspect_ratio",
        `Seedance 3.0 Pro has no output dimensions configured for aspect ratio: ${aspectRatio}`,
      );
    }
    return {
      url: videoUrl,
      mimeType: "video/mp4",
      width: dimensions.width,
      height: dimensions.height,
      durationSeconds,
    };
  }
}

function signingKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
) {
  const kDate = hmac(secretKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "request");
}

function hmac(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function formatAmzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { raw: text };
  } catch {
    return { raw: text };
  }
}

function assertSeedreamOk(
  providerName: string,
  step: string,
  result: SignedPostResult,
) {
  const code = result.body.code;
  if (result.status !== 200 || code !== 10000) {
    const message =
      typeof result.body.message === "string"
        ? result.body.message
        : JSON.stringify(result.body);
    const requestId = getRequestId(result.body);
    throw new GenerationError(
      providerName,
      "api_error",
      `Volcengine ${providerName} ${step} failed (${result.status}/${String(code)}${requestId ? ` request_id=${requestId}` : ""}): ${message}`,
    );
  }
}

function getRequestId(source: Record<string, unknown>): string | undefined {
  const requestId = source.request_id;
  return typeof requestId === "string" ? requestId : undefined;
}

function summarizeSeedreamBody(body: Record<string, unknown>) {
  const imageUrls = Array.isArray(body.image_urls) ? body.image_urls : [];
  const binaryData = Array.isArray(body.binary_data_base64)
    ? body.binary_data_base64
    : [];
  return {
    hasPrompt: typeof body.prompt === "string" && body.prompt.length > 0,
    promptLength: typeof body.prompt === "string" ? body.prompt.length : 0,
    imageCount: imageUrls.length,
    binaryImageCount: binaryData.length,
    size: typeof body.size === "number" ? body.size : null,
    forceSingle: body.force_single === true,
    duration: typeof body.duration === "number" ? body.duration : null,
    frames: typeof body.frames === "number" ? body.frames : null,
    resolution: typeof body.resolution === "string" ? body.resolution : null,
    aspectRatio:
      typeof body.aspect_ratio === "string" ? body.aspect_ratio : null,
  };
}

function isSeedanceAspectRatio(
  aspectRatio: string,
): aspectRatio is (typeof SEEDANCE_ALLOWED_ASPECT_RATIOS)[number] {
  return SEEDANCE_ALLOWED_ASPECT_RATIOS.includes(
    aspectRatio as (typeof SEEDANCE_ALLOWED_ASPECT_RATIOS)[number],
  );
}

function getNestedString(
  source: Record<string, unknown>,
  path: string[],
): string | undefined {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : undefined;
}

function getNestedArray(
  source: Record<string, unknown>,
  path: string[],
): unknown[] {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return [];
    }
    current = (current as Record<string, unknown>)[key];
  }
  return Array.isArray(current) ? current : [];
}
