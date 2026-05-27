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
  it("defaults to components but can be opened directly on the icons library", () => {
    const api = createCanvasApi(createDoc());
    const { rerender } = render(
      <CanvasDesignSystemPanel canvasApi={api} open onClose={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "组件" })).toHaveClass(
      "bg-muted",
    );

    rerender(
      <CanvasDesignSystemPanel
        canvasApi={api}
        initialTab="icons"
        open
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "图标" })).toHaveClass(
      "bg-muted",
    );
    expect(screen.getByRole("textbox", { name: "Search icons" })).toHaveFocus();
  });

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

  it("prevents unsetting a component while ref instances point to it", async () => {
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
    const refInstance: PenNode = {
      id: "ref-1",
      type: "ref",
      name: "Hero Card instance",
      ref: "frame-1",
      x: 400,
      y: 0,
    };
    const api = createCanvasApi(createDoc([reusableFrame, refInstance]));

    render(<CanvasDesignSystemPanel canvasApi={api} open onClose={vi.fn()} />);

    await user.click(
      screen.getByRole("button", {
        name: "Remove Hero Card from components",
      }),
    );

    expect(
      screen.getByText(
        "该组件仍有页面实例，请先删除或重定向实例后再取消复用。",
      ),
    ).toBeInTheDocument();
    expect(api.updateNode).not.toHaveBeenCalledWith("frame-1", {
      reusable: false,
    });
  });

  it("prevents deleting a variable while node fills still reference it", async () => {
    const user = userEvent.setup();
    const rect: PenNode = {
      id: "rect-1",
      type: "rectangle",
      name: "Card",
      x: 10,
      y: 10,
      width: 120,
      height: 80,
      fill: [{ type: "solid", color: "$accent" }],
    };
    const doc = createDoc([rect]);
    doc.variables = {
      accent: { type: "color", value: "#ff3366" },
    };
    const api = createCanvasApi(doc);

    render(<CanvasDesignSystemPanel canvasApi={api} open onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "变量" }));
    await user.click(
      screen.getByRole("button", { name: "Delete variable accent" }),
    );

    expect(
      screen.getByText("变量 accent 仍被画布节点引用，请先解绑后再删除。"),
    ).toBeInTheDocument();
    expect(api.setDocument).not.toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {},
      }),
    );
  });

  it("removes existing theme axes from the document", async () => {
    const user = userEvent.setup();
    const doc = createDoc();
    doc.themes = {
      density: ["compact", "comfortable"],
      mode: ["light", "dark"],
    };
    const api = createCanvasApi(doc);

    render(<CanvasDesignSystemPanel canvasApi={api} open onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "变量" }));
    await user.click(
      screen.getByRole("button", { name: "Delete theme axis density" }),
    );

    expect(api.setDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        themes: {
          mode: ["light", "dark"],
        },
      }),
    );
    expect(screen.getByText("主题轴 density 已删除。")).toBeInTheDocument();
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
        fill: [{ type: "solid", color: "#111827" }],
      }),
    );
    expect(lookupCanvasIcon("mail")).toMatchObject({
      d: expect.stringContaining("M4 4h16"),
      iconId: "lucide:mail",
      style: "stroke",
    });
    expect(lookupCanvasIcon("lucide:mail")).toMatchObject({
      d: expect.stringContaining("M4 4h16"),
      iconId: "lucide:mail",
      style: "stroke",
    });
  });
});
