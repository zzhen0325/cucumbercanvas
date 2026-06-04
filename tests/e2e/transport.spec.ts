import { createServer } from "node:http";
import type {
  Server as HttpServer,
  IncomingMessage,
  ServerResponse,
} from "node:http";
import { setTimeout as delay } from "node:timers/promises";

import { expect, test } from "@playwright/test";
import { type WebSocket, WebSocketServer } from "ws";

const API_PORT = 4011;
const WEB_PORT = 3100;
const TRANSPORT_CANVAS_ID = "transport-canvas-fixture";
const SSE_PATH = `/api/canvases/${TRANSPORT_CANVAS_ID}/stream`;
const WS_PATH = "/api/ws";
const TOKEN = "dev-skip-auth-token";
const TEST_PAGE_URL = `http://127.0.0.1:${WEB_PORT}/test/transport?canvasId=${TRANSPORT_CANVAS_ID}&token=${TOKEN}`;

test.describe
  .serial("browser transport black-box", () => {
    let harness: TransportTestServer;

    test.beforeAll(async () => {
      harness = new TransportTestServer(API_PORT);
      await harness.start();
    });

    test.afterAll(async () => {
      await harness.stop();
    });

    test.beforeEach(async () => {
      await harness.reset();
    });

    test("replays SSE after disconnect and keeps the stream alive with heartbeats", async ({
      page,
    }) => {
      await page.goto(TEST_PAGE_URL);
      await page.getByTestId("start-sse").click();

      await harness.waitForSseConnectionCount(1);
      await expect(page.getByTestId("sse-open-count")).toHaveText("1");

      harness.publish({
        payload: { text: "first" },
        type: "message.delta",
      });
      await expect(page.getByTestId("sse-events")).toContainText(
        "1:message.delta",
      );

      await harness.waitForHeartbeatCount(1);
      expect(harness.heartbeatCount).toBeGreaterThanOrEqual(1);

      await harness.closeSseConnections();
      harness.publish({
        payload: { text: "second" },
        type: "message.delta",
      });

      await expect(page.getByTestId("sse-reconnect-count")).toHaveText("1", {
        timeout: 10_000,
      });
      await expect(page.getByTestId("sse-events")).toContainText(
        "2:message.delta",
        { timeout: 10_000 },
      );
      await expect(page.getByTestId("sse-error-count")).toHaveText("0");
      expect(harness.lastEventIds.at(-1)).toBe(1);
    });

    test("reconnects WebSocket clients and returns rpc.response payloads", async ({
      page,
    }) => {
      await page.goto(TEST_PAGE_URL);
      await harness.waitForWsConnectionCount(1);
      await harness.waitForActiveWsClient();
      await expect(page.getByTestId("ws-connected")).toHaveText("true", {
        timeout: 10_000,
      });

      const firstResponsePromise = harness.waitForRpcResponse("rpc-1");
      await harness.sendRpcRequest({
        id: "rpc-1",
        method: "browser.echo",
        params: { value: "hello" },
      });

      const firstResponse = await firstResponsePromise;
      expect(firstResponse).toEqual({
        id: "rpc-1",
        result: {
          echoed: "hello",
          seenByBrowser: true,
        },
        type: "rpc.response",
      });
      await expect(page.getByTestId("ws-calls")).toContainText("hello");

      await harness.closeWsConnections();
      await harness.waitForWsConnectionCount(2);
      await harness.waitForActiveWsClient();
      await expect(page.getByTestId("ws-connected")).toHaveText("true", {
        timeout: 10_000,
      });

      const secondResponsePromise = harness.waitForRpcResponse("rpc-2");
      await harness.sendRpcRequest({
        id: "rpc-2",
        method: "browser.echo",
        params: { value: "after-reconnect" },
      });

      const secondResponse = await secondResponsePromise;
      expect(secondResponse).toEqual({
        id: "rpc-2",
        result: {
          echoed: "after-reconnect",
          seenByBrowser: true,
        },
        type: "rpc.response",
      });
      await expect(page.getByTestId("ws-calls")).toContainText(
        "after-reconnect",
      );
    });
  });

type RpcRequest = {
  id: string;
  method: string;
  params: Record<string, unknown>;
};

type RpcResponse = {
  error?: string;
  id: string;
  result?: Record<string, unknown>;
  type: "rpc.response";
};

type StreamEvent = {
  payload?: Record<string, unknown>;
  type: string;
};

type StreamEntry = {
  event: StreamEvent;
  seq: number;
};

type SseClient = {
  heartbeatTimer: ReturnType<typeof setInterval>;
  response: ServerResponse;
};

class TransportTestServer {
  private readonly entries: StreamEntry[] = [];
  private readonly port: number;
  private readonly rpcResponses: RpcResponse[] = [];
  private readonly sseClients = new Set<SseClient>();
  private readonly wsClients = new Map<string, WebSocket>();
  heartbeatCount = 0;
  lastEventIds: number[] = [];
  private nextStreamId = 1;
  private server: HttpServer | null = null;
  private webSocketServer: WebSocketServer | null = null;
  private wsConnectionCount = 0;

  constructor(port: number) {
    this.port = port;
  }

  async start() {
    if (this.server) {
      return;
    }

    this.server = createServer((request, response) => {
      if (request.method === "OPTIONS") {
        response.writeHead(204, buildCorsHeaders());
        response.end();
        return;
      }

      if (request.url?.startsWith(SSE_PATH)) {
        this.handleSseRequest(request, response);
        return;
      }

      response.writeHead(404, buildCorsHeaders());
      response.end("Not found");
    });

    this.webSocketServer = new WebSocketServer({ noServer: true });
    this.webSocketServer.on("connection", (socket, request) => {
      const url = new URL(
        request.url ?? WS_PATH,
        `http://127.0.0.1:${this.port}`,
      );
      const connectionId =
        url.searchParams.get("connectionId") ?? `connection-${Date.now()}`;

      this.wsConnectionCount += 1;
      this.wsClients.set(connectionId, socket);

      socket.on("message", (raw) => {
        try {
          const parsed = JSON.parse(raw.toString("utf-8")) as RpcResponse;
          if (parsed.type === "rpc.response") {
            this.rpcResponses.push(parsed);
          }
        } catch {
          // Ignore malformed payloads in the harness.
        }
      });

      const cleanup = () => {
        this.wsClients.delete(connectionId);
      };

      socket.on("close", cleanup);
      socket.on("error", cleanup);
    });

    this.server.on("upgrade", (request, socket, head) => {
      const url = new URL(
        request.url ?? WS_PATH,
        `http://127.0.0.1:${this.port}`,
      );
      if (url.pathname !== WS_PATH || url.searchParams.get("token") !== TOKEN) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      this.webSocketServer?.handleUpgrade(
        request,
        socket,
        head,
        (websocket) => {
          this.webSocketServer?.emit("connection", websocket, request);
        },
      );
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.port, "127.0.0.1", () => resolve());
    });
  }

  async stop() {
    await this.reset();

    await new Promise<void>((resolve, reject) => {
      this.webSocketServer?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    this.server = null;
    this.webSocketServer = null;
  }

  async reset() {
    await this.closeSseConnections();
    await this.closeWsConnections();
    this.entries.length = 0;
    this.heartbeatCount = 0;
    this.lastEventIds = [];
    this.nextStreamId = 1;
    this.rpcResponses.length = 0;
    this.wsConnectionCount = 0;
  }

  publish(event: StreamEvent) {
    const entry = { event, seq: this.nextStreamId++ };
    this.entries.push(entry);
    for (const client of this.sseClients) {
      this.writeSseEntry(client.response, entry);
    }
  }

  async sendRpcRequest(request: RpcRequest) {
    const socket = await this.waitForActiveWsClient();
    if (!socket || socket.readyState !== 1) {
      throw new Error("No active WebSocket client is available.");
    }

    socket.send(
      JSON.stringify({
        id: request.id,
        method: request.method,
        params: request.params,
        type: "rpc.request",
      }),
    );
  }

  async waitForRpcResponse(id: string, timeoutMs = 10_000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const match = this.rpcResponses.find((response) => response.id === id);
      if (match) {
        return match;
      }
      await delay(100);
    }

    throw new Error(`Timed out waiting for rpc.response ${id}.`);
  }

  async waitForHeartbeatCount(expectedCount: number, timeoutMs = 10_000) {
    await this.waitFor(
      () => this.heartbeatCount >= expectedCount,
      timeoutMs,
      `Timed out waiting for ${expectedCount} heartbeat frame(s).`,
    );
  }

  async waitForSseConnectionCount(expectedCount: number, timeoutMs = 10_000) {
    await this.waitFor(
      () => this.sseClients.size >= expectedCount,
      timeoutMs,
      `Timed out waiting for ${expectedCount} SSE connection(s).`,
    );
  }

  async waitForWsConnectionCount(expectedCount: number, timeoutMs = 10_000) {
    await this.waitFor(
      () => this.wsConnectionCount >= expectedCount,
      timeoutMs,
      `Timed out waiting for ${expectedCount} WebSocket connection(s).`,
    );
  }

  async waitForActiveWsClient(timeoutMs = 10_000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const socket = [...this.wsClients.values()].find(
        (candidate) => candidate.readyState === 1,
      );
      if (socket) {
        await delay(250);
        if (
          socket.readyState === 1 &&
          [...this.wsClients.values()].includes(socket)
        ) {
          return socket;
        }
      }
      await delay(100);
    }

    throw new Error("Timed out waiting for an active WebSocket client.");
  }

  async closeSseConnections() {
    const clients = [...this.sseClients];
    for (const client of clients) {
      clearInterval(client.heartbeatTimer);
      client.response.end();
      this.sseClients.delete(client);
    }
  }

  async closeWsConnections() {
    const sockets = [...this.wsClients.values()];
    await Promise.all(
      sockets.map(
        (socket) =>
          new Promise<void>((resolve) => {
            if (socket.readyState === 3) {
              resolve();
              return;
            }

            socket.once("close", () => resolve());
            socket.close();
          }),
      ),
    );
    this.wsClients.clear();
  }

  private handleSseRequest(request: IncomingMessage, response: ServerResponse) {
    if (request.headers.authorization !== `Bearer ${TOKEN}`) {
      response.writeHead(401, buildCorsHeaders());
      response.end("Unauthorized");
      return;
    }

    const url = new URL(
      request.url ?? SSE_PATH,
      `http://127.0.0.1:${this.port}`,
    );
    const headerLastEventId = parseLastEventId(
      request.headers["last-event-id"],
    );
    const queryLastEventId = parseLastEventId(
      url.searchParams.get("lastEventId"),
    );
    const lastEventId = headerLastEventId ?? queryLastEventId ?? 0;
    this.lastEventIds.push(lastEventId);

    response.writeHead(200, {
      ...buildCorsHeaders(),
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    });
    response.write("retry: 1000\n\n");

    for (const entry of this.entries.filter(
      (candidate) => candidate.seq > lastEventId,
    )) {
      this.writeSseEntry(response, entry);
    }

    const heartbeatTimer = setInterval(() => {
      this.heartbeatCount += 1;
      response.write(`: heartbeat ${Date.now()}\n\n`);
    }, 250);

    const client = { heartbeatTimer, response };
    this.sseClients.add(client);

    const cleanup = () => {
      clearInterval(heartbeatTimer);
      this.sseClients.delete(client);
    };

    request.on("close", cleanup);
    request.on("end", cleanup);
    response.on("close", cleanup);
    response.on("error", cleanup);
  }

  private writeSseEntry(response: ServerResponse, entry: StreamEntry) {
    response.write(`id: ${entry.seq}\n`);
    response.write("event: stream.event\n");
    response.write(`data: ${JSON.stringify(entry.event)}\n\n`);
  }

  private async waitFor(
    predicate: () => boolean,
    timeoutMs: number,
    timeoutMessage: string,
  ) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (predicate()) {
        return;
      }
      await delay(100);
    }

    throw new Error(timeoutMessage);
  }
}

function buildCorsHeaders() {
  return {
    "access-control-allow-headers":
      "Authorization, Last-Event-ID, Accept, Content-Type",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-origin": "http://127.0.0.1:3100",
  };
}

function parseLastEventId(value: string | string[] | null | undefined) {
  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}
