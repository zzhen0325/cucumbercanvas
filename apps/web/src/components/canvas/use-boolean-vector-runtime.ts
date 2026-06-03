"use client";

import { setPaperModule } from "@cucumber/pen-core";
import { useEffect, useState } from "react";

export type BooleanRuntimeStatus = "loading" | "ready" | "failed";

export function useBooleanVectorRuntime() {
  const [booleanRuntimeStatus, setBooleanRuntimeStatus] =
    useState<BooleanRuntimeStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    setBooleanRuntimeStatus("loading");
    import("paper")
      .then((paperModule) => {
        if (cancelled) return;
        const runtimeModule =
          "default" in paperModule ? paperModule.default : paperModule;
        setPaperModule(
          runtimeModule as unknown as Parameters<typeof setPaperModule>[0],
        );
        setBooleanRuntimeStatus("ready");
        console.info("[skia-canvas] Paper.js boolean runtime loaded");
      })
      .catch((error) => {
        if (cancelled) return;
        setPaperModule(null);
        setBooleanRuntimeStatus("failed");
        console.error("[skia-canvas] Paper.js boolean runtime failed", {
          error,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return booleanRuntimeStatus;
}
