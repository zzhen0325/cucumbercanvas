import { createEmptyDocument } from "@cucumber/canvas-core";
import { describe, expect, it, vi } from "vitest";

import {
  type LiveCanvasServiceError,
  createLiveCanvasService,
} from "./live-canvas-service.js";

const user = {
  accessToken: "token",
  email: "tester@example.com",
  id: "user-1",
  userMetadata: {},
};

function createUserClient() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: "canvas-1" },
            error: null,
          }),
        }),
      }),
    }),
  };
}

describe("createLiveCanvasService", () => {
  it("returns a live document through a bound editor RPC", async () => {
    const doc = createEmptyDocument();
    const service = createLiveCanvasService({
      connectionManager: {
        rpcToCanvas: vi.fn(async () => ({ document: doc, version: 3 })),
      } as never,
      createUserClient: createUserClient as never,
    });

    await expect(service.getDocument(user, "canvas-1")).resolves.toEqual(doc);
  });

  it("returns a live document state with version through a bound editor RPC", async () => {
    const doc = createEmptyDocument();
    const service = createLiveCanvasService({
      connectionManager: {
        rpcToCanvas: vi.fn(async () => ({ document: doc, version: 7 })),
      } as never,
      createUserClient: createUserClient as never,
    });

    await expect(service.getDocumentState(user, "canvas-1")).resolves.toEqual({
      document: doc,
      version: 7,
    });
  });

  it("fails clearly when no live editor is available", async () => {
    const service = createLiveCanvasService({
      connectionManager: {
        rpcToCanvas: vi.fn(async () => {
          throw new Error("No live editor");
        }),
      } as never,
      createUserClient: createUserClient as never,
    });

    await expect(service.getDocument(user, "canvas-1")).rejects.toMatchObject({
      code: "live_canvas_unavailable",
      statusCode: 409,
    } satisfies Partial<LiveCanvasServiceError>);
  });
});
