import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readClipboardImportPayload,
  readClipboardImportPayloadFromEvent,
  readDataTransferImportPayload,
  useCanvasClipboardImport,
} from "@/components/canvas/use-canvas-clipboard-import";

function createPasteEvent(data: Record<string, string>, files: File[] = []) {
  const event = new Event("paste", {
    bubbles: true,
    cancelable: true,
  }) as ClipboardEvent;
  const items = [
    ...Object.keys(data).map((type) => ({
      kind: "string",
      type,
      getAsFile: () => null,
    })),
    ...files.map((file) => ({
      kind: "file",
      type: file.type,
      getAsFile: () => file,
    })),
  ];
  Object.defineProperty(event, "clipboardData", {
    value: {
      types: [...Object.keys(data), ...files.map((file) => file.type)],
      items,
      files,
      getData: (type: string) => data[type] ?? "",
    },
  });
  return event;
}

function createDataTransfer(data: Record<string, string>, files: File[] = []) {
  const items = [
    ...Object.keys(data).map((type) => ({
      kind: "string",
      type,
      getAsFile: () => null,
    })),
    ...files.map((file) => ({
      kind: "file",
      type: file.type,
      getAsFile: () => file,
    })),
  ];
  return {
    types: [...Object.keys(data), ...(files.length > 0 ? ["Files"] : [])],
    items,
    files,
    getData: (type: string) => data[type] ?? "",
  } as unknown as DataTransfer;
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
        files: undefined,
      },
      {
        trigger: "paste-event",
        mimeTypes: ["text/html", "text/plain"],
        itemTypes: ["text/html", "text/plain"],
        hasHtml: true,
        hasText: true,
      },
    );
    expect(event.defaultPrevented).toBe(true);
  });

  it("enriches HTML paste events with Clipboard API MIME payloads", async () => {
    const onImportPayload = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        read: vi.fn().mockResolvedValue([
          {
            types: ["image/svg+xml"],
            getType: vi.fn().mockResolvedValue(
              new Blob(["<svg><circle /></svg>"], {
                type: "image/svg+xml",
              }),
            ),
          },
        ]),
        readText: vi.fn().mockResolvedValue(""),
      },
    });
    await mountHook(onImportPayload);

    const event = createPasteEvent({
      "text/html": "<div data-buffer='1'></div>",
      "text/plain": "fallback",
    });
    document.body.dispatchEvent(event);

    await expect.poll(() => onImportPayload.mock.calls.length).toBe(1);

    expect(event.defaultPrevented).toBe(true);
    expect(onImportPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        html: "<div data-buffer='1'></div>",
        text: "fallback",
        svg: "<svg><circle /></svg>",
      }),
      expect.objectContaining({
        trigger: "paste-event",
        mimeTypes: ["text/html", "text/plain", "image/svg+xml"],
        itemTypes: ["text/html", "text/plain", "image/svg+xml"],
      }),
    );
  });

  it("reads paste event file items as image data URLs", async () => {
    const originalImage = globalThis.Image;
    Object.defineProperty(globalThis, "Image", {
      configurable: true,
      value: undefined,
    });
    const file = new File([new Uint8Array([1, 2, 3])], "paste.png", {
      type: "image/png",
    });
    const event = createPasteEvent({ "text/plain": "" }, [file]);

    const result = await readClipboardImportPayloadFromEvent(event);

    expect(result.context.mimeTypes).toContain("image/png");
    expect(result.context.fileTypes).toContain("image/png");
    expect(result.payload.files?.[0]).toMatchObject({
      type: "image/png",
      name: "paste.png",
    });
    expect(result.payload.files?.[0]?.dataUrl).toMatch(
      /^data:image\/png;base64,/,
    );

    Object.defineProperty(globalThis, "Image", {
      configurable: true,
      value: originalImage,
    });
  });

  it("reads drop event SVG files as SVG import payloads", async () => {
    const file = new File(
      ["<svg><rect width='10' height='10' /></svg>"],
      "asset.svg",
      {
        type: "image/svg+xml",
      },
    );

    const result = await readDataTransferImportPayload(
      createDataTransfer({}, [file]),
    );

    expect(result.context).toMatchObject({
      trigger: "drop-event",
      mimeTypes: ["Files", "image/svg+xml"],
      fileTypes: ["image/svg+xml"],
      hasHtml: false,
      hasText: false,
    });
    expect(result.payload.svg).toBe(
      "<svg><rect width='10' height='10' /></svg>",
    );
    expect(result.payload.items).toEqual([
      {
        type: "image/svg+xml",
        text: "<svg><rect width='10' height='10' /></svg>",
      },
    ]);
    expect(result.payload.files).toBeUndefined();
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
        files: undefined,
      },
      context: {
        trigger: "clipboard-api",
        mimeTypes: [],
        hasHtml: false,
        hasText: true,
      },
    });
  });

  it("reads Clipboard API image blobs alongside text MIME items", async () => {
    const originalImage = globalThis.Image;
    Object.defineProperty(globalThis, "Image", {
      configurable: true,
      value: undefined,
    });
    const getType = vi.fn(async (type: string) => {
      if (type === "text/html") {
        return new Blob(["<div data-buffer='1'></div>"], {
          type: "text/html",
        });
      }
      return new Blob([new Uint8Array([137, 80, 78, 71])], {
        type: "image/png",
      });
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        read: vi.fn().mockResolvedValue([
          {
            types: ["text/html", "image/png"],
            getType,
          },
        ]),
        readText: vi.fn(),
      },
    });

    const result = await readClipboardImportPayload();

    expect(result.context).toMatchObject({
      trigger: "clipboard-api",
      mimeTypes: ["text/html", "image/png"],
      hasHtml: true,
      hasText: false,
    });
    expect(result.payload.items).toEqual([
      { type: "text/html", text: "<div data-buffer='1'></div>" },
    ]);
    expect(result.payload.files?.[0]?.type).toBe("image/png");
    expect(result.payload.files?.[0]?.dataUrl).toMatch(
      /^data:image\/png;base64,/,
    );

    Object.defineProperty(globalThis, "Image", {
      configurable: true,
      value: originalImage,
    });
  });
});
