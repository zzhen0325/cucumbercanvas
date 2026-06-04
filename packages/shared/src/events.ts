import { z } from "zod";

import {
  agentStageEventSchema,
  runContextEventSchema,
} from "./agent-orchestration.js";
import { toolArtifactSchema } from "./artifacts.js";
import {
  conversationIdSchema,
  messageIdSchema,
  runIdSchema,
  sessionIdSchema,
  timestampSchema,
  toolCallIdSchema,
} from "./contracts.js";
import { cucumberErrorSchema } from "./errors.js";
import { canvasPatchOperationSchema } from "./ws-protocol.js";

export {
  imageArtifactSchema,
  videoArtifactSchema,
  placementSchema,
  toolArtifactSchema,
} from "./artifacts.js";
export type {
  ImageArtifact,
  VideoArtifact,
  Placement,
  ToolArtifact,
} from "./artifacts.js";

export const runStartedEventSchema = z.object({
  type: z.literal("run.started"),
  runId: runIdSchema,
  sessionId: sessionIdSchema,
  conversationId: conversationIdSchema,
  timestamp: timestampSchema,
});

export const messageDeltaEventSchema = z.object({
  type: z.literal("message.delta"),
  runId: runIdSchema,
  messageId: messageIdSchema,
  delta: z.string(),
  timestamp: timestampSchema,
});

export const toolStartedEventSchema = z.object({
  type: z.literal("tool.started"),
  runId: runIdSchema,
  toolCallId: toolCallIdSchema,
  toolName: z.string().min(1),
  input: z.record(z.unknown()).optional(),
  timestamp: timestampSchema,
});

export const toolCompletedEventSchema = z.object({
  type: z.literal("tool.completed"),
  runId: runIdSchema,
  toolCallId: toolCallIdSchema,
  toolName: z.string().min(1),
  output: z.record(z.unknown()).optional(),
  outputSummary: z.string().optional(),
  artifacts: z.array(toolArtifactSchema).optional(),
  timestamp: timestampSchema,
});

export const runCompletedEventSchema = z.object({
  type: z.literal("run.completed"),
  runId: runIdSchema,
  timestamp: timestampSchema,
});

export const runCanceledEventSchema = z.object({
  type: z.literal("run.canceled"),
  runId: runIdSchema,
  timestamp: timestampSchema,
});

export const runPausedEventSchema = z.object({
  type: z.literal("run.paused"),
  runId: runIdSchema,
  reason: z.string().min(1).optional(),
  timestamp: timestampSchema,
});

export const runFailedEventSchema = z.object({
  type: z.literal("run.failed"),
  runId: runIdSchema,
  error: cucumberErrorSchema,
  timestamp: timestampSchema,
});

export const thinkingDeltaEventSchema = z.object({
  type: z.literal("thinking.delta"),
  runId: runIdSchema,
  messageId: messageIdSchema,
  delta: z.string(),
  timestamp: timestampSchema,
});

export const canvasSyncEventSchema = z.object({
  type: z.literal("canvas.sync"),
  runId: runIdSchema,
  timestamp: timestampSchema,
});

export const canvasPatchEventSchema = z.object({
  type: z.literal("canvas.patch"),
  runId: runIdSchema,
  transactionId: z.string().min(1),
  baseVersion: z.number().int().nonnegative(),
  operations: z.array(canvasPatchOperationSchema).min(1),
  selection: z.array(z.string()).optional(),
  timestamp: timestampSchema,
});

export const streamEventSchema = z.discriminatedUnion("type", [
  runStartedEventSchema,
  runContextEventSchema,
  agentStageEventSchema,
  messageDeltaEventSchema,
  thinkingDeltaEventSchema,
  toolStartedEventSchema,
  toolCompletedEventSchema,
  runCanceledEventSchema,
  runPausedEventSchema,
  runCompletedEventSchema,
  runFailedEventSchema,
  canvasSyncEventSchema,
  canvasPatchEventSchema,
]);

export type StreamEvent = z.infer<typeof streamEventSchema>;
