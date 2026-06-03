"use client";

import { loadCanvasKit } from "@cucumber/pen-renderer";
import type { CanvasKit } from "canvaskit-wasm";
import { useEffect, useRef, useState } from "react";

export function useCanvasKitRuntime() {
  const ckRef = useRef<CanvasKit | null>(null);
  const [ckReady, setCkReady] = useState(false);
  const [ckError, setCkError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCanvasKit("/canvaskit/")
      .then((ck) => {
        if (cancelled) return;
        ckRef.current = ck;
        setCkReady(true);
        console.info("[skia-canvas] CanvasKit loaded");
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[skia-canvas] CanvasKit load failed", err);
        setCkError(
          `Failed to load CanvasKit: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { ckError, ckReady, ckRef };
}
