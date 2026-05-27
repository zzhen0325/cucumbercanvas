import { type Page, expect, test } from "@playwright/test";

type CanvasHarnessSnapshot = {
  nodeCount: number;
  nodes: Array<{
    connectorType?: string;
    content?: string;
    d?: string;
    height?: number;
    id: string;
    path?: string;
    rotation?: number;
    type: string;
    width?: number;
    x: number;
    x2?: number;
    y: number;
    y2?: number;
  }>;
  selectedIds: string[];
};

test.describe("skia canvas harness", () => {
  const readSnapshot = async (page: Page) =>
    JSON.parse(
      await page.getByTestId("skia-document-snapshot").innerText(),
    ) as CanvasHarnessSnapshot;

  test("draws native vector shapes with toolbar drag tools", async ({
    page,
  }) => {
    await page.goto("/test/canvas-engine");

    const stage = page.getByTestId("skia-canvas-stage");
    await expect(stage).toBeVisible();
    const stageBox = await stage.boundingBox();
    expect(stageBox).not.toBeNull();
    if (!stageBox) {
      throw new Error("Skia canvas stage was not measurable.");
    }

    const drawShape = async (
      toolName: string,
      start: { x: number; y: number },
      end: { x: number; y: number },
    ) => {
      if (toolName === "Rectangle") {
        await page.getByRole("button", { name: "Shapes" }).click();
      } else {
        await page.getByRole("button", { name: "Open shape menu" }).click();
        await page.getByRole("menuitem", { name: toolName }).click();
      }
      await page.mouse.move(stageBox.x + start.x, stageBox.y + start.y);
      await page.mouse.down();
      await page.mouse.move(stageBox.x + end.x, stageBox.y + end.y, {
        steps: 8,
      });
      await page.mouse.up();
    };

    await drawShape("Rectangle", { x: 170, y: 160 }, { x: 340, y: 260 });
    await drawShape("Ellipse", { x: 220, y: 300 }, { x: 360, y: 410 });
    await drawShape("Polygon", { x: 400, y: 170 }, { x: 500, y: 290 });

    const snapshot = page.getByTestId("skia-document-snapshot");
    await expect(snapshot).toContainText('"nodeCount": 3');
    await expect(snapshot).toContainText('"type": "rectangle"');
    await expect(snapshot).toContainText('"type": "ellipse"');
    await expect(snapshot).toContainText('"type": "polygon"');

    const beforeMove = await readSnapshot(page);
    const polygonBeforeMove = beforeMove.nodes.find(
      (node) => node.type === "polygon",
    );
    expect(polygonBeforeMove).toBeDefined();
    expect(beforeMove.selectedIds).toEqual([polygonBeforeMove?.id]);

    await page.mouse.move(stageBox.x + 450, stageBox.y + 230);
    await page.mouse.down();
    await page.mouse.move(stageBox.x + 480, stageBox.y + 250, { steps: 6 });
    await page.mouse.up();

    await expect
      .poll(async () => {
        const afterMove = await readSnapshot(page);
        const polygonAfterMove = afterMove.nodes.find(
          (node) => node.id === polygonBeforeMove?.id,
        );
        return polygonAfterMove
          ? { x: polygonAfterMove.x, y: polygonAfterMove.y }
          : null;
      })
      .toEqual({
        x: (polygonBeforeMove?.x ?? 0) + 30,
        y: (polygonBeforeMove?.y ?? 0) + 20,
      });
  });

  test("creates text, line, arrow, and path nodes through real toolbar tools", async ({
    page,
  }) => {
    await page.goto("/test/canvas-engine");

    const stage = page.getByTestId("skia-canvas-stage");
    await expect(stage).toBeVisible();
    const stageBox = await stage.boundingBox();
    expect(stageBox).not.toBeNull();
    if (!stageBox) {
      throw new Error("Skia canvas stage was not measurable.");
    }

    const clickStage = async (point: { x: number; y: number }) => {
      await page.mouse.click(stageBox.x + point.x, stageBox.y + point.y);
    };

    const chooseShapeMenuItem = async (name: string) => {
      await page.getByRole("button", { name: "Open shape menu" }).click();
      await page.getByRole("menuitem", { name }).click();
    };

    await page.getByRole("button", { name: "Text" }).click();
    await clickStage({ x: 260, y: 170 });

    await chooseShapeMenuItem("Line");
    await clickStage({ x: 290, y: 340 });

    await chooseShapeMenuItem("Arrow");
    await clickStage({ x: 430, y: 450 });

    await chooseShapeMenuItem("Path");
    await clickStage({ x: 430, y: 160 });
    await clickStage({ x: 500, y: 210 });
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("skia-document-snapshot")).toContainText(
      '"nodeCount": 4',
    );
    const snapshot = await readSnapshot(page);

    expect(snapshot.nodes.map((node) => node.type).sort()).toEqual([
      "line",
      "line",
      "path",
      "text",
    ]);
    expect(snapshot.nodes.find((node) => node.type === "text")).toMatchObject({
      content: "Double click to edit",
      height: 120,
      type: "text",
      width: 160,
    });
    const lineNodes = snapshot.nodes.filter((node) => node.type === "line");
    expect(lineNodes).toHaveLength(2);
    expect(lineNodes.find((node) => node.connectorType !== "arrow")).toEqual(
      expect.objectContaining({
        height: 1,
        width: 160,
        x2: expect.any(Number),
        y2: expect.any(Number),
      }),
    );
    expect(lineNodes.find((node) => node.connectorType === "arrow")).toEqual(
      expect.objectContaining({
        connectorType: "arrow",
        height: 1,
        width: 160,
        x2: expect.any(Number),
        y2: expect.any(Number),
      }),
    );
    expect(snapshot.nodes.find((node) => node.type === "path")).toMatchObject({
      d: expect.stringContaining("M"),
      height: expect.any(Number),
      type: "path",
      width: expect.any(Number),
    });
    expect(snapshot.selectedIds).toEqual([
      snapshot.nodes.find((node) => node.type === "path")?.id,
    ]);
  });
});
