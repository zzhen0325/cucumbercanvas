// @vitest-environment jsdom

import type { PenNode } from "@cucumber/canvas-core";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CanvasPropertyPanel } from "@/components/canvas/property-panel/canvas-property-panel";

const rectangleNode: PenNode = {
  fill: [{ type: "solid", color: "#3366ff", opacity: 0.75 }],
  height: 80,
  id: "rect-1",
  name: "Hero block",
  rotation: 5,
  stroke: {
    align: "inside",
    fill: [{ type: "solid", color: "#111827", opacity: 1 }],
    thickness: 2,
  },
  type: "rectangle",
  width: 120,
  x: 12,
  y: 34,
};

const frameNode: PenNode = {
  alignItems: "start",
  children: [],
  gap: 8,
  height: 180,
  id: "frame-1",
  justifyContent: "start",
  layout: "vertical",
  padding: 12,
  type: "frame",
  width: 240,
  x: 0,
  y: 0,
};

const textNode: PenNode = {
  content: "Launch copy",
  fill: [{ type: "solid", color: "#111827" }],
  fontFamily: "Inter",
  fontSize: 18,
  height: 40,
  id: "text-1",
  textAlign: "left",
  type: "text",
  width: 180,
  x: 0,
  y: 0,
};

function renderPropertyPanel(
  node: PenNode = rectangleNode,
  overrides: Partial<React.ComponentProps<typeof CanvasPropertyPanel>> = {},
) {
  const props = {
    node,
    onBindAgent: vi.fn(),
    onUpdate: vi.fn(),
    ...overrides,
  } satisfies React.ComponentProps<typeof CanvasPropertyPanel>;

  const view = render(<CanvasPropertyPanel {...props} />);
  return { ...props, ...view };
}

describe("CanvasPropertyPanel", () => {
  it("updates selected-node bounds and rotation with full bound payloads", () => {
    const { onUpdate } = renderPropertyPanel();

    fireEvent.change(screen.getByRole("spinbutton", { name: "X" }), {
      target: { value: "25" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "旋转" }), {
      target: { value: "15" },
    });

    expect(onUpdate).toHaveBeenCalledWith({
      height: 80,
      rotation: 5,
      width: 120,
      x: 25,
      y: 34,
    });
    expect(onUpdate).toHaveBeenCalledWith({
      height: 80,
      rotation: 15,
      width: 120,
      x: 12,
      y: 34,
    });
  });

  it("updates lock and visibility without rendering raw empty values", async () => {
    const user = userEvent.setup();
    const { container, onUpdate } = renderPropertyPanel();

    await user.click(screen.getByRole("button", { name: "锁定" }));
    await user.click(screen.getByRole("button", { name: "隐藏图层" }));

    expect(onUpdate).toHaveBeenCalledWith({ locked: true });
    expect(onUpdate).toHaveBeenCalledWith({ visible: false });
    expect(container).not.toHaveTextContent(/\bnull\b|\bundefined\b/);
  });

  it("shows fill and stroke controls for paint nodes", () => {
    renderPropertyPanel();

    expect(screen.getByRole("heading", { name: "填充" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "描边" })).toBeInTheDocument();
    expect(screen.getByText("3366FF")).toBeInTheDocument();
    expect(screen.getByText("111827")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "宽度" })).toHaveValue(2);
  });

  it("shows text controls for text nodes and layout controls for frame nodes", () => {
    const { rerender } = renderPropertyPanel(textNode);

    expect(
      screen.getByRole("heading", { name: "字体排印" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "文本内容" }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("Launch copy")).toBeInTheDocument();

    rerender(
      <CanvasPropertyPanel
        node={frameNode}
        onBindAgent={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "布局" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "间距" })).toHaveValue(8);
    expect(screen.getByRole("spinbutton", { name: "内边距" })).toHaveValue(12);
  });
});
