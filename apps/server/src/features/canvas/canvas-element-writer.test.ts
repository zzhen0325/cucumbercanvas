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
        download: async () => ({
          data: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
          error: null,
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
      type: "image",
      name: "Generated hero image",
    });
    expect(Object.keys(nextDoc.assets ?? {})).toHaveLength(1);
  });
});
