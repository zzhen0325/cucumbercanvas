// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CanvasDesignSystemPanel } from "@/components/canvas-design-system-panel";
import type { CanvasApi } from "@/components/canvas/canvas-api";
import { lookupCanvasIcon } from "@/components/canvas/icon-library";
import type { CucumberCanvasDocument, PenNode } from "@cucumber/canvas-core";

function createDoc(children: PenNode[] = []): CucumberCanvasDocument {
  return {
    version: "1",
    children: [],
    pages: [{ id: "page-1", name: "Page 1", children }],
    activePageId: "page-1",
  };
}

function createCanvasApi(
  doc: CucumberCanvasDocument,
  selectedIds: string[] = [],
) {
  let currentDoc = doc;
  const api = {
    getDocument: vi.fn(() => currentDoc),
    setDocument: vi.fn((next: unknown) => {
      currentDoc = next as CucumberCanvasDocument;
    }),
    getActivePageId: vi.fn(() => currentDoc.activePageId ?? "page-1"),
    getAppState: vi.fn(() => ({
      zoom: { value: 1 },
      scrollX: 0,
      scrollY: 0,
      viewBackgroundColor: "#ffffff",
      selectedElementIds: Object.fromEntries(
        selectedIds.map((id) => [id, true]),
      ),
    })),
    getViewportBounds: vi.fn(() => ({
      x: 0,
      y: 0,
      width: 1200,
      height: 800,
    })),
    onChange: vi.fn(() => () => undefined),
    updateNode: vi.fn(),
    insertNode: vi.fn(),
    setSelection: vi.fn(),
  } as Partial<CanvasApi> as CanvasApi;
  return api;
}

describe("CanvasDesignSystemPanel", () => {
  it("creates variables, manages theme axes, and binds a color variable to the selected fill", async () => {
    const user = userEvent.setup();
    const rect: PenNode = {
      id: "rect-1",
      type: "rectangle",
      name: "Card",
      x: 10,
      y: 10,
      width: 120,
      height: 80,
    };
    const doc = createDoc([rect]);
    doc.variables = {
      accent: { type: "color", value: "#ff3366" },
    };
    const api = createCanvasApi(doc, ["rect-1"]);

    render(<CanvasDesignSystemPanel canvasApi={api} open onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "变量" }));
    await user.type(screen.getByPlaceholderText("brand.primary"), "brand.new");
    await user.click(screen.getByRole("button", { name: "创建" }));

    expect(api.setDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          "brand.new": { type: "color", value: "#111827" },
        }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "更新主题轴" }));
    expect(api.setDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({
        themes: { mode: ["light", "dark"] },
      }),
    );

    await user.click(
      screen.getByRole("button", { name: "Bind accent fill variable" }),
    );
    expect(api.updateNode).toHaveBeenCalledWith("rect-1", {
      fill: [{ type: "solid", color: "$accent" }],
    });
  });

  it("marks selected frames as components and inserts ref instances", async () => {
    const user = userEvent.setup();
    const reusableFrame: PenNode = {
      id: "frame-1",
      type: "frame",
      name: "Hero Card",
      reusable: true,
      x: 0,
      y: 0,
      width: 320,
      height: 180,
      children: [],
    };
    const selectedFrame: PenNode = {
      id: "frame-2",
      type: "frame",
      name: "Promo Card",
      x: 400,
      y: 0,
      width: 240,
      height: 120,
      children: [],
    };
    const api = createCanvasApi(createDoc([reusableFrame, selectedFrame]), [
      "frame-2",
    ]);

    render(<CanvasDesignSystemPanel canvasApi={api} open onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "创建组件" }));
    expect(api.updateNode).toHaveBeenCalledWith("frame-2", {
      reusable: true,
    });

    await user.click(screen.getByRole("button", { name: "插入实例" }));
    expect(api.insertNode).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ref",
        ref: "frame-1",
        width: 320,
        height: 180,
      }),
    );
    expect(api.setSelection).toHaveBeenCalledWith([
      expect.stringMatching(/^ref_/),
    ]);
  });

  it("inserts library icons as renderable icon_font nodes", async () => {
    const user = userEvent.setup();
    const api = createCanvasApi(createDoc());

    render(<CanvasDesignSystemPanel canvasApi={api} open onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "图标" }));
    await user.type(
      screen.getByRole("textbox", { name: "Search icons" }),
      "mail",
    );
    await user.click(screen.getByRole("button", { name: "Insert Mail icon" }));

    expect(api.insertNode).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "icon_font",
        iconFontName: "mail",
        iconFontFamily: "lucide",
        width: 48,
        height: 48,
      }),
    );
    expect(lookupCanvasIcon("mail")).toMatchObject({
      iconId: "lucide:mail",
      style: "stroke",
    });
  });
});
