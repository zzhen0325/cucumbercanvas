import {
  applyCanvasOperation,
  createEmptyDocument,
  findNode,
} from "@cucumber/canvas-core";
import type { PenDocument, PenNode } from "@cucumber/pen-types";
import { describe, expect, it, vi } from "vitest";

import {
  type CanvasServiceError,
  createCanvasService,
} from "./canvas-service.js";

const user = {
  accessToken: "token",
  email: "tester@example.com",
  id: "user-1",
  userMetadata: {},
};

describe("createCanvasService", () => {
  it("returns canonical canvas content from persistence", async () => {
    const content = createEmptyDocument("Main Canvas");
    const service = createCanvasService({
      createUserClient: () =>
        ({
          from: () => ({
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    content,
                    id: "canvas-1",
                    name: "Main Canvas",
                    project_id: "project-1",
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }) as never,
    });

    await expect(service.getCanvas(user, "canvas-1")).resolves.toMatchObject({
      content,
      id: "canvas-1",
      projectId: "project-1",
    });
  });

  it("fails clearly when persisted canvas content is legacy shaped", async () => {
    const service = createCanvasService({
      createUserClient: () =>
        ({
          from: () => ({
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    content: {
                      nodes: {},
                      rootNodeIds: [],
                      schemaVersion: "cucumber-canvas-v1",
                    },
                    id: "canvas-1",
                    name: "Main Canvas",
                    project_id: "project-1",
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }) as never,
    });

    await expect(service.getCanvas(user, "canvas-1")).rejects.toMatchObject({
      code: "invalid_canvas_document",
      statusCode: 500,
    } satisfies Partial<CanvasServiceError>);
  });

  it("rejects invalid canvas content before saving", async () => {
    const update = vi.fn();
    const service = createCanvasService({
      createUserClient: () =>
        ({
          from: () => ({
            update,
          }),
        }) as never,
    });

    await expect(
      service.saveCanvasContent(user, "canvas-1", {
        nodes: {},
        rootNodeIds: [],
        schemaVersion: "cucumber-canvas-v1",
      }),
    ).rejects.toMatchObject({
      code: "invalid_canvas_document",
      statusCode: 400,
    } satisfies Partial<CanvasServiceError>);
    expect(update).not.toHaveBeenCalled();
  });

  it("extracts base64 canvas assets to project storage before saving", async () => {
    const dataUrl = "data:image/png;base64,AQID";
    let doc: PenDocument = {
      ...createEmptyDocument("Main Canvas"),
      assets: {
        asset_1: {
          id: "asset_1",
          url: dataUrl,
          mimeType: "image/png",
          name: "Pasted image",
        },
      },
    };
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: {
        id: "image_1",
        type: "image",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        assetId: "asset_1",
        src: dataUrl,
      } as PenNode,
    });
    const upload = vi.fn(async () => ({ error: null }));
    const update = vi.fn((payload: { content: PenDocument }) => ({
      eq: async () => ({ error: null, payload }),
    }));
    const service = createCanvasService({
      createUserClient: () =>
        ({
          from: () => ({
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    project_id: "project-1",
                    projects: { workspace_id: "workspace-1" },
                  },
                  error: null,
                }),
              }),
            }),
            update,
          }),
          storage: {
            from: () => ({
              getPublicUrl: (path: string) => ({
                data: { publicUrl: `https://cdn.example.test/${path}` },
              }),
              upload,
            }),
          },
        }) as never,
    });

    const result = (await service.saveCanvasContent(
      user,
      "canvas-1",
      doc as never,
    )) as unknown as PenDocument;

    const expectedUrl =
      "https://cdn.example.test/workspace-1/project-1/canvas-assets/canvas-1/asset_1.png";
    expect(upload).toHaveBeenCalledWith(
      "workspace-1/project-1/canvas-assets/canvas-1/asset_1.png",
      expect.any(Buffer),
      { cacheControl: "31536000", contentType: "image/png", upsert: true },
    );
    expect(result.assets?.asset_1?.url).toBe(expectedUrl);
    expect(findNode(result, "image_1")).toMatchObject({ src: expectedUrl });
    expect(update.mock.calls[0]?.[0].content.assets?.asset_1?.url).toBe(
      expectedUrl,
    );
  });

  it("throws a typed save error when canvas asset upload fails", async () => {
    const doc: PenDocument = {
      ...createEmptyDocument("Main Canvas"),
      assets: {
        asset_1: {
          id: "asset_1",
          url: "data:image/png;base64,AQID",
          mimeType: "image/png",
        },
      },
    };
    const update = vi.fn();
    const service = createCanvasService({
      createUserClient: () =>
        ({
          from: () => ({
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    project_id: "project-1",
                    projects: { workspace_id: "workspace-1" },
                  },
                  error: null,
                }),
              }),
            }),
            update,
          }),
          storage: {
            from: () => ({
              upload: async () => ({
                error: { message: "storage is unavailable" },
              }),
            }),
          },
        }) as never,
    });

    await expect(
      service.saveCanvasContent(user, "canvas-1", doc as never),
    ).rejects.toMatchObject({
      code: "canvas_save_failed",
      statusCode: 500,
    } satisfies Partial<CanvasServiceError>);
    expect(update).not.toHaveBeenCalled();
  });
});
