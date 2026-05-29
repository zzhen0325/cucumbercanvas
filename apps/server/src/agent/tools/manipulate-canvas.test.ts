import {
  type ContainerRole,
  type PenNode,
  applyCanvasOperation,
  createEmptyDocument,
  createNodeId,
  findNode,
  isCucumberCanvasDocument,
} from "@cucumber/canvas-core";
import { describe, expect, it } from "vitest";

import type { UserSupabaseClient } from "../../supabase/user.js";
import { createManipulateCanvasTool } from "./manipulate-canvas.js";

function createContainer(id: string): PenNode {
  return {
    id,
    type: "frame",
    name: "Agent Host",
    x: 0,
    y: 0,
    width: 420,
    height: 280,
    containerRole: ["visual", "task", "context"] as ContainerRole[],
    children: [] as PenNode[],
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
  } satisfies PenNode;
}

function createClient(content: unknown) {
  const state = { content };

  return {
    state,
    liveCanvasService: {
      getDocument: async () => state.content,
      setDocument: async (_user: unknown, _canvasId: string, doc: unknown) => {
        state.content = doc;
      },
    },
  };
}

describe("createManipulateCanvasTool", () => {
  it("writes add_text operations into the new Cucumber canvas document", async () => {
    let doc = createEmptyDocument();
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: createContainer("container_1"),
    });

    const client = createClient(doc);
    const tool = createManipulateCanvasTool({
      createUserClient: () => ({}) as UserSupabaseClient,
      liveCanvasService: client.liveCanvasService as never,
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
    const createdTextId = result.createdIds?.op_0;
    expect(createdTextId).toBeTruthy();
    if (!createdTextId) throw new Error("Expected add_text to create a node");
    expect(isCucumberCanvasDocument(client.state.content)).toBe(true);

    const nextDoc = client.state.content as ReturnType<
      typeof createEmptyDocument
    >;
    const textNode = findNode(nextDoc, createdTextId);
    expect(textNode).toBeTruthy();
    expect(textNode).toMatchObject({
      type: "text",
      content: "生成标题",
    });
  });

  it("creates a container and lets later operations reference it by op id", async () => {
    const client = createClient(createEmptyDocument());
    const tool = createManipulateCanvasTool({
      createUserClient: () => ({}) as UserSupabaseClient,
      liveCanvasService: client.liveCanvasService as never,
    });

    const raw = await tool.invoke(
      {
        operations: [
          {
            action: "add_container",
            title: "方案 A",
            x: 100,
            y: 120,
            width: 500,
            height: 320,
          },
          {
            action: "add_text",
            container_id: "op_0",
            text: "关键视觉方向",
          },
        ],
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
    expect(result.applied).toBe(2);
    const containerId = result.createdIds?.op_0;
    const textId = result.createdIds?.op_1;
    expect(containerId).toBeTruthy();
    expect(textId).toBeTruthy();
    if (!containerId || !textId) {
      throw new Error("Expected add_container and add_text to create nodes");
    }

    const nextDoc = client.state.content as ReturnType<
      typeof createEmptyDocument
    >;
    const containerNode = findNode(nextDoc, containerId);
    expect(containerNode).toBeTruthy();
    expect(containerNode).toMatchObject({
      type: "frame",
      name: "方案 A",
    });
    const textNode = findNode(nextDoc, textId);
    expect(textNode).toBeTruthy();
    expect(textNode).toMatchObject({
      type: "text",
      content: "关键视觉方向",
    });
  });
});
