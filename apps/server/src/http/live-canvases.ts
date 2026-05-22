import { isCucumberCanvasDocument } from "@cucumber/canvas-core";
import type { FastifyInstance, FastifyReply } from "fastify";

import {
  applicationErrorResponseSchema,
  canvasContentSchema,
  unauthenticatedErrorResponseSchema,
} from "@cucumber/shared";

import {
  type LiveCanvasService,
  LiveCanvasServiceError,
} from "../features/canvas/live-canvas-service.js";
import type { RequestAuthenticator } from "../supabase/user.js";

export async function registerLiveCanvasRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    liveCanvasService: LiveCanvasService;
  },
) {
  app.get<{ Params: { canvasId: string } }>(
    "/api/live-canvases/:canvasId/document",
    async (request, reply) => {
      try {
        const user = await options.auth.authenticate(request);
        if (!user) return sendUnauthorized(reply);
        const document = await options.liveCanvasService.getDocument(
          user,
          request.params.canvasId,
        );
        return reply.code(200).send({ document });
      } catch (error) {
        return sendLiveCanvasError(error, reply);
      }
    },
  );

  app.put<{ Params: { canvasId: string } }>(
    "/api/live-canvases/:canvasId/document",
    async (request, reply) => {
      try {
        const user = await options.auth.authenticate(request);
        if (!user) return sendUnauthorized(reply);
        const payload = request.body as { document?: unknown };
        const parsed = canvasContentSchema.parse(payload.document);
        if (!isCucumberCanvasDocument(parsed)) {
          throw new LiveCanvasServiceError(
            "invalid_canvas_document",
            "Only Cucumber canvas documents can be sent to the live editor.",
            400,
          );
        }
        await options.liveCanvasService.setDocument(
          user,
          request.params.canvasId,
          parsed,
        );
        return reply.code(200).send({ ok: true });
      } catch (error) {
        return sendLiveCanvasError(error, reply);
      }
    },
  );
}

function sendUnauthorized(reply: FastifyReply) {
  return reply.code(401).send(
    unauthenticatedErrorResponseSchema.parse({
      error: {
        code: "unauthorized",
        message: "Missing or invalid bearer token.",
      },
    }),
  );
}

function sendLiveCanvasError(error: unknown, reply: FastifyReply) {
  if (error instanceof LiveCanvasServiceError) {
    return reply.code(error.statusCode).send(
      applicationErrorResponseSchema.parse({
        error: {
          code: error.code,
          message: error.message,
        },
      }),
    );
  }

  if (
    error instanceof Error &&
    error.name === "ZodError" &&
    "issues" in error
  ) {
    return reply.code(400).send({
      issues: (error as { issues: unknown }).issues,
      message: "Invalid request body",
    });
  }

  return reply.code(500).send(
    applicationErrorResponseSchema.parse({
      error: {
        code: "application_error",
        message: "Internal server error.",
      },
    }),
  );
}
