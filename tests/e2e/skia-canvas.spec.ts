import { expect, test } from "@playwright/test";

test.describe("skia canvas harness", () => {
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
      await page.getByRole("button", { name: toolName }).click();
      await page.mouse.move(stageBox.x + start.x, stageBox.y + start.y);
      await page.mouse.down();
      await page.mouse.move(stageBox.x + end.x, stageBox.y + end.y, {
        steps: 8,
      });
      await page.mouse.up();
    };

    await drawShape("矩形", { x: 170, y: 160 }, { x: 340, y: 260 });
    await drawShape("椭圆", { x: 220, y: 300 }, { x: 360, y: 410 });
    await drawShape("多边形", { x: 430, y: 180 }, { x: 560, y: 310 });

    const snapshot = page.getByTestId("skia-document-snapshot");
    await expect(snapshot).toContainText('"nodeCount": 3');
    await expect(snapshot).toContainText('"type": "rectangle"');
    await expect(snapshot).toContainText('"type": "ellipse"');
    await expect(snapshot).toContainText('"type": "polygon"');
  });
});
