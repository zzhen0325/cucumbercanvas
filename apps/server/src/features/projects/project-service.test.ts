import { isCucumberCanvasDocument } from "@cucumber/canvas-core";
import { describe, expect, it, vi } from "vitest";

import { createProjectService } from "./project-service.js";

const user = {
  accessToken: "token",
  email: "tester@example.com",
  id: "user-1",
  userMetadata: {},
};

describe("createProjectService", () => {
  it("initializes new primary canvases with canonical PenDocument content", async () => {
    const update = vi.fn((_payload: unknown) => ({
      eq: async () => ({ error: null }),
    }));
    const rpc = vi.fn(async () => ({
      data: {
        canvas: {
          id: "canvas-1",
          is_primary: true,
          name: "Main Canvas",
        },
        project: {
          created_at: "2026-05-28T00:00:00.000Z",
          description: null,
          id: "project-1",
          name: "Untitled",
          slug: "untitled",
          updated_at: "2026-05-28T00:00:00.000Z",
          workspace_id: "workspace-1",
        },
      },
      error: null,
    }));

    const service = createProjectService({
      createUserClient: () =>
        ({
          from: (table: string) => {
            if (table === "workspaces") {
              return {
                select: () => ({
                  eq: () => ({
                    eq: () => ({
                      order: () => ({
                        limit: () => ({
                          maybeSingle: async () => ({
                            data: {
                              id: "workspace-1",
                              name: "Personal",
                              owner_user_id: "user-1",
                              type: "personal",
                            },
                            error: null,
                          }),
                        }),
                      }),
                    }),
                  }),
                }),
              };
            }
            if (table === "canvases") {
              return { update };
            }
            throw new Error(`Unexpected table ${table}`);
          },
          rpc,
        }) as never,
      viewerService: {
        ensureViewer: vi.fn(async () => undefined),
      } as never,
    });

    await expect(
      service.createProject(user, { name: "Untitled" }),
    ).resolves.toMatchObject({
      id: "project-1",
      primaryCanvas: { id: "canvas-1" },
    });

    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0]?.[0] as { content: unknown };
    expect(isCucumberCanvasDocument(payload.content)).toBe(true);
    expect((payload.content as { name?: string }).name).toBe("Main Canvas");
  });

  it("stores SVG thumbnails with a matching extension and content type", async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const update = vi.fn(() => ({
      eq: async () => ({ error: null }),
    }));
    const service = createProjectService({
      createUserClient: () =>
        ({
          from: () => ({
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { workspace_id: "workspace-1" },
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
      viewerService: {
        ensureViewer: vi.fn(async () => undefined),
      } as never,
    });

    await expect(
      service.saveThumbnail(
        user,
        "project-1",
        Buffer.from("<svg></svg>"),
        "image/svg+xml",
      ),
    ).resolves.toEqual({
      thumbnailUrl:
        "https://cdn.example.test/workspace-1/project-1/thumbnail.svg",
    });
    expect(upload).toHaveBeenCalledWith(
      "workspace-1/project-1/thumbnail.svg",
      expect.any(Buffer),
      { contentType: "image/svg+xml", upsert: true },
    );
  });
});
