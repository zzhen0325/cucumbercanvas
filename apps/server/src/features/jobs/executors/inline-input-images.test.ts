import { describe, expect, it } from "vitest";

import {
  decodeDataUri,
  persistInlineInputImages,
} from "./inline-input-images.js";

describe("persistInlineInputImages", () => {
  it("uploads data URIs and preserves existing URLs", async () => {
    const uploads: Array<{ contentType: string; path: string; size: number }> = [];
    const admin = {
      storage: {
        from: () => ({
          getPublicUrl: (path: string) => ({
            data: { publicUrl: `https://cdn.example.com/${path}` },
          }),
          upload: async (
            path: string,
            data: Buffer,
            options: { contentType: string; upsert: boolean },
          ) => {
            uploads.push({
              contentType: options.contentType,
              path,
              size: data.length,
            });
            return { error: null };
          },
        }),
      },
    };

    const results = await persistInlineInputImages({
      admin,
      inputImages: [
        "data:image/png;base64,aGVsbG8=",
        "https://example.com/reference.png",
      ],
      jobId: "job_123",
      workspaceId: "workspace_456",
    });

    expect(results).toHaveLength(2);
    expect(results?.[0]).toMatch(
      /^https:\/\/cdn\.example\.com\/workspace_456\/generated\//,
    );
    expect(results?.[1]).toBe("https://example.com/reference.png");
    expect(uploads).toEqual([
      expect.objectContaining({
        contentType: "image/png",
        path: expect.stringContaining("workspace_456/generated/"),
        size: 5,
      }),
    ]);
  });
});

describe("decodeDataUri", () => {
  it("throws on malformed input", () => {
    expect(() => decodeDataUri("not-a-data-uri")).toThrow(
      "Invalid data URI",
    );
  });
});
