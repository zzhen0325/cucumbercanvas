"use client";

import { useEffect, useRef, useState } from "react";

import type { CanvasTool } from "./canvas-api";

export function useSpaceHandTool(activeTool: CanvasTool) {
  const [spaceHeld, setSpaceHeld] = useState(false);
  const savedToolRef = useRef<CanvasTool>("select");

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      savedToolRef.current = activeTool;
      setSpaceHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [activeTool]);

  return spaceHeld ? "hand" : activeTool;
}
