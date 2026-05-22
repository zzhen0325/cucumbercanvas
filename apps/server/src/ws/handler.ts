import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";

import { wsCanvasBindSchema, wsRpcResponseSchema } from "@cucumber/shared";
import type {
  AuthenticatedUser,
  RequestAuthenticator,
} from "../supabase/user.js";
import type { ConnectionManager } from "./connection-manager.js";
import { createPipelineLogger } from "./logger.js";

type RegisterWsOptions = {
  auth?: RequestAuthenticator;
  connectionManager: ConnectionManager;
};

export async function registerWsRoute(
  app: FastifyInstance,
  options: RegisterWsOptions,
) {
  const { connectionManager } = options;

  app.get(
    "/api/ws",
    { websocket: true },
    (socket: WebSocket, request: FastifyRequest) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const token = url.searchParams.get("token");

      if (!token || !options.auth) {
        socket.close(4001, "Unauthorized");
        return;
      }

      void authenticateAndBind(
        socket,
        token,
        request,
        options.auth,
        connectionManager,
      );
    },
  );
}

async function authenticateAndBind(
  socket: WebSocket,
  token: string,
  request: FastifyRequest,
  auth: RequestAuthenticator,
  connectionManager: ConnectionManager,
) {
  const log = createPipelineLogger("ws");

  let authenticatedUser: AuthenticatedUser;
  try {
    const fakeRequest = {
      headers: { authorization: `Bearer ${token}` },
    } as unknown as FastifyRequest;
    const user = await auth.authenticate(fakeRequest);
    if (!user) {
      log.warn("auth_rejected", { reason: "invalid_token" });
      socket.close(4001, "Unauthorized");
      return;
    }
    authenticatedUser = user;
    log.info("connected", { userId: user.id });
  } catch (err) {
    log.warn("auth_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    socket.close(4001, "Unauthorized");
    return;
  }

  if (socket.readyState !== 1) {
    return;
  }

  const urlForParams = new URL(request.url, `http://${request.headers.host}`);
  const connectionId =
    urlForParams.searchParams.get("connectionId") || randomUUID();
  connectionManager.register(connectionId, authenticatedUser.id, socket);

  let lastPong = Date.now();
  socket.on("pong", () => {
    lastPong = Date.now();
  });

  const pingInterval = setInterval(() => {
    if (Date.now() - lastPong > 60_000) {
      log.warn("pong_timeout", { userId: authenticatedUser.id });
      socket.terminate();
      return;
    }

    if (socket.readyState === 1) {
      socket.ping();
    }
  }, 30_000);

  socket.on("message", (raw: Buffer | string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        typeof raw === "string" ? raw : raw.toString("utf-8"),
      );
    } catch {
      socket.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      return;
    }

    const obj = parsed as Record<string, unknown>;
    if (obj.type === "canvas.bind") {
      try {
        const bind = wsCanvasBindSchema.parse(parsed);
        connectionManager.bindCanvas(connectionId, bind.canvasId);
        log.info("canvas_bound", {
          canvasId: bind.canvasId,
          connectionId,
          userId: authenticatedUser.id,
        });
      } catch {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Invalid canvas.bind payload",
          }),
        );
      }
      return;
    }

    if (obj.type !== "rpc.response") {
      return;
    }

    try {
      const rpcResponse = wsRpcResponseSchema.parse(parsed);
      connectionManager.handleRpcResponse(connectionId, {
        type: rpcResponse.type,
        id: rpcResponse.id,
        ...(rpcResponse.result !== undefined
          ? { result: rpcResponse.result }
          : {}),
        ...(rpcResponse.error !== undefined
          ? { error: rpcResponse.error }
          : {}),
      });
    } catch {
      // Ignore malformed RPC responses
    }
  });

  socket.on("close", () => {
    log.info("disconnected", { userId: authenticatedUser.id, connectionId });
    clearInterval(pingInterval);
    connectionManager.remove(connectionId);
  });

  socket.on("error", () => {
    log.error("socket_error", { userId: authenticatedUser.id, connectionId });
    clearInterval(pingInterval);
    connectionManager.remove(connectionId);
  });
}
