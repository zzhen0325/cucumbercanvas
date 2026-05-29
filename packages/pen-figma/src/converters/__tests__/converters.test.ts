// @ts-nocheck
import { describe, expect, it } from "vitest";
import { collectImageBlobs, convertNode } from "../index.js";
import type { ConversionContext } from "../index.js";
import {
  collectFigmaStyleDefinitions,
  figmaNodeChangesToPenNodes,
} from "../../figma-node-mapper.js";

function makeCtx(): ConversionContext {
  let id = 0;
  return {
    componentMap: new Map(),
    symbolTree: new Map(),
    warnings: [],
    generateId: () => `test-${++id}`,
    blobs: [],
    layoutMode: "cucumber",
  };
}

function makePathBlob(points: Array<[number, number]>): Uint8Array {
  const byteLength = points.length * 9 + 1;
  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const [index, point] of points.entries()) {
    bytes[offset] = index === 0 ? 0x01 : 0x02;
    offset += 1;
    view.setFloat32(offset, point[0], true);
    offset += 4;
    view.setFloat32(offset, point[1], true);
    offset += 4;
  }
  bytes[offset] = 0x00;
  return bytes;
}

describe("convertNode", () => {
  it("collects Figma style definitions for editable style-token restoration", () => {
    const definitions = collectFigmaStyleDefinitions([
      {
        type: "RECTANGLE",
        name: "Brand / Surface",
        styleType: "FILL",
        guid: { sessionID: 8, localID: 1 },
        fillPaints: [
          { type: "SOLID", color: { r: 0.1, g: 0.2, b: 0.3, a: 1 } },
        ],
        variableConsumptionMap: {
          fills: [{ id: "VariableID:brand-surface" }],
        },
      },
      {
        type: "TEXT",
        name: "Heading / XL",
        styleType: "TEXT",
        guid: { sessionID: 8, localID: 2 },
        fontName: {
          family: "Inter",
          style: "Bold",
          postscript: "Inter-Bold",
        },
        fontSize: 32,
        lineHeight: { value: 40, units: "PIXELS" },
        textAlignHorizontal: "CENTER",
      },
      {
        type: "RECTANGLE",
        name: "Elevation / Card",
        styleType: "EFFECT",
        guid: { sessionID: 8, localID: 3 },
        effects: [
          {
            type: "DROP_SHADOW",
            offset: { x: 0, y: 8 },
            radius: 24,
            spread: 0,
            color: { r: 0, g: 0, b: 0, a: 0.2 },
          },
        ],
      },
    ] as any);

    expect(definitions).toMatchObject({
      "8:1": {
        source: "figma",
        id: "8:1",
        name: "Brand / Surface",
        type: "fill",
        fill: [{ type: "solid", color: "#1a334d" }],
        variableRefs: {
          fills: [{ id: "VariableID:brand-surface" }],
        },
      },
      "8:2": {
        source: "figma",
        id: "8:2",
        name: "Heading / XL",
        type: "text",
        text: {
          fontFamily: "Inter",
          fontPostScriptName: "Inter-Bold",
          fontSize: 32,
          fontWeight: 700,
          lineHeight: 1.25,
          textAlign: "center",
        },
      },
      "8:3": {
        source: "figma",
        id: "8:3",
        name: "Elevation / Card",
        type: "effect",
        effects: [
          {
            type: "shadow",
            inner: false,
            offsetX: 0,
            offsetY: 8,
            blur: 24,
            spread: 0,
            color: "#000000",
            opacity: 0.2,
          },
        ],
      },
    });
  });

  it("should convert a RECTANGLE TreeNode to a PenNode rectangle", () => {
    const ctx = makeCtx();
    const treeNode = {
      figma: {
        type: "RECTANGLE",
        name: "Test Rect",
        size: { x: 100, y: 50 },
        transform: { m00: 1, m01: 0, m02: 10, m10: 0, m11: 1, m12: 20 },
      },
      children: [],
    };

    const result = convertNode(treeNode as any, undefined, ctx);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("rectangle");
    expect(result!.name).toBe("Test Rect");
    expect(result!.x).toBe(10);
    expect(result!.y).toBe(20);
  });

  it("keeps preserve-mode descendants that are already parent-relative", () => {
    const { nodes } = figmaNodeChangesToPenNodes(
      {
        nodeChanges: [
          {
            type: "FRAME",
            name: "Award Page",
            guid: { sessionID: 1, localID: 1 },
            size: { x: 560, y: 1080 },
            transform: { m00: 1, m01: 0, m02: 300, m10: 0, m11: 1, m12: 100 },
          },
          {
            type: "RECTANGLE",
            name: "Yellow Rail",
            guid: { sessionID: 1, localID: 2 },
            parentIndex: {
              guid: { sessionID: 1, localID: 1 },
              position: "a",
            },
            size: { x: 72, y: 816 },
            transform: { m00: 1, m01: 0, m02: 20, m10: 0, m11: 1, m12: 40 },
          },
        ],
        blobs: [],
        imageFiles: new Map(),
      } as any,
      "preserve",
    );

    const root = nodes[0] as any;
    const child = root.children[0] as any;

    expect(root).toMatchObject({
      type: "frame",
      x: 300,
      y: 100,
      transform: { m02: 300, m12: 100 },
      clipContent: true,
    });
    expect(child).toMatchObject({
      type: "rectangle",
      x: 20,
      y: 40,
      transform: { m02: 20, m12: 40 },
    });
  });

  it("normalizes clear preserve-mode scene-space descendants to parent-relative coordinates", () => {
    const { nodes } = figmaNodeChangesToPenNodes(
      {
        nodeChanges: [
          {
            type: "FRAME",
            name: "Award Page",
            guid: { sessionID: 1, localID: 1 },
            size: { x: 560, y: 1080 },
            transform: { m00: 1, m01: 0, m02: 300, m10: 0, m11: 1, m12: 100 },
          },
          {
            type: "RECTANGLE",
            name: "Yellow Rail",
            guid: { sessionID: 1, localID: 2 },
            parentIndex: {
              guid: { sessionID: 1, localID: 1 },
              position: "a",
            },
            size: { x: 72, y: 816 },
            transform: { m00: 1, m01: 0, m02: 620, m10: 0, m11: 1, m12: 240 },
          },
        ],
        blobs: [],
        imageFiles: new Map(),
      } as any,
      "preserve",
    );

    const root = nodes[0] as any;
    const child = root.children[0] as any;

    expect(root).toMatchObject({
      type: "frame",
      x: 300,
      y: 100,
      transform: { m02: 300, m12: 100 },
      clipContent: true,
    });
    expect(child).toMatchObject({
      type: "rectangle",
      x: 320,
      y: 140,
      transform: { m02: 620, m12: 240 },
    });
  });

  it("preserves Figma node-level transform, visibility, blend mode, and smoothing", () => {
    const ctx = makeCtx();
    const treeNode = {
      figma: {
        type: "RECTANGLE",
        name: "Transformed Rect",
        visible: false,
        blendMode: "SOFT_LIGHT",
        size: { x: 100, y: 50 },
        transform: { m00: 0.5, m01: 0.2, m02: 10, m10: 0.1, m11: 0.75, m12: 20 },
        cornerRadius: 12,
        cornerSmoothing: 0.6,
      },
      children: [],
    };

    const result = convertNode(treeNode as any, undefined, ctx) as any;

    expect(result).toMatchObject({
      type: "rectangle",
      visible: false,
      blendMode: "soft_light",
      cornerRadius: 12,
      cornerSmoothing: 0.6,
      transform: { m00: 0.5, m01: 0.2, m02: 10, m10: 0.1, m11: 0.75, m12: 20 },
    });
    expect(result.scaleX).toBeGreaterThan(0);
    expect(result.scaleY).toBeGreaterThan(0);
  });

  it("preserves Figma container isolation from blend mode", () => {
    const ctx = makeCtx();
    const isolated = convertNode(
      {
        figma: {
          type: "FRAME",
          name: "Isolated",
          blendMode: "MULTIPLY",
          size: { x: 100, y: 50 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        },
        children: [],
      } as any,
      undefined,
      ctx,
    ) as any;
    const passThrough = convertNode(
      {
        figma: {
          type: "FRAME",
          name: "Pass through",
          blendMode: "PASS_THROUGH",
          size: { x: 100, y: 50 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        },
        children: [],
      } as any,
      undefined,
      ctx,
    ) as any;

    expect(isolated).toMatchObject({
      blendMode: "multiply",
      isolated: true,
    });
    expect(passThrough).toMatchObject({
      blendMode: "pass_through",
      isolated: false,
    });
  });

  it("preserves Figma mask layer metadata", () => {
    const ctx = makeCtx();
    const treeNode = {
      figma: {
        type: "RECTANGLE",
        name: "Alpha Mask",
        isMask: true,
        maskType: "ALPHA",
        shouldBreakMaskChain: true,
        size: { x: 120, y: 80 },
        transform: { m00: 1, m01: 0, m02: 4, m10: 0, m11: 1, m12: 8 },
      },
      children: [],
    };

    const result = convertNode(treeNode as any, undefined, ctx) as any;

    expect(result).toMatchObject({
      type: "rectangle",
      name: "Alpha Mask",
      mask: {
        enabled: true,
        type: "alpha",
        shouldBreakMaskChain: true,
      },
    });
  });

  it("preserves Figma style and variable references alongside inline values", () => {
    const ctx = makeCtx();
    const treeNode = {
      figma: {
        type: "RECTANGLE",
        name: "Tokenized card",
        size: { x: 120, y: 80 },
        transform: { m00: 1, m01: 0, m02: 4, m10: 0, m11: 1, m12: 8 },
        fillPaints: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
        styleIdForFill: { guid: { sessionID: 44, localID: 8 } },
        styleIdForEffect: { guid: { sessionID: 44, localID: 9 } },
        variableConsumptionMap: {
          fills: [{ id: "VariableID:brand-bg" }],
        },
      },
      children: [],
    };

    const result = convertNode(treeNode as any, undefined, ctx) as any;

    expect(result.fill?.[0]).toMatchObject({
      type: "solid",
      color: "#ff0000",
    });
    expect(result.styleRefs).toMatchObject({
      fill: { source: "figma", id: "44:8" },
      effect: { source: "figma", id: "44:9" },
    });
    expect(result.variableRefs).toEqual({
      fills: [{ id: "VariableID:brand-bg" }],
    });
  });

  it("preserves common Figma metadata on line nodes", () => {
    const ctx = makeCtx();
    const treeNode = {
      figma: {
        type: "LINE",
        name: "Divider line",
        visible: false,
        locked: true,
        blendMode: "SCREEN",
        isMask: true,
        maskType: "VECTOR",
        size: { x: 240, y: 0 },
        transform: { m00: 0.5, m01: 0.1, m02: 30, m10: 0.2, m11: 1, m12: 40 },
        strokePaints: [
          { type: "SOLID", color: { r: 0.2, g: 0.4, b: 0.8, a: 1 } },
        ],
        strokeWeight: 3,
        strokeCap: "ROUND",
        styleIdForStrokeFill: { guid: { sessionID: 9, localID: 12 } },
        variableConsumptionMap: {
          strokes: [{ id: "VariableID:divider" }],
        },
      },
      children: [],
    };

    const result = convertNode(treeNode as any, undefined, ctx) as any;

    expect(result).toMatchObject({
      type: "line",
      name: "Divider line",
      visible: false,
      locked: true,
      blendMode: "screen",
      x: -30,
      y: 64,
      x2: 210,
      y2: 64,
      transform: { m00: 0.5, m01: 0.1, m02: 30, m10: 0.2, m11: 1, m12: 40 },
      mask: {
        enabled: true,
        type: "vector",
      },
      styleRefs: {
        stroke: { source: "figma", id: "9:12" },
      },
      variableRefs: {
        strokes: [{ id: "VariableID:divider" }],
      },
      stroke: {
        thickness: 3,
        cap: "round",
      },
    });
  });

  it("should convert a TEXT TreeNode", () => {
    const ctx = makeCtx();
    const treeNode = {
      figma: {
        type: "TEXT",
        name: "Title",
        size: { x: 200, y: 30 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        styledTextSegments: [
          {
            characters: "Hello World",
            fontSize: 16,
            fontWeight: 400,
            fontFamily: "Inter",
          },
        ],
      },
      children: [],
    };

    const result = convertNode(treeNode as any, undefined, ctx);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("text");
  });

  it("should skip SLICE node types", () => {
    const ctx = makeCtx();
    const treeNode = {
      figma: { type: "SLICE", name: "Slice", size: { x: 100, y: 100 } },
      children: [],
    };

    const result = convertNode(treeNode as any, undefined, ctx);
    expect(result).toBeNull();
  });

  it("should convert a FRAME TreeNode", () => {
    const ctx = makeCtx();
    const treeNode = {
      figma: {
        type: "FRAME",
        name: "Container",
        size: { x: 300, y: 200 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      },
      children: [],
    };

    const result = convertNode(treeNode as any, undefined, ctx);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("frame");
  });

  it("keeps preserve-mode Figma auto-layout frames visually absolute", () => {
    const ctx = makeCtx();
    ctx.layoutMode = "preserve";
    const treeNode = {
      figma: {
        type: "FRAME",
        name: "Auto layout frame",
        size: { x: 300, y: 120 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        stackMode: "HORIZONTAL",
        stackSpacing: 24,
      },
      children: [
        {
          figma: {
            type: "RECTANGLE",
            name: "Second visually",
            size: { x: 50, y: 50 },
            transform: { m00: 1, m01: 0, m02: 100, m10: 0, m11: 1, m12: 20 },
          },
          children: [],
        },
        {
          figma: {
            type: "RECTANGLE",
            name: "First visually",
            size: { x: 50, y: 50 },
            transform: { m00: 1, m01: 0, m02: 20, m10: 0, m11: 1, m12: 20 },
          },
          children: [],
        },
      ],
    };

    const result = convertNode(treeNode as any, undefined, ctx) as any;

    expect(result.layout).toBeUndefined();
    expect(result.clipContent).toBe(true);
    expect(result.children.map((child: any) => child.x)).toEqual([100, 20]);
  });

  it("preserves Figma auto-layout refs for editable layout reflow", () => {
    const ctx = makeCtx();
    const treeNode = {
      figma: {
        type: "FRAME",
        name: "Auto layout frame",
        size: { x: 320, y: 120 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        stackMode: "HORIZONTAL",
        stackSpacing: 12,
        stackPadding: 16,
        stackPrimaryAlignItems: "SPACE_EVENLY",
        stackCounterAlignItems: "BASELINE",
        stackPrimarySizing: "FIXED",
        stackCounterSizing: "RESIZE_TO_FIT",
        frameMaskDisabled: false,
      },
      children: [
        {
          figma: {
            type: "RECTANGLE",
            name: "Fill child",
            size: { x: 40, y: 32 },
            transform: { m00: 1, m01: 0, m02: 16, m10: 0, m11: 1, m12: 16 },
            stackChildPrimaryGrow: 1,
            stackChildAlignSelf: "STRETCH",
            stackPositioning: "AUTO",
          },
          children: [],
        },
        {
          figma: {
            type: "RECTANGLE",
            name: "Absolute child",
            size: { x: 24, y: 24 },
            transform: { m00: 1, m01: 0, m02: 80, m10: 0, m11: 1, m12: 20 },
            stackPositioning: "ABSOLUTE",
          },
          children: [],
        },
      ],
    };

    const result = convertNode(treeNode as any, undefined, ctx) as any;

    expect(result.layoutRef).toMatchObject({
      source: "figma",
      layout: "horizontal",
      padding: 16,
      justifyContent: "space_between",
      alignItems: "baseline",
      widthMode: "fixed",
      heightMode: "fit_content",
      clipContent: true,
    });
    expect(result.meta?.autoLayout).toMatchObject({
      layout: "horizontal",
      widthMode: "fixed",
      heightMode: "fit_content",
    });
    const fillChild = result.children.find(
      (child: any) => child.name === "Fill child",
    );
    const absoluteChild = result.children.find(
      (child: any) => child.name === "Absolute child",
    );
    expect(fillChild.layoutRef).toMatchObject({
      source: "figma",
      widthMode: "fill_container",
      heightMode: "fill_container",
      alignSelf: "stretch",
      positioning: "auto",
      grow: 1,
    });
    expect(absoluteChild.layoutRef).toMatchObject({
      source: "figma",
      positioning: "absolute",
    });
    expect(absoluteChild.meta?.autoLayout).toMatchObject({
      positioning: "absolute",
    });
  });

  it("applies component instance text overrides from the master symbol tree", () => {
    const ctx = makeCtx();
    const symbolGuid = { sessionID: 1, localID: 1 };
    const textGuid = { sessionID: 1, localID: 2 };
    const instanceGuid = { sessionID: 2, localID: 10 };
    ctx.symbolTree.set("1:1", {
      figma: {
        type: "SYMBOL",
        name: "Button master",
        guid: symbolGuid,
        size: { x: 160, y: 48 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        blendMode: "MULTIPLY",
        isMask: true,
        maskType: "VECTOR",
        styleIdForFill: { guid: { sessionID: 7, localID: 11 } },
        variantProperties: { State: "Default", Size: "Large" },
      },
      children: [
        {
          figma: {
            type: "TEXT",
            name: "Label",
            guid: textGuid,
            size: { x: 100, y: 24 },
            transform: { m00: 1, m01: 0, m02: 20, m10: 0, m11: 1, m12: 12 },
            textData: { characters: "Default" },
            fontSize: 14,
          },
          children: [],
        },
      ],
    });
    const treeNode = {
      figma: {
        type: "INSTANCE",
        name: "Button instance",
        guid: instanceGuid,
        size: { x: 160, y: 48 },
        transform: { m00: 1, m01: 0, m02: 80, m10: 0, m11: 1, m12: 96 },
        componentPropAssignments: {
          Label: "Submit",
          Disabled: false,
        },
        symbolData: {
          symbolID: symbolGuid,
          symbolOverrides: [
            {
              guidPath: { guids: [textGuid] },
              textData: { characters: "Submit" },
              fontSize: 18,
            },
          ],
        },
      },
      children: [],
    };

    const result = convertNode(treeNode as any, undefined, ctx) as any;

    expect(result.type).toBe("frame");
    expect(result).toMatchObject({
      blendMode: "multiply",
      componentRef: {
        source: "figma",
        type: "instance",
        id: "2:10",
        componentId: "1:1",
        variantProperties: { State: "Default", Size: "Large" },
        propertyAssignments: {
          Label: "Submit",
          Disabled: false,
        },
        overrideCount: 1,
        overridePaths: ["1:2"],
        overrides: [
          {
            source: "figma",
            path: "1:2",
            pathIds: ["1:2"],
            targetId: "1:2",
            properties: ["textData", "fontSize"],
            values: {
              textData: { characters: "Submit" },
              fontSize: 18,
            },
          },
        ],
      },
      mask: {
        enabled: true,
        type: "vector",
      },
      styleRefs: {
        fill: { source: "figma", id: "7:11" },
      },
    });
    expect(result.children).toHaveLength(1);
    expect(result.children[0]).toMatchObject({
      type: "text",
      content: "Submit",
      fontSize: 18,
    });
  });

  it("preserves structured component override refs for nested Figma instance paths", () => {
    const result = convertNode(
      {
        figma: {
          type: "INSTANCE",
          name: "Nested override carrier",
          guid: { sessionID: 2, localID: 10 },
          size: { x: 120, y: 48 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          symbolData: {
            symbolID: { sessionID: 1, localID: 1 },
            symbolOverrides: [
              {
                guidPath: {
                  guids: [
                    { sessionID: 4, localID: 20 },
                    { sessionID: 4, localID: 21 },
                  ],
                },
                textData: { characters: "Nested label" },
                fontSize: 18,
              },
            ],
          },
        },
        children: [],
      } as any,
      undefined,
      makeCtx(),
    ) as any;

    expect(result.componentRef).toMatchObject({
      source: "figma",
      type: "instance",
      id: "2:10",
      componentId: "1:1",
      overrideCount: 1,
      overridePaths: ["4:20/4:21"],
      overrides: [
        {
          source: "figma",
          path: "4:20/4:21",
          pathIds: ["4:20", "4:21"],
          targetId: "4:21",
          properties: ["textData", "fontSize"],
          values: {
            textData: { characters: "Nested label" },
            fontSize: 18,
          },
        },
      ],
    });
  });

  it("preserves boolean/vector nodes as diagnostic rectangle fallbacks when paths cannot decode", () => {
    const ctx = makeCtx();
    const treeNode = {
      figma: {
        type: "BOOLEAN_OPERATION",
        name: "Union badge",
        size: { x: 64, y: 32 },
        transform: { m00: 1, m01: 0, m02: 12, m10: 0, m11: 1, m12: 24 },
        booleanOperation: "UNION",
        vectorData: {
          normalizedSize: { x: 64, y: 32 },
          vectorNetworkBlob: 3,
        },
        fillGeometry: [{ windingRule: "ODD", commandsBlob: 4 }],
      },
      children: [],
    };

    const result = convertNode(treeNode as any, undefined, ctx) as any;

    expect(result).toMatchObject({
      type: "rectangle",
      name: "Union badge",
      x: 12,
      y: 24,
      width: 64,
      height: 32,
      meta: {
        vectorFallback: {
          source: "figma",
          nodeType: "BOOLEAN_OPERATION",
          fallbackReason: "path_not_decodable",
          booleanOperation: "UNION",
          normalizedSize: { x: 64, y: 32 },
          vectorNetworkBlob: 3,
          fillGeometryCount: 1,
          strokeGeometryCount: 0,
          fillWindingRules: ["ODD"],
        },
      },
    });
    expect(ctx.warnings).toContain(
      'Vector node "Union badge" converted as rectangle (path data not decodable)',
    );
  });

  it("uses evenodd fill rule when any decoded Figma vector subpath is odd", () => {
    const ctx = makeCtx();
    ctx.blobs = [
      makePathBlob([
        [0, 0],
        [80, 0],
        [80, 80],
        [0, 80],
      ]),
      makePathBlob([
        [20, 20],
        [60, 20],
        [60, 60],
        [20, 60],
      ]),
    ];
    const result = convertNode(
      {
        figma: {
          type: "VECTOR",
          name: "Donut",
          size: { x: 80, y: 80 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          fillGeometry: [
            { windingRule: "NONZERO", commandsBlob: 0 },
            { windingRule: "ODD", commandsBlob: 1 },
          ],
          fillPaints: [
            { type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } },
          ],
        },
        children: [],
      } as any,
      undefined,
      ctx,
    ) as any;

    expect(result).toMatchObject({
      type: "path",
      fillRule: "evenodd",
    });
    expect(result.d).toContain("M0 0");
    expect(result.d).toContain("M20 20");
  });

  it("converts Figma regular polygon and star nodes to editable polygon nodes", () => {
    const ctx = makeCtx();
    const polygon = convertNode(
      {
        figma: {
          type: "REGULAR_POLYGON",
          name: "Hexagon",
          pointCount: 6,
          size: { x: 80, y: 80 },
          transform: { m00: 1, m01: 0, m02: 10, m10: 0, m11: 1, m12: 20 },
          fillPaints: [
            { type: "SOLID", color: { r: 0, g: 0.5, b: 1, a: 1 } },
          ],
        },
        children: [],
      } as any,
      undefined,
      ctx,
    ) as any;
    const star = convertNode(
      {
        figma: {
          type: "STAR",
          name: "Badge Star",
          pointCount: 7,
          innerRadiusRatio: 0.42,
          size: { x: 90, y: 90 },
          transform: { m00: 1, m01: 0, m02: 100, m10: 0, m11: 1, m12: 20 },
          strokePaints: [
            { type: "SOLID", color: { r: 1, g: 0.8, b: 0, a: 1 } },
          ],
          strokeWeight: 2,
        },
        children: [],
      } as any,
      undefined,
      ctx,
    ) as any;

    expect(polygon).toMatchObject({
      type: "polygon",
      name: "Hexagon",
      polygonKind: "polygon",
      polygonCount: 6,
      width: 80,
      height: 80,
      x: 10,
      y: 20,
    });
    expect(star).toMatchObject({
      type: "polygon",
      name: "Badge Star",
      polygonKind: "star",
      polygonCount: 7,
      innerRadius: 0.42,
      width: 90,
      height: 90,
      x: 100,
      y: 20,
      stroke: {
        thickness: 2,
      },
    });
  });
});

describe("collectImageBlobs", () => {
  it("should detect PNG blobs", () => {
    const pngHeader = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
    const blobs: (Uint8Array | string)[] = ["text", pngHeader];
    const map = collectImageBlobs(blobs);
    expect(map.size).toBe(1);
    expect(map.has(1)).toBe(true);
  });

  it("should detect JPEG blobs", () => {
    const jpegHeader = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49,
    ]);
    const blobs: (Uint8Array | string)[] = [jpegHeader];
    const map = collectImageBlobs(blobs);
    expect(map.size).toBe(1);
  });
});
