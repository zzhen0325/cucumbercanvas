import {
  type CucumberCanvasDocument,
  flattenNodes,
  isCucumberCanvasDocument,
} from "@cucumber/canvas-core";

import type {
  AuthenticatedUser,
  UserSupabaseClient,
} from "../../supabase/user.js";
import type { ConnectionManager } from "../../ws/connection-manager.js";

export class LiveCanvasServiceError extends Error {
  readonly code:
    | "canvas_not_found"
    | "invalid_canvas_document"
    | "live_canvas_unavailable";
  readonly statusCode: number;

  constructor(
    code:
      | "canvas_not_found"
      | "invalid_canvas_document"
      | "live_canvas_unavailable",
    message: string,
    statusCode: number,
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type LiveCanvasService = ReturnType<typeof createLiveCanvasService>;

export function createLiveCanvasService(options: {
  connectionManager: ConnectionManager;
  createUserClient: (accessToken: string) => UserSupabaseClient;
  rpcTimeoutMs?: number;
}) {
  const rpcTimeoutMs = options.rpcTimeoutMs ?? 10_000;

  async function assertCanvasAccess(user: AuthenticatedUser, canvasId: string) {
    const client = options.createUserClient(user.accessToken);
    const { data, error } = await client
      .from("canvases")
      .select("id")
      .eq("id", canvasId)
      .maybeSingle();

    if (error || !data) {
      throw new LiveCanvasServiceError(
        "canvas_not_found",
        "Canvas not found or access denied.",
        404,
      );
    }
  }

  async function rpcToLiveEditor<T>(
    user: AuthenticatedUser,
    canvasId: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    try {
      return await options.connectionManager.rpcToCanvas<T>(
        canvasId,
        user.id,
        method,
        params,
        rpcTimeoutMs,
      );
    } catch (error) {
      console.warn("[live-canvas] live editor rpc unavailable", {
        canvasId,
        method,
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new LiveCanvasServiceError(
        "live_canvas_unavailable",
        "No live editor is open for this canvas. Open the canvas page and retry.",
        409,
      );
    }
  }

  return {
    async getDocument(
      user: AuthenticatedUser,
      canvasId: string,
    ): Promise<CucumberCanvasDocument> {
      await assertCanvasAccess(user, canvasId);
      const result = await rpcToLiveEditor<{ document?: unknown }>(
        user,
        canvasId,
        "canvas.document.get",
        {},
      );
      if (!isCucumberCanvasDocument(result.document)) {
        throw new LiveCanvasServiceError(
          "invalid_canvas_document",
          "Live editor returned an invalid Cucumber canvas document.",
          500,
        );
      }
      return result.document;
    },

    async setDocument(
      user: AuthenticatedUser,
      canvasId: string,
      document: CucumberCanvasDocument,
    ): Promise<void> {
      await assertCanvasAccess(user, canvasId);
      if (!isCucumberCanvasDocument(document)) {
        throw new LiveCanvasServiceError(
          "invalid_canvas_document",
          "Only Cucumber canvas documents can be sent to the live editor.",
          400,
        );
      }
      await rpcToLiveEditor<{ ok?: boolean }>(
        user,
        canvasId,
        "canvas.document.set",
        { document },
      );
      console.info("[live-canvas] document synced to live editor", {
        canvasId,
        nodeCount: flattenNodes(document).length,
        userId: user.id,
      });
    },
  };
}
