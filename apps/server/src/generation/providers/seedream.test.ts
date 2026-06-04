import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:timers/promises", () => ({
  setTimeout: vi.fn(async () => undefined),
}));

import { SeedreamImageProvider } from "./seedream.js";

const config = {
  accessKeyId: "test-ak",
  secretAccessKey: "test-sk",
  reqKey: "jimeng_seedream46_cvtob",
  host: "visual.volcengineapi.com",
  region: "cn-north-1",
  service: "cv",
  version: "2022-08-31",
};

describe("SeedreamImageProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("queries image tasks with only the required task lookup fields", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      requests.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });

      if (requests.length === 1) {
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
          image_urls: ["https://example.com/generated.png"],
        },
        message: "Success",
        request_id: "poll-request",
      });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new SeedreamImageProvider(config).generate({
        prompt: "A playful puppy illustration",
        model: "bytedance/seedream-4.6",
      }),
    ).resolves.toMatchObject({
      url: "https://example.com/generated.png",
      width: 1024,
      height: 1024,
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toContain("Action=CVSync2AsyncSubmitTask");
    expect(requests[0]?.body).toMatchObject({
      force_single: true,
      prompt: "A playful puppy illustration",
      req_key: "jimeng_seedream46_cvtob",
      size: 1048576,
    });
    expect(requests[1]?.url).toContain("Action=CVSync2AsyncGetResult");
    expect(requests[1]?.body).toEqual({
      req_key: "jimeng_seedream46_cvtob",
      task_id: "task-1",
    });
  });

  it("classifies Seedream parameter errors as non-retryable invalid input", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          code: 10000,
          data: { task_id: "task-1" },
          message: "Success",
          request_id: "submit-request",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            code: 50200,
            message:
              'Invalid Input Parameters: [{"gateway_msg":"Invalid Param,req_key=[jimeng_seedream46_cvtob] not supported"}]',
            request_id: "poll-request",
          },
          { status: 400 },
        ),
      ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new SeedreamImageProvider(config).generate({
        prompt: "A playful puppy illustration",
        model: "bytedance/seedream-4.6",
      }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      message: expect.stringContaining("request_id=poll-request"),
      provider: "seedream",
    });
  });
});

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
    ...init,
  });
}
