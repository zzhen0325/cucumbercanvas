import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCanvasKeyboardShortcuts } from "@/components/canvas/use-canvas-keyboard-shortcuts";

function createOptions(
  overrides: Partial<Parameters<typeof useCanvasKeyboardShortcuts>[0]> = {},
) {
  return {
    undo: vi.fn(),
    redo: vi.fn(),
    selectAll: vi.fn(),
    copySelection: vi.fn().mockReturnValue(false),
    cutSelection: vi.fn(),
    pasteClipboard: vi.fn().mockReturnValue([]),
    pasteFromSystemClipboard: vi.fn().mockResolvedValue([]),
    duplicateSelection: vi.fn().mockReturnValue([]),
    deleteSelection: vi.fn(),
    groupSelection: vi.fn().mockReturnValue(null),
    ungroupSelection: vi.fn().mockReturnValue([]),
    nudgeSelection: vi.fn(),
    reorderSelection: vi.fn(),
    setActiveTool: vi.fn(),
    ...overrides,
  };
}

function HookHarness({
  options,
}: {
  options: Parameters<typeof useCanvasKeyboardShortcuts>[0];
}) {
  useCanvasKeyboardShortcuts(options);
  return <div>keyboard hook</div>;
}

describe("useCanvasKeyboardShortcuts paste handling", () => {
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

  async function mountHook(
    options: Parameters<typeof useCanvasKeyboardShortcuts>[0],
  ) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<HookHarness options={options} />);
    });
  }

  it("lets native paste events carry Figma clipboard HTML when the internal canvas clipboard is empty", async () => {
    const options = createOptions();
    await mountHook(options);

    const event = new KeyboardEvent("keydown", {
      key: "v",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(options.pasteClipboard).toHaveBeenCalledOnce();
    expect(options.pasteFromSystemClipboard).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("prevents default browser paste when internal canvas nodes are pasted", async () => {
    const options = createOptions({
      pasteClipboard: vi.fn().mockReturnValue(["node-1"]),
    });
    await mountHook(options);

    const event = new KeyboardEvent("keydown", {
      key: "v",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(options.pasteClipboard).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });
});
