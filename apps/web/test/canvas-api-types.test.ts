import type { BooleanOpType } from "@cucumber/pen-core";
import { describe, expect, it } from "vitest";

import type {
  CanvasApi,
  CanvasApiRuntimeState,
  CanvasTool,
  PenPage,
} from "@/components/canvas/canvas-api";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;

type Expect<T extends true> = T;

type PhaseACanvasTool =
  | "select"
  | "hand"
  | "sticky"
  | "container"
  | "section"
  | "connector"
  | "rect"
  | "ellipse"
  | "polygon"
  | "path"
  | "text"
  | "line"
  | "arrow";

type PhaseACanvasApiContract = [
  Expect<Equal<CanvasTool, PhaseACanvasTool>>,
  Expect<Equal<ReturnType<CanvasApi["getActivePageId"]>, string>>,
  Expect<Equal<Parameters<CanvasApi["setActivePage"]>, [pageId: string]>>,
  Expect<Equal<ReturnType<CanvasApi["setActivePage"]>, void>>,
  Expect<Equal<ReturnType<CanvasApi["getPages"]>, PenPage[]>>,
  Expect<Equal<Parameters<CanvasApi["addPage"]>, [name?: string]>>,
  Expect<Equal<ReturnType<CanvasApi["addPage"]>, string>>,
  Expect<
    Equal<Parameters<CanvasApi["renamePage"]>, [pageId: string, name: string]>
  >,
  Expect<Equal<ReturnType<CanvasApi["renamePage"]>, void>>,
  Expect<Equal<Parameters<CanvasApi["duplicatePage"]>, [pageId: string]>>,
  Expect<Equal<ReturnType<CanvasApi["duplicatePage"]>, string>>,
  Expect<Equal<Parameters<CanvasApi["deletePage"]>, [pageId: string]>>,
  Expect<Equal<ReturnType<CanvasApi["deletePage"]>, void>>,
  Expect<
    Equal<
      Parameters<CanvasApi["reorderPage"]>,
      [pageId: string, direction: "left" | "right"]
    >
  >,
  Expect<Equal<ReturnType<CanvasApi["reorderPage"]>, void>>,
  Expect<
    Equal<
      Parameters<CanvasApi["applyBooleanOperation"]>,
      [operation: BooleanOpType]
    >
  >,
  Expect<Equal<ReturnType<CanvasApi["applyBooleanOperation"]>, string | null>>,
  Expect<Equal<ReturnType<CanvasApi["getActiveTool"]>, CanvasTool>>,
  Expect<Equal<Parameters<CanvasApi["setActiveTool"]>, [tool: CanvasTool]>>,
  Expect<Equal<ReturnType<CanvasApi["setActiveTool"]>, void>>,
  Expect<
    Equal<
      ReturnType<CanvasApi["getDocument"]>["selection"],
      string[] | undefined
    >
  >,
  Expect<Equal<CanvasApiRuntimeState["selection"], string[]>>,
];

const phaseATools = [
  "select",
  "hand",
  "sticky",
  "container",
  "section",
  "connector",
  "rect",
  "ellipse",
  "polygon",
  "path",
  "text",
  "line",
  "arrow",
] as const satisfies readonly CanvasTool[];

describe("CanvasApi Phase A type contract", () => {
  it("exposes page, tool, and boolean-operation methods", () => {
    const _contract: PhaseACanvasApiContract | null = null;
    expect(_contract).toBeNull();
    expect(phaseATools).toContain("path");
    expect(phaseATools).not.toContain("icon");
  });
});
