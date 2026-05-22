import { expect, test } from "@playwright/test";

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

test.describe("canvas import harness", () => {
  test("handles a real paste event and exposes auto-layout import metadata", async ({
    page,
  }) => {
    await page.goto(TEST_PAGE_URL);

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
    await expect(page.getByTestId("selected-meta")).toContainText('"source": "figma-paste"');
    await expect(page.getByTestId("selected-meta")).toContainText('"layout": "vertical"');
    await expect(page.getByTestId("selected-meta")).toContainText('"justifyContent": "center"');
    await expect(page.getByTestId("selected-meta")).toContainText(
      '"component_metadata_dropped"',
    );
    await expect(page.getByTestId("document-snapshot")).toContainText("Nested instance title");
    await expect(page.getByTestId("document-snapshot")).toContainText('"childrenOrder"');
  });
});
