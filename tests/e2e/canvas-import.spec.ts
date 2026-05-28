import { type Page, expect, test } from "@playwright/test";

const TEST_PAGE_URL = "/test/canvas-import";

const NESTED_FIGMA_HTML = `
  <div
    data-metadata="invalid"
    data-buffer="invalid"
    data-node-id="99:1"
    data-node-type="INSTANCE"
    style="position:absolute;left:40px;top:36px;width:320px;height:180px;background-color:#ffffff;display:flex;flex-direction:column;gap:16px;padding:20px;justify-content:center;align-items:flex-end;box-shadow:0 6px 24px rgba(15,23,42,.18)"
  >
    <div
      data-node-id="99:2"
      data-node-type="INSTANCE"
      style="position:absolute;left:24px;top:28px;width:180px;height:72px;background-color:#e2e8f0;display:flex;gap:8px;padding:12px"
    >
      <span style="font-size:18px;color:#0f172a">Nested instance title</span>
    </div>
  </div>
`;

const SVG_WITH_UNSUPPORTED_CONTENT = `
  <svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120">
    <rect id="editable-card" x="16" y="18" width="160" height="72" fill="#38bdf8" />
    <foreignObject id="html-label" x="24" y="28" width="120" height="40">
      <div xmlns="http://www.w3.org/1999/xhtml">Unsupported HTML label</div>
    </foreignObject>
  </svg>
`;

const ONE_BY_ONE_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

type CanvasImportSnapshot = {
  nodes: Array<{
    id: string;
    type: string;
    assetId?: string;
  }>;
  assets?: Array<{
    id: string;
    mimeType?: string;
    name?: string;
    source?: string;
    width?: number;
    height?: number;
  }>;
};

async function waitForCanvasReady(page: Page) {
  await expect(
    page.getByRole("navigation", { name: "Canvas editor tools" }),
  ).toBeVisible({ timeout: 30_000 });
}

async function chooseShapeTool(page: Page, toolName: string) {
  await page.getByRole("button", { name: "Open shape menu" }).click();
  await page.getByRole("menuitem", { name: toolName }).click();
}

async function dispatchPaste(
  page: Page,
  init: {
    types: string[];
    getData?: (type: string) => string;
    files?: Array<{ name: string; type: string; dataUrl: string }>;
  },
) {
  await page.evaluate(
    async ({ types, files, dataByType }) => {
      const dataTransfer = new DataTransfer();
      for (const file of files ?? []) {
        const response = await fetch(file.dataUrl);
        const blob = await response.blob();
        dataTransfer.items.add(
          new File([blob], file.name, { type: file.type }),
        );
      }
      for (const type of types) {
        const value = dataByType[type];
        if (value) {
          dataTransfer.setData(type, value);
        }
      }
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      });
      document.body.dispatchEvent(event);
    },
    {
      types: init.types,
      files: init.files,
      dataByType: Object.fromEntries(
        init.types.map((type) => [type, init.getData?.(type) ?? ""]),
      ),
    },
  );
}

async function readDocumentSnapshot(page: Page): Promise<CanvasImportSnapshot> {
  const raw = await page.getByTestId("document-snapshot").textContent();
  if (!raw) {
    throw new Error(
      "Canvas import harness did not expose a document snapshot.",
    );
  }
  return JSON.parse(raw) as CanvasImportSnapshot;
}

test.describe("canvas import harness", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(60_000);

  test("draws native vector shapes with toolbar drag tools", async ({
    page,
  }) => {
    await page.goto(TEST_PAGE_URL);
    await waitForCanvasReady(page);

    const stage = page.getByTestId("canvas-import-stage");
    const stageBox = await stage.boundingBox();
    expect(stageBox).not.toBeNull();
    if (!stageBox) {
      throw new Error("Canvas import stage was not measurable.");
    }

    const drawShape = async (
      toolName: string,
      start: { x: number; y: number },
      end: { x: number; y: number },
    ) => {
      await chooseShapeTool(page, toolName);
      await page.mouse.move(stageBox.x + start.x, stageBox.y + start.y);
      await page.mouse.down();
      await page.mouse.move(stageBox.x + end.x, stageBox.y + end.y, {
        steps: 8,
      });
      await page.mouse.up();
    };

    await drawShape("Rectangle", { x: 160, y: 160 }, { x: 300, y: 240 });
    await drawShape("Ellipse", { x: 220, y: 300 }, { x: 360, y: 400 });
    await drawShape("Polygon", { x: 420, y: 180 }, { x: 560, y: 300 });

    await expect(page.getByTestId("document-snapshot")).toContainText(
      '"nodeCount": 3',
    );
    await expect(page.getByTestId("document-snapshot")).toContainText(
      '"type": "rectangle"',
    );
    await expect(page.getByTestId("document-snapshot")).toContainText(
      '"type": "ellipse"',
    );
    await expect(page.getByTestId("document-snapshot")).toContainText(
      '"type": "polygon"',
    );
  });

  test("handles a real paste event and exposes auto-layout import metadata", async ({
    page,
  }) => {
    await page.goto(TEST_PAGE_URL);
    await waitForCanvasReady(page);

    await page.evaluate((html) => {
      const event = new Event("paste", {
        bubbles: true,
        cancelable: true,
      }) as ClipboardEvent;
      Object.defineProperty(event, "clipboardData", {
        value: {
          types: ["text/html", "text/plain"],
          getData: (type: string) => {
            if (type === "text/html") return html;
            if (type === "text/plain") return "Nested instance title";
            return "";
          },
        },
      });
      document.body.dispatchEvent(event);
    }, NESTED_FIGMA_HTML);

    await expect(page.getByTestId("imported-selection-count")).toHaveText("1");
    await expect(page.getByTestId("selected-meta")).toContainText(
      '"source": "figma-paste"',
    );
    await expect(page.getByTestId("selected-meta")).toContainText(
      '"layout": "vertical"',
    );
    await expect(page.getByTestId("selected-meta")).toContainText(
      '"justifyContent": "center"',
    );
    await expect(page.getByTestId("selected-meta")).toContainText(
      '"component_editability_limited"',
    );
    await expect(page.getByTestId("document-snapshot")).toContainText(
      '"nodeCount": 5',
    );
    await expect(page.getByTestId("document-snapshot")).toContainText(
      '"originNodeId": "99:1"',
    );
  });

  test("exposes SVG paste warning metadata for unsupported content", async ({
    page,
  }) => {
    await page.goto(TEST_PAGE_URL);
    await waitForCanvasReady(page);

    await dispatchPaste(page, {
      types: ["image/svg+xml", "text/plain"],
      getData: (type) =>
        type === "image/svg+xml" || type === "text/plain"
          ? SVG_WITH_UNSUPPORTED_CONTENT
          : "",
    });

    await expect(page.getByTestId("imported-selection-count")).toHaveText("1");
    await expect(page.getByTestId("selected-meta")).toContainText(
      '"source": "svg-import"',
    );
    await expect(page.getByTestId("selected-meta")).toContainText(
      '"importSourceLabel": "SVG"',
    );
    await expect(page.getByTestId("selected-meta")).toContainText(
      '"originNodeType": "rect"',
    );
    await expect(page.getByTestId("selected-meta")).toContainText(
      '"originNodeId": "editable-card"',
    );
    await expect(page.getByTestId("selected-meta")).toContainText(
      '"warningCount": 1',
    );
    await expect(page.getByTestId("selected-meta")).toContainText(
      '"unsupported_tag"',
    );
  });

  test("exposes raster paste asset metadata without inventing degradation warnings", async ({
    page,
  }) => {
    await page.goto(TEST_PAGE_URL);
    await waitForCanvasReady(page);

    await dispatchPaste(page, {
      types: [],
      files: [
        {
          name: "one-pixel.png",
          type: "image/png",
          dataUrl: ONE_BY_ONE_PNG_DATA_URL,
        },
      ],
    });

    await expect(page.getByTestId("imported-selection-count")).toHaveText("1");
    await expect(page.getByTestId("selected-meta")).toContainText(
      '"source": "image-paste"',
    );
    await expect(page.getByTestId("selected-meta")).toContainText(
      '"importSourceLabel": "Image"',
    );
    await expect(page.getByTestId("selected-meta")).toContainText(
      '"originNodeType": "image/png"',
    );
    await expect(page.getByTestId("selected-meta")).toContainText(
      '"originNodeId": "one-pixel.png"',
    );
    await expect(page.getByTestId("selected-meta")).not.toContainText(
      '"warningCount"',
    );
    const snapshot = await readDocumentSnapshot(page);
    const imageNodes = snapshot.nodes.filter((node) => node.type === "image");
    expect(imageNodes).toHaveLength(1);

    const imageNode = imageNodes[0];
    expect(imageNode?.assetId).toBeTruthy();
    const linkedAsset = snapshot.assets?.find(
      (asset) => asset.id === imageNode?.assetId,
    );
    expect(linkedAsset).toMatchObject({
      id: imageNode?.assetId,
      mimeType: "image/png",
      name: "one-pixel.png",
      source: "upload",
      width: 1,
      height: 1,
    });
  });
});
