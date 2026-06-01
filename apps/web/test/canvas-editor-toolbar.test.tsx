// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CanvasBooleanToolbar } from "@/components/canvas/boolean-toolbar";
import type { CanvasTool } from "@/components/canvas/canvas-api";
import { CanvasEditorToolbar } from "@/components/canvas/editor-toolbar";

function renderEditorToolbar(
  overrides: Partial<React.ComponentProps<typeof CanvasEditorToolbar>> = {},
) {
  const props = {
    activeTool: "select" as CanvasTool,
    canRedo: true,
    canUndo: false,
    selectedCount: 1,
    onCreateContainer: vi.fn(),
    onDelete: vi.fn(),
    onInsertIcon: vi.fn(),
    onImportImage: vi.fn(),
    onImportSvg: vi.fn(),
    onRedo: vi.fn(),
    onToolChange: vi.fn(),
    onUndo: vi.fn(),
    ...overrides,
  } satisfies React.ComponentProps<typeof CanvasEditorToolbar>;

  render(<CanvasEditorToolbar {...props} />);

  return props;
}

describe("CanvasEditorToolbar", () => {
  it("keeps undo disabled and switches to the text tool", async () => {
    const user = userEvent.setup();
    const props = renderEditorToolbar();

    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Text" }));
    await user.click(screen.getByRole("button", { name: "Sticky" }));
    await user.click(screen.getByRole("button", { name: "Connector" }));
    await user.click(screen.getByRole("button", { name: "Section" }));

    expect(props.onUndo).not.toHaveBeenCalled();
    expect(props.onToolChange).toHaveBeenNthCalledWith(1, "text");
    expect(props.onToolChange).toHaveBeenNthCalledWith(2, "sticky");
    expect(props.onToolChange).toHaveBeenNthCalledWith(3, "connector");
    expect(props.onToolChange).toHaveBeenNthCalledWith(4, "section");
  });

  it("chooses shape tools and exposes insert/import actions from the shape menu", async () => {
    const user = userEvent.setup();
    const props = renderEditorToolbar();

    await user.click(screen.getByRole("button", { name: "Open shape menu" }));
    await user.click(await screen.findByRole("menuitem", { name: /Ellipse/ }));

    expect(props.onToolChange).toHaveBeenCalledWith("ellipse");

    await user.click(screen.getByRole("button", { name: "Open shape menu" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Import image" }),
    );
    await user.click(screen.getByRole("button", { name: "Open shape menu" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Insert icon" }),
    );
    await user.click(screen.getByRole("button", { name: "Open shape menu" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Import SVG" }),
    );

    expect(props.onInsertIcon).toHaveBeenCalledOnce();
    expect(props.onImportImage).toHaveBeenCalledOnce();
    expect(props.onImportSvg).toHaveBeenCalledOnce();
  });

  it("does not expose icon insertion when no icon insertion callback is wired", async () => {
    const user = userEvent.setup();
    const props = renderEditorToolbar({ onInsertIcon: undefined });

    await user.click(screen.getByRole("button", { name: "Open shape menu" }));

    expect(screen.queryByText("Insert icon")).not.toBeInTheDocument();
    expect(props.onToolChange).not.toHaveBeenCalled();
  });
});

describe("CanvasBooleanToolbar", () => {
  it("applies a boolean operation from accessible controls", async () => {
    const user = userEvent.setup();
    const onBooleanOperation = vi.fn();

    render(
      <CanvasBooleanToolbar
        onBooleanOperation={onBooleanOperation}
        rejectionReason={null}
        visible
      />,
    );

    await user.click(screen.getByRole("button", { name: "Union" }));

    expect(onBooleanOperation).toHaveBeenCalledWith("union");
  });

  it("hides when not visible and disables operations with a readable reason", () => {
    const onBooleanOperation = vi.fn();
    const { rerender } = render(
      <CanvasBooleanToolbar
        onBooleanOperation={onBooleanOperation}
        rejectionReason={null}
        visible={false}
      />,
    );

    expect(
      screen.queryByRole("toolbar", { name: "Boolean operations" }),
    ).not.toBeInTheDocument();

    rerender(
      <CanvasBooleanToolbar
        onBooleanOperation={onBooleanOperation}
        rejectionReason="Select at least two supported vector shapes."
        visible
      />,
    );

    const subtract = screen.getByRole("button", { name: "Subtract" });
    expect(subtract).toBeDisabled();
    expect(subtract).toHaveAttribute(
      "title",
      "Select at least two supported vector shapes.",
    );
    expect(onBooleanOperation).not.toHaveBeenCalled();
  });
});
