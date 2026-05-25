"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { StreamEvent } from "@cucumber/shared";
import { useSseStream } from "../../../hooks/use-sse-stream";
import { useWebSocket } from "../../../hooks/use-websocket";
import { useAuth } from "../../../lib/auth-context";

const CANVAS_ID = "canvas-1";
const RPC_METHOD = "browser.echo";

export function TransportHarness() {
  const { loading, session } = useAuth();
  const accessToken = session?.access_token ?? "";
  const [sseErrors, setSseErrors] = useState<string[]>([]);
  const [sseEvents, setSseEvents] = useState<string[]>([]);
  const [sseOpenCount, setSseOpenCount] = useState(0);
  const [sseReconnectCount, setSseReconnectCount] = useState(0);
  const [streamActive, setStreamActive] = useState(false);
  const [wsCalls, setWsCalls] = useState<string[]>([]);
  const streamHandleRef = useRef<{ stop: () => void } | null>(null);
  const { startStream } = useSseStream(accessToken);
  const { connected, registerRPC } = useWebSocket(() => accessToken || null);

  useEffect(() => {
    return registerRPC(RPC_METHOD, async (params) => {
      const serializedParams = JSON.stringify(params);
      setWsCalls((current) => [...current, serializedParams]);

      return {
        echoed: params.value ?? null,
        seenByBrowser: true,
      };
    });
  }, [registerRPC]);

  const stopStream = useCallback(() => {
    streamHandleRef.current?.stop();
    streamHandleRef.current = null;
    setStreamActive(false);
  }, []);

  const startHarnessStream = useCallback(() => {
    stopStream();
    setSseErrors([]);
    setSseEvents([]);
    setSseOpenCount(0);
    setSseReconnectCount(0);

    if (!accessToken) {
      setSseErrors(["No access token available for the transport harness."]);
      setStreamActive(false);
      return null;
    }

    setStreamActive(true);

    return startStream({
      canvasId: CANVAS_ID,
      onError: (error) => {
        setSseErrors((current) => [...current, error.message]);
      },
      onEvent: (event: StreamEvent, meta) => {
        setSseEvents((current) => [
          ...current,
          `${meta.id}:${event.type}:${JSON.stringify(event)}`,
        ]);
      },
      onOpen: () => {
        setSseOpenCount((count) => count + 1);
      },
      onReconnect: () => {
        setSseReconnectCount((count) => count + 1);
      },
    });
  }, [accessToken, startStream, stopStream]);

  const handleStartSse = useCallback(() => {
    streamHandleRef.current = startHarnessStream();
  }, [startHarnessStream]);

  useEffect(() => stopStream, [stopStream]);

  return (
    <main style={{ display: "grid", gap: 16, padding: 24 }}>
      <h1>Transport Harness</h1>
      <div style={{ display: "flex", gap: 12 }}>
        <button
          data-testid="start-sse"
          disabled={loading || !accessToken}
          onClick={handleStartSse}
          type="button"
        >
          Start SSE
        </button>
        <button data-testid="stop-sse" onClick={stopStream} type="button">
          Stop SSE
        </button>
      </div>

      <section>
        <h2>SSE</h2>
        <div data-testid="sse-stream-active">{String(streamActive)}</div>
        <div data-testid="sse-open-count">{sseOpenCount}</div>
        <div data-testid="sse-reconnect-count">{sseReconnectCount}</div>
        <div data-testid="sse-error-count">{sseErrors.length}</div>
        <pre data-testid="sse-events">{JSON.stringify(sseEvents)}</pre>
        <pre data-testid="sse-errors">{JSON.stringify(sseErrors)}</pre>
      </section>

      <section>
        <h2>WebSocket</h2>
        <div data-testid="ws-connected">{String(connected)}</div>
        <pre data-testid="ws-calls">{JSON.stringify(wsCalls)}</pre>
      </section>
    </main>
  );
}
