import type { PenDocument, PenNode } from "@cucumber/pen-types";
import { describe, expect, it } from "vitest";
import {
  CanvasPageOperationError,
  addCanvasPage,
  appendActivePageChildren,
  applyCanvasOperation,
  createDefaultCanvasPage,
  deleteCanvasPage,
  duplicateCanvasPage,
  findNode,
  getActiveChildren,
  getCanvasPage,
  getCanvasPages,
  normalizeCanvasPages,
  renameCanvasPage,
  reorderCanvasPage,
  resolveActivePageId,
} from "../index.js";

const rect = (id: string, x = 0): PenNode => ({
  id,
  type: "rectangle",
  x,
  y: 0,
  width: 10,
  height: 10,
});

const group = (id: string, children: PenNode[]): PenNode => ({
  id,
  type: "group",
  name: id,
  x: 0,
  y: 0,
  width: 20,
  height: 20,
  children,
});

function expectPageError(
  action: () => unknown,
  code: CanvasPageOperationError["code"],
  message: string,
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(CanvasPageOperationError);
    expect((error as CanvasPageOperationError).code).toBe(code);
    expect((error as Error).message).toContain(message);
    return;
  }
  throw new Error("Expected CanvasPageOperationError.");
}

describe("canvas page helpers", () => {
  it("normalizes legacy children-only documents into a first page", () => {
    const legacy: PenDocument = {
      version: "cucumber-canvas-v1",
      children: [rect("legacy")],
    };

    const normalized = normalizeCanvasPages(legacy);

    expect(normalized.pages).toHaveLength(1);
    expect(normalized.pages?.[0]?.name).toBe("Page 1");
    expect(normalized.pages?.[0]?.children.map((node) => node.id)).toEqual([
      "legacy",
    ]);
    expect(normalized.activePageId).toBe("page-default");
    expect(normalized.children).toEqual([]);
  });

  it("clones explicit page children while normalizing pages", () => {
    const seed = rect("seed");
    const doc: PenDocument = {
      version: "cucumber-canvas-v1",
      children: [],
      pages: [{ id: "page-a", name: "A", children: [seed] }],
    };

    const normalized = normalizeCanvasPages(doc);

    expect(normalized.pages?.[0]?.children).not.toBe(doc.pages?.[0]?.children);
    expect(normalized.pages?.[0]?.children[0]).not.toBe(seed);
    expect(normalized.pages?.[0]?.children[0]?.id).toBe("seed");
  });

  it("finds and mutates nodes on the requested active page", () => {
    const doc: PenDocument = normalizeCanvasPages({
      version: "cucumber-canvas-v1",
      children: [],
      pages: [
        { id: "page-a", name: "A", children: [rect("a")] },
        { id: "page-b", name: "B", children: [rect("b")] },
      ],
    });

    expect(findNode(doc, "b", "page-b")?.id).toBe("b");
    expect(findNode(doc, "b", "page-a")).toBeUndefined();

    const next = applyCanvasOperation(doc, {
      type: "insertNode",
      node: rect("b2", 20),
      activePageId: "page-b",
    });

    expect(getActiveChildren(next, "page-a").map((node) => node.id)).toEqual([
      "a",
    ]);
    expect(getActiveChildren(next, "page-b").map((node) => node.id)).toEqual([
      "b",
      "b2",
    ]);
    expect(next.children).toEqual([]);
  });

  it("uses the persisted active page when operation metadata has no override", () => {
    const doc: PenDocument = {
      version: "cucumber-canvas-v1",
      activePageId: "page-b",
      children: [],
      pages: [
        { id: "page-a", name: "A", children: [rect("a")] },
        { id: "page-b", name: "B", children: [rect("b")] },
      ],
    };

    const next = applyCanvasOperation(doc, {
      type: "insertNode",
      node: rect("b2", 20),
    });

    expect(getActiveChildren(next, "page-a").map((node) => node.id)).toEqual([
      "a",
    ]);
    expect(getActiveChildren(next, "page-b").map((node) => node.id)).toEqual([
      "b",
      "b2",
    ]);
  });

  it("lets operation metadata override the persisted active page", () => {
    const doc: PenDocument = {
      version: "cucumber-canvas-v1",
      activePageId: "page-b",
      children: [],
      pages: [
        { id: "page-a", name: "A", children: [rect("a")] },
        { id: "page-b", name: "B", children: [rect("b")] },
      ],
    };

    const next = applyCanvasOperation(doc, {
      type: "insertNode",
      node: rect("a2", 20),
      activePageId: "page-a",
    });

    expect(getActiveChildren(next, "page-a").map((node) => node.id)).toEqual([
      "a",
      "a2",
    ]);
    expect(getActiveChildren(next, "page-b").map((node) => node.id)).toEqual([
      "b",
    ]);
  });

  it("rejects stale active page IDs without mutating the first page", () => {
    const doc: PenDocument = normalizeCanvasPages({
      version: "cucumber-canvas-v1",
      children: [],
      pages: [
        { id: "page-a", name: "A", children: [rect("a")] },
        { id: "page-b", name: "B", children: [rect("b")] },
      ],
    });

    expectPageError(
      () =>
        applyCanvasOperation(doc, {
          type: "insertNode",
          node: rect("typo-target"),
          activePageId: "page-typo",
        }),
      "page_not_found",
      "Page page-typo does not exist.",
    );

    expect(getActiveChildren(doc, "page-a").map((node) => node.id)).toEqual([
      "a",
    ]);
    expect(getActiveChildren(doc, "page-b").map((node) => node.id)).toEqual([
      "b",
    ]);

    expectPageError(
      () =>
        applyCanvasOperation(doc, {
          type: "insertNode",
          node: rect("agent-target"),
          agentId: "agent-1",
          activePageId: "page-typo",
        }),
      "page_not_found",
      "Page page-typo does not exist.",
    );
  });

  it("rejects stale active page IDs on legacy children-only documents without mutating root children", () => {
    const legacy: PenDocument = {
      version: "cucumber-canvas-v1",
      children: [rect("legacy")],
    };

    expectPageError(
      () =>
        applyCanvasOperation(legacy, {
          type: "insertNode",
          node: rect("typo-target"),
          activePageId: "page-default",
        }),
      "page_not_found",
      "Page page-default does not exist.",
    );
    expectPageError(
      () => resolveActivePageId(legacy, "page-default"),
      "page_not_found",
      "Page page-default does not exist.",
    );
    expectPageError(
      () => getCanvasPage(legacy, "page-default"),
      "page_not_found",
      "Page page-default does not exist.",
    );
    expect(legacy.children.map((node) => node.id)).toEqual(["legacy"]);
  });

  it("rejects a legacy children-only document with persisted explicit default active page", () => {
    const legacy: PenDocument = {
      version: "cucumber-canvas-v1",
      activePageId: "page-default",
      children: [rect("legacy")],
    };

    expectPageError(
      () =>
        applyCanvasOperation(legacy, {
          type: "insertNode",
          node: rect("target"),
        }),
      "page_not_found",
      "Page page-default does not exist.",
    );
    expectPageError(
      () => normalizeCanvasPages(legacy),
      "page_not_found",
      "Page page-default does not exist.",
    );
    expectPageError(
      () => getCanvasPages(legacy),
      "page_not_found",
      "Page page-default does not exist.",
    );
  });

  it("creates default pages and appends children to the active page", () => {
    const defaultPage = createDefaultCanvasPage([rect("seed")]);
    expect(defaultPage).toMatchObject({
      id: "page-default",
      name: "Page 1",
    });
    expect(defaultPage.children.map((node) => node.id)).toEqual(["seed"]);

    const doc: PenDocument = {
      version: "cucumber-canvas-v1",
      activePageId: "page-b",
      children: [],
      pages: [
        { id: "page-a", name: "A", children: [rect("a")] },
        { id: "page-b", name: "B", children: [rect("b")] },
      ],
    };

    const next = appendActivePageChildren(doc, [rect("b2")]);

    expect(getActiveChildren(next, "page-a").map((node) => node.id)).toEqual([
      "a",
    ]);
    expect(getActiveChildren(next, "page-b").map((node) => node.id)).toEqual([
      "b",
      "b2",
    ]);
  });

  it("validates stale active page IDs for selection operations", () => {
    const doc = normalizeCanvasPages({
      version: "cucumber-canvas-v1",
      children: [rect("root")],
    });

    expect(() =>
      applyCanvasOperation(doc, {
        type: "setSelection",
        nodeIds: [],
        activePageId: "missing",
      }),
    ).toThrow("Page missing does not exist.");
  });

  it("rejects duplicate page IDs when adding a page", () => {
    const doc = normalizeCanvasPages({
      version: "cucumber-canvas-v1",
      children: [],
      pages: [
        { id: "page-a", name: "A", children: [] },
        { id: "page-b", name: "B", children: [] },
      ],
    });

    expectPageError(
      () => addCanvasPage(doc, { id: "page-b", name: "Duplicate" }),
      "invalid_page_operation",
      "Page page-b already exists.",
    );
  });

  it("rejects persisted documents with duplicate page IDs before page-child writes", () => {
    const malformed: PenDocument = {
      version: "cucumber-canvas-v1",
      children: [],
      pages: [
        { id: "page-a", name: "A", children: [rect("a")] },
        { id: "page-a", name: "Duplicate A", children: [rect("duplicate")] },
      ],
    };

    expect(() => getCanvasPages(malformed)).toThrow(CanvasPageOperationError);
    expect(() =>
      applyCanvasOperation(malformed, {
        type: "insertNode",
        node: rect("target"),
        activePageId: "page-a",
      }),
    ).toThrow("Page page-a already exists.");
  });

  it("adds, renames, duplicates, reorders, and deletes pages without deleting the final page", () => {
    let doc = normalizeCanvasPages({
      version: "cucumber-canvas-v1",
      children: [rect("root")],
    });

    const added = addCanvasPage(doc, { name: "Exploration" });
    doc = added.document;
    expect(added.page.name).toBe("Exploration");
    expect(doc.activePageId).toBe("page-default");
    expect(resolveActivePageId(doc, added.page.id)).toBe(added.page.id);

    doc = { ...doc, activePageId: added.page.id };
    doc = renameCanvasPage(doc, added.page.id, "Final UI").document;
    expect(doc.activePageId).toBe(added.page.id);
    expect(getCanvasPages(doc).find((page) => page.id === added.page.id)?.name).toBe(
      "Final UI",
    );

    const duplicated = duplicateCanvasPage(doc, added.page.id);
    doc = duplicated.document;
    expect(doc.activePageId).toBe(added.page.id);
    expect(duplicated.page.name).toBe("Final UI copy");

    doc = reorderCanvasPage(doc, duplicated.page.id, "left").document;
    expect(doc.activePageId).toBe(added.page.id);
    expect(getCanvasPages(doc)[1]?.id).toBe(duplicated.page.id);

    const inactiveDeleted = deleteCanvasPage(doc, "page-default");
    doc = inactiveDeleted.document;
    expect(inactiveDeleted.page.id).toBe(added.page.id);
    expect(doc.activePageId).toBe(added.page.id);
    expect(getCanvasPages(doc).some((page) => page.id === "page-default")).toBe(
      false,
    );

    doc = { ...doc, activePageId: duplicated.page.id };
    const deleted = deleteCanvasPage(doc, duplicated.page.id);
    doc = deleted.document;
    expect(deleted.page.id).toBe(added.page.id);
    expect(doc.activePageId).toBe(added.page.id);
    expect(getCanvasPages(doc).some((page) => page.id === duplicated.page.id)).toBe(
      false,
    );

    const invalidNextDoc = addCanvasPage(
      normalizeCanvasPages({
        version: "cucumber-canvas-v1",
        children: [rect("root")],
      }),
      { name: "Second" },
    ).document;
    expectPageError(
      () => deleteCanvasPage(invalidNextDoc, "page-default", "missing"),
      "page_not_found",
      "Page missing does not exist.",
    );

    const onePageDoc = normalizeCanvasPages({
      version: "cucumber-canvas-v1",
      children: [rect("only")],
    });
    expectPageError(
      () => deleteCanvasPage(onePageDoc, "missing"),
      "page_not_found",
      "Page missing does not exist.",
    );
    expectPageError(
      () => deleteCanvasPage(onePageDoc, "page-default"),
      "invalid_page_operation",
      "Cannot delete the only page.",
    );
  });

  it("rejects stale persisted active page IDs in page mutations", () => {
    const doc: PenDocument = {
      version: "cucumber-canvas-v1",
      activePageId: "missing",
      children: [],
      pages: [
        { id: "page-a", name: "A", children: [] },
        { id: "page-b", name: "B", children: [] },
      ],
    };

    expect(() => normalizeCanvasPages(doc)).toThrow("Page missing does not exist.");
    expect(() => addCanvasPage(doc, { name: "C" })).toThrow(
      "Page missing does not exist.",
    );
    expect(() => renameCanvasPage(doc, "page-a", "A2")).toThrow(
      "Page missing does not exist.",
    );
    expect(() => duplicateCanvasPage(doc, "page-a")).toThrow(
      "Page missing does not exist.",
    );
    expect(() => reorderCanvasPage(doc, "page-a", "right")).toThrow(
      "Page missing does not exist.",
    );
  });

  it("duplicates page children recursively with new IDs", () => {
    const doc = normalizeCanvasPages({
      version: "cucumber-canvas-v1",
      children: [],
      pages: [
        {
          id: "source-page",
          name: "Source",
          children: [group("group-original", [rect("child-original")])],
        },
      ],
    });

    const duplicated = duplicateCanvasPage(doc, "source-page");
    const originalGroup = getActiveChildren(doc, "source-page")[0];
    expect(originalGroup).toBeDefined();
    const originalChild =
      originalGroup &&
      "children" in originalGroup &&
      Array.isArray(originalGroup.children)
        ? originalGroup.children[0]
        : undefined;
    const clonedGroup = duplicated.page.children[0];
    expect(clonedGroup).toBeDefined();
    const clonedChild =
      clonedGroup && "children" in clonedGroup && Array.isArray(clonedGroup.children)
        ? clonedGroup.children[0]
        : undefined;

    expect(clonedGroup?.id).not.toBe(originalGroup?.id);
    expect(clonedChild?.id).toBeDefined();
    expect(clonedChild?.id).not.toBe(originalChild?.id);
  });
});
