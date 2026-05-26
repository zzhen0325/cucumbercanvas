import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readClipboardImportPayload,
  useCanvasClipboardImport,
} from "@/components/canvas/use-canvas-clipboard-import";

function createPasteEvent(data: Record<string, string>) {
  const event = new Event("paste", {
    bubbles: true,
    cancelable: true,
  }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    value: {
      types: Object.keys(data),
      getData: (type: string) => data[type] ?? "",
    },
  });
  return event;
}

function HookHarness({
  onImportPayload,
}: {
  onImportPayload: ReturnType<typeof vi.fn>;
}) {
  useCanvasClipboardImport({ onImportPayload });
  return <div>clipboard hook</div>;
}

describe("useCanvasClipboardImport", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  async function mountHook(onImportPayload: ReturnType<typeof vi.fn>) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<HookHarness onImportPayload={onImportPayload} />);
    });
  }

  it("ignores paste events from input elements", async () => {
    const onImportPayload = vi.fn().mockReturnValue(true);
    await mountHook(onImportPayload);

    const input = document.createElement("input");
    document.body.appendChild(input);
    const event = createPasteEvent({ "text/plain": "<svg />" });
    input.dispatchEvent(event);

    expect(onImportPayload).not.toHaveBeenCalled();
  });

  it("passes payload and context for non-input paste events and prevents default on handled imports", async () => {
    const onImportPayload = vi.fn().mockReturnValue(true);
    await mountHook(onImportPayload);

    const event = createPasteEvent({
      "text/html": "<div data-buffer='1'></div>",
      "text/plain": "<svg></svg>",
    });
    document.body.dispatchEvent(event);

    expect(onImportPayload).toHaveBeenCalledWith(
      {
        html: "<div data-buffer='1'></div>",
        text: "<svg></svg>",
        svg: undefined,
        items: [
          { type: "text/html", text: "<div data-buffer='1'></div>" },
          { type: "text/plain", text: "<svg></svg>" },
        ],
      },
      {
        trigger: "paste-event",
        mimeTypes: ["text/html", "text/plain"],
        hasHtml: true,
        hasText: true,
      },
    );
    expect(event.defaultPrevented).toBe(true);
  });

  it("falls back to readText when clipboard.read is unavailable or blocked", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        read: vi.fn().mockRejectedValue(new Error("blocked")),
        readText: vi.fn().mockResolvedValue("<svg></svg>"),
      },
    });

    await expect(readClipboardImportPayload()).resolves.toEqual({
      payload: {
        html: undefined,
        text: "<svg></svg>",
        svg: undefined,
        items: undefined,
      },
      context: {
        trigger: "clipboard-api",
        mimeTypes: [],
        hasHtml: false,
        hasText: true,
      },
    });
  });
});
