import { z } from "zod";

import { streamEventSchema } from "./events.js";

export const sseEventNameSchema = z.literal("stream.event");

export const sseEnvelopeSchema = z.object({
  id: z.number().int().min(1),
  event: sseEventNameSchema,
  data: streamEventSchema,
});

export const sseStreamQuerySchema = z.object({
  lastEventId: z.coerce.number().int().min(0).optional(),
});

export type SseEventName = z.infer<typeof sseEventNameSchema>;
export type SseEnvelope = z.infer<typeof sseEnvelopeSchema>;
export type SseStreamQuery = z.infer<typeof sseStreamQuerySchema>;
