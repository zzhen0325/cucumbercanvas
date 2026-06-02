// @vitest-environment jsdom

import type { PenNode } from "@cucumber/canvas-core";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CanvasPropertyPanel } from "@/components/canvas/property-panel/canvas-property-panel";
import { createStickyNoteNode } from "@/components/canvas/sticky-note-tool";

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
  fillRule: "nonzero",
  fill: [{ type: "solid", color: "#22c55e", opacity: 0.5 }],
  height: 24,
  id: "path-1",
  meta: {
    source: "figma-paste",
    vectorFallback: {
      booleanOperation: "UNION",
      fallbackReason: "path_not_decodable",
      fillGeometryCount: 2,
      fillWindingRules: ["NONZERO", "ODD"],
      normalizedSize: { x: 80, y: 24 },
      source: "figma",
      strokeGeometryCount: 1,
      strokeWindingRules: ["NONZERO"],
      vectorNetworkBlob: 3,
    },
  },
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
  layoutConstraints: {
    alignSelf: "auto",
    grow: 0,
    heightMode: "fixed",
    positioning: "auto",
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

  it("updates layout sizing, child positioning, and grow constraints when parent uses auto-layout", () => {
    const { onUpdate } = renderPropertyPanel(figmaReferenceNode, {
      parentNode: frameNode,
    });

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

    expect(onUpdate).toHaveBeenCalledWith({
      layoutConstraints: expect.objectContaining({
        widthMode: "fill_container",
      }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      layoutConstraints: expect.objectContaining({
        heightMode: "fit_content",
      }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      layoutConstraints: expect.objectContaining({
        positioning: "absolute",
      }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      layoutConstraints: expect.objectContaining({
        alignSelf: "stretch",
      }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      layoutConstraints: expect.objectContaining({ grow: 2 }),
    });
  });

  it("collapses layout constraints when the parent is not auto-layout", () => {
    renderPropertyPanel(figmaReferenceNode, {
      parentNode: { ...frameNode, layout: "none" },
    });

    expect(
      screen.getByText("父级未启用自动布局，布局约束暂不可用"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("宽度模式")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "布局裁剪" })).toBeNull();
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
      transform: { m00: 0.8, m01: 0.1, m02: 0.2, m10: 0, m11: 0.9, m12: 0.3 },
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
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "填充 2 图片矩阵 m00" }),
      { target: { value: "0.75" } },
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
      fill: [
        firstFill,
        {
          ...secondFill,
          transform: {
            m00: 0.75,
            m01: 0.1,
            m02: 0.2,
            m10: 0,
            m11: 0.9,
            m12: 0.3,
          },
        },
      ],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      fill: [secondFill, firstFill],
    });
  });

  it("edits fill and stroke gradient stops without changing gradient types", async () => {
    const user = userEvent.setup();
    const fillGradient = {
      type: "linear_gradient" as const,
      angle: 15,
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      stops: [
        { offset: 0, color: "#111111", opacity: 1 },
        { offset: 1, color: "#eeeeee", opacity: 0.5 },
      ],
    };
    const strokeGradient = {
      type: "radial_gradient" as const,
      cx: 0.5,
      cy: 0.5,
      radius: 0.6,
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#0000ff" },
      ],
    };
    const { onUpdate } = renderPropertyPanel({
      ...rectangleNode,
      fill: [fillGradient],
      stroke: {
        align: "inside",
        thickness: 2,
        fill: [strokeGradient],
      },
    });

    fireEvent.change(screen.getByLabelText("填充 1 色标 2 颜色"), {
      target: { value: "#00ff00" },
    });
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "填充 1 色标 2 位置" }),
      { target: { value: "0.35" } },
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "填充 1 色标 2 透明" }),
      { target: { value: "80" } },
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "填充 1 矩阵 m02" }),
      {
        target: { value: "0.25" },
      },
    );
    await user.click(screen.getByRole("button", { name: "添加填充 1 色标" }));
    fireEvent.change(
      screen.getByRole("spinbutton", {
        name: "描边填充 1 色标 1 位置",
      }),
      { target: { value: "0.2" } },
    );

    expect(onUpdate).toHaveBeenCalledWith({
      fill: [
        {
          ...fillGradient,
          stops: [
            fillGradient.stops[0],
            { offset: 1, color: "#00ff00", opacity: 0.5 },
          ],
        },
      ],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      fill: [
        {
          ...fillGradient,
          stops: [
            fillGradient.stops[0],
            { offset: 0.35, color: "#eeeeee", opacity: 0.5 },
          ],
        },
      ],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      fill: [
        {
          ...fillGradient,
          stops: [
            fillGradient.stops[0],
            { offset: 1, color: "#eeeeee", opacity: 0.8 },
          ],
        },
      ],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      fill: [
        {
          ...fillGradient,
          transform: { m00: 1, m01: 0, m02: 0.25, m10: 0, m11: 1, m12: 0 },
        },
      ],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      fill: [
        {
          ...fillGradient,
          stops: [
            ...fillGradient.stops,
            { offset: 1, color: "#eeeeee", opacity: 0.5 },
          ],
        },
      ],
    });
    expect(onUpdate).toHaveBeenCalledWith({
      stroke: expect.objectContaining({
        fill: [
          {
            ...strokeGradient,
            stops: [{ offset: 0.2, color: "#ff0000" }, strokeGradient.stops[1]],
          },
        ],
      }),
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

  it("edits layered stroke paints without overwriting independent border geometry", async () => {
    const user = userEvent.setup();
    const firstStrokePaint = {
      type: "solid" as const,
      color: "#111827",
      opacity: 0.5,
      visible: false,
      blendMode: "multiply" as const,
    };
    const secondStrokePaint = {
      type: "image" as const,
      url: "__hash:stroke-image",
      mode: "crop" as const,
      opacity: 0.75,
      blendMode: "screen" as const,
      originalSize: { width: 320, height: 240 },
      transform: { m00: 0.7, m01: 0, m02: 0.1, m10: 0, m11: 0.8, m12: 0.2 },
    };
    const stroke = {
      align: "outside" as const,
      cap: "round" as const,
      dashOffset: 1,
      dashPattern: [4, 2],
      fill: [firstStrokePaint, secondStrokePaint],
      join: "bevel" as const,
      miterLimit: 6,
      thickness: [1, 2, 3, 4] as [number, number, number, number],
    };
    const { onUpdate } = renderPropertyPanel({
      ...rectangleNode,
      stroke,
    });

    await user.click(screen.getByRole("button", { name: "显示描边填充 1" }));
    fireEvent.change(screen.getByLabelText("描边填充 2 混合模式"), {
      target: { value: "overlay" },
    });
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "描边填充 2 图片矩阵 m12" }),
      { target: { value: "0.45" } },
    );
    await user.click(screen.getByRole("button", { name: "上移描边填充 2" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "右" }), {
      target: { value: "7" },
    });

    expect(onUpdate).toHaveBeenCalledWith({
      stroke: {
        ...stroke,
        fill: [{ ...firstStrokePaint, visible: true }, secondStrokePaint],
      },
    });
    expect(onUpdate).toHaveBeenCalledWith({
      stroke: {
        ...stroke,
        fill: [
          firstStrokePaint,
          { ...secondStrokePaint, blendMode: "overlay" },
        ],
      },
    });
    expect(onUpdate).toHaveBeenCalledWith({
      stroke: {
        ...stroke,
        fill: [
          firstStrokePaint,
          {
            ...secondStrokePaint,
            transform: {
              m00: 0.7,
              m01: 0,
              m02: 0.1,
              m10: 0,
              m11: 0.8,
              m12: 0.45,
            },
          },
        ],
      },
    });
    expect(onUpdate).toHaveBeenCalledWith({
      stroke: { ...stroke, fill: [secondStrokePaint, firstStrokePaint] },
    });
    expect(onUpdate).toHaveBeenCalledWith({
      stroke: { ...stroke, thickness: [1, 7, 3, 4] },
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
    fireEvent.change(screen.getByLabelText("组件变体 1 值"), {
      target: { value: "Compact" },
    });
    fireEvent.change(screen.getByLabelText("组件赋值 1 名称"), {
      target: { value: "ctaLabel" },
    });
    fireEvent.change(screen.getByLabelText("组件赋值 1 值"), {
      target: { value: "Continue" },
    });
    fireEvent.change(screen.getByLabelText("组件覆写 1 路径"), {
      target: { value: "root/button/icon" },
    });
    fireEvent.change(screen.getByLabelText("组件覆写 1 路径 IDs"), {
      target: { value: "root, button, icon" },
    });
    fireEvent.change(screen.getByLabelText("组件覆写 1 目标"), {
      target: { value: "icon" },
    });
    fireEvent.change(screen.getByLabelText("组件覆写 1 属性"), {
      target: { value: "fill, visible" },
    });
    const structuredOverrideValues = screen.getByLabelText("组件覆写 1 值");
    fireEvent.change(structuredOverrideValues, {
      target: { value: '{"fill":"#00ff00","visible":false}' },
    });
    fireEvent.blur(structuredOverrideValues);
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
        variantProperties: { Size: "Compact" },
      }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      componentRef: expect.objectContaining({
        propertyAssignments: { ctaLabel: "Start" },
        source: "figma",
      }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      componentRef: expect.objectContaining({
        propertyAssignments: { label: "Continue" },
        source: "figma",
      }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      componentRef: expect.objectContaining({
        overrides: [
          expect.objectContaining({
            path: "root/button/icon",
            pathIds: ["root", "button"],
            properties: ["fill"],
            targetId: "button",
            values: { fill: "#ff0000" },
          }),
        ],
        source: "figma",
      }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      componentRef: expect.objectContaining({
        overrides: [
          expect.objectContaining({
            path: "root/button",
            pathIds: ["root", "button", "icon"],
            properties: ["fill"],
            targetId: "button",
            values: { fill: "#ff0000" },
          }),
        ],
        source: "figma",
      }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      componentRef: expect.objectContaining({
        overrides: [
          expect.objectContaining({
            path: "root/button",
            pathIds: ["root", "button"],
            properties: ["fill"],
            targetId: "icon",
            values: { fill: "#ff0000" },
          }),
        ],
        source: "figma",
      }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      componentRef: expect.objectContaining({
        overrides: [
          expect.objectContaining({
            path: "root/button",
            pathIds: ["root", "button"],
            properties: ["fill", "visible"],
            targetId: "button",
            values: { fill: "#ff0000" },
          }),
        ],
        source: "figma",
      }),
    });
    expect(onUpdate).toHaveBeenCalledWith({
      componentRef: expect.objectContaining({
        overrides: [
          expect.objectContaining({
            path: "root/button",
            pathIds: ["root", "button"],
            properties: ["fill"],
            targetId: "button",
            values: { fill: "#00ff00", visible: false },
          }),
        ],
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

  it("does not expose mask controls for sticky notes", () => {
    const sticky = createStickyNoteNode({
      x: 24,
      y: 36,
      width: 220,
      height: 200,
    });
    const { onUpdate } = renderPropertyPanel({
      ...sticky,
      mask: { enabled: true, sourceNodeId: "legacy-mask", type: "alpha" },
    } as PenNode);

    expect(
      screen.queryByRole("heading", { name: "遮罩" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "启用遮罩" }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "Workshop note" },
    });

    expect(onUpdate).toHaveBeenCalledWith({ name: "Workshop note" });
    for (const [update] of onUpdate.mock.calls) {
      expect(update).not.toHaveProperty("mask");
    }
  });

  it("shows and updates resolved style and variable tokens without overwriting node refs", () => {
    const onVariablesChange = vi.fn();
    const onStyleDefinitionsChange = vi.fn();
    const { onUpdate } = renderPropertyPanel(figmaReferenceNode, {
      variables: {
        "figma.VariableID-1": {
          id: "VariableID:1",
          name: "Brand Primary",
          source: "figma",
          type: "color",
          value: "#3366ff",
        },
      },
      styleDefinitions: {
        "fill-style": {
          fill: [{ type: "solid", color: "#123456" }],
          id: "fill-style",
          name: "Brand Fill",
          source: "figma",
          type: "fill",
        },
      },
      onStyleDefinitionsChange,
      onVariablesChange,
    });

    expect(screen.getByText(/Brand Primary/)).toBeInTheDocument();
    expect(
      screen.getByText(/figma · VariableID:1 · 已解析/),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Brand Fill/).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("变量 1 值"), {
      target: { value: "#445566" },
    });
    fireEvent.change(screen.getByLabelText("填充样式 token 值"), {
      target: { value: "#abcdef" },
    });

    expect(onVariablesChange).toHaveBeenCalledWith({
      "figma.VariableID-1": {
        id: "VariableID:1",
        name: "Brand Primary",
        source: "figma",
        type: "color",
        unresolved: false,
        value: "#445566",
      },
    });
    expect(onStyleDefinitionsChange).toHaveBeenCalledWith({
      "fill-style": {
        fill: [{ type: "solid", color: "#abcdef" }],
        id: "fill-style",
        name: "Brand Fill",
        source: "figma",
        type: "fill",
      },
    });
    expect(onUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        fill: expect.anything(),
      }),
    );
    expect(onUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        styleRefs: expect.anything(),
      }),
    );
  });

  it("exposes a constructed Figma fidelity fixture across advanced inspector sections", () => {
    const complexFigmaFrame: PenNode = {
      ...frameNode,
      blendMode: "screen",
      clipContent: true,
      componentRef: figmaReferenceNode.componentRef,
      effects: [
        { ...existingShadow, blendMode: "multiply", opacity: 0.5 },
        { type: "background_blur", radius: 12, opacity: 0.4 },
      ],
      fill: [
        {
          type: "linear_gradient",
          angle: 45,
          stops: [
            { offset: 0, color: "#111827", opacity: 1 },
            { offset: 1, color: "#ffffff", opacity: 0.75 },
          ],
          transform: { m00: 1, m01: 0, m02: 0.1, m10: 0, m11: 1, m12: 0.2 },
        },
        {
          type: "image",
          url: "__hash:hero-image",
          mode: "crop",
          opacity: 0.8,
          originalSize: { width: 1200, height: 800 },
          transform: {
            m00: 0.75,
            m01: 0.05,
            m02: 0.1,
            m10: 0,
            m11: 0.8,
            m12: 0.25,
          },
        },
      ],
      layoutConstraints: {
        alignSelf: "stretch",
        grow: 1,
        heightMode: "fit_content",
        positioning: "auto",
        widthMode: "fill_container",
      },
      mask: {
        enabled: true,
        sourceNodeId: "mask-source",
        type: "alpha",
      },
      stroke: {
        align: "outside",
        dashOffset: 2,
        dashPattern: [6, 3],
        fill: [
          { type: "solid", color: "#111827", opacity: 0.5 },
          {
            type: "image",
            url: "__hash:stroke-image",
            mode: "crop",
            originalSize: { width: 512, height: 256 },
            transform: {
              m00: 0.5,
              m01: 0,
              m02: 0.2,
              m10: 0,
              m11: 0.6,
              m12: 0.3,
            },
          },
        ],
        join: "miter",
        miterLimit: 5,
        thickness: [1, 2, 3, 4],
      },
      styleRefs: figmaReferenceNode.styleRefs,
      variableRefs: figmaReferenceNode.variableRefs,
    };
    const { container, rerender } = renderPropertyPanel(complexFigmaFrame, {
      parentNode: frameNode,
      onStyleDefinitionsChange: vi.fn(),
      onVariablesChange: vi.fn(),
      styleDefinitions: {
        "fill-style": {
          fill: [{ type: "solid", color: "#123456" }],
          id: "fill-style",
          name: "Brand Fill",
          source: "figma",
          type: "fill",
        },
      },
      variables: {
        "figma.VariableID-1": {
          id: "VariableID:1",
          name: "Brand Primary",
          source: "figma",
          type: "color",
          value: "#3366ff",
        },
      },
    });

    expect(screen.getByLabelText("填充 2 图片模式")).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: "填充 2 图片矩阵 m00" }),
    ).toHaveValue(0.75);
    expect(
      screen.getByRole("spinbutton", { name: "描边填充 2 图片矩阵 m12" }),
    ).toHaveValue(0.3);
    expect(screen.getByLabelText("效果 2 类型")).toHaveValue("background_blur");
    expect(screen.getByLabelText("遮罩类型")).toHaveValue("alpha");
    expect(screen.getByRole("spinbutton", { name: "布局 Grow" })).toHaveValue(
      1,
    );
    expect(screen.getByLabelText("组件覆写 1 路径")).toHaveValue("root/button");
    expect(screen.getByLabelText("变量 1 值")).toHaveValue("#3366ff");
    expect(screen.getByLabelText("填充样式 token 值")).toHaveValue("#123456");
    expect(container).not.toHaveTextContent(/\bnull\b|\bundefined\b/);

    rerender(
      <CanvasPropertyPanel
        node={styledTextNode}
        onBindAgent={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("文本段 2 大小写")).toHaveValue("upper");
    expect(screen.getByLabelText("文本段 2")).toHaveValue("World");

    rerender(
      <CanvasPropertyPanel
        node={pathNode}
        onBindAgent={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByText("布尔操作")).toBeInTheDocument();
    expect(screen.getByText("UNION")).toBeInTheDocument();
    expect(screen.getByLabelText("路径 d 数据")).toHaveValue(pathNode.d);
  });

  it("keeps advanced JSON values unchanged and shows concrete Chinese errors", () => {
    const { onUpdate } = renderPropertyPanel(figmaReferenceNode);

    const variableRefsInput = screen.getByLabelText("变量引用 JSON");
    fireEvent.change(variableRefsInput, {
      target: { value: '{"fills/0/color":' },
    });
    fireEvent.blur(variableRefsInput);

    expect(screen.getByText(/变量引用 JSON 格式无效/)).toBeInTheDocument();
    expect(variableRefsInput).toHaveValue(
      JSON.stringify(figmaReferenceNode.variableRefs),
    );
    expect(onUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ variableRefs: expect.anything() }),
    );

    const componentVariantInput = screen.getByLabelText("组件变体 JSON");
    fireEvent.change(componentVariantInput, {
      target: { value: '["State"]' },
    });
    fireEvent.blur(componentVariantInput);

    expect(screen.getByText("组件变体 必须是 JSON 对象。")).toBeInTheDocument();
    expect(componentVariantInput).toHaveValue(
      JSON.stringify(figmaReferenceNode.componentRef?.variantProperties),
    );
    expect(onUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        componentRef: expect.objectContaining({
          variantProperties: ["State"],
        }),
      }),
    );
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

    expect(screen.getByText("布尔操作")).toBeInTheDocument();
    expect(screen.getByText("UNION")).toBeInTheDocument();
    expect(screen.getByText("Figma 填充")).toBeInTheDocument();
    expect(screen.getByText("NONZERO, ODD")).toBeInTheDocument();
    expect(
      screen.getByText("路径数据无法解码，已保留诊断信息"),
    ).toBeInTheDocument();
    expect(onUpdate).toHaveBeenCalledWith({ fillRule: "evenodd" });
    expect(onUpdate).toHaveBeenCalledWith({ closed: true });

    fireEvent.change(screen.getByLabelText("路径 d 数据"), {
      target: { value: "M0 0 L 40 0 L 40 20 Z" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存路径 d" }));
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        anchors: expect.any(Array),
        closed: true,
        d: "M0 0 L 40 0 L 40 20 Z",
      }),
    );

    onUpdate.mockClear();
    fireEvent.change(screen.getByLabelText("路径 d 数据"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存路径 d" }));
    expect(screen.getByText(/路径 d 不能为空/)).toBeInTheDocument();
    expect(screen.getByLabelText("路径 d 数据")).toHaveValue(pathNode.d);
    expect(onUpdate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("路径 d 数据"), {
      target: { value: "M0 0 L" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存路径 d" }));
    expect(screen.getByText(/路径命令 L 参数不足/)).toBeInTheDocument();
    expect(screen.getByLabelText("路径 d 数据")).toHaveValue(pathNode.d);
    expect(onUpdate).not.toHaveBeenCalled();

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
    fireEvent.change(screen.getByLabelText("起点样式"), {
      target: { value: "diamond" },
    });
    fireEvent.change(screen.getByLabelText("终点样式"), {
      target: { value: "line-arrow" },
    });

    expect(onUpdate).toHaveBeenCalledWith({ x2: 120 });
    expect(onUpdate).toHaveBeenCalledWith({ y2: 24 });
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        stroke: expect.objectContaining({ startTip: "diamond" }),
      }),
    );
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        stroke: expect.objectContaining({ endTip: "line-arrow" }),
      }),
    );
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
