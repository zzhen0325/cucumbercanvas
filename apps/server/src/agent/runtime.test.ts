import { describe, expect, it } from "vitest";

import { buildUserMessage } from "./runtime.js";

describe("buildUserMessage", () => {
  it("injects selected canvas context xml for text, image, and video refs", () => {
    const result = buildUserMessage(
      "继续完善这个方案",
      [
        {
          assetId: "asset-1",
          url: "https://example.com/ref.png",
          mimeType: "image/png",
          name: "Reference image",
        },
      ],
      [
        {
          kind: "text",
          elementId: "text-1",
          text: "主标题：Fresh Market",
          x: 80,
          y: 120,
          width: 320,
          height: 64,
        },
        {
          kind: "image",
          elementId: "image-1",
          assetId: "asset-1",
          storageUrl: "https://example.com/ref.png",
          mimeType: "image/png",
          title: "Storefront reference",
          x: 480,
          y: 120,
          width: 640,
          height: 360,
        },
        {
          kind: "video",
          elementId: "video-1",
          url: "https://example.com/ref.mp4",
          mimeType: "video/mp4",
          durationSeconds: 5,
          x: 80,
          y: 360,
          width: 640,
          height: 360,
        },
      ],
      undefined,
      [],
      undefined,
      "<canvas_summary />",
    );

    expect(result.text).toContain("<selected_canvas_context count=\"3\">");
    expect(result.text).toContain("<text index=\"1\" element_id=\"text-1\"");
    expect(result.text).toContain("主标题：Fresh Market");
    expect(result.text).toContain(
      "<image index=\"2\" element_id=\"image-1\"",
    );
    expect(result.text).toContain("asset_id=\"asset-1\"");
    expect(result.text).toContain(
      "<video index=\"3\" element_id=\"video-1\" x=\"80\" y=\"360\" width=\"640\" height=\"360\" url=\"https://example.com/ref.mp4\"",
    );
  });
});
