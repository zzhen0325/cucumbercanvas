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

const styledTextNode: PenNode = {
  ...textNode,
  content: [
    {
      text: "Hello",
      fill: "#111827",
      fontFamily: "Inter",
      fontPostScriptName: "Inter-Regular",
      fontSize: 18,
    },
    {
      text: "World",
      baselineShift: 2,
      fills: [{ type: "solid", color: "#ef4444" }],
      fontFamily: "Inter",
      fontSize: 20,
      textCase: "upper",
    },
  ],
  fontFallback: ["Arial", "Helvetica"],
  fontPostScriptName: "Inter-Regular",
  listStyle: "none",
  openTypeFeatures: { kern: 1, liga: true },
  paragraphSpacing: 4,
  textAlignVertical: "top",
  textCase: "original",
  textGrowth: "fixed-width-height",
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

const ellipseNode: PenNode = {
  fill: [{ type: "solid", color: "#fef3c7" }],
  height: 100,
  id: "ellipse-1",
  innerRadius: 0.25,
  startAngle: 15,
  sweepAngle: 220,
  type: "ellipse",
  width: 120,
  x: 0,
  y: 0,
};

const polygonNode: PenNode = {
  fill: [{ type: "solid", color: "#a7f3d0" }],
  height: 120,
  id: "polygon-1",
  innerRadius: 0.4,
  polygonCount: 5,
  polygonKind: "star",
  startAngle: -90,
  type: "polygon",
  width: 120,
  x: 0,
  y: 0,
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

const figmaReferenceNode: PenNode = {
  ...rectangleNode,
  componentRef: {
    componentId: "component-1",
    id: "instance-1",
    key: "component-key",
    overrideCount: 1,
    overrides: [
      {
        path: "root/button",
        pathIds: ["root", "button"],
        properties: ["fill"],
        source: "figma",
        targetId: "button",
        values: { fill: "#ff0000" },
      },
    ],
    propertyAssignments: { label: "Start" },
    source: "figma",
    type: "instance",
    variantProperties: { Size: "Large" },
  },
  layoutRef: {
    alignSelf: "auto",
    grow: 0,
    heightMode: "fixed",
    positioning: "auto",
    source: "figma",
    widthMode: "fixed",
  },
  mask: {
    enabled: false,
    sourceNodeId: "mask-source",
    type: "alpha",
  },
  styleRefs: {
    effect: { id: "effect-style", source: "figma" },
    fill: { id: "fill-style", source: "figma" },
  },
  variableRefs: {
    "fills/0/color": "VariableID:1",
  },
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

  it("updates transform matrix, scale, and skew controls", () => {
    const { onUpdate } = renderPropertyPanel({
      ...rectangleNode,
      scaleX: 1.2,
      scaleY: 0.9,
      skewX: 4,
      skewY: -2,
      transform: { m00: 1, m01: 0.1, m02: 12, m10: 0.2, m11: 1, m12: 34 },
    });

    fireEvent.change(screen.getByRole("spinbutton", { name: "Scale X" }), {
      target: { value: "1.5" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Skew Y" }), {
      target: { value: "6" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "矩阵 m01" }), {
      target: { value: "0.35" },
    });

    expect(onUpdate).toHaveBeenCalledWith({ scaleX: 1.5 });
    expect(onUpdate).toHaveBeenCalledWith({ skewY: 6 });
    expect(onUpdate).toHaveBeenCalledWith({
      transform: { m00: 1, m01: 0.35, m02: 12, m10: 0.2, m11: 1, m12: 34 },
    });
  });

  it("updates layout sizing, child positioning, grow, and layout clip refs", async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderPropertyPanel(figmaReferenceNode);

    fireEvent.change(screen.getByLabelText("宽度模式"), {
      target: { value: "fill_container" },
    });
    fireEvent.change(screen.getByLabelText("高度模式"), {
      target: { value: "fit_content" },
    });
    fireEvent.change(screen.getByLabelText("子项定位"), {
      target: { value: "absolute" },
    });
    fireEvent.change(screen.getByLabelText("自身对齐"), {
      target: { value: "stretch" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "布局 Grow" }), {
      target: { value: "2" },
    });
    await user.click(screen.getByRole("checkbox", { name: "布局裁剪" }));

    expect(onUpdate).toHaveBeenCalledWith({
      width: "fill_container",
      layoutRef: expect.objectContaining({
        source: "figma",
        widthMode: "fill_container",
      }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      height: "fit_content",
      layoutRef: expect.objectContaining({
        heightMode: "fit_content",
        source: "figma",
      }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      layoutRef: expect.objectContaining({
        positioning: "absolute",
        source: "figma",
      }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      layoutRef: expect.objectContaining({
        alignSelf: "stretch",
        source: "figma",
      }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      layoutRef: expect.objectContaining({ grow: 2, source: "figma" }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      layoutRef: expect.objectContaining({
        clipContent: true,
        source: "figma",
      }),
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

  it("updates node blend mode and layered fill fidelity controls", async () => {
    const user = userEvent.setup();
    const firstFill = {
      type: "solid" as const,
      color: "#3366ff",
      opacity: 0.75,
      visible: false,
      blendMode: "multiply" as const,
    };
    const secondFill = {
      type: "image" as const,
      url: "__hash:figma-image",
      mode: "crop" as const,
      opacity: 0.5,
      visible: true,
      blendMode: "screen" as const,
      originalSize: { width: 640, height: 480 },
    };
    const { onUpdate } = renderPropertyPanel({
      ...rectangleNode,
      blendMode: "screen",
      fill: [firstFill, secondFill],
    });

    fireEvent.change(screen.getByLabelText("图层混合模式"), {
      target: { value: "overlay" },
    });
    await user.click(screen.getByRole("button", { name: "显示填充 1" }));
    fireEvent.change(screen.getByLabelText("填充 1 类型"), {
      target: { value: "linear_gradient" },
    });
    fireEvent.change(screen.getByLabelText("填充 1 混合模式"), {
      target: { value: "darken" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "填充 2 透明" }), {
      target: { value: "65" },
    });
    fireEvent.change(screen.getByLabelText("填充 2 图片模式"), {
      target: { value: "stretch" },
    });
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "填充 2 原始宽度" }),
      { target: { value: "800" } },
    );
    await user.click(screen.getByRole("button", { name: "上移填充 2" }));

    expect(onUpdate).toHaveBeenCalledWith({ blendMode: "overlay" });
    expect(onUpdate).toHaveBeenCalledWith({
      fill: [{ ...firstFill, visible: true }, secondFill],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      fill: [
        expect.objectContaining({
          type: "linear_gradient",
          opacity: 0.75,
          visible: false,
          blendMode: "multiply",
        }),
        secondFill,
      ],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      fill: [{ ...firstFill, blendMode: "darken" }, secondFill],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      fill: [firstFill, { ...secondFill, opacity: 0.65 }],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      fill: [firstFill, { ...secondFill, mode: "stretch" }],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      fill: [
        firstFill,
        { ...secondFill, originalSize: { width: 800, height: 480 } },
      ],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      fill: [secondFill, firstFill],
    });
  });

  it("updates advanced stroke fidelity controls from the inspector", () => {
    const { onUpdate } = renderPropertyPanel({
      ...rectangleNode,
      stroke: {
        align: "inside",
        cap: "none",
        dashOffset: 1,
        dashPattern: [4, 2],
        fill: [{ type: "solid", color: "#111827", opacity: 1 }],
        join: "miter",
        miterLimit: 4,
        thickness: 2,
      },
    });

    fireEvent.change(screen.getByLabelText("端点"), {
      target: { value: "round" },
    });
    fireEvent.change(screen.getByLabelText("连接"), {
      target: { value: "bevel" },
    });
    const dashInput = screen.getByLabelText("虚线");
    fireEvent.change(dashInput, { target: { value: "6 3" } });
    fireEvent.blur(dashInput);
    fireEvent.change(screen.getByRole("spinbutton", { name: "右" }), {
      target: { value: "7" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "斜接" }), {
      target: { value: "9" },
    });

    expect(onUpdate).toHaveBeenCalledWith({
      stroke: expect.objectContaining({ cap: "round" }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      stroke: expect.objectContaining({ join: "bevel" }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      stroke: expect.objectContaining({ dashPattern: [6, 3] }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      stroke: expect.objectContaining({ thickness: [2, 7, 2, 2] }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      stroke: expect.objectContaining({ miterLimit: 9 }),
    });
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

  it("updates advanced root typography and styled text segment controls", () => {
    const { onUpdate } = renderPropertyPanel(styledTextNode);

    fireEvent.change(screen.getByLabelText("PostScript 字体名"), {
      target: { value: "Inter-SemiBold" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "段落间距" }), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText("垂直对齐"), {
      target: { value: "middle" },
    });
    fireEvent.change(screen.getByLabelText("文本自适应"), {
      target: { value: "auto" },
    });
    fireEvent.change(screen.getByLabelText("大小写"), {
      target: { value: "title" },
    });
    fireEvent.change(screen.getByLabelText("列表样式"), {
      target: { value: "unordered" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "文本缩进" }), {
      target: { value: "24" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "悬挂缩进" }), {
      target: { value: "8" },
    });
    const fallbackInput = screen.getByLabelText("字体 fallback");
    fireEvent.change(fallbackInput, { target: { value: "Arial, Roboto" } });
    fireEvent.blur(fallbackInput);
    const openTypeInput = screen.getByLabelText("OpenType 特性");
    fireEvent.change(openTypeInput, {
      target: { value: "liga=false, kern=1" },
    });
    fireEvent.blur(openTypeInput);
    fireEvent.click(screen.getByRole("button", { name: "Strike" }));

    fireEvent.change(screen.getByLabelText("文本段 1"), {
      target: { value: "Hello!" },
    });
    fireEvent.change(screen.getByLabelText("文本段 1 字体"), {
      target: { value: "Roboto" },
    });
    fireEvent.change(screen.getByLabelText("文本段 1 PostScript"), {
      target: { value: "Roboto-Regular" },
    });
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "文本段 1 字号" }),
      { target: { value: "22" } },
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "文本段 1 字距" }),
      { target: { value: "1.5" } },
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "文本段 1 基线" }),
      { target: { value: "3" } },
    );
    fireEvent.change(screen.getByLabelText("文本段 1 大小写"), {
      target: { value: "upper" },
    });

    expect(onUpdate).toHaveBeenCalledWith({
      fontPostScriptName: "Inter-SemiBold",
    });
    expect(onUpdate).toHaveBeenCalledWith({ paragraphSpacing: 12 });
    expect(onUpdate).toHaveBeenCalledWith({ textAlignVertical: "middle" });
    expect(onUpdate).toHaveBeenCalledWith({ textGrowth: "auto" });
    expect(onUpdate).toHaveBeenCalledWith({ textCase: "title" });
    expect(onUpdate).toHaveBeenCalledWith({ listStyle: "unordered" });
    expect(onUpdate).toHaveBeenCalledWith({ indent: 24 });
    expect(onUpdate).toHaveBeenCalledWith({ hangingIndent: 8 });
    expect(onUpdate).toHaveBeenCalledWith({
      fontFallback: ["Arial", "Roboto"],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      openTypeFeatures: { liga: false, kern: 1 },
    });
    expect(onUpdate).toHaveBeenCalledWith({ strikethrough: true });
    expect(onUpdate).toHaveBeenCalledWith({
      content: [
        expect.objectContaining({ text: "Hello!" }),
        expect.objectContaining({ text: "World" }),
      ],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      content: [
        expect.objectContaining({ fontFamily: "Roboto" }),
        expect.objectContaining({ text: "World" }),
      ],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      content: [
        expect.objectContaining({ fontPostScriptName: "Roboto-Regular" }),
        expect.objectContaining({ text: "World" }),
      ],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      content: [
        expect.objectContaining({ fontSize: 22 }),
        expect.objectContaining({ text: "World" }),
      ],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      content: [
        expect.objectContaining({ letterSpacing: 1.5 }),
        expect.objectContaining({ text: "World" }),
      ],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      content: [
        expect.objectContaining({ baselineShift: 3 }),
        expect.objectContaining({ text: "World" }),
      ],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      content: [
        expect.objectContaining({ textCase: "upper" }),
        expect.objectContaining({ text: "World" }),
      ],
    });
  });

  it("updates clipping, corner details, and stretch layout controls", async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderPropertyPanel({
      ...frameNode,
      clipContent: false,
      cornerRadius: [4, 8, 12, 16],
      cornerSmoothing: 0.25,
    });

    fireEvent.change(screen.getByLabelText("交叉对齐"), {
      target: { value: "stretch" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "内边距右" }), {
      target: { value: "20" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "右下" }), {
      target: { value: "18" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "平滑" }), {
      target: { value: "60" },
    });
    await user.click(screen.getByRole("checkbox", { name: /裁剪内容/ }));
    await user.click(screen.getByRole("checkbox", { name: "隔离混合" }));

    expect(onUpdate).toHaveBeenCalledWith({ alignItems: "stretch" });
    expect(onUpdate).toHaveBeenCalledWith({ padding: [12, 20, 12, 12] });
    expect(onUpdate).toHaveBeenCalledWith({
      cornerRadius: [4, 8, 18, 16],
    });
    expect(onUpdate).toHaveBeenCalledWith({ cornerSmoothing: 0.6 });
    expect(onUpdate).toHaveBeenCalledWith({ clipContent: true });
    expect(onUpdate).toHaveBeenCalledWith({ isolated: true });
  });

  it("updates mask, style refs, variable refs, and component refs from UI", () => {
    const { onUpdate } = renderPropertyPanel(figmaReferenceNode);

    fireEvent.click(screen.getByRole("checkbox", { name: "启用遮罩" }));
    fireEvent.change(screen.getByLabelText("遮罩类型"), {
      target: { value: "vector" },
    });
    fireEvent.change(screen.getByLabelText("遮罩来源节点"), {
      target: { value: "new-mask" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "断开遮罩链" }));

    fireEvent.change(screen.getByLabelText("填充样式"), {
      target: { value: "fill-style-2" },
    });
    const variableRefsInput = screen.getByLabelText("变量引用 JSON");
    fireEvent.change(variableRefsInput, {
      target: { value: '{"fills/1/color":"VariableID:2"}' },
    });
    fireEvent.blur(variableRefsInput);

    fireEvent.change(screen.getByLabelText("组件引用类型"), {
      target: { value: "variant" },
    });
    fireEvent.change(screen.getByLabelText("组件引用 Key"), {
      target: { value: "component-key-2" },
    });
    const variantInput = screen.getByLabelText("组件变体 JSON");
    fireEvent.change(variantInput, {
      target: { value: '{"State":"Active"}' },
    });
    fireEvent.blur(variantInput);
    const assignmentsInput = screen.getByLabelText("组件属性赋值 JSON");
    fireEvent.change(assignmentsInput, {
      target: { value: '{"buttonText":"Launch"}' },
    });
    fireEvent.blur(assignmentsInput);
    const overridesInput = screen.getByLabelText("组件覆写 JSON");
    fireEvent.change(overridesInput, {
      target: {
        value:
          '[{"source":"figma","path":"root/icon","properties":["visible"]}]',
      },
    });
    fireEvent.blur(overridesInput);

    expect(onUpdate).toHaveBeenCalledWith({
      mask: expect.objectContaining({
        enabled: true,
        sourceNodeId: "mask-source",
      }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      mask: expect.objectContaining({ type: "vector" }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      mask: expect.objectContaining({ sourceNodeId: "new-mask" }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      mask: expect.objectContaining({ shouldBreakMaskChain: true }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      styleRefs: expect.objectContaining({
        fill: { id: "fill-style-2", source: "figma" },
      }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      variableRefs: { "fills/1/color": "VariableID:2" },
    });
    expect(onUpdate).toHaveBeenCalledWith({
      componentRef: expect.objectContaining({
        source: "figma",
        type: "variant",
      }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      componentRef: expect.objectContaining({
        key: "component-key-2",
        source: "figma",
      }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      componentRef: expect.objectContaining({
        source: "figma",
        variantProperties: { State: "Active" },
      }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      componentRef: expect.objectContaining({
        propertyAssignments: { buttonText: "Launch" },
        source: "figma",
      }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      componentRef: expect.objectContaining({
        overrides: [
          {
            path: "root/icon",
            properties: ["visible"],
            source: "figma",
          },
        ],
        source: "figma",
      }),
    });
  });

  it("updates ellipse arc, polygon star, line endpoint, and path winding controls", () => {
    const { onUpdate, rerender } = renderPropertyPanel(ellipseNode);

    fireEvent.change(screen.getByRole("spinbutton", { name: "起始角度" }), {
      target: { value: "45" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "扫过角度" }), {
      target: { value: "180" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "内径比例" }), {
      target: { value: "0.5" },
    });

    expect(onUpdate).toHaveBeenCalledWith({ startAngle: 45 });
    expect(onUpdate).toHaveBeenCalledWith({ sweepAngle: 180 });
    expect(onUpdate).toHaveBeenCalledWith({ innerRadius: 0.5 });

    onUpdate.mockClear();
    rerender(
      <CanvasPropertyPanel
        node={polygonNode}
        onBindAgent={vi.fn()}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.change(screen.getByLabelText("多边形类型"), {
      target: { value: "polygon" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "边数" }), {
      target: { value: "7" },
    });
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "多边形起始角度" }),
      { target: { value: "-45" } },
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "多边形圆角" }), {
      target: { value: "6" },
    });

    expect(onUpdate).toHaveBeenCalledWith({ polygonKind: "polygon" });
    expect(onUpdate).toHaveBeenCalledWith({ polygonCount: 7 });
    expect(onUpdate).toHaveBeenCalledWith({ startAngle: -45 });
    expect(onUpdate).toHaveBeenCalledWith({ cornerRadius: 6 });

    onUpdate.mockClear();
    rerender(
      <CanvasPropertyPanel
        node={pathNode}
        onBindAgent={vi.fn()}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.change(screen.getByLabelText("路径填充规则"), {
      target: { value: "evenodd" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "闭合路径" }));

    expect(onUpdate).toHaveBeenCalledWith({ fillRule: "evenodd" });
    expect(onUpdate).toHaveBeenCalledWith({ closed: true });

    onUpdate.mockClear();
    rerender(
      <CanvasPropertyPanel
        node={lineNode}
        onBindAgent={vi.fn()}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.change(screen.getByRole("spinbutton", { name: "终点 X" }), {
      target: { value: "120" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "终点 Y" }), {
      target: { value: "24" },
    });

    expect(onUpdate).toHaveBeenCalledWith({ x2: 120 });
    expect(onUpdate).toHaveBeenCalledWith({ y2: 24 });
  });

  it("adds and updates layered effects with concrete payloads", async () => {
    const user = userEvent.setup();
    const { container, onUpdate } = renderPropertyPanel({
      ...rectangleNode,
      effects: undefined,
    });

    await user.click(screen.getByRole("button", { name: "添加效果" }));

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
    expect(container).not.toHaveTextContent(/\bnull\b|\bundefined\b/);
  });

  it("updates multi-effect stack visibility, type, blend, opacity, and order", async () => {
    const user = userEvent.setup();
    const firstEffect = {
      ...existingShadow,
      blendMode: "multiply" as const,
      opacity: 0.4,
      visible: false,
    };
    const secondEffect = {
      blendMode: "screen" as const,
      opacity: 0.25,
      radius: 12,
      type: "background_blur" as const,
      visible: true,
    };
    const { onUpdate } = renderPropertyPanel({
      ...rectangleNode,
      effects: [firstEffect, secondEffect],
    });

    await user.click(screen.getByRole("button", { name: "显示效果 1" }));
    fireEvent.change(screen.getByLabelText("效果 1 类型"), {
      target: { value: "inner_shadow" },
    });
    fireEvent.change(screen.getByLabelText("效果 1 混合模式"), {
      target: { value: "overlay" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "效果 1 扩展" }), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("效果 2 类型"), {
      target: { value: "blur" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "效果 2 透明" }), {
      target: { value: "75" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "效果 2 半径" }), {
      target: { value: "20" },
    });
    await user.click(screen.getByRole("button", { name: "上移效果 2" }));

    expect(onUpdate).toHaveBeenCalledWith({
      effects: [{ ...firstEffect, visible: true }, secondEffect],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      effects: [
        expect.objectContaining({
          blendMode: "multiply",
          blur: 8,
          color: "#00000080",
          inner: true,
          opacity: 0.4,
          spread: 1,
          type: "shadow",
          visible: false,
        }),
        secondEffect,
      ],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      effects: [{ ...firstEffect, blendMode: "overlay" }, secondEffect],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      effects: [{ ...firstEffect, spread: 3 }, secondEffect],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      effects: [firstEffect, { ...secondEffect, type: "blur" }],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      effects: [firstEffect, { ...secondEffect, opacity: 0.75 }],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      effects: [firstEffect, { ...secondEffect, radius: 20 }],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      effects: [secondEffect, firstEffect],
    });
  });

  it("updates existing effect values without leaking empty fields", () => {
    const { onUpdate } = renderPropertyPanel(nodeWithEffects);
    const effectsSection = screen.getByRole("heading", { name: "效果" })
      .parentElement?.parentElement;

    expect(effectsSection).toBeTruthy();
    fireEvent.change(
      within(effectsSection as HTMLElement).getByRole("spinbutton", {
        name: "效果 1 X",
      }),
      { target: { value: "12" } },
    );
    fireEvent.change(
      within(effectsSection as HTMLElement).getByRole("spinbutton", {
        name: "效果 2 半径",
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
    expect(screen.getByRole("spinbutton", { name: "效果 1 半径" })).toHaveValue(
      2,
    );
  });
});
