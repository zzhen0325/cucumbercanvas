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

    expect(result.text).toContain('<selected_canvas_context count="3">');
    expect(result.text).toContain('<text index="1" element_id="text-1"');
    expect(result.text).toContain("主标题：Fresh Market");
    expect(result.text).toContain('<image index="2" element_id="image-1"');
    expect(result.text).toContain('asset_id="asset-1"');
    expect(result.text).toContain(
      '<video index="3" element_id="video-1" x="80" y="360" width="640" height="360" url="https://example.com/ref.mp4"',
    );
  });

  it("injects accepted task plans for execute_plan runs", () => {
    const result = buildUserMessage(
      "执行这个计划",
      [],
      [],
      undefined,
      [],
      undefined,
      null,
      "execute_plan",
      {
        planId: "plan_123",
        title: "Campaign refresh",
        steps: [
          {
            stepId: "step_1",
            title: "Create hero concept",
            status: "pending",
          },
        ],
      },
    );

    expect(result.text).toContain('<accepted_task_plan plan_id="plan_123"');
    expect(result.text).toContain('<step index="1" step_id="step_1"');
    expect(result.text).toContain("execute_plan");
  });

  it("injects structured canvas agent context without inline image data", () => {
    const result = buildUserMessage(
      "调整这里和旁边的图片",
      [],
      [],
      undefined,
      [],
      undefined,
      null,
      "direct",
      undefined,
      {
        viewport: { x: 100, y: 200, zoom: 1.5, width: 960, height: 540 },
        selectedCards: [
          {
            kind: "text",
            elementId: "text-1",
            text: "Hero copy",
            x: 120,
            y: 220,
            width: 240,
            height: 60,
          },
        ],
        nearbyCards: [
          {
            kind: "image",
            elementId: "image-1",
            dataUrl: "data:image/png;base64,very-large-inline-payload",
            storageUrl: "https://example.com/ref.png",
            x: 420,
            y: 220,
            width: 320,
            height: 180,
          },
        ],
        canvasSummary: "Canvas has 2 visible elements.",
        cardRelations: [
          {
            type: "arrow",
            sourceId: "text-1",
            targetId: "image-1",
            ids: ["arrow-1"],
          },
        ],
      },
    );

    expect(result.text).toContain('<canvas_agent_context format="json">');
    expect(result.text).toContain('"viewport"');
    expect(result.text).toContain('"nearbyCards"');
    expect(result.text).toContain('"cardRelations"');
    expect(result.text).toContain("https://example.com/ref.png");
    expect(result.text).not.toContain("very-large-inline-payload");
  });
});
