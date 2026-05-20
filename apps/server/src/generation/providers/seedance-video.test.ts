import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SeedreamVideoProvider } from "./seedream.js";

const providerConfig = {
  accessKeyId: "ak",
  secretAccessKey: "sk",
  reqKey: "jimeng_seedream46_cvtob",
  host: "visual.volcengineapi.com",
  region: "cn-north-1",
  service: "cv",
  version: "2022-08-31",
};

describe("Seedance video provider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("submits Seedance 3.0 Pro requests with frames and first-frame base64", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      requestBodies.push(
        JSON.parse(String(init?.body)) as Record<string, unknown>,
      );
      const action = new URL(String(input)).searchParams.get("Action");

      if (action === "CVSync2AsyncSubmitTask") {
        return jsonResponse({
          code: 10000,
          data: { task_id: "task-1" },
          message: "Success",
          request_id: "submit-request",
        });
      }

      return jsonResponse({
        code: 10000,
        data: {
          status: "done",
          video_url: "https://cdn.example.com/video.mp4",
        },
        message: "Success",
        request_id: "poll-request",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new SeedreamVideoProvider(providerConfig);
    const generation = provider.generate({
      prompt: "cinematic cucumber field",
      model: "bytedance/seedance-3.0-pro",
      duration: 10,
      aspectRatio: "21:9",
      inputImages: ["data:image/png;base64,aGVsbG8="],
    });

    await vi.advanceTimersByTimeAsync(4_000);
    const result = await generation;

    expect(result).toMatchObject({
      url: "https://cdn.example.com/video.mp4",
      mimeType: "video/mp4",
      width: 2176,
      height: 928,
      durationSeconds: 10,
    });
    expect(requestBodies[0]).toMatchObject({
      req_key: "jimeng_ti2v_v30_pro",
      prompt: "cinematic cucumber field",
      frames: 241,
      aspect_ratio: "21:9",
      binary_data_base64: ["aGVsbG8="],
    });
    expect(requestBodies[0]).not.toHaveProperty("image_urls");
    expect(requestBodies[1]).toEqual({
      req_key: "jimeng_ti2v_v30_pro",
      task_id: "task-1",
    });
  });

  it("rejects unsupported Seedance durations before calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const provider = new SeedreamVideoProvider(providerConfig);

    await expect(
      provider.generate({
        prompt: "cinematic cucumber field",
        model: "bytedance/seedance-3.0-pro",
        duration: 8,
        aspectRatio: "16:9",
      }),
    ).rejects.toThrow("only supports 5s or 10s");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function jsonResponse(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
