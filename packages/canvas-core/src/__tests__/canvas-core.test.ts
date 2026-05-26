import { describe, expect, it } from "vitest";
import type { FigmaTreeNode } from "../figma-native-types.js";
import type { ContainerRole, PenFill } from "../types.js";

import {
  type CanvasImportResult,
  type PenNode,
  applyCanvasOperation,
  applyImportedAutoLayout,
  applyInstanceOverrides,
  buildAgentContext,
  createCanvasDocument,
  createEmptyDocument,
  createNodeId,
  duplicateCanvasNodes,
  extractFigmaClipboardData,
  findNode,
  findParent,
  getActiveChildren,
  getFigmaAutoLayoutMeta,
  getNodeBounds,
  getVisibleCanvasNodesInBounds,
  insertCanvasImportResult,
  mergeSymbolProps,
  parseClipboardImport,
  resolveContext,
} from "../index.js";

const parserCapableIt = typeof DOMParser === "undefined" ? it.skip : it;

function importedNodeTitle(
  node: CanvasImportResult["nodes"][number],
): string | undefined {
  const titled = node as { title?: string; name?: string };
  return titled.title ?? titled.name;
}

function makeContainer(id: string, _parentId: string | null = null): PenNode {
  return {
    id,
    type: "frame" as const,
    name: id,
    x: 0,
    y: 0,
    width: 500,
    height: 400,
    containerRole: ["visual", "task", "context"] as ContainerRole[],
    children: [] as PenNode[],
    contextSlots: {},
    inheritPolicy: "merge" as const,
    agentBinding: {
      agentId: "agent-1",
      permissions: ["read", "write"] as ("read" | "write" | "spawn")[],
    },
    permissions: { canRead: [], canWrite: [], isolationLevel: "open" as const },
  };
}

describe("cucumber canvas core", () => {
  it("serializes an empty Cucumber document baseline", () => {
    const doc = createEmptyDocument();
    expect(doc.version).toBe("cucumber-canvas-v1");
    expect(doc.activePageId).toBe("page-default");
    expect(doc.pages?.[0]?.id).toBe("page-default");
    expect(doc.children).toEqual([]);
    expect((doc as any).viewport.zoom).toBe(1);
  });

  it("creates page-aware canvas documents with the default active page", () => {
    const doc = createCanvasDocument("New canvas");

    expect(doc.name).toBe("New canvas");
    expect(doc.activePageId).toBe("page-default");
    expect(doc.pages).toEqual([
      { id: "page-default", name: "Page 1", children: [] },
    ]);
    expect(doc.children).toEqual([]);
  });

  it("resolves inherited context through container parents", () => {
    let doc = createEmptyDocument();
    const parent = makeContainer("parent");
    parent.contextSlots = { rules: ["brand purple"], style: { tone: "calm" } };
    const child = makeContainer("child", "parent");
    child.contextSlots = { rules: ["wide spacing"], tokens: { radius: 8 } };
    doc = applyCanvasOperation(doc, { type: "insertNode", node: parent });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: child,
      parentId: "parent",
    });

    expect(resolveContext(doc, "child")).toEqual({
      rules: ["brand purple", "wide spacing"],
      style: { tone: "calm" },
      tokens: { radius: 8 },
      constraints: {},
    });
  });

  it("rejects agent writes outside the bound container", () => {
    let doc = createEmptyDocument();
    const container = makeContainer("container");
    doc = applyCanvasOperation(doc, { type: "insertNode", node: container });
    const node: PenNode = {
      id: createNodeId("rect"),
      type: "rectangle",
      x: 1000,
      y: 1000,
      width: 100,
      height: 100,
      fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
    };

    expect(() =>
      applyCanvasOperation(doc, {
        type: "insertNode",
        node,
        parentId: "container",
        agentId: "agent-1",
      }),
    ).toThrow("cannot write outside container");
  });

  it("rejects moving an existing node outside the bound container", () => {
    let doc = createEmptyDocument();
    const container = makeContainer("container");
    doc = applyCanvasOperation(doc, { type: "insertNode", node: container });

    const node: PenNode = {
      id: createNodeId("rect"),
      type: "rectangle",
      x: 40,
      y: 40,
      width: 120,
      height: 80,
      fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
    };
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node,
      parentId: "container",
      agentId: "agent-1",
    });

    expect(() =>
      applyCanvasOperation(doc, {
        type: "updateNode",
        nodeId: node.id,
        // @ts-expect-error - containerId deprecated, still used in test for agent boundary check
        containerId: "container",
        agentId: "agent-1",
        updates: {
          x: 520,
          y: 60,
          width: 120,
          height: 80,
        } as Partial<PenNode>,
      }),
    ).toThrow("cannot write outside container");
  });

  it("builds agent context for a bound container", () => {
    let doc = createEmptyDocument();
    const container = makeContainer("container");
    doc = applyCanvasOperation(doc, { type: "insertNode", node: container });
    const ctx = buildAgentContext({
      doc,
      agentId: "agent-1",
      containerId: "container",
    });
    expect(ctx.containerPath).toEqual(["container"]);
    expect(ctx.permissions).toEqual(["read", "write"]);
  });

  it("duplicates a container with its child nodes", () => {
    let doc = createEmptyDocument();
    const container = makeContainer("container");
    const child: PenNode = {
      id: "child",
      type: "rectangle",
      x: 40,
      y: 40,
      width: 120,
      height: 80,
      fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
    };
    doc = applyCanvasOperation(doc, { type: "insertNode", node: container });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: child,
      parentId: "container",
    });

    const result = duplicateCanvasNodes(doc, ["container"], 16);
    const cloneId = result.pastedIds[0];
    expect(cloneId).toBeDefined();
    const clone = cloneId ? findNode(result.doc, cloneId) : undefined;

    expect(clone?.type).toBe("frame");
    const cloneChildren = clone && "children" in clone ? clone.children : [];
    expect(cloneChildren).toHaveLength(1);
    const childClone = (cloneChildren as PenNode[])[0];
    expect(childClone).toBeDefined();
    expect(childClone ? findParent(result.doc, childClone.id)?.id : null).toBe(
      cloneId,
    );
  });

  it("reorders nodes within root stacking order", () => {
    let doc = createEmptyDocument();
    const a: PenNode = {
      id: "a",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    };
    const b: PenNode = {
      id: "b",
      type: "rectangle",
      x: 20,
      y: 0,
      width: 10,
      height: 10,
    };
    doc = applyCanvasOperation(doc, { type: "insertNode", node: a });
    doc = applyCanvasOperation(doc, { type: "insertNode", node: b });
    doc = applyCanvasOperation(doc, {
      type: "reorderNode",
      nodeId: "a",
      direction: "front",
    });

    expect(getActiveChildren(doc).map((node) => node.id)).toEqual(["b", "a"]);
  });

  it("hit-tests visible nodes inside marquee bounds", () => {
    let doc = createEmptyDocument();
    const visible: PenNode = {
      id: "visible",
      type: "rectangle",
      x: 10,
      y: 10,
      width: 80,
      height: 80,
    };
    const hidden: PenNode = {
      id: "hidden",
      type: "rectangle",
      x: 20,
      y: 20,
      width: 80,
      height: 80,
      visible: false,
    };
    doc = applyCanvasOperation(doc, { type: "insertNode", node: visible });
    doc = applyCanvasOperation(doc, { type: "insertNode", node: hidden });

    expect(
      getVisibleCanvasNodesInBounds(doc, {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      }).map((node) => node.id),
    ).toEqual(["visible"]);
  });

  it("groups and ungroups sibling nodes without changing their bounds", () => {
    let doc = createEmptyDocument();
    const a: PenNode = {
      id: "a",
      type: "rectangle",
      x: 20,
      y: 30,
      width: 80,
      height: 60,
    };
    const b: PenNode = {
      id: "b",
      type: "ellipse",
      x: 140,
      y: 100,
      width: 100,
      height: 90,
      fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
    };
    doc = applyCanvasOperation(doc, { type: "insertNode", node: a });
    doc = applyCanvasOperation(doc, { type: "insertNode", node: b });

    doc = applyCanvasOperation(doc, {
      type: "groupNodes",
      groupId: "group-1",
      nodeIds: ["a", "b"],
    });

    expect(getActiveChildren(doc).map((node) => node.id)).toEqual(["group-1"]);
    expect(getNodeBounds(findNode(doc, "group-1")!)).toEqual({
      x: 20,
      y: 30,
      width: 220,
      height: 160,
    });
    expect(findParent(doc, "a")?.id).toBe("group-1");

    doc = applyCanvasOperation(doc, {
      type: "ungroupNode",
      groupId: "group-1",
    });

    expect(getActiveChildren(doc).map((node) => node.id)).toEqual(["a", "b"]);
    expect(getNodeBounds(findNode(doc, "a")!)).toEqual(getNodeBounds(a));
    expect(findParent(doc, "b")).toBeUndefined();
  });

  it("aligns unlocked nodes to the selection bounds", () => {
    let doc = createEmptyDocument();
    const a: PenNode = {
      id: "a",
      type: "rectangle",
      x: 20,
      y: 30,
      width: 80,
      height: 60,
    };
    const b: PenNode = {
      id: "b",
      type: "rectangle",
      x: 140,
      y: 100,
      width: 100,
      height: 90,
    };
    doc = applyCanvasOperation(doc, { type: "insertNode", node: a });
    doc = applyCanvasOperation(doc, { type: "insertNode", node: b });

    doc = applyCanvasOperation(doc, {
      type: "alignNodes",
      nodeIds: ["a", "b"],
      alignment: "right",
    });

    expect(findNode(doc, "a")?.x ?? 0).toBe(160);
    expect(findNode(doc, "b")?.x ?? 0).toBe(140);
  });

  it("moves a node to a specific sibling index", () => {
    let doc = createEmptyDocument();
    const a: PenNode = {
      id: "a",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    };
    const b: PenNode = {
      id: "b",
      type: "rectangle",
      x: 20,
      y: 0,
      width: 10,
      height: 10,
    };
    const c: PenNode = {
      id: "c",
      type: "rectangle",
      x: 40,
      y: 0,
      width: 10,
      height: 10,
    };
    doc = applyCanvasOperation(doc, { type: "insertNode", node: a });
    doc = applyCanvasOperation(doc, { type: "insertNode", node: b });
    doc = applyCanvasOperation(doc, { type: "insertNode", node: c });

    doc = applyCanvasOperation(doc, {
      type: "reorderNode",
      nodeId: "c",
      targetParentId: null,
      targetIndex: 1,
    });

    expect(getActiveChildren(doc).map((node) => node.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("inserts imported nodes into the target parent and selects the roots", () => {
    let doc = createEmptyDocument();
    const container = makeContainer("container");
    doc = applyCanvasOperation(doc, { type: "insertNode", node: container });
    const result: CanvasImportResult = {
      source: "svg",
      sourceLabel: "SVG",
      importSessionId: "import-test",
      rootNodeIds: ["group-1"],
      nodes: [
        {
          id: "group-1",
          type: "group",
          title: "Imported",
          x: 10,
          y: 20,
          width: 200,
          height: 120,
          childrenOrder: ["child-1"],
          meta: { source: "svg-import" },
        },
        {
          id: "child-1",
          type: "rectangle",
          title: "Child",
          x: 20,
          y: 30,
          width: 100,
          height: 80,
          fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
          meta: { source: "svg-import" },
        },
      ],
      assets: [],
      warnings: [],
    };

    const inserted = insertCanvasImportResult(doc, result, {
      offsetX: 40,
      offsetY: 10,
    });

    const groupNode1 = findNode(inserted.doc, "group-1");
    expect(groupNode1?.x).toBe(50);
    expect(groupNode1?.y).toBe(30);
    expect(findNode(inserted.doc, "child-1")).toBeDefined();
    expect(inserted.insertedIds).toEqual(["group-1"]);
    expect((findNode(inserted.doc, "group-1") as any)?.meta).toMatchObject({
      source: "svg-import",
      importSessionId: result.importSessionId,
      importSourceLabel: "SVG",
      warningCount: 0,
    });
  });

  it("assigns a shared import session and warning metadata to inserted roots", () => {
    const result: CanvasImportResult = {
      source: "svg",
      sourceLabel: "SVG",
      importSessionId: "import-shared-session",
      rootNodeIds: ["rect-1"],
      nodes: [
        {
          id: "rect-1",
          type: "rectangle",
          title: "Imported rect",
          x: 10,
          y: 20,
          width: 80,
          height: 60,
          fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
          meta: { source: "svg-import" },
        },
      ],
      assets: [],
      warnings: [
        {
          code: "unsupported_tag",
          message: "暂未支持导入 SVG 节点 <foreignObject>，已跳过。",
        },
      ],
    };

    const inserted = insertCanvasImportResult(createEmptyDocument(), result);
    const root = findNode(inserted.doc, result.rootNodeIds[0]!);
    expect((root as any)?.meta).toMatchObject({
      source: "svg-import",
      importSessionId: result.importSessionId,
      importSourceLabel: "SVG",
      warningCount: 1,
      degradationHints: ["unsupported_tag"],
    });
  });

  parserCapableIt(
    "parses figma html fallback with grouped structure and degradation warnings",
    () => {
      const result = parseClipboardImport({
        html: `
          <div data-buffer="1" data-node-id="42:1" style="position:absolute;left:10px;top:12px;width:120px;height:64px;background-color:#ffffff;display:flex;box-shadow:0 2px 12px rgba(0,0,0,.15)">
            <span style="font-size:18px;color:#111827">Title</span>
          </div>
        `,
      });

      expect(result).not.toBeNull();
      expect(result?.source).toBe("figma");
      expect(result?.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "layout_degraded" }),
          expect.objectContaining({ code: "effects_dropped" }),
          expect.objectContaining({ code: "partial_fidelity" }),
        ]),
      );
      const rootId = result?.rootNodeIds[0];
      const root = rootId
        ? result?.nodes.find((node) => node.id === rootId)
        : null;
      expect(root?.type).toBe("group");
      expect((root as any)?.meta).toMatchObject({
        source: "figma-paste",
        importSourceLabel: "Figma",
        originNodeType: "div",
        autoLayout: {
          layout: "horizontal",
        },
      });
    },
  );

  it("extracts figma clipboard meta and buffer from comment blocks", () => {
    const metaBase64 = Buffer.from(
      JSON.stringify({ source: "figma", nodeCount: 2 }),
    ).toString("base64");
    const bufferBase64 = Buffer.from(Uint8Array.from([1, 2, 3, 4])).toString(
      "base64",
    );
    const html = `<!--(figmeta)-->${metaBase64}<!--(figmeta)--><!--(figma)-->${bufferBase64}<!--(figma)-->`;

    const extracted = extractFigmaClipboardData(html);

    expect(extracted?.meta).toEqual({ source: "figma", nodeCount: 2 });
    expect(
      Array.from(new Uint8Array(extracted?.buffer ?? new ArrayBuffer(0))),
    ).toEqual([1, 2, 3, 4]);
  });

  it("extracts figma clipboard meta and buffer from quoted data attributes", () => {
    const metaBase64 = Buffer.from(
      JSON.stringify({ source: "figma", nodeCount: 1 }),
    ).toString("base64");
    const bufferBase64 = Buffer.from(Uint8Array.from([4, 3, 2, 1])).toString(
      "base64",
    );
    const html = `<div data-metadata='${metaBase64}' data-buffer='${bufferBase64}'></div>`;

    const extracted = extractFigmaClipboardData(html);

    expect(extracted?.meta).toEqual({ source: "figma", nodeCount: 1 });
    expect(
      Array.from(new Uint8Array(extracted?.buffer ?? new ArrayBuffer(0))),
    ).toEqual([4, 3, 2, 1]);
  });

  parserCapableIt(
    "falls back to styled html figma parsing when native clipboard decode is invalid",
    () => {
      const html = `
      <div data-metadata="invalid" data-buffer="invalid" style="position:absolute;left:12px;top:16px;width:120px;height:56px;background-color:#ffffff">
        Native fallback
      </div>
    `;

      const result = parseClipboardImport({ html });

      expect(result?.source).toBe("figma");
      expect(result?.rootNodeIds.length).toBeGreaterThan(0);
      expect(result?.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "partial_fidelity" }),
        ]),
      );
    },
  );

  parserCapableIt(
    "parses SVG clipboard MIME items with style, defs, and transform",
    () => {
      const result = parseClipboardImport({
        items: [
          {
            type: "image/svg+xml",
            text: `
            <svg width="200" height="100" viewBox="0 0 100 50">
              <defs>
                <linearGradient id="g"><stop offset="0%" stop-color="#ff0000"/><stop offset="100%" stop-color="#0000ff"/></linearGradient>
              </defs>
              <style>.hero { fill: url(#g); stroke: #111111; stroke-width: 2; }</style>
              <rect class="hero" x="10" y="10" width="30" height="20" transform="translate(5 0)" />
            </svg>
          `,
          },
        ],
      });

      expect(result?.source).toBe("svg");
      const rect = result?.nodes.find((node) => node.type === "rect") as
        | {
            bounds?: { x: number; y: number; width: number; height: number };
            fills?: Array<{ type: string }>;
            stroke?: { thickness?: number };
          }
        | undefined;
      expect(rect?.bounds).toMatchObject({
        x: 30,
        y: 20,
        width: 60,
        height: 40,
      });
      expect(rect?.fills?.[0]).toMatchObject({ type: "linear_gradient" });
      expect(rect?.stroke?.thickness).toBe(2);
    },
  );

  it("parses raster clipboard files into image assets", () => {
    const result = parseClipboardImport({
      files: [
        {
          type: "image/png",
          name: "paste.png",
          dataUrl: "data:image/png;base64,AQID",
          width: 32,
          height: 24,
        },
      ],
    });

    expect(result?.source).toBe("image");
    expect(result?.assets[0]).toMatchObject({
      mimeType: "image/png",
      name: "paste.png",
      width: 32,
      height: 24,
    });
    const image = result?.nodes[0] as
      | {
          type?: string;
          bounds?: { width: number; height: number };
          src?: string;
        }
      | undefined;
    expect(image).toMatchObject({
      type: "image",
      bounds: { width: 32, height: 24 },
      src: "data:image/png;base64,AQID",
    });
  });

  parserCapableIt(
    "prefers explicit SVG MIME over HTML inline SVG fallback",
    () => {
      const result = parseClipboardImport({
        html: '<svg width="20" height="20"><rect id="html" width="20" height="20"/></svg>',
        items: [
          {
            type: "image/svg+xml",
            text: '<svg width="10" height="10"><circle id="mime" cx="5" cy="5" r="5"/></svg>',
          },
        ],
      });

      expect(
        result?.nodes.some((node) => importedNodeTitle(node) === "mime"),
      ).toBe(true);
      expect(
        result?.nodes.some((node) => importedNodeTitle(node) === "html"),
      ).toBe(false);
    },
  );

  parserCapableIt(
    "prefers explicit SVG MIME when Figma native decode falls back",
    () => {
      const result = parseClipboardImport({
        html: `
          <div data-metadata="invalid" data-buffer="invalid" style="position:absolute;left:12px;top:16px;width:120px;height:56px">
            Figma html fallback
          </div>
        `,
        items: [
          {
            type: "image/svg+xml",
            text: '<svg width="10" height="10"><circle id="figma-svg-mime" cx="5" cy="5" r="5"/></svg>',
          },
        ],
      });

      expect(result?.source).toBe("svg");
      expect(
        result?.nodes.some(
          (node) => importedNodeTitle(node) === "figma-svg-mime",
        ),
      ).toBe(true);
      expect(
        result?.nodes.some(
          (node) => importedNodeTitle(node) === "Figma html fallback",
        ),
      ).toBe(false);
    },
  );

  parserCapableIt(
    "applies SVG descendant selector specificity and stroke attributes",
    () => {
      const result = parseClipboardImport({
        svg: `
        <svg width="100" height="60">
          <style>
            rect { fill: #ff0000; }
            .wrapper .target { fill: #00ff00; stroke: #111111; stroke-width: 3; }
            #hero { stroke: #222222; }
          </style>
          <g class="wrapper">
            <rect id="hero" class="target" x="4" y="6" width="40" height="20" fill-opacity="0.5" stroke-dasharray="4 2" stroke-linecap="round" stroke-linejoin="miter" />
          </g>
        </svg>
      `,
      });

      const rect = result?.nodes.find(
        (node) => importedNodeTitle(node) === "hero",
      ) as
        | {
            fills?: Array<{ type: string; color?: string; opacity?: number }>;
            stroke?: {
              fill?: Array<{ color?: string }>;
              thickness?: number;
              dashPattern?: number[];
              cap?: string;
              join?: string;
            };
          }
        | undefined;

      expect(rect?.fills?.[0]).toMatchObject({
        type: "solid",
        color: "#00ff00",
        opacity: 0.5,
      });
      expect(rect?.stroke).toMatchObject({
        thickness: 3,
        dashPattern: [4, 2],
        cap: "round",
        join: "miter",
      });
      expect(rect?.stroke?.fill?.[0]?.color).toBe("#222222");
    },
  );

  parserCapableIt(
    "expands SVG use and maps simple clipPath/filter definitions",
    () => {
      const result = parseClipboardImport({
        svg: `
        <svg width="120" height="80">
          <defs>
            <rect id="reused" x="8" y="8" width="50" height="30" fill="#3366ff" />
            <clipPath id="clip"><rect x="0" y="0" width="60" height="40" rx="6" /></clipPath>
            <filter id="shadow"><feDropShadow dx="2" dy="3" stdDeviation="4" flood-color="#000000" /></filter>
          </defs>
          <g id="clipped" clip-path="url(#clip)" filter="url(#shadow)">
            <use href="#reused" x="4" y="5" />
          </g>
        </svg>
      `,
      });

      const frame = result?.nodes.find(
        (node) => importedNodeTitle(node) === "clipped",
      ) as
        | {
            type?: string;
            clipContent?: boolean;
            cornerRadius?: number;
            effects?: Array<{
              type?: string;
              offsetX?: number;
              offsetY?: number;
              blur?: number;
            }>;
            childrenOrder?: string[];
          }
        | undefined;
      const reused = result?.nodes.find(
        (node) => importedNodeTitle(node) === "reused",
      );

      expect(frame).toMatchObject({
        type: "frame",
        clipContent: true,
        cornerRadius: 6,
        effects: [{ type: "shadow", offsetX: 2, offsetY: 3, blur: 4 }],
      });
      expect(frame?.childrenOrder).toContain(reused?.id);
    },
  );

  it("preserves imported frame layout, effects, and text style during insertion", () => {
    const result: CanvasImportResult = {
      source: "figma",
      sourceLabel: "Figma",
      importSessionId: "import-test",
      rootNodeIds: ["frame-1"],
      nodes: [
        {
          id: "frame-1",
          type: "frame",
          parentId: null,
          title: "Auto frame",
          bounds: { x: 10, y: 20, width: 240, height: 120, rotation: 8 },
          fills: [{ type: "solid", color: "#ffffff" }] as PenFill[],
          effects: [
            {
              type: "shadow",
              offsetX: 0,
              offsetY: 4,
              blur: 12,
              spread: 0,
              color: "#00000033",
            },
          ],
          layout: "horizontal",
          gap: 12,
          padding: [8, 16],
          justifyContent: "center",
          alignItems: "center",
          clipContent: true,
          childrenOrder: ["text-1"],
          meta: { source: "figma-paste" },
        },
        {
          id: "text-1",
          type: "text",
          parentId: "frame-1",
          text: "Styled",
          bounds: { x: 0, y: 0, width: 80, height: 24 },
          fontSize: 18,
          fontWeight: 700,
          lineHeight: 1.2,
          letterSpacing: 0.4,
          textAlign: "center",
          textGrowth: "fixed-width",
          fills: [{ type: "solid", color: "#111111" }] as PenFill[],
        },
      ],
      assets: [],
      warnings: [],
    };

    const inserted = insertCanvasImportResult(createEmptyDocument(), result);
    const frame = findNode(inserted.doc, "frame-1") as
      | (PenNode & {
          gap?: number;
          padding?: [number, number];
          justifyContent?: string;
          alignItems?: string;
          clipContent?: boolean;
          effects?: Array<{ type: string; blur?: number }>;
        })
      | undefined;
    const text = findNode(inserted.doc, "text-1") as
      | (PenNode & {
          lineHeight?: number;
          letterSpacing?: number;
          textGrowth?: string;
        })
      | undefined;

    expect(frame).toMatchObject({
      type: "frame",
      rotation: 8,
      layout: "horizontal",
      gap: 12,
      padding: [8, 16],
      justifyContent: "center",
      alignItems: "center",
      clipContent: true,
    });
    expect(frame?.effects?.[0]).toMatchObject({ type: "shadow", blur: 12 });
    expect(text).toMatchObject({
      fontWeight: 700,
      lineHeight: 1.2,
      letterSpacing: 0.4,
      textAlign: "center",
      textGrowth: "fixed-width",
    });
  });

  it("materializes imported auto-layout sizing onto executable PenNode fields", () => {
    const result: CanvasImportResult = {
      source: "figma",
      sourceLabel: "Figma",
      importSessionId: "import-layout-props",
      rootNodeIds: ["frame-fit"],
      nodes: [
        {
          id: "frame-fit",
          type: "frame",
          parentId: null,
          title: "Fit frame",
          bounds: { x: 0, y: 0, width: 240, height: 120 },
          layout: "horizontal",
          gap: 8,
          childrenOrder: ["child-fill", "child-absolute"],
          meta: {
            source: "figma-paste",
            autoLayout: {
              layout: "horizontal",
              widthMode: "fit_content",
              heightMode: "fixed",
            },
          },
        },
        {
          id: "child-fill",
          type: "text",
          parentId: "frame-fit",
          text: "Fill child",
          bounds: { x: 0, y: 0, width: 80, height: 24 },
          meta: {
            source: "figma-paste",
            autoLayout: {
              widthMode: "fill_container",
              heightMode: "fixed",
            },
          },
        },
        {
          id: "child-absolute",
          type: "rectangle",
          parentId: "frame-fit",
          bounds: { x: 16, y: 16, width: 20, height: 20 },
          meta: {
            source: "figma-paste",
            autoLayout: {
              positioning: "absolute",
            },
          },
        },
      ],
      assets: [],
      warnings: [],
    };

    const inserted = insertCanvasImportResult(createEmptyDocument(), result);
    const frame = findNode(inserted.doc, "frame-fit") as
      | (PenNode & { width?: string; layout?: string })
      | undefined;
    const childFill = findNode(inserted.doc, "child-fill") as
      | (PenNode & { width?: string })
      | undefined;
    const childAbsolute = findNode(inserted.doc, "child-absolute") as
      | (PenNode & { role?: string })
      | undefined;

    expect(frame).toMatchObject({
      type: "frame",
      width: "fit_content",
      layout: "horizontal",
    });
    expect(childFill?.width).toBe("fill_container");
    expect(childAbsolute?.role).toBe("overlay");
  });

  it("merges missing symbol props into an instance node", () => {
    const merged = mergeSymbolProps(
      {
        type: "INSTANCE",
        name: "Button Instance",
        guid: { sessionID: 1, localID: 10 },
        fillPaints: undefined,
        strokePaints: undefined,
      },
      {
        type: "SYMBOL",
        name: "Button Master",
        guid: { sessionID: 1, localID: 20 },
        stackMode: "HORIZONTAL",
        stackSpacing: 12,
        fillPaints: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
        strokePaints: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
      },
    );

    expect(merged.stackMode).toBe("HORIZONTAL");
    expect(merged.stackSpacing).toBe(12);
    expect(merged.fillPaints?.[0]?.type).toBe("SOLID");
    expect(merged.strokePaints?.[0]?.type).toBe("SOLID");
  });

  it("maps figma auto-layout metadata for containers and children", () => {
    expect(
      getFigmaAutoLayoutMeta(
        {
          type: "FRAME",
          stackMode: "VERTICAL",
          stackSpacing: 16,
          stackPadding: 20,
          stackPrimaryAlignItems: "CENTER",
          stackCounterAlignItems: "MAX",
          frameMaskDisabled: false,
          size: { x: 320, y: 180 },
        },
        undefined,
      ),
    ).toEqual({
      layout: "vertical",
      gap: 16,
      padding: 20,
      justifyContent: "center",
      alignItems: "end",
      clipContent: true,
      widthMode: "fixed",
      heightMode: "fixed",
    });

    expect(
      getFigmaAutoLayoutMeta(
        {
          type: "TEXT",
          size: { x: 120, y: 40 },
          stackChildPrimaryGrow: 1,
          stackChildAlignSelf: "STRETCH",
          stackPositioning: "AUTO",
        },
        "VERTICAL",
      ),
    ).toEqual({
      widthMode: "fill_container",
      heightMode: "fill_container",
      alignSelf: "stretch",
      positioning: "auto",
      grow: 1,
    });
  });

  it("applies imported auto-layout to container children and nested layout containers", () => {
    let doc = createEmptyDocument();
    const root = makeContainer("root");
    (root as any).x = 10;
    (root as any).y = 20;
    (root as any).width = 300;
    (root as any).height = 200;
    (root as any).meta = {
      source: "figma-paste",
      autoLayout: {
        layout: "vertical",
        gap: 10,
        padding: [12, 16],
        justifyContent: "center",
      },
    };

    const titleNode = {
      id: "title",
      type: "text" as const,
      x: 0,
      y: 0,
      width: 50,
      height: 20,
      content: "Title",
      fontSize: 16,
      meta: {
        source: "figma-paste",
        autoLayout: {
          widthMode: "fill_container",
        },
      },
    } as any as PenNode;
    const nested = makeContainer("nested", "root");
    (nested as any).x = 0;
    (nested as any).y = 0;
    (nested as any).width = 100;
    (nested as any).height = 40;
    (nested as any).meta = {
      source: "figma-paste",
      autoLayout: {
        layout: "horizontal",
        gap: 8,
        padding: 8,
        widthMode: "fill_container",
        alignItems: "center",
      },
    };

    const nestedLabel: PenNode = {
      id: "nested-label",
      type: "text",
      x: 0,
      y: 0,
      width: 60,
      height: 20,
      content: "Nested",
      fontSize: 14,
    };
    const nestedValue: PenNode = {
      id: "nested-value",
      type: "text" as const,
      x: 0,
      y: 0,
      width: 40,
      height: 20,
      content: "Value",
      fontSize: 14,
      meta: {
        source: "figma-paste",
        autoLayout: {
          grow: 1,
          heightMode: "fill_container",
        },
      },
    } as any;

    doc = applyCanvasOperation(doc, { type: "insertNode", node: root });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: titleNode,
      parentId: "root",
    });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: nested,
      parentId: "root",
    });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: nestedLabel,
      parentId: "nested",
    });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: nestedValue,
      parentId: "nested",
    });

    const next = applyImportedAutoLayout(doc, "root");

    expect(getNodeBounds(findNode(next, "title")!)).toMatchObject({
      x: 26,
      y: 85,
      width: 268,
      height: 20,
    });
    expect(getNodeBounds(findNode(next, "nested")!)).toMatchObject({
      x: 26,
      y: 115,
      width: 268,
      height: 40,
    });
    expect(getNodeBounds(findNode(next, "nested-label")!)).toMatchObject({
      x: 34,
      y: 125,
      width: 60,
      height: 20,
    });
    expect(getNodeBounds(findNode(next, "nested-value")!)).toMatchObject({
      x: 102,
      y: 123,
      width: 184,
      height: 24,
    });
  });

  it("keeps imported absolute-positioned children fixed during auto-layout reflow", () => {
    let doc = createEmptyDocument();
    const root = makeContainer("absolute-root");
    (root as any).x = 0;
    (root as any).y = 0;
    (root as any).width = 200;
    (root as any).height = 120;
    (root as any).meta = {
      source: "figma-paste",
      autoLayout: {
        layout: "horizontal",
        gap: 12,
        padding: 10,
      },
    };

    const flowNode: PenNode = {
      id: "flow",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 40,
      height: 20,
      fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
    };
    const absoluteNode: PenNode = {
      id: "absolute",
      type: "rectangle" as const,
      x: 77,
      y: 33,
      width: 30,
      height: 30,
      fill: [{ type: "solid", color: "#ffffff" }] as PenFill[],
      meta: {
        source: "figma-paste",
        autoLayout: {
          positioning: "absolute",
        },
      },
    } as any;

    doc = applyCanvasOperation(doc, { type: "insertNode", node: root });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: flowNode,
      parentId: "absolute-root",
    });
    doc = applyCanvasOperation(doc, {
      type: "insertNode",
      node: absoluteNode,
      parentId: "absolute-root",
    });

    const next = applyImportedAutoLayout(doc, "absolute-root");

    expect(getNodeBounds(findNode(next, "flow")!)).toMatchObject({
      x: 10,
      y: 10,
      width: 40,
      height: 20,
    });
    expect(getNodeBounds(findNode(next, "absolute")!)).toMatchObject({
      x: 77,
      y: 33,
      width: 30,
      height: 30,
    });
  });

  it("applies instance overrides and derived data to symbol children", () => {
    const symbolNode: FigmaTreeNode = {
      figma: {
        type: "SYMBOL",
        name: "Card",
        guid: { sessionID: 1, localID: 100 },
        size: { x: 200, y: 80 },
        transform: { m00: 1, m01: 0, m02: 10, m10: 0, m11: 1, m12: 20 },
      },
      children: [
        {
          figma: {
            type: "TEXT",
            name: "Title",
            guid: { sessionID: 1, localID: 101 },
            size: { x: 160, y: 24 },
            transform: { m00: 1, m01: 0, m02: 20, m10: 0, m11: 1, m12: 30 },
            fontSize: 16,
            textData: { characters: "Master Title" },
          },
          children: [],
        },
      ],
    };

    const children = applyInstanceOverrides(
      symbolNode,
      [
        {
          guidPath: { guids: [{ sessionID: 1, localID: 101 }] },
          fontSize: 22,
          textData: { characters: "Instance Title" },
        },
      ],
      [
        {
          guidPath: { guids: [{ sessionID: 1, localID: 101 }] },
          size: { x: 180, y: 28 },
          transform: { m00: 1, m01: 0, m02: 24, m10: 0, m11: 1, m12: 36 },
        },
      ],
      { x: 240, y: 100 },
    );

    expect(children).toHaveLength(1);
    expect(children[0]?.figma.fontSize).toBe(22);
    expect(children[0]?.figma.textData?.characters).toBe("Instance Title");
    expect(children[0]?.figma.size).toEqual({ x: 180, y: 28 });
    expect(children[0]?.figma.transform).toEqual({
      m00: 1,
      m01: 0,
      m02: 24,
      m10: 0,
      m11: 1,
      m12: 36,
    });
  });

  it("propagates nested instance override paths to child instances", () => {
    const symbolNode: FigmaTreeNode = {
      figma: {
        type: "SYMBOL",
        name: "Outer Card",
        guid: { sessionID: 1, localID: 1000 },
        size: { x: 300, y: 180 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      },
      children: [
        {
          figma: {
            type: "INSTANCE",
            name: "Nested Badge Instance",
            guid: { sessionID: 1, localID: 1001 },
            size: { x: 120, y: 48 },
            transform: { m00: 1, m01: 0, m02: 20, m10: 0, m11: 1, m12: 24 },
            symbolData: {
              symbolID: { sessionID: 1, localID: 2000 },
            },
          },
          children: [],
        },
      ],
    };

    const children = applyInstanceOverrides(
      symbolNode,
      [
        {
          guidPath: {
            guids: [
              { sessionID: 8, localID: 5000 },
              { sessionID: 8, localID: 5001 },
            ],
          },
          textData: { characters: "Nested override title" },
          fontSize: 18,
        },
      ],
      [
        {
          guidPath: {
            guids: [
              { sessionID: 8, localID: 5000 },
              { sessionID: 8, localID: 5001 },
            ],
          },
          size: { x: 96, y: 36 },
          transform: { m00: 1, m01: 0, m02: 26, m10: 0, m11: 1, m12: 32 },
        },
      ],
      { x: 300, y: 180 },
    );

    expect(children).toHaveLength(1);
    const nestedInstance = children[0];
    expect(nestedInstance?.figma.symbolData?.symbolOverrides).toEqual([
      expect.objectContaining({
        guidPath: { guids: [{ sessionID: 8, localID: 5001 }] },
        textData: { characters: "Nested override title" },
        fontSize: 18,
      }),
    ]);
    expect(nestedInstance?.figma.derivedSymbolData).toEqual([
      expect.objectContaining({
        guidPath: { guids: [{ sessionID: 8, localID: 5001 }] },
        size: { x: 96, y: 36 },
      }),
    ]);
  });
});
