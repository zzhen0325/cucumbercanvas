import { describe, expect, it } from "vitest";
import {
  type ContainerNode,
  applyCanvasOperation,
  createCanvasNodeId,
  createEmptyCanvasDocument,
  isCucumberCanvasDocument,
} from "@cucumber/canvas-core";

import { createManipulateCanvasTool } from "./manipulate-canvas.js";

function createContainer(id: string): ContainerNode {
  return {
    id,
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
      name: "Designer Agent",
      permissions: ["read", "write"],
    },
    permissions: {
      owner: "user-1",
      canRead: [],
      canWrite: [],
      isolationLevel: "open",
    },
  };
}

function createClient(content: unknown) {
  const state = { content };
  const query = {
    select: () => query,
    update: (value: { content: unknown }) => {
      state.content = value.content;
      return query;
    },
    eq: () => query,
    single: async () => ({ data: { content: state.content }, error: null }),
  };

  return {
    state,
    from: () => query,
  };
}

describe("createManipulateCanvasTool", () => {
  it("writes add_text operations into the new Cucumber canvas document", async () => {
    let doc = createEmptyCanvasDocument();
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: createContainer("container_1"),
    });

    const client = createClient(doc);
    const tool = createManipulateCanvasTool({
      createUserClient: () => client,
    });

    const raw = await tool.invoke(
      {
        operations: [{ action: "add_text", text: "生成标题" }],
      },
      {
        configurable: {
          access_token: "token",
          canvas_id: "canvas_1",
          user_id: "user-1",
        },
      },
    );

    const result = JSON.parse(raw as string) as {
      applied: number;
      createdIds?: Record<string, string>;
    };
    expect(result.applied).toBe(1);
    expect(result.createdIds?.op_0).toBeTruthy();
    expect(isCucumberCanvasDocument(client.state.content)).toBe(true);

    const nextDoc = client.state.content as ReturnType<
      typeof createEmptyCanvasDocument
    >;
    expect(nextDoc.nodes[result.createdIds!.op_0!]).toMatchObject({
      type: "text",
      parentId: "container_1",
      text: "生成标题",
    });
  });

  it("blocks moving a node outside its bound container on the new runtime", async () => {
    let doc = createEmptyCanvasDocument();
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: createContainer("container_1"),
    });
    const textId = createCanvasNodeId("text");
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      containerId: "container_1",
      node: {
        id: textId,
        type: "text",
        parentId: "container_1",
        bounds: { x: 24, y: 32, width: 160, height: 60 },
        text: "原始标题",
        fontSize: 28,
        color: "#111827",
      },
    });

    const client = createClient(doc);
    const tool = createManipulateCanvasTool({
      createUserClient: () => client,
    });

    const raw = await tool.invoke(
      {
        operations: [{ action: "move", element_id: textId, x: 380, y: 240 }],
      },
      {
        configurable: {
          access_token: "token",
          canvas_id: "canvas_1",
          user_id: "user-1",
        },
      },
    );

    const result = JSON.parse(raw as string) as {
      applied: number;
      errors?: string[];
    };
    expect(result.applied).toBe(0);
    expect(result.errors?.[0]).toContain("cannot write outside container");

    const nextDoc = client.state.content as ReturnType<
      typeof createEmptyCanvasDocument
    >;
    expect(nextDoc.nodes[textId]).toMatchObject({
      bounds: { x: 24, y: 32, width: 160, height: 60 },
    });
  });
});
