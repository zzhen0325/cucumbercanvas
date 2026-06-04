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
import { GenerationError, aspectRatioToDimensions } from "../utils.js";
import { normalizeSeedreamImagePrompt } from "./seedream-prompt.js";

const IMAGE_MODEL_ID = "bytedance/seedream-4.6";
const VIDEO_MODEL_ID = "bytedance/seedream-video";

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

  async submitAndPoll(reqKey: string, body: Record<string, unknown>) {
    const traceId = createHash("sha256")
      .update(`${reqKey}:${JSON.stringify(body)}:${Date.now()}`)
      .digest("hex")
      .slice(0, 12);
    const tag = `[seedream:${traceId}]`;
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
    assertSeedreamOk("submit", submit);

    const taskId = getNestedString(submit.body, ["data", "task_id"]);
    if (!taskId) {
      throw new GenerationError(
        "seedream",
        "no_task_id",
        "Seedream did not return task_id",
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
      const result = await this.signedPost("CVSync2AsyncGetResult", {
        req_key: reqKey,
        task_id: taskId,
        // Downstream persistence and canvas insertion use provider URLs as the
        // runtime contract. Seedream returns base64 by default unless this flag
        // is requested on the result lookup.
        req_json: JSON.stringify({ return_url: true }),
      });
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
          imageUrlCount: getNestedArray(result.body, ["data", "image_urls"])
            .length,
          videoUrlCount: getNestedArray(result.body, ["data", "video_urls"])
            .length,
          requestId: getRequestId(result.body),
        }),
      );
      assertSeedreamOk("poll", result);
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
          "seedream",
          `task_${status}`,
          `Seedream task ${status}: ${taskId}`,
        );
      }
    }

    throw new GenerationError(
      "seedream",
      "timeout",
      `Seedream task timed out: ${JSON.stringify(last)}`,
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
  ] as const;

  private readonly client: SeedreamClient;

  constructor(private readonly config: SeedreamConfig) {
    this.client = new SeedreamClient(config);
  }

  async generate(params: VideoGenerateParams): Promise<GeneratedVideo> {
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

    const result = await this.client.submitAndPoll(reqKey, body);
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

function assertSeedreamOk(step: string, result: SignedPostResult) {
  const code = result.body.code;
  if (result.status !== 200 || code !== 10000) {
    const message =
      typeof result.body.message === "string"
        ? result.body.message
        : JSON.stringify(result.body);
    const requestId = getRequestId(result.body);
    throw new GenerationError(
      "seedream",
      resolveSeedreamErrorCode(result),
      `Seedream ${step} failed (${result.status}/${String(code)}${requestId ? ` request_id=${requestId}` : ""}): ${message}`,
    );
  }
}

function resolveSeedreamErrorCode(result: SignedPostResult): string {
  if (result.status === 400) {
    if (result.body.code === 50200) return "invalid_input";
    if (
      result.body.code === 50411 ||
      result.body.code === 50412 ||
      result.body.code === 50511 ||
      result.body.code === 50512
    ) {
      return "safety_filter";
    }
  }
  return "api_error";
}

function getRequestId(source: Record<string, unknown>): string | undefined {
  const requestId = source.request_id;
  return typeof requestId === "string" ? requestId : undefined;
}

function summarizeSeedreamBody(body: Record<string, unknown>) {
  const imageUrls = Array.isArray(body.image_urls) ? body.image_urls : [];
  return {
    hasPrompt: typeof body.prompt === "string" && body.prompt.length > 0,
    promptLength: typeof body.prompt === "string" ? body.prompt.length : 0,
    imageCount: imageUrls.length,
    size: typeof body.size === "number" ? body.size : null,
    forceSingle: body.force_single === true,
    duration: typeof body.duration === "number" ? body.duration : null,
    resolution: typeof body.resolution === "string" ? body.resolution : null,
    aspectRatio:
      typeof body.aspect_ratio === "string" ? body.aspect_ratio : null,
  };
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
