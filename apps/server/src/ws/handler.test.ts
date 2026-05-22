import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import type { RequestAuthenticator } from "../supabase/user.js";
import { registerWsRoute } from "./handler.js";

const TEST_USER = {
  accessToken: "token",
  email: "tester@example.com",
  id: "user-1",
  userMetadata: {},
};

describe("registerWsRoute", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects websocket connections with invalid tokens", async () => {
    const { app, wsUrl } = await createHarness(async () => null);
    const socket = new WebSocket(`${wsUrl}?token=bad-token`);

    try {
      const [code, reason] = await waitForClose(socket);
      expect(code).toBe(4001);
      expect(reason).toContain("Unauthorized");
    } finally {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
      await app.close();
    }
  });

  it("ignores non-rpc messages and forwards rpc.response payloads", async () => {
    const { app, connectionManager, wsUrl } = await createHarness(
      async () => TEST_USER,
    );
    const socket = new WebSocket(
      `${wsUrl}?token=good-token&connectionId=conn-1`,
    );

    try {
      await waitForOpen(socket);
      expect(connectionManager.register).toHaveBeenCalledWith(
        "conn-1",
        "user-1",
        expect.anything(),
      );

      socket.send(JSON.stringify({ type: "agent.run", id: "ignored" }));
      await sleep(10);
      expect(connectionManager.handleRpcResponse).not.toHaveBeenCalled();

      socket.send(
        JSON.stringify({ type: "canvas.bind", canvasId: "canvas-1" }),
      );
      await expect
        .poll(() => connectionManager.bindCanvas.mock.calls.length)
        .toBe(1);
      expect(connectionManager.bindCanvas).toHaveBeenCalledWith(
        "conn-1",
        "canvas-1",
      );

      socket.send(
        JSON.stringify({
          type: "rpc.response",
          id: "rpc-1",
          result: { ok: true },
        }),
      );

      await expect
        .poll(() => connectionManager.handleRpcResponse.mock.calls.length)
        .toBe(1);
      expect(connectionManager.handleRpcResponse).toHaveBeenCalledWith(
        "conn-1",
        {
          type: "rpc.response",
          id: "rpc-1",
          result: { ok: true },
        },
      );
    } finally {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
      await app.close();
    }
  });
});

async function createHarness(
  authenticate: RequestAuthenticator["authenticate"],
) {
  const app = Fastify();
  await app.register(websocket);

  const connectionManager = {
    bindCanvas: vi.fn(),
    handleRpcResponse: vi.fn(),
    register: vi.fn(),
    remove: vi.fn(),
  };

  await registerWsRoute(app, {
    auth: { authenticate },
    connectionManager: connectionManager as never,
  });

  const origin = await app.listen({
    host: "127.0.0.1",
    port: 0,
  });

  return {
    app,
    connectionManager,
    wsUrl: `${origin.replace("http", "ws")}/api/ws`,
  };
}

function waitForOpen(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function waitForClose(socket: WebSocket) {
  return new Promise<[number, string]>((resolve) => {
    socket.once("close", (code, reason) => {
      resolve([code, reason.toString("utf-8")]);
    });
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
