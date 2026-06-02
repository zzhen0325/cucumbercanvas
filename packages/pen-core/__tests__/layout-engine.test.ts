import type { PenNode } from "@cucumber/pen-types";
import { describe, expect, it } from "vitest";
import {
  computeLayoutPositions,
  getNodeHeight,
  getNodeWidth,
  inferLayout,
  isNodeVisible,
  resolvePadding,
} from "../layout/engine.js";

const frame = (props: Partial<PenNode> & { children?: PenNode[] }): PenNode =>
  ({
    id: "f1",
    type: "frame",
    x: 0,
    y: 0,
    ...props,
  }) as PenNode;

const rect = (id: string, w = 50, h = 30): PenNode => ({
  id,
  type: "rectangle",
  x: 0,
  y: 0,
  width: w,
  height: h,
});

describe("layout-engine", () => {
  describe("resolvePadding", () => {
    it("returns zero for undefined", () => {
      expect(resolvePadding(undefined)).toEqual({
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      });
    });

    it("resolves uniform padding", () => {
      expect(resolvePadding(10)).toEqual({
        top: 10,
        right: 10,
        bottom: 10,
        left: 10,
      });
    });

    it("resolves [vertical, horizontal]", () => {
      expect(resolvePadding([10, 20])).toEqual({
        top: 10,
        right: 20,
        bottom: 10,
        left: 20,
      });
    });

    it("resolves [top, right, bottom, left]", () => {
      expect(resolvePadding([1, 2, 3, 4])).toEqual({
        top: 1,
        right: 2,
        bottom: 3,
        left: 4,
      });
    });

    it("returns zero for string (variable ref)", () => {
      expect(resolvePadding("$spacing")).toEqual({
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      });
    });
  });

  describe("isNodeVisible", () => {
    it("returns true by default", () => {
      expect(isNodeVisible(rect("a"))).toBe(true);
    });

    it("returns false when visible is false", () => {
      expect(isNodeVisible({ ...rect("a"), visible: false })).toBe(false);
    });

    it("returns false when enabled is false", () => {
      expect(isNodeVisible({ ...rect("a"), enabled: false } as PenNode)).toBe(
        false,
      );
    });
  });

  describe("inferLayout", () => {
    it("returns undefined for non-frame nodes", () => {
      expect(inferLayout(rect("a"))).toBeUndefined();
    });

    it("infers horizontal when gap is set", () => {
      expect(inferLayout(frame({ gap: 10, children: [] }))).toBe("horizontal");
    });

    it("infers horizontal when padding is set", () => {
      expect(inferLayout(frame({ padding: 10, children: [] }))).toBe(
        "horizontal",
      );
    });

    it("returns undefined when no layout hints", () => {
      expect(inferLayout(frame({ children: [rect("a")] }))).toBeUndefined();
    });

    it("does not infer parent layout from legacy child sizing strings", () => {
      expect(
        inferLayout(
          frame({
            children: [
              {
                ...rect("fill"),
                width: "fill_container" as unknown as number,
              } as PenNode,
            ],
          }),
        ),
      ).toBeUndefined();
    });
  });

  describe("getNodeWidth / getNodeHeight", () => {
    it("returns explicit width", () => {
      expect(getNodeWidth(rect("a", 200))).toBe(200);
    });

    it("returns explicit height", () => {
      expect(getNodeHeight(rect("a", 50, 100))).toBe(100);
    });

    it("estimates text width", () => {
      const text: PenNode = {
        id: "t",
        type: "text",
        content: "Hello World",
        fontSize: 16,
      };
      expect(getNodeWidth(text)).toBeGreaterThan(0);
    });
  });

  describe("computeLayoutPositions", () => {
    it("positions children horizontally", () => {
      const parent = frame({
        width: 300,
        height: 100,
        layout: "horizontal",
        gap: 10,
        children: [rect("a", 50, 30), rect("b", 50, 30)],
      });
      const result = computeLayoutPositions(
        parent,
        (parent as PenNode & { children: PenNode[] }).children,
      );
      expect(result[0]).toMatchObject({ x: 0, y: 0 });
      expect(result[1]).toMatchObject({ x: 60 }); // 50 + 10 gap
    });

    it("positions children vertically", () => {
      const parent = frame({
        width: 100,
        height: 300,
        layout: "vertical",
        gap: 10,
        children: [rect("a", 50, 30), rect("b", 50, 30)],
      });
      const result = computeLayoutPositions(
        parent,
        (parent as PenNode & { children: PenNode[] }).children,
      );
      expect(result[0]).toMatchObject({ x: 0, y: 0 });
      expect(result[1]).toMatchObject({ y: 40 }); // 30 + 10 gap
    });

    it("applies padding", () => {
      const parent = frame({
        width: 300,
        height: 100,
        layout: "horizontal",
        padding: 20,
        children: [rect("a", 50, 30)],
      });
      const result = computeLayoutPositions(
        parent,
        (parent as PenNode & { children: PenNode[] }).children,
      );
      expect(result[0]).toMatchObject({ x: 20, y: 20 });
    });

    it("centers children on cross axis", () => {
      const parent = frame({
        width: 300,
        height: 100,
        layout: "horizontal",
        alignItems: "center",
        children: [rect("a", 50, 30)],
      });
      const result = computeLayoutPositions(
        parent,
        (parent as PenNode & { children: PenNode[] }).children,
      );
      expect(result[0]).toMatchObject({ y: 35 }); // (100 - 30) / 2
    });

    it('maps alignItems="baseline" to end-alignment (engine has no baseline metric)', () => {
      // LLMs routinely emit alignItems: 'baseline' from web CSS reflex
      // for "big number + small unit" patterns like "72 BPM". The
      // layout engine doesn't compute text baselines; the closest
      // visually correct fallback is end-alignment (both children
      // bottom-pinned). Locks in that `baseline` no longer falls
      // through to the `start` default.
      //
      // `baseline` is not part of the TS `alignItems` union, so we
      // cast through unknown — the normalizer accepts any string and
      // that's exactly the behavior we want to exercise here.
      const parent = frame({
        width: 300,
        height: 100,
        layout: "horizontal",
        alignItems: "baseline" as unknown as "start" | "center" | "end",
        children: [rect("big", 120, 80), rect("unit", 60, 20)],
      });
      const result = computeLayoutPositions(
        parent,
        (parent as PenNode & { children: PenNode[] }).children,
      );
      expect(result[0]).toMatchObject({ y: 20 }); // 100 - 80 (big pinned to bottom)
      expect(result[1]).toMatchObject({ y: 80 }); // 100 - 20 (unit pinned to bottom)
    });

    it('maps alignItems="flex-end" and "bottom" to end (CSS/alias passthrough)', () => {
      // `flex-end` is a CSS alias that the normalizer accepts but the
      // TS union doesn't — cast through unknown same as the baseline
      // test above.
      const parent = frame({
        width: 300,
        height: 100,
        layout: "horizontal",
        alignItems: "flex-end" as unknown as "start" | "center" | "end",
        children: [rect("a", 50, 30)],
      });
      const result = computeLayoutPositions(
        parent,
        (parent as PenNode & { children: PenNode[] }).children,
      );
      expect(result[0]).toMatchObject({ y: 70 }); // 100 - 30
    });

    it("distributes remaining main-axis space by layoutConstraints grow weights", () => {
      const parent = frame({
        width: 300,
        height: 80,
        layout: "horizontal",
        gap: 0,
        children: [
          rect("fixed", 50, 30),
          {
            ...rect("grow-1", 50, 30),
            layoutConstraints: { grow: 1 },
          },
          {
            ...rect("grow-2", 50, 30),
            layoutConstraints: { grow: 2 },
          },
        ],
      });

      const result = computeLayoutPositions(
        parent,
        (parent as PenNode & { children: PenNode[] }).children,
      );

      expect(result[0]).toMatchObject({ width: 50 });
      expect(result[1]).toMatchObject({ width: 100 });
      expect(result[2]).toMatchObject({ width: 150, x: 150 });
    });

    it("resolves fixed, fit_content, and fill_container constraints by axis", () => {
      const parent = frame({
        width: 260,
        height: 120,
        layout: "horizontal",
        gap: 10,
        padding: 10,
        children: [
          rect("fixed", 40, 20),
          {
            ...rect("fit", 80, 20),
            layoutConstraints: { widthMode: "fit_content" },
          },
          {
            ...rect("fill", 20, 20),
            layoutConstraints: {
              heightMode: "fill_container",
              widthMode: "fill_container",
            },
          },
        ],
      });

      const result = computeLayoutPositions(
        parent,
        (parent as PenNode & { children: PenNode[] }).children,
      );

      expect(result[0]).toMatchObject({ x: 10, width: 40, height: 20 });
      expect(result[1]).toMatchObject({ x: 60, width: 80, height: 20 });
      expect(result[2]).toMatchObject({ x: 150, width: 100, height: 100 });
    });

    it("lets alignSelf override parent alignItems and maps baseline to end", () => {
      const parent = frame({
        width: 200,
        height: 100,
        layout: "horizontal",
        alignItems: "start",
        children: [
          {
            ...rect("center", 40, 20),
            layoutConstraints: { alignSelf: "center" },
          },
          {
            ...rect("baseline", 40, 20),
            layoutConstraints: { alignSelf: "baseline" },
          },
        ],
      });

      const result = computeLayoutPositions(
        parent,
        (parent as PenNode & { children: PenNode[] }).children,
      );

      expect(result[0]).toMatchObject({ y: 40 });
      expect(result[1]).toMatchObject({ y: 80 });
    });

    it("keeps absolute children out of flow while preserving layer order", () => {
      const parent = frame({
        width: 200,
        height: 80,
        layout: "horizontal",
        gap: 10,
        children: [
          rect("a", 40, 20),
          {
            ...rect("absolute", 30, 30),
            x: 77,
            y: 33,
            layoutConstraints: { positioning: "absolute" },
          },
          rect("b", 40, 20),
        ],
      });

      const result = computeLayoutPositions(
        parent,
        (parent as PenNode & { children: PenNode[] }).children,
      );

      expect(result.map((node) => node.id)).toEqual(["a", "absolute", "b"]);
      expect(result[0]).toMatchObject({ x: 0, y: 0 });
      expect(result[1]).toMatchObject({ x: 77, y: 33 });
      expect(result[2]).toMatchObject({ x: 50, y: 0 });
    });

    it("filters invisible children", () => {
      const parent = frame({
        width: 300,
        height: 100,
        layout: "horizontal",
        children: [rect("a", 50, 30), { ...rect("b", 50, 30), visible: false }],
      });
      const result = computeLayoutPositions(
        parent,
        (parent as PenNode & { children: PenNode[] }).children,
      );
      expect(result).toHaveLength(1);
    });

    it("returns visible children as-is when layout is none", () => {
      const parent = frame({
        width: 300,
        height: 100,
        layout: "none",
        children: [rect("a", 50, 30)],
      });
      const result = computeLayoutPositions(
        parent,
        (parent as PenNode & { children: PenNode[] }).children,
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: "a" });
    });
  });
});
