import type { OutgoingHttpHeader, OutgoingHttpHeaders } from "node:http";

import type { FastifyInstance, FastifyReply } from "fastify";

import {
  applicationErrorResponseSchema,
  sseStreamQuerySchema,
  unauthenticatedErrorResponseSchema,
} from "@cucumber/shared";

import type { RequestAuthenticator } from "../supabase/user.js";
import type { CanvasEventBuffer } from "../ws/event-buffer.js";

type CanvasLookupClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        maybeSingle: () => PromiseLike<{
          data: unknown;
          error: unknown;
        }>;
      };
    };
  };
};

export async function registerSseRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    createUserClient: (accessToken: string) => unknown;
    eventBuffer: CanvasEventBuffer;
  },
) {
  app.get("/api/canvases/:canvasId/stream", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) {
      return sendUnauthorized(reply);
    }

    const { canvasId } = request.params as { canvasId: string };
    const client = options.createUserClient(
      user.accessToken,
    ) as CanvasLookupClient;
    const { data: canvas, error } = await client
      .from("canvases")
      .select("id")
      .eq("id", canvasId)
      .maybeSingle();

    if (error || !isCanvasRecord(canvas)) {
      return reply.code(404).send(
        applicationErrorResponseSchema.parse({
          error: {
            code: "canvas_not_found",
            message: "Canvas not found.",
          },
        }),
      );
    }

    const parsedQuery = sseStreamQuerySchema.safeParse(request.query);
    const queryLastEventId = parsedQuery.success
      ? parsedQuery.data.lastEventId
      : undefined;
    const headerLastEventId = parseLastEventId(
      request.headers["last-event-id"],
    );
    const lastEventId = headerLastEventId ?? queryLastEventId ?? 0;

    request.log.debug(
      {
        canvasId,
        lastEventId,
        userId: user.id,
      },
      "Opening canvas SSE stream",
    );

    const responseHeaders = normalizeResponseHeaders(reply.getHeaders());
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      ...responseHeaders,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    response.write("retry: 1000\n\n");

    const writeEntry = (entry: { seq: number; event: unknown }) => {
      response.write(`id: ${entry.seq}\n`);
      response.write("event: stream.event\n");
      response.write(`data: ${JSON.stringify(entry.event)}\n\n`);
    };

    for (const entry of options.eventBuffer.getAfter(canvasId, lastEventId)) {
      writeEntry(entry);
    }

    const unsubscribe = options.eventBuffer.subscribe(canvasId, (entry) => {
      writeEntry(entry);
    });

    const heartbeat = setInterval(() => {
      response.write(`: heartbeat ${Date.now()}\n\n`);
    }, 30_000);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    request.raw.on("close", cleanup);
    request.raw.on("end", cleanup);
    request.raw.on("error", cleanup);
  });
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

function parseLastEventId(value: string | string[] | undefined) {
  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

function isCanvasRecord(value: unknown): value is { id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string"
  );
}

function normalizeResponseHeaders(
  headers: Record<string, OutgoingHttpHeader | undefined>,
): OutgoingHttpHeaders {
  return Object.fromEntries(
    Object.entries(headers).filter(
      (entry): entry is [string, OutgoingHttpHeader] => {
        return entry[1] !== undefined;
      },
    ),
  );
}
