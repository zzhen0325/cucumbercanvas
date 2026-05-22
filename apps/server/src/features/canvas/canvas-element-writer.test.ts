import { describe, expect, it } from "vitest";
import {
  type ContainerNode,
  applyCanvasOperation,
  createEmptyCanvasDocument,
} from "@cucumber/canvas-core";

import {
  buildImageGenerationGroupElements,
  insertImageElement,
  markImageGenerationGroupFailed,
  replaceImageGenerationPlaceholder,
} from "./canvas-element-writer.js";

type CanvasContentForTest = {
  elements: Record<string, unknown>[];
  appState: Record<string, unknown>;
  files?: Record<string, Record<string, unknown>>;
} | ReturnType<typeof createEmptyCanvasDocument>;

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

    const legacyContent = client.state.content as {
      elements: Record<string, unknown>[];
      files?: Record<string, Record<string, unknown>>;
    };
    const elements = legacyContent.elements;
    const image = elements.find((el) => el.id === result.elementId);
    const placeholder = elements.find((el) => el.id === group.placeholderId);
    const arrows = elements.filter((el) => el.type === "arrow");

    expect(image?.type).toBe("image");
    expect(image?.groupIds).toContain(group.groupId);
    expect(placeholder?.isDeleted).toBe(true);
    expect(Object.keys(legacyContent.files ?? {})).toHaveLength(1);
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

    const legacyContent = client.state.content as {
      elements: Record<string, unknown>[];
    };
    const placeholder = legacyContent.elements.find(
      (el) => el.id === group.placeholderId,
    );
    const message = legacyContent.elements.find(
      (el) => el.containerId === group.placeholderId,
    );

    expect((placeholder?.customData as { status?: string })?.status).toBe(
      "error",
    );
    expect(String(message?.text)).toContain("Provider rejected the prompt");
    expect(String(message?.text)).not.toMatch(/null|undefined/);
  });

  it("inserts generated images into the new Cucumber canvas document", async () => {
    const container: ContainerNode = {
      id: "container_1",
      type: "container",
      parentId: null,
      title: "Agent Host",
      bounds: { x: 0, y: 0, width: 420, height: 280 },
      role: ["visual", "task", "context"],
      childrenOrder: [],
      contextSlots: {},
      inheritPolicy: "merge",
      agentBinding: {
        agentId: "designer-agent",
        permissions: ["read", "write"],
      },
      permissions: { canRead: [], canWrite: [], isolationLevel: "open" },
    };
    let doc = createEmptyCanvasDocument();
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: container,
    });
    const client = createClient(doc);

    const result = await insertImageElement(client, {
      canvasId: "canvas_1",
      objectPath: "workspace/generated/job_4.png",
      width: 1024,
      height: 768,
      mimeType: "image/png",
      title: "Generated hero image",
    });

    const nextDoc = client.state.content as ReturnType<
      typeof createEmptyCanvasDocument
    >;
    expect(nextDoc.nodes[result.elementId]).toMatchObject({
      type: "image",
      parentId: "container_1",
      title: "Generated hero image",
    });
    expect(Object.keys(nextDoc.assets)).toHaveLength(1);
  });
});
