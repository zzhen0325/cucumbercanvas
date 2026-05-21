// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  buildArtifactNodeText,
  buildTraceToolNodeText,
} from "../src/lib/agent-trace-projector";

describe("buildTraceToolNodeText", () => {
  it("renders running tool input into a compact canvas node summary", () => {
    const text = buildTraceToolNodeText({
      toolName: "generate_image",
      status: "running",
      input: {
        prompt: "为街边水果店生成一张横版宣传海报，强调清晨阳光和新鲜质感",
        aspectRatio: "16:9",
      },
    });

    expect(text).toContain("generate_image");
    expect(text).toContain("Status: running");
    expect(text).toContain("prompt=");
    expect(text).toContain("aspectRatio=16:9");
  });

  it("includes output summary and artifact types for completed tools", () => {
    const text = buildTraceToolNodeText({
      toolName: "generate_video",
      status: "completed",
      outputSummary: "生成完成，已返回视频结果",
      artifacts: [
        {
          type: "video",
          url: "https://example.com/demo.mp4",
          mimeType: "video/mp4",
          width: 1280,
          height: 720,
          durationSeconds: 5,
        },
      ],
    });

    expect(text).toContain("Status: completed");
    expect(text).toContain("Output: 生成完成");
    expect(text).toContain("Artifacts: video");
  });

  it("builds a compact artifact sidecar summary", () => {
    const text = buildArtifactNodeText([
      {
        type: "image",
        url: "https://example.com/1.png",
        mimeType: "image/png",
        width: 1024,
        height: 768,
        title: "水果店海报主视觉",
      },
      {
        type: "video",
        url: "https://example.com/2.mp4",
        mimeType: "video/mp4",
        width: 1280,
        height: 720,
        durationSeconds: 5,
      },
    ]);

    expect(text).toContain("Artifacts");
    expect(text).toContain("image: 水果店海报主视觉");
    expect(text).toContain("video: video");
  });
});
