import {
  type ContainerRole,
  type PenNode,
  applyCanvasOperation,
  createEmptyCanvasDocument,
  findNode,
  isCucumberCanvasDocument,
} from "@cucumber/canvas-core";
import { describe, expect, it } from "vitest";

import {
  buildImageGenerationGroupElements,
  insertImageElement,
  markImageGenerationGroupFailed,
  replaceImageGenerationPlaceholder,
} from "./canvas-element-writer.js";

type CanvasContentForTest =
  | {
      elements: Record<string, unknown>[];
      appState: Record<string, unknown>;
      files?: Record<string, Record<string, unknown>>;
    }
  | ReturnType<typeof createEmptyCanvasDocument>;

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

  it("resets legacy placeholder canvases and inserts a Cucumber image node", async () => {
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

    const nextDoc = client.state.content as ReturnType<
      typeof createEmptyCanvasDocument
    >;
    expect(isCucumberCanvasDocument(nextDoc)).toBe(true);
    expect(findNode(nextDoc, result.elementId)).toMatchObject({
      type: "image",
      name: "Clean product image",
    });
    expect(Object.keys(nextDoc.assets ?? {})).toHaveLength(1);
  });

  it("logs generation failure without writing legacy placeholder state", async () => {
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

    expect(client.state.content).toMatchObject({
      elements: group.elements,
      appState: {},
    });
  });

  it("inserts generated images into the new Cucumber canvas document", async () => {
    const container = {
      id: "container_1",
      type: "frame" as const,
      name: "Agent Host",
      x: 0,
      y: 0,
      width: 420,
      height: 280,
      containerRole: ["visual", "task", "context"] as ContainerRole[],
      children: [] as PenNode[],
      contextSlots: {},
      inheritPolicy: "merge" as const,
      agentBinding: {
        agentId: "designer-agent",
        permissions: ["read", "write"] as ("read" | "write" | "spawn")[],
      },
      permissions: { canRead: [], canWrite: [], isolationLevel: "open" as const },
    } satisfies PenNode;
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
    expect(findNode(nextDoc, result.elementId)).toMatchObject({
      type: "image",
      name: "Generated hero image",
    });
    expect(Object.keys(nextDoc.assets ?? {})).toHaveLength(1);
  });
});
