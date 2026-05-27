import { type Page, expect, test } from "@playwright/test";

type CanvasAgentOutputSnapshot = {
  activePageId: string;
  nodeCount: number;
  nodes: Array<{
    agentBinding?: {
      status?: string;
      toolName?: string;
    };
    childrenOrder?: string[];
    containerRole?: string[];
    content?: string;
    explain?: string;
    id: string;
    name?: string;
    type: string;
  }>;
  selectedIds: string[];
};

async function readSnapshot(page: Page) {
  const raw = await page.getByTestId("agent-output-snapshot").innerText();
  return JSON.parse(raw) as CanvasAgentOutputSnapshot;
}

test.describe("canvas agent output harness", () => {
  test("applies prompt-canvas output through CanvasApi.setDocument without dropping manual nodes", async ({
    page,
  }) => {
    await page.goto("/test/canvas-agent-output");

    await expect(page.getByTestId("canvas-agent-output-stage")).toBeVisible();
    await expect(page.getByTestId("agent-output-snapshot")).toContainText(
      "manual-note",
    );

    await page.getByRole("button", { name: "Apply agent output" }).click();

    await expect(page.getByTestId("agent-output-snapshot")).toContainText(
      "phase-c-prompt_canvas_web_smoke-root",
    );

    const snapshot = await readSnapshot(page);
    const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const manualNode = nodeById.get("manual-note");
    const rootNode = nodeById.get("phase-c-prompt_canvas_web_smoke-root");
    const heroSection = nodeById.get(
      "phase-c-prompt_canvas_web_smoke-section-1-hero",
    );
    const formSection = nodeById.get(
      "phase-c-prompt_canvas_web_smoke-section-2-form",
    );

    expect(snapshot.activePageId).toBe("page-default");
    expect(snapshot.selectedIds).toEqual([
      "phase-c-prompt_canvas_web_smoke-root",
    ]);
    expect(manualNode).toMatchObject({
      content: "Manual note to preserve",
      id: "manual-note",
      type: "text",
    });
    expect(rootNode).toMatchObject({
      agentBinding: {
        status: "completed",
        toolName: "prompt_canvas_execute",
      },
      childrenOrder: [
        "phase-c-prompt_canvas_web_smoke-section-1-hero",
        "phase-c-prompt_canvas_web_smoke-section-2-form",
      ],
      containerRole: ["task", "visual"],
      explain: expect.stringContaining("Phase C prompt canvas root"),
      id: "phase-c-prompt_canvas_web_smoke-root",
      type: "frame",
    });
    expect(heroSection).toMatchObject({
      agentBinding: {
        status: "completed",
        toolName: "prompt_canvas_execute",
      },
      containerRole: ["visual"],
      explain: expect.stringContaining("section-1-hero"),
      name: "Hero",
      type: "frame",
    });
    expect(formSection).toMatchObject({
      agentBinding: {
        status: "completed",
        toolName: "prompt_canvas_execute",
      },
      explain: expect.stringContaining("section-2-form"),
      name: "Form",
      type: "frame",
    });
    expect(snapshot.nodeCount).toBeGreaterThanOrEqual(7);
  });
});
