import {
  type ContainerRole,
  type PenNode,
  applyCanvasOperation,
  createEmptyDocument,
  findNode,
} from "@cucumber/canvas-core";
import { describe, expect, it } from "vitest";

import { insertImageElement } from "./canvas-element-writer.js";

type CanvasContentForTest =
  | {
      elements: Record<string, unknown>[];
      appState: Record<string, unknown>;
      files?: Record<string, Record<string, unknown>>;
    }
  | ReturnType<typeof createEmptyDocument>;

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
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://cdn.example.test/${path}` },
        }),
      }),
    },
  };
}

describe("canvas-element-writer generated asset insertion", () => {
  it("rejects legacy placeholder canvases instead of resetting them", async () => {
    const client = createClient({
      elements: [],
      appState: {},
      files: {},
    });

    await expect(
      insertImageElement(client, {
        canvasId: "canvas_1",
        objectPath: "workspace/generated/job_2.png",
        width: 1024,
        height: 1024,
        mimeType: "image/png",
        title: "Clean product image",
      }),
    ).rejects.toThrow(
      "Unsupported canvas content for canvas_1: expected a Cucumber PenDocument",
    );
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
      permissions: {
        canRead: [],
        canWrite: [],
        isolationLevel: "open" as const,
      },
    } satisfies PenNode;
    let doc = createEmptyDocument();
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
      typeof createEmptyDocument
    >;
    expect(findNode(nextDoc, result.elementId)).toMatchObject({
      src: "https://cdn.example.test/workspace/generated/job_4.png",
      type: "image",
      name: "Generated hero image",
    });
    expect(Object.keys(nextDoc.assets ?? {})).toHaveLength(1);
    expect(Object.values(nextDoc.assets ?? {})[0]?.url).toBe(
      "https://cdn.example.test/workspace/generated/job_4.png",
    );
  });

  it("inserts generated images into an explicit result container", async () => {
    let doc = createEmptyDocument();
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: {
        id: "result_container",
        type: "frame",
        name: "图片结果容器",
        x: 760,
        y: -20,
        width: 600,
        height: 640,
        children: [],
      } as PenNode,
    });
    const client = createClient(doc);

    const result = await insertImageElement(
      client,
      {
        canvasId: "canvas_1",
        objectPath: "workspace/generated/job_5.png",
        width: 1024,
        height: 1024,
        mimeType: "image/png",
        targetContainerId: "result_container",
        title: "Puppy image",
      },
      { x: 44, y: 88, width: 512, height: 512 },
    );

    const nextDoc = client.state.content as ReturnType<
      typeof createEmptyDocument
    >;
    const resultContainer = findNode(nextDoc, "result_container") as
      | (PenNode & { children?: PenNode[] })
      | undefined;
    expect(resultContainer?.children?.map((node) => node.id)).toEqual([
      result.elementId,
    ]);
    expect(findNode(nextDoc, result.elementId)).toMatchObject({
      height: 512,
      src: "https://cdn.example.test/workspace/generated/job_5.png",
      type: "image",
      width: 512,
      x: 44,
      y: 88,
    });
  });

  it("fails clearly when the explicit result container is missing", async () => {
    const client = createClient(createEmptyDocument());

    await expect(
      insertImageElement(client, {
        canvasId: "canvas_1",
        objectPath: "workspace/generated/job_6.png",
        width: 1024,
        height: 1024,
        mimeType: "image/png",
        targetContainerId: "missing_result_container",
        title: "Puppy image",
      }),
    ).rejects.toThrow(
      "Target image container missing_result_container does not exist",
    );
  });
});
