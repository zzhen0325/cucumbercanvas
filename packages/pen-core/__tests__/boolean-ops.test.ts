import type { PenNode } from "@cucumber/pen-types";
import { describe, expect, it } from "vitest";
import {
  type BooleanOpType,
  canBooleanOp,
  executeBooleanOp,
  getBooleanOpRejectionReason,
  setPaperModule,
} from "../boolean-ops.js";

function rectangle(id: string): PenNode {
  return { id, type: "rectangle", width: 100, height: 80, x: 0, y: 0 };
}

function text(id: string): PenNode {
  return { id, type: "text", content: "Hello", x: 0, y: 0 };
}

describe("boolean operations", () => {
  describe("canBooleanOp", () => {
    it("returns false for one selected node", () => {
      expect(canBooleanOp([rectangle("a")])).toBe(false);
    });

    it("returns false for unsupported nodes", () => {
      expect(canBooleanOp([rectangle("a"), text("b")])).toBe(false);
    });

    it("returns true for two supported nodes", () => {
      expect(canBooleanOp([rectangle("a"), rectangle("b")])).toBe(true);
    });
  });

  describe("getBooleanOpRejectionReason", () => {
    it("returns useful copy when fewer than two nodes are selected", () => {
      const reason = getBooleanOpRejectionReason([rectangle("a")]);

      expect(reason).toEqual(expect.any(String));
      expect(reason).toContain("Select at least two");
    });

    it("returns useful copy for unsupported selected nodes", () => {
      const reason = getBooleanOpRejectionReason([rectangle("a"), text("b")]);

      expect(reason).toEqual(expect.any(String));
      expect(reason).toContain("rectangle");
      expect(reason).toContain("ellipse");
      expect(reason).toContain("path");
    });

    it("returns null when selected nodes can run a boolean operation", () => {
      expect(
        getBooleanOpRejectionReason([rectangle("a"), rectangle("b")]),
      ).toBeNull();
    });
  });

  it("accepts exclude as a boolean operation type", () => {
    const operation: BooleanOpType = "exclude";

    expect(operation).toBe("exclude");
  });

  it("dispatches exclude to Paper.js and labels the generated path", () => {
    const calls: string[] = [];

    class FakePaperPath {
      bounds = {
        center: { x: 50, y: 40 },
        x: 10,
        y: 20,
        width: 90,
        height: 70,
      };
      pathData: string;

      constructor(pathData: string) {
        this.pathData = pathData;
      }

      translate(): void {
        calls.push("translate");
      }

      rotate(): void {
        calls.push("rotate");
      }

      unite(): FakePaperPath {
        calls.push("unite");
        return new FakePaperPath("M union-result Z");
      }

      subtract(): FakePaperPath {
        calls.push("subtract");
        return new FakePaperPath("M subtract-result Z");
      }

      intersect(): FakePaperPath {
        calls.push("intersect");
        return new FakePaperPath("M intersect-result Z");
      }

      exclude(): FakePaperPath {
        calls.push("exclude");
        return new FakePaperPath("M exclude-result Z");
      }

      remove(): void {
        calls.push("remove");
      }
    }

    class FakePaperScope {
      Size = class {
        constructor(
          readonly width: number,
          readonly height: number,
        ) {}
      };

      Point = class {
        constructor(
          readonly x: number,
          readonly y: number,
        ) {}
      };

      CompoundPath = {
        create(pathData: string): FakePaperPath {
          calls.push("create");
          return new FakePaperPath(pathData);
        },
      };

      setup(): void {
        calls.push("setup");
      }

      activate(): void {
        calls.push("activate");
      }
    }

    setPaperModule({
      PaperScope: FakePaperScope,
      Point: class {
        constructor(
          readonly x: number,
          readonly y: number,
        ) {}
      },
    });

    const result = executeBooleanOp(
      [rectangle("a"), rectangle("b")],
      "exclude",
    );

    expect(calls).toContain("exclude");
    expect(result?.name).toBe("Exclude");
    expect(result?.d).toBe("M exclude-result Z");
  });
});
