import { describe, expect, it } from "vitest";

import {
  buildImageGenerationGroupElements,
  markImageGenerationGroupFailed,
  replaceImageGenerationPlaceholder,
} from "./canvas-element-writer.js";

type CanvasContentForTest = {
  elements: Record<string, unknown>[];
  appState: Record<string, unknown>;
  files?: Record<string, Record<string, unknown>>;
};

function createClient(content: CanvasContentForTest) {
  const state = { content };
  const query = {
    select: () => query,
    update: (value: { content: CanvasContentForTest }) => {
      state.content = value.content;
      return query;
    },
    eq: () => query,
    single: async () => ({ data: { content: state.content }, error: null }),
  };

  return {
    state,
    from: () => query,
    storage: {
      from: () => ({
        download: async () => ({
          data: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
          error: null,
        }),
      }),
    },
  };
}

describe("canvas-element-writer image generation groups", () => {
  it("creates grouped demand, optimized prompt, image placeholder, and arrows", () => {
    const group = buildImageGenerationGroupElements([], {
      userPrompt: "生成一张黄瓜气泡水海报",
      optimizedPrompt:
        "A polished campaign key visual for a cucumber sparkling water brand, product photography, fresh green accents.",
      title: "Cucumber sparkling water",
      model: "bytedance/seedream-4.6",
      jobId: "job_1",
      runId: "run_1",
      sessionId: "session_1",
      aspectRatio: "1:1",
    });

    const containers = group.elements.filter((el) => el.type === "rectangle");
    const arrows = group.elements.filter((el) => el.type === "arrow");
    const texts = group.elements.filter((el) => el.type === "text");

    expect(containers).toHaveLength(3);
    expect(arrows).toHaveLength(2);
    expect(texts).toHaveLength(3);
    expect(group.placeholderId).toBeTruthy();
    expect(
      group.elements.every(
        (el) =>
          Array.isArray(el.groupIds) &&
          (el.groupIds as string[]).includes(group.groupId),
      ),
    ).toBe(true);
    expect(texts.some((el) => String(el.text).includes("我的需求"))).toBe(true);
    expect(
      texts.some((el) => String(el.text).includes("优化后的 Prompt")),
    ).toBe(true);
    expect(texts.some((el) => String(el.text).includes("黄瓜气泡水海报"))).toBe(
      true,
    );
    expect(
      texts.some(
        (el) =>
          String(el.text).includes("polished") &&
          String(el.text).includes("campaign"),
      ),
    ).toBe(true);
  });

  it("replaces the image placeholder in place and preserves group arrow bindings", async () => {
    const group = buildImageGenerationGroupElements([], {
      userPrompt: "生成一张图片",
      optimizedPrompt: "Generate a clean product image.",
      title: "Clean product image",
      model: "bytedance/seedream-4.6",
      jobId: "job_2",
      runId: "run_2",
      sessionId: "session_2",
      aspectRatio: "1:1",
    });
    const client = createClient({
      elements: group.elements,
      appState: {},
      files: {},
    });

    const result = await replaceImageGenerationPlaceholder(client, {
      canvasId: "canvas_1",
      placeholderId: group.placeholderId,
      groupId: group.groupId,
      objectPath: "workspace/generated/job_2.png",
      width: 1024,
      height: 1024,
      mimeType: "image/png",
      title: "Clean product image",
      prompt: "Generate a clean product image.",
      model: "bytedance/seedream-4.6",
      jobId: "job_2",
      runId: "run_2",
      sessionId: "session_2",
    });

    const elements = client.state.content.elements;
    const image = elements.find((el) => el.id === result.elementId);
    const placeholder = elements.find((el) => el.id === group.placeholderId);
    const arrows = elements.filter((el) => el.type === "arrow");

    expect(image?.type).toBe("image");
    expect(image?.groupIds).toContain(group.groupId);
    expect(placeholder?.isDeleted).toBe(true);
    expect(Object.keys(client.state.content.files ?? {})).toHaveLength(1);
    expect(
      arrows.some(
        (el) =>
          (el.endBinding as { elementId?: string } | null)?.elementId ===
          result.elementId,
      ),
    ).toBe(true);
  });

  it("marks the image placeholder as failed with a concrete error message", async () => {
    const group = buildImageGenerationGroupElements([], {
      userPrompt: "生成一张图片",
      optimizedPrompt: "Generate a clean product image.",
      title: "Clean product image",
      model: "bytedance/seedream-4.6",
      jobId: "job_3",
      runId: "run_3",
      sessionId: "session_3",
      aspectRatio: "1:1",
    });
    const client = createClient({
      elements: group.elements,
      appState: {},
    });

    await markImageGenerationGroupFailed(client, {
      canvasId: "canvas_1",
      placeholderId: group.placeholderId,
      groupId: group.groupId,
      errorMessage: "Provider rejected the prompt because it was empty.",
    });

    const placeholder = client.state.content.elements.find(
      (el) => el.id === group.placeholderId,
    );
    const message = client.state.content.elements.find(
      (el) => el.containerId === group.placeholderId,
    );

    expect((placeholder?.customData as { status?: string })?.status).toBe(
      "error",
    );
    expect(String(message?.text)).toContain("Provider rejected the prompt");
    expect(String(message?.text)).not.toMatch(/null|undefined/);
  });

  it("applies dark mode palette for demand and prompt elements when isDark is true", () => {
    const group = buildImageGenerationGroupElements([], {
      userPrompt: "生成一张图片",
      optimizedPrompt: "Generate a clean product image.",
      title: "Clean product image",
      model: "bytedance/seedream-4.6",
      jobId: "job_4",
      runId: "run_4",
      sessionId: "session_4",
      aspectRatio: "1:1",
      isDark: true,
    });

    const rectangles = group.elements.filter((el) => el.type === "rectangle");
    const texts = group.elements.filter((el) => el.type === "text");

    expect(rectangles).toHaveLength(3);

    // demand container
    const demandContainer = rectangles.find(
      (el) => el.strokeColor === "#1E293B",
    );
    expect(demandContainer).toBeTruthy();
    expect(demandContainer?.backgroundColor).toBe("#0F172A");

    // prompt container
    const promptContainer = rectangles.find(
      (el) => el.strokeColor === "#0D9488",
    );
    expect(promptContainer).toBeTruthy();
    expect(promptContainer?.backgroundColor).toBe("#042F2E");

    // prompt text strokeColor
    const promptText = texts.find((el) => el.strokeColor === "#2DD4BF");
    expect(promptText).toBeTruthy();
  });
});
