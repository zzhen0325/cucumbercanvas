// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PenPage } from "@/components/canvas/canvas-api";
import { CanvasPageTabs } from "@/components/canvas/page-tabs";

function createPages(): PenPage[] {
  return [
    { id: "page-1", name: "Cover", children: [] },
    { id: "page-2", name: "Storyboard", children: [] },
    { id: "page-3", name: "Final", children: [] },
  ];
}

function renderTabs(
  overrides: Partial<React.ComponentProps<typeof CanvasPageTabs>> = {},
) {
  const props = {
    pages: createPages(),
    activePageId: "page-1",
    onAddPage: vi.fn(),
    onDeletePage: vi.fn(),
    onDuplicatePage: vi.fn(),
    onRenamePage: vi.fn(),
    onReorderPage: vi.fn(),
    onSetActivePage: vi.fn(),
    ...overrides,
  } satisfies React.ComponentProps<typeof CanvasPageTabs>;

  render(<CanvasPageTabs {...props} />);

  return props;
}

describe("CanvasPageTabs", () => {
  it("switches the active page from a compact tab", async () => {
    const user = userEvent.setup();
    const props = renderTabs();

    await user.click(screen.getByRole("button", { name: "Open Storyboard" }));

    expect(props.onSetActivePage).toHaveBeenCalledWith("page-2");
  });

  it("adds a page from the icon button", async () => {
    const user = userEvent.setup();
    const props = renderTabs();

    await user.click(screen.getByRole("button", { name: "Add page" }));

    expect(props.onAddPage).toHaveBeenCalledOnce();
  });

  it("renames a page with a trimmed non-empty name on Enter", async () => {
    const user = userEvent.setup();
    const props = renderTabs();

    await user.dblClick(screen.getByText("Cover"));
    const input = screen.getByRole("textbox", { name: "Rename page" });
    await user.clear(input);
    await user.type(input, "  Opening Frame  {Enter}");

    expect(props.onRenamePage).toHaveBeenCalledWith("page-1", "Opening Frame");
  });

  it("commits a rename on blur and cancels a rename on Escape", async () => {
    const user = userEvent.setup();
    const props = renderTabs();

    await user.dblClick(screen.getByText("Cover"));
    const blurInput = screen.getByRole("textbox", { name: "Rename page" });
    await user.clear(blurInput);
    await user.type(blurInput, "  Cover Blur  ");
    await user.tab();

    expect(props.onRenamePage).toHaveBeenCalledWith("page-1", "Cover Blur");

    await user.dblClick(screen.getByText("Cover"));
    const escapeInput = screen.getByRole("textbox", { name: "Rename page" });
    await user.clear(escapeInput);
    await user.type(escapeInput, "Cancelled{Escape}");

    expect(props.onRenamePage).not.toHaveBeenCalledWith("page-1", "Cancelled");
  });

  it("duplicates, deletes, and reorders pages through accessible controls", async () => {
    const user = userEvent.setup();
    const props = renderTabs();

    await user.click(screen.getByRole("button", { name: "Duplicate Cover" }));
    await user.click(screen.getByRole("button", { name: "Delete Cover" }));
    await user.click(
      screen.getByRole("button", { name: "Move Storyboard left" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Move Storyboard right" }),
    );

    expect(props.onDuplicatePage).toHaveBeenCalledWith("page-1");
    expect(props.onDeletePage).toHaveBeenCalledWith("page-1");
    expect(props.onReorderPage).toHaveBeenCalledWith("page-2", "left");
    expect(props.onReorderPage).toHaveBeenCalledWith("page-2", "right");
  });

  it("does not render delete for the only page", () => {
    renderTabs({
      pages: [{ id: "page-1", name: "Only page", children: [] }],
    });

    expect(
      screen.queryByRole("button", { name: "Delete Only page" }),
    ).not.toBeInTheDocument();
  });
});
