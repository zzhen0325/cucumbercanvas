import { createEmptyDocument } from "@cucumber/canvas-core";
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
});
