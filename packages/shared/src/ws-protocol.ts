import { z } from "zod";

export const wsRpcRequestSchema = z.object({
  type: z.literal("rpc.request"),
  id: z.string().min(1),
  method: z.string().min(1),
  params: z.record(z.unknown()).default({}),
});

export const wsRpcResponseSchema = z.object({
  type: z.literal("rpc.response"),
  id: z.string().min(1),
  result: z.record(z.unknown()).optional(),
  error: z.string().optional(),
});

export const wsCanvasBindSchema = z.object({
  type: z.literal("canvas.bind"),
  canvasId: z.string().min(1),
});

export const wsClientMessageSchema = z.discriminatedUnion("type", [
  wsRpcResponseSchema,
  wsCanvasBindSchema,
]);

export const wsServerMessageSchema = wsRpcRequestSchema;

export type WsRpcRequest = z.infer<typeof wsRpcRequestSchema>;
export type WsRpcResponse = z.infer<typeof wsRpcResponseSchema>;
export type WsCanvasBind = z.infer<typeof wsCanvasBindSchema>;
export type WsClientMessage = z.infer<typeof wsClientMessageSchema>;
export type WsServerMessage = z.infer<typeof wsServerMessageSchema>;

export const screenshotParamsSchema = z.object({
  mode: z.enum(["full", "region", "viewport"]),
  region: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional(),
  max_dimension: z.number().default(1024),
});

export const screenshotResultSchema = z.object({
  url: z.string().min(1),
  width: z.number(),
  height: z.number(),
  actualBounds: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional(),
});

export type ScreenshotParams = z.infer<typeof screenshotParamsSchema>;
export type ScreenshotResult = z.infer<typeof screenshotResultSchema>;
