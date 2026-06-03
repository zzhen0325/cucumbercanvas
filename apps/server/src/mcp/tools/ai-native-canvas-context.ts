import {
  type CucumberCanvasDocument,
  isCucumberCanvasDocument,
} from "@cucumber/canvas-core";

import type { LiveCanvasService } from "../../features/canvas/live-canvas-service.js";
import type { CanvasEventBuffer } from "../../ws/event-buffer.js";
import type { McpToolCallResult, McpToolContext } from "../types.js";

export type AiNativeCanvasToolDeps = {
  eventBuffer?: CanvasEventBuffer;
  liveCanvasService?: LiveCanvasService;
};

export type RuntimeCanvasDocument = CucumberCanvasDocument & {
  selection?: string[];
};

export type AiNativeCanvasLiveContext = {
  canvasId: string;
  doc: RuntimeCanvasDocument;
  user: {
    accessToken: string;
    email: string;
    id: string;
    userMetadata: Record<string, unknown>;
  };
};

export type AiNativeCanvasLiveState = AiNativeCanvasLiveContext & {
  version: number;
};

export async function readAiNativeCanvasLiveContext(
  deps: AiNativeCanvasToolDeps,
  context: McpToolContext,
  toolName: string,
): Promise<AiNativeCanvasLiveContext> {
  const live = await readAiNativeCanvasLiveState(deps, context, toolName);
  return { canvasId: live.canvasId, doc: live.doc, user: live.user };
}

export async function readAiNativeCanvasLiveState(
  deps: AiNativeCanvasToolDeps,
  context: McpToolContext,
  toolName: string,
): Promise<AiNativeCanvasLiveState> {
  const canvasId = context.configurable?.canvas_id;
  const accessToken = context.configurable?.access_token;
  const userId = context.configurable?.user_id;

  if (
    typeof canvasId !== "string" ||
    typeof accessToken !== "string" ||
    typeof userId !== "string" ||
    canvasId.trim().length === 0 ||
    accessToken.trim().length === 0 ||
    userId.trim().length === 0
  ) {
    throw new Error(
      `${toolName} requires canvas_id, access_token, and user_id in runtime context.`,
    );
  }

  if (!deps.liveCanvasService) {
    throw new Error(
      `${toolName} requires an open live editor. Open the canvas page and retry.`,
    );
  }

  const user = {
    accessToken,
    email: "",
    id: userId,
    userMetadata: {},
  };
  const liveCanvasService = deps.liveCanvasService as LiveCanvasService & {
    getDocumentState?: LiveCanvasService["getDocumentState"];
  };
  const state =
    typeof liveCanvasService.getDocumentState === "function"
      ? await liveCanvasService.getDocumentState(user, canvasId)
      : {
          document: await liveCanvasService.getDocument(user, canvasId),
          version: 0,
        };
  const doc = state.document;
  if (!isCucumberCanvasDocument(doc)) {
    throw new Error(
      `Unsupported canvas document: expected PenDocument.pages with a valid activePageId. Legacy root children are not supported by ${toolName}.`,
    );
  }
  return {
    canvasId,
    doc: doc as RuntimeCanvasDocument,
    user,
    version: state.version,
  };
}

export function jsonResult(
  payload: Record<string, unknown>,
): McpToolCallResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: false,
  };
}

export function errorResult(payload: {
  error: string;
  message: string;
}): McpToolCallResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: true,
  };
}

export function compactRecord<T extends Record<string, unknown>>(
  record: T,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}
