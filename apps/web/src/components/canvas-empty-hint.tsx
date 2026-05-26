"use client";

import { useEffect, useRef, useState } from "react";

import type { CanvasApi, CanvasSceneElement } from "./canvas/canvas-api";

type CanvasEmptyHintProps = {
  canvasApi: CanvasApi | null;
  onOpenChat: () => void;
};

/**
 * Floating overlay hint shown when the canvas has no visible elements.
 */
export function CanvasEmptyHint({
  canvasApi,
  onOpenChat,
}: CanvasEmptyHintProps) {
  const [hasElements, setHasElements] = useState(false);
  const onOpenChatRef = useRef(onOpenChat);
  onOpenChatRef.current = onOpenChat;

  // Poll the canvas API until the surface exposes a lightweight empty-state event.
  useEffect(() => {
    function check() {
      if (!canvasApi) {
        setHasElements(false);
        return;
      }
      const elements: CanvasSceneElement[] =
        canvasApi.getSceneElements?.() ?? [];
      setHasElements(elements.some((el) => !el.isDeleted));
    }

    check();
    const id = setInterval(check, 500);
    return () => clearInterval(id);
  }, [canvasApi]);

  // Global keydown listener for the `C` shortcut.
  useEffect(() => {
    if (hasElements) return;

    function handleKeyDown(e: KeyboardEvent) {
      // Ignore when the user is typing in an input or textarea.
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      // Also ignore if contentEditable
      if ((e.target as HTMLElement)?.isContentEditable) return;

      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        onOpenChatRef.current();

        // The textarea may not be in the DOM yet (sidebar was closed), so
        // retry focus with a short delay.
        requestAnimationFrame(() => {
          const textarea = document.querySelector<HTMLTextAreaElement>(
            "textarea[data-chat-input]",
          );
          if (textarea) {
            textarea.focus();
          } else {
            // Sidebar might animate open; retry once more.
            setTimeout(() => {
              document
                .querySelector<HTMLTextAreaElement>("textarea[data-chat-input]")
                ?.focus();
            }, 100);
          }
        });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasElements]);

  if (hasElements) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      <p className="text-base text-muted-foreground/50">
        {"输入你的想法开始创作"}
      </p>
    </div>
  );
}
