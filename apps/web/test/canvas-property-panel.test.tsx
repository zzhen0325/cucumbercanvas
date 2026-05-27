// @vitest-environment jsdom

import type { PenNode } from "@cucumber/canvas-core";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

const pathNode: PenNode = {
  d: "M0 0 C 20 10 40 10 60 0",
  fill: [{ type: "solid", color: "#22c55e", opacity: 0.5 }],
  height: 24,
  id: "path-1",
  name: "Bezier path",
  stroke: {
    align: "center",
    fill: [{ type: "solid", color: "#14532d", opacity: 0.8 }],
    thickness: 3,
  },
  type: "path",
  width: 80,
  x: 4,
  y: 8,
  anchors: [
    {
      handleIn: null,
      handleOut: { x: 20, y: 10 },
      x: 0,
      y: 0,
    },
  ],
};

const lineNode: PenNode = {
  effects: [{ type: "blur", radius: 2 }],
  id: "line-1",
  name: "Connector line",
  stroke: {
    align: "center",
    fill: [{ type: "solid", color: "#f97316", opacity: 1 }],
    thickness: 4,
  },
  type: "line",
  x: 10,
  x2: 106,
  y: 12,
  y2: 12,
};

const existingShadow = {
  blur: 8,
  color: "#00000080",
  offsetX: 2,
  offsetY: 6,
  spread: 1,
  type: "shadow" as const,
};

const existingBlur = { radius: 3, type: "blur" as const };

const nodeWithEffects: PenNode = {
  ...rectangleNode,
  effects: [existingShadow, existingBlur],
};

function renderPropertyPanel(
  node: PenNode = rectangleNode,
  overrides: Partial<React.ComponentProps<typeof CanvasPropertyPanel>> = {},
) {
  const onUpdate = vi.fn();
  const props = {
    node,
    onBindAgent: vi.fn(),
    onUpdate,
    ...overrides,
  } satisfies React.ComponentProps<typeof CanvasPropertyPanel>;

  const view = render(<CanvasPropertyPanel {...props} />);
  return { ...props, ...view, onUpdate };
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

  it("updates effects by toggling shadow and blur with concrete payloads", async () => {
    const user = userEvent.setup();
    const { container, onUpdate } = renderPropertyPanel({
      ...rectangleNode,
      effects: undefined,
    });

    await user.click(screen.getByRole("button", { name: /^阴影/ }));
    await user.click(screen.getByRole("button", { name: /^模糊/ }));

    expect(onUpdate).toHaveBeenCalledWith({
      effects: [
        {
          blur: 8,
          color: "#00000040",
          offsetX: 0,
          offsetY: 4,
          spread: 0,
          type: "shadow",
        },
      ],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      effects: [{ radius: 4, type: "blur" }],
    });
    expect(container).not.toHaveTextContent(/\bnull\b|\bundefined\b/);
  });

  it("preserves other effects when disabling an existing shadow or blur", async () => {
    const user = userEvent.setup();
    const { onUpdate, rerender } = renderPropertyPanel(nodeWithEffects);

    await user.click(screen.getByRole("button", { name: /^阴影/ }));

    expect(onUpdate).toHaveBeenCalledWith({
      effects: [existingBlur],
    });

    onUpdate.mockClear();
    rerender(
      <CanvasPropertyPanel
        node={nodeWithEffects}
        onBindAgent={vi.fn()}
        onUpdate={onUpdate}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^模糊/ }));

    expect(onUpdate).toHaveBeenCalledWith({
      effects: [existingShadow],
    });
  });

  it("preserves existing effects when enabling shadow or blur", async () => {
    const user = userEvent.setup();
    const { onUpdate, rerender } = renderPropertyPanel({
      ...rectangleNode,
      effects: [existingBlur],
    });

    await user.click(screen.getByRole("button", { name: /^阴影/ }));

    expect(onUpdate).toHaveBeenCalledWith({
      effects: [
        existingBlur,
        {
          blur: 8,
          color: "#00000040",
          offsetX: 0,
          offsetY: 4,
          spread: 0,
          type: "shadow",
        },
      ],
    });

    onUpdate.mockClear();
    rerender(
      <CanvasPropertyPanel
        node={{ ...rectangleNode, effects: [existingShadow] }}
        onBindAgent={vi.fn()}
        onUpdate={onUpdate}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^模糊/ }));

    expect(onUpdate).toHaveBeenCalledWith({
      effects: [existingShadow, { radius: 4, type: "blur" }],
    });
  });

  it("updates existing effect values without leaking empty fields", () => {
    const { onUpdate } = renderPropertyPanel(nodeWithEffects);
    const effectsSection = screen.getByRole("heading", { name: "效果" })
      .parentElement?.parentElement;

    expect(effectsSection).toBeTruthy();
    fireEvent.change(
      within(effectsSection as HTMLElement).getByRole("spinbutton", {
        name: "X",
      }),
      { target: { value: "12" } },
    );
    fireEvent.change(
      within(effectsSection as HTMLElement).getByRole("spinbutton", {
        name: "半径",
      }),
      { target: { value: "6" } },
    );

    expect(onUpdate).toHaveBeenCalledWith({
      effects: [
        {
          blur: 8,
          color: "#00000080",
          offsetX: 12,
          offsetY: 6,
          spread: 1,
          type: "shadow",
        },
        { radius: 3, type: "blur" },
      ],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      effects: [
        {
          blur: 8,
          color: "#00000080",
          offsetX: 2,
          offsetY: 6,
          spread: 1,
          type: "shadow",
        },
        { radius: 6, type: "blur" },
      ],
    });
    for (const [update] of onUpdate.mock.calls) {
      expect(JSON.stringify(update)).not.toMatch(/null|undefined/);
    }
  });

  it("exposes path paint and effects controls while emitting partial paint updates", () => {
    const { onUpdate } = renderPropertyPanel(pathNode);

    expect(screen.getByRole("heading", { name: "填充" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "描边" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "效果" })).toBeInTheDocument();

    const fillSection = screen.getByRole("heading", { name: "填充" })
      .parentElement?.parentElement;
    expect(fillSection).toBeTruthy();
    fireEvent.change(
      within(fillSection as HTMLElement).getByRole("spinbutton"),
      { target: { value: "65" } },
    );

    expect(onUpdate).toHaveBeenCalledWith({
      fill: [{ type: "solid", color: "#22c55e", opacity: 0.65 }],
    });
    const [update] = onUpdate.mock.calls.at(-1) ?? [];
    expect(update).not.toHaveProperty("d");
    expect(update).not.toHaveProperty("anchors");
  });

  it("limits line inspector to supported stroke and effects controls", () => {
    renderPropertyPanel(lineNode);

    expect(
      screen.queryByRole("heading", { name: "填充" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "描边" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "效果" })).toBeInTheDocument();
    expect(screen.getByText("F97316")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "半径" })).toHaveValue(2);
  });
});
