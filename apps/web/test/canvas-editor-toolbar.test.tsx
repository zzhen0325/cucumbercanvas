// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CANVAS_NODE_TEMPLATE_MIME } from "@/components/canvas/agent-node-template-drag";
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
    onCreateAgentUserGoal: vi.fn(),
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

    expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "文本" }));
    await user.click(screen.getByRole("button", { name: "便签" }));
    await user.click(screen.getByRole("button", { name: "连接线" }));
    await user.click(screen.getByRole("button", { name: "分区" }));

    expect(props.onUndo).not.toHaveBeenCalled();
    expect(props.onToolChange).toHaveBeenNthCalledWith(1, "text");
    expect(props.onToolChange).toHaveBeenNthCalledWith(2, "sticky");
    expect(props.onToolChange).toHaveBeenNthCalledWith(3, "connector");
    expect(props.onToolChange).toHaveBeenNthCalledWith(4, "section");
  });

  it("chooses shape tools and exposes insert/import actions from the shape menu", async () => {
    const user = userEvent.setup();
    const props = renderEditorToolbar();

    await user.click(screen.getByRole("button", { name: "打开形状菜单" }));
    await user.click(await screen.findByRole("menuitem", { name: /椭圆/ }));

    expect(props.onToolChange).toHaveBeenCalledWith("ellipse");

    await user.click(screen.getByRole("button", { name: "打开形状菜单" }));
    await user.click(await screen.findByRole("menuitem", { name: "导入图片" }));
    await user.click(screen.getByRole("button", { name: "打开形状菜单" }));
    await user.click(await screen.findByRole("menuitem", { name: "插入图标" }));
    await user.click(screen.getByRole("button", { name: "打开形状菜单" }));
    await user.click(await screen.findByRole("menuitem", { name: "导入 SVG" }));

    expect(props.onInsertIcon).toHaveBeenCalledOnce();
    expect(props.onImportImage).toHaveBeenCalledOnce();
    expect(props.onImportSvg).toHaveBeenCalledOnce();
  });

  it("creates and exposes a draggable user-goal Agent node template", async () => {
    const user = userEvent.setup();
    const props = renderEditorToolbar();
    const userGoalButton = screen.getByRole("button", { name: "用户目标" });

    await user.click(userGoalButton);

    expect(props.onCreateAgentUserGoal).toHaveBeenCalledOnce();

    const dataTransfer = {
      effectAllowed: "none",
      setData: vi.fn(),
    } as unknown as DataTransfer;

    fireEvent.dragStart(userGoalButton, { dataTransfer });

    expect(dataTransfer.effectAllowed).toBe("copy");
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      CANVAS_NODE_TEMPLATE_MIME,
      JSON.stringify({ type: "agent_user_goal" }),
    );
  });

  it("does not expose icon insertion when no icon insertion callback is wired", async () => {
    const user = userEvent.setup();
    const props = renderEditorToolbar({ onInsertIcon: undefined });

    await user.click(screen.getByRole("button", { name: "打开形状菜单" }));

    expect(screen.queryByText("插入图标")).not.toBeInTheDocument();
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
