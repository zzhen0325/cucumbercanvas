// @vitest-environment jsdom

import { type PenNode, withAgentExecutionMeta } from "@cucumber/canvas-core";
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

  it("shows Agent execution metadata and disables unavailable run actions with reasons", () => {
    const executionNode = withAgentExecutionMeta(
      {
        ...frameNode,
        agentBinding: {
          agentId: "agent-1",
          name: "Designer",
          permissions: ["read", "write"],
          status: "running",
        },
        name: "图片结果容器",
        runId: "run-1",
        sessionId: "session-1",
      },
      {
        agentId: "agent-1",
        kind: "final_deliverable",
        runId: "run-1",
        sessionId: "session-1",
        status: "running",
        summary: "图片生成完成后会替换容器内的加载节点。",
        title: "图片结果容器",
        upstreamNodeIds: ["prompt-1"],
      },
    );

    renderPropertyPanel(executionNode);

    expect(screen.getByRole("heading", { name: "Agent 执行" })).toBeVisible();
    expect(screen.getByText("最终交付物")).toBeVisible();
    expect(screen.getAllByText("运行中")).toHaveLength(2);
    expect(screen.queryByText("run-1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "显示开发诊断" })).toBeVisible();
    expect(screen.getByRole("button", { name: "从这里继续" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重跑此步骤" })).toHaveAttribute(
      "title",
      "当前页面暂时不能继续生成。",
    );
  });

  it("resolves Agent execution upstream and downstream nodes into readable selectable chain context", async () => {
    const user = userEvent.setup();
    const onSelectAgentExecutionNode = vi.fn();
    const goalNode = withAgentExecutionMeta(
      { ...frameNode, id: "goal-1", name: "用户目标" },
      {
        downstreamNodeIds: ["step-1"],
        kind: "user_goal",
        status: "done",
        title: "生成三套海报方向",
      },
    );
    const stepNode = withAgentExecutionMeta(
      { ...frameNode, id: "step-1", name: "方向生成" },
      {
        downstreamNodeIds: ["validate-1", "missing-next"],
        kind: "task_step",
        status: "running",
        title: "生成方向 A",
        toolName: "batch_design",
        upstreamNodeIds: ["goal-1"],
      },
    );
    const validateNode = withAgentExecutionMeta(
      { ...frameNode, id: "validate-1", name: "验证画布" },
      {
        kind: "tool_call",
        status: "waiting",
        title: "验证画布结构",
        toolName: "validate_canvas",
        upstreamNodeIds: ["step-1"],
      },
    );

    renderPropertyPanel(stepNode, {
      onSelectAgentExecutionNode,
      pageNodes: [goalNode, stepNode, validateNode],
    });

    expect(screen.getByText("关联步骤")).toBeVisible();
    expect(screen.getByText("前置内容")).toBeVisible();
    expect(screen.getByText("生成三套海报方向")).toBeVisible();
    expect(screen.getByText("用户目标")).toBeVisible();
    expect(screen.getByText("后续结果")).toBeVisible();
    expect(screen.getByText("验证画布结构")).toBeVisible();
    expect(screen.getByText("工具调用 · validate_canvas")).toBeVisible();
    expect(screen.getByText("关联内容暂不可用")).toBeVisible();
    expect(screen.queryByText("missing-next")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /生成三套海报方向/ }));
    await user.click(screen.getByRole("button", { name: /验证画布结构/ }));

    expect(onSelectAgentExecutionNode).toHaveBeenNthCalledWith(1, "goal-1");
    expect(onSelectAgentExecutionNode).toHaveBeenNthCalledWith(2, "validate-1");
    expect(
      screen.queryByRole("button", { name: /missing-next/ }),
    ).not.toBeInTheDocument();
  });

  it("shows Agent evidence provenance and source actions", () => {
    const evidenceNode = withAgentExecutionMeta(frameNode, {
      evidence: {
        confidence: 0.82,
        sourceLabel: "Flowith 产品文档",
        sourceType: "url",
        url: "https://doc.flowith.io/",
      },
      kind: "evidence",
      runId: "run-1",
      status: "done",
      summary: "用于对比 Agent 执行画布的竞品参考来源。",
      title: "竞品参考",
      upstreamNodeIds: ["research-step-1"],
    });

    renderPropertyPanel(evidenceNode);

    expect(screen.getByText("证据来源")).toBeVisible();
    expect(screen.getAllByText("链接")).toHaveLength(2);
    expect(screen.getByText("Flowith 产品文档")).toBeVisible();
    expect(screen.getByText("https://doc.flowith.io/")).toBeVisible();
    expect(screen.getByText("82%")).toBeVisible();
    expect(screen.getByRole("link", { name: "打开链接" })).toHaveAttribute(
      "href",
      "https://doc.flowith.io/",
    );
  });

  it("shows structured critique findings for validation review nodes", () => {
    const critiqueNode = withAgentExecutionMeta(frameNode, {
      critique: {
        findings: [
          {
            nodeId: "hero-title",
            reason: "标题区域可能溢出。",
            severity: "warning",
            suggestedFix: "增加容器高度或缩短标题。",
          },
          {
            reason: "交付物结构完整。",
            severity: "info",
          },
        ],
        issueCounts: {
          error: 0,
          info: 1,
          warning: 1,
        },
        pass: true,
      },
      kind: "critique",
      status: "done",
      summary: "检查到 1 条需要关注的问题。",
      title: "画布验证结果",
    });

    renderPropertyPanel(critiqueNode);

    expect(screen.getByText("评审结果")).toBeVisible();
    expect(screen.getByText("通过")).toBeVisible();
    expect(screen.getAllByText("警告").length).toBeGreaterThan(0);
    expect(screen.getByText("hero-title")).toBeVisible();
    expect(screen.getByText("标题区域可能溢出。")).toBeVisible();
    expect(screen.getByText("建议：增加容器高度或缩短标题。")).toBeVisible();
    expect(screen.getByText("交付物结构完整。")).toBeVisible();
  });

  it("expands and collapses task-step execution details", async () => {
    const user = userEvent.setup();
    const executionNode = withAgentExecutionMeta(frameNode, {
      details: {
        inputSummary: "用户要求三套品牌方向。",
        outputSummary: "已生成方向 A 的初稿。",
        reasoningSummary: "先收敛品牌语气，再生成视觉主线。",
      },
      kind: "task_step",
      runId: "run-1",
      status: "done",
      summary: "生成品牌探索方向。",
      title: "生成方向 A",
      toolName: "batch_design",
    });

    renderPropertyPanel(executionNode);

    const detailsButton = screen.getByRole("button", { name: "执行详情" });
    expect(detailsButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("用户要求三套品牌方向。")).toBeVisible();
    expect(screen.getByText("先收敛品牌语气，再生成视觉主线。")).toBeVisible();

    await user.click(detailsButton);

    expect(detailsButton).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByText("用户要求三套品牌方向。"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("先收敛品牌语气，再生成视觉主线。"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("结果摘要")).toBeVisible();
    expect(screen.getByText("已生成方向 A 的初稿。")).toBeVisible();
  });

  it("writes ask-user-more responses and routes file supplements into continuation drafts", async () => {
    const user = userEvent.setup();
    const onContinueAgentExecution = vi.fn();
    const executionNode = withAgentExecutionMeta(frameNode, {
      kind: "ask_user_more",
      runId: "run-2",
      status: "waiting",
      title: "等待品牌资料",
      waitingForUser: {
        acceptsFiles: true,
        prompt: "请补充品牌名和主色。",
        response: {
          attachmentCount: 2,
          submittedAt: "2026-06-03T12:00:00.000Z",
          text: "",
        },
      },
    });
    const { onUpdate } = renderPropertyPanel(executionNode, {
      onContinueAgentExecution,
    });

    expect(screen.getByText("已随继续执行补充 2 个文件/图片。")).toBeVisible();

    await user.type(
      screen.getByLabelText("补充说明"),
      "品牌名 Cucumber Lab，主色绿色。",
    );
    await user.click(screen.getByRole("button", { name: "提交补充" }));

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        containerRole: ["task"],
        runId: "run-2",
        contextSlots: {
          rules: ["agent execution node: ask_user_more"],
        },
        meta: expect.objectContaining({
          agentExecution: expect.objectContaining({
            kind: "ask_user_more",
            status: "paused",
            summary: "用户已提交补充，等待 Agent 从该节点继续。",
            waitingForUser: expect.objectContaining({
              response: expect.objectContaining({
                attachmentCount: 2,
                text: "品牌名 Cucumber Lab，主色绿色。",
                submittedAt: expect.any(String),
              }),
            }),
          }),
        }),
      }),
    );
    expect(onContinueAgentExecution).toHaveBeenNthCalledWith(
      1,
      "frame-1",
      "continue",
      { waitingResponseText: "品牌名 Cucumber Lab，主色绿色。" },
    );
    await user.click(screen.getByRole("button", { name: "补充文件/图片" }));
    expect(onContinueAgentExecution).toHaveBeenNthCalledWith(
      2,
      "frame-1",
      "attach_files",
    );
  });

  it("shows failed execution recovery choices without raw error codes", () => {
    const executionNode = withAgentExecutionMeta(frameNode, {
      details: {
        errorReason: "ECONNRESET",
      },
      failure: {
        attempted: ["ERR_BAD_REQUEST", "检查目标容器是否仍然存在"],
        nextActions: ["重试此步骤", "HTTP 500", "新建分支尝试另一种方案"],
        reason: "HTTP 503 null undefined",
        step: "生成视觉资产 ERR_BAD_REQUEST",
      },
      kind: "tool_call",
      status: "failed",
      title: "generate_image",
      toolName: "generate_image",
    });

    renderPropertyPanel(executionNode);

    expect(
      screen.getAllByText("外部服务暂时不可用，请稍后重试或改写输入后继续。")
        .length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("生成视觉资产")).toBeVisible();
    expect(
      screen.getByText(
        "该步骤失败，但当前节点没有记录可读的失败原因。请重试此步骤，或改写输入后继续。",
      ),
    ).toBeVisible();
    expect(screen.getByText("检查目标容器是否仍然存在")).toBeVisible();
    expect(screen.getByRole("button", { name: "重试此步骤" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "跳过此步骤" })).toBeDisabled();
    expect(
      screen.queryByText(
        /\bnull\b|\bundefined\b|ERR_BAD_REQUEST|ECONNRESET|HTTP 500|HTTP 503/,
      ),
    ).not.toBeInTheDocument();
  });

  it("shows variant branch and comparison metadata for multi-direction work", async () => {
    const user = userEvent.setup();
    const onContinueAgentExecution = vi.fn();
    const onSelectAgentVariantBranch = vi.fn();
    const branchNode = withAgentExecutionMeta(frameNode, {
      branch: {
        critiqueSummary: "制作成本高，需要控制素材数量。",
        deliverableSummary: "活动海报主视觉与社交媒体延展。",
        isMainline: true,
        isRecommended: true,
        planSummary: "先生成高冲击主视觉，再延展到活动海报。",
        risks: ["制作成本较高"],
        strengths: ["传播张力强"],
        useCases: ["活动海报", "社交媒体"],
      },
      branchId: "branch-b",
      branchLabel: "方向 B",
      kind: "variant_branch",
      status: "done",
      title: "方向 B",
    });

    const { rerender, onUpdate } = renderPropertyPanel(branchNode);

    expect(screen.getAllByText("方案分支").length).toBeGreaterThan(0);
    expect(screen.getByText("当前主线")).toBeVisible();
    expect(
      screen.getByText("先生成高冲击主视觉，再延展到活动海报。"),
    ).toBeVisible();
    expect(screen.getByText("活动海报主视觉与社交媒体延展。")).toBeVisible();
    expect(screen.getByText("制作成本高，需要控制素材数量。")).toBeVisible();
    expect(screen.getByText("传播张力强")).toBeVisible();
    expect(screen.getByText("制作成本较高")).toBeVisible();

    const branchNodeA = withAgentExecutionMeta(
      { ...frameNode, id: "branch-node-a" },
      {
        branch: {
          critiqueSummary: "情绪强，但需要验证转化效率。",
          deliverableSummary: "品牌首发海报方向。",
          isMainline: false,
          planSummary: "先探索情绪版式，再补充品牌资产。",
          risks: ["转化效率未知"],
          strengths: ["情绪感染力强"],
          useCases: ["品牌首发"],
        },
        branchId: "branch-a",
        branchLabel: "方向 A",
        kind: "variant_branch",
        status: "done",
        title: "方向 A",
      },
    );
    const branchNodeB = withAgentExecutionMeta(
      { ...frameNode, id: "branch-node-b" },
      {
        branch: {
          critiqueSummary: "制作成本高，需要控制素材数量。",
          deliverableSummary: "活动海报主视觉。",
          isMainline: true,
          isRecommended: true,
          planSummary: "先生成高冲击主视觉。",
          risks: ["制作成本较高"],
          strengths: ["传播张力强"],
          useCases: ["活动海报"],
        },
        branchId: "branch-b",
        branchLabel: "方向 B",
        kind: "variant_branch",
        status: "done",
        title: "方向 B",
      },
    );
    const comparisonNode = withAgentExecutionMeta(frameNode, {
      comparison: {
        branchNodeIds: ["branch-node-a", "branch-node-b"],
        recommendedBranchId: "branch-b",
        recommendationReason: "方向 B 更适合活动首发。",
      },
      kind: "comparison",
      status: "done",
      title: "方案对比",
    });

    rerender(
      <CanvasPropertyPanel
        node={comparisonNode}
        onContinueAgentExecution={onContinueAgentExecution}
        onSelectAgentVariantBranch={onSelectAgentVariantBranch}
        onBindAgent={vi.fn()}
        onUpdate={onUpdate}
        pageNodes={[comparisonNode, branchNodeA, branchNodeB]}
      />,
    );

    expect(screen.getAllByText("方案对比").length).toBeGreaterThan(0);
    expect(screen.queryByText("branch-b")).not.toBeInTheDocument();
    expect(
      screen.getAllByText("方向 B 更适合活动首发。").length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("branch-node-a")).not.toBeInTheDocument();
    expect(screen.getByText("2 个")).toBeVisible();
    expect(screen.getByText("分支对比")).toBeVisible();
    expect(screen.getByText("先探索情绪版式，再补充品牌资产。")).toBeVisible();
    expect(screen.getByText("品牌首发海报方向。")).toBeVisible();
    expect(screen.getByText("情绪强，但需要验证转化效率。")).toBeVisible();
    expect(screen.getByText("情绪感染力强")).toBeVisible();
    expect(screen.getByText("转化效率未知")).toBeVisible();
    expect(screen.getByText("活动海报")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "设为主线并深化" }));
    await user.click(screen.getByRole("button", { name: "设为主线" }));

    expect(onSelectAgentVariantBranch).toHaveBeenNthCalledWith(
      1,
      "branch-node-a",
    );
    expect(onContinueAgentExecution).toHaveBeenCalledWith(
      "branch-node-a",
      "continue",
      expect.objectContaining({
        continuationTargetElement: expect.objectContaining({
          agentExecution: expect.objectContaining({
            branchId: "branch-a",
            branch: expect.objectContaining({
              isMainline: true,
              isRecommended: true,
            }),
            comparison: {
              branchNodeIds: ["branch-node-a", "branch-node-b"],
              recommendedBranchId: "branch-a",
              recommendationReason: "方向 B 更适合活动首发。",
            },
            kind: "variant_branch",
            title: "方向 A",
          }),
          id: "branch-node-a",
        }),
      }),
    );
    expect(onSelectAgentVariantBranch).toHaveBeenNthCalledWith(
      2,
      "branch-node-a",
    );
  });

  it("offers a real set-mainline action for non-mainline variant branches", async () => {
    const user = userEvent.setup();
    const onContinueAgentExecution = vi.fn();
    const onSelectAgentVariantBranch = vi.fn();
    const branchNode = withAgentExecutionMeta(frameNode, {
      branch: {
        isMainline: false,
        isRecommended: false,
        strengths: ["文化感强"],
      },
      branchId: "branch-c",
      branchLabel: "方向 C",
      kind: "variant_branch",
      status: "done",
      title: "方向 C",
    });

    renderPropertyPanel(branchNode, {
      onContinueAgentExecution,
      onSelectAgentVariantBranch,
    });

    await user.click(screen.getByRole("button", { name: "设为主线并深化" }));
    await user.click(screen.getByRole("button", { name: "设为主线" }));

    expect(onSelectAgentVariantBranch).toHaveBeenNthCalledWith(1, "frame-1");
    expect(onContinueAgentExecution).toHaveBeenCalledWith(
      "frame-1",
      "continue",
      expect.objectContaining({
        continuationTargetElement: expect.objectContaining({
          agentExecution: expect.objectContaining({
            branch: expect.objectContaining({
              isMainline: true,
              isRecommended: true,
            }),
            kind: "variant_branch",
          }),
          id: "frame-1",
        }),
      }),
    );
    expect(onSelectAgentVariantBranch).toHaveBeenNthCalledWith(2, "frame-1");
  });

  it("deepens the recommended comparison branch from the summary action", async () => {
    const user = userEvent.setup();
    const onContinueAgentExecution = vi.fn();
    const onSelectAgentVariantBranch = vi.fn();
    const branchNodeA = withAgentExecutionMeta(
      { ...frameNode, id: "branch-node-a" },
      {
        branch: {
          isMainline: true,
          strengths: ["识别度高"],
        },
        branchId: "branch-a",
        branchLabel: "方向 A",
        kind: "variant_branch",
        status: "done",
        title: "方向 A",
      },
    );
    const branchNodeB = withAgentExecutionMeta(
      { ...frameNode, id: "branch-node-b" },
      {
        branch: {
          isMainline: false,
          risks: ["制作成本高"],
          strengths: ["传播张力强"],
        },
        branchId: "branch-b",
        branchLabel: "方向 B",
        kind: "variant_branch",
        status: "done",
        title: "方向 B",
      },
    );
    const comparisonNode = withAgentExecutionMeta(frameNode, {
      comparison: {
        branchNodeIds: ["branch-node-a", "branch-node-b"],
        recommendedBranchId: "branch-b",
        recommendationReason: "方向 B 更适合活动首发。",
      },
      kind: "comparison",
      status: "done",
      title: "方案对比",
    });

    renderPropertyPanel(comparisonNode, {
      onContinueAgentExecution,
      onSelectAgentVariantBranch,
      pageNodes: [comparisonNode, branchNodeA, branchNodeB],
    });

    expect(screen.getByText("推荐选择")).toBeVisible();
    expect(screen.getAllByText("方向 B").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText("方向 B 更适合活动首发。").length,
    ).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole("button", { name: "深化推荐选择" }));

    expect(onSelectAgentVariantBranch).toHaveBeenCalledWith("branch-node-b");
    expect(onContinueAgentExecution).toHaveBeenCalledWith(
      "branch-node-b",
      "continue",
      expect.objectContaining({
        continuationTargetElement: expect.objectContaining({
          agentExecution: expect.objectContaining({
            branch: expect.objectContaining({
              isMainline: true,
              isRecommended: true,
            }),
            branchId: "branch-b",
            comparison: expect.objectContaining({
              branchNodeIds: ["branch-node-a", "branch-node-b"],
              recommendedBranchId: "branch-b",
            }),
            kind: "variant_branch",
          }),
          id: "branch-node-b",
        }),
      }),
    );
  });

  it("routes failed-node recovery actions into continuation drafts", async () => {
    const user = userEvent.setup();
    const onContinueAgentExecution = vi.fn();
    const executionNode = withAgentExecutionMeta(frameNode, {
      failure: {
        attempted: ["重试图片生成服务"],
        nextActions: ["改写输入后继续", "新建分支尝试另一种方案"],
        reason: "图片生成服务暂时不可用。",
        step: "生成视觉资产",
      },
      kind: "tool_call",
      status: "failed",
      title: "generate_image",
      toolName: "generate_image",
    });

    renderPropertyPanel(executionNode, { onContinueAgentExecution });

    await user.click(screen.getByRole("button", { name: "重试此步骤" }));
    await user.click(screen.getByRole("button", { name: "改写输入后继续" }));
    await user.click(screen.getByRole("button", { name: "跳过此步骤" }));
    await user.click(screen.getByRole("button", { name: "新建分支尝试" }));

    expect(onContinueAgentExecution).toHaveBeenNthCalledWith(
      1,
      "frame-1",
      "retry",
    );
    expect(onContinueAgentExecution).toHaveBeenNthCalledWith(
      2,
      "frame-1",
      "rewrite",
    );
    expect(onContinueAgentExecution).toHaveBeenNthCalledWith(
      3,
      "frame-1",
      "skip",
    );
    expect(onContinueAgentExecution).toHaveBeenNthCalledWith(
      4,
      "frame-1",
      "new_branch",
    );
  });

  it("shows checkpoint restart context and routes continuation actions into drafts", async () => {
    const user = userEvent.setup();
    const onContinueAgentExecution = vi.fn();
    const checkpointNode = withAgentExecutionMeta(frameNode, {
      checkpoint: {
        canRestartFromHere: true,
        restartReason: "设计方向已经收敛，可从这里继续。",
      },
      kind: "checkpoint",
      status: "done",
      title: "Checkpoint 1",
    });

    renderPropertyPanel(checkpointNode, { onContinueAgentExecution });

    expect(screen.getAllByText("保存点").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("可从此处继续")).toBeInTheDocument();
    expect(
      screen.getByText("设计方向已经收敛，可从这里继续。"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "从这里继续" }));
    await user.click(screen.getByRole("button", { name: "从保存点重跑" }));
    await user.click(screen.getByRole("button", { name: "复制为新分支" }));

    expect(onContinueAgentExecution).toHaveBeenNthCalledWith(
      1,
      "frame-1",
      "continue",
    );
    expect(onContinueAgentExecution).toHaveBeenNthCalledWith(
      2,
      "frame-1",
      "rerun_checkpoint",
    );
    expect(onContinueAgentExecution).toHaveBeenNthCalledWith(
      3,
      "frame-1",
      "new_branch",
    );
  });

  it("explains when a checkpoint is only a progress marker", () => {
    const checkpointNode = withAgentExecutionMeta(frameNode, {
      checkpoint: {
        canRestartFromHere: false,
      },
      kind: "checkpoint",
      status: "done",
      title: "Checkpoint marker",
    });

    renderPropertyPanel(checkpointNode);

    expect(screen.getByText("仅记录进度")).toBeInTheDocument();
    expect(
      screen.getByText(
        "这个保存点已记录当前进度，可用于继续、复制分支或重新生成后续结果。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "从保存点重跑" }),
    ).toHaveAttribute("title", "这个保存点还不能从此处重跑。");
    expect(screen.getByRole("button", { name: "从这里继续" })).toBeDisabled();
  });
});
