import { expect, test } from "@playwright/test";

const TEST_PAGE_URL = "http://127.0.0.1:3100/test/trace-canvas-chat";

test.describe.configure({ timeout: 90_000 });

type TraceSceneState = Array<{
  id: string;
  opacity: number | null;
  runId: string | null;
  toolCallId: string | null;
  traceType: string | null;
}>;

async function readTraceSceneState(page: Parameters<typeof test>[0]["page"]) {
  const raw = await page.getByTestId("trace-scene-state").textContent();
  return JSON.parse(raw ?? "[]") as TraceSceneState;
}

test.describe("trace canvas chat harness", () => {
  test("renders inline media and the floating selected-element toolbar", async ({
    page,
  }) => {
    await page.goto(TEST_PAGE_URL, {
      timeout: 60_000,
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("harness-ready")).toHaveText("true");

    await expect(page.getByTestId("inline-video-preview")).toBeVisible();

    await page.getByTestId("select-canvas-video").click();
    await expect(page.getByTestId("selected-element-summary")).toHaveText(
      "video",
    );

    await page.getByTestId("select-canvas-image").click();
    await expect(page.getByTestId("selected-element-summary")).toHaveText(
      "image",
    );
  });

  test("links trace detail, chat tool blocks, and run highlighting", async ({
    page,
  }) => {
    await page.goto(TEST_PAGE_URL, {
      timeout: 60_000,
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("harness-ready")).toHaveText("true");

    await page.getByTestId("project-demo-trace").click();
    await expect(page.getByTestId("projected-runs")).toHaveText("2");

    await page.getByTestId("select-tool-call-1").click();
    await expect(page.getByTestId("trace-detail-panel")).toBeVisible();
    await expect(page.getByTestId("selected-trace-tool-call-id")).toHaveText(
      "tool-call-1",
    );

    const firstHighlightState = await readTraceSceneState(page);
    expect(
      firstHighlightState.find(
        (element) =>
          element.traceType === "tool-node" &&
          element.toolCallId === "tool-call-1",
      )?.opacity,
    ).toBe(100);
    expect(
      firstHighlightState.find(
        (element) =>
          element.traceType === "tool-node" &&
          element.toolCallId === "tool-call-2",
      )?.opacity,
    ).toBe(80);
    expect(
      firstHighlightState.find(
        (element) =>
          element.traceType === "tool-node" &&
          element.toolCallId === "tool-call-3",
      )?.opacity,
    ).toBe(28);

    await page.getByTestId("select-artifact-tool-call-1").click();
    await expect(page.getByTestId("trace-detail-panel")).toBeVisible();
    await expect(page.getByTestId("trace-detail-jump-chat")).toBeVisible();

    await page.getByTestId("trace-detail-jump-chat").click();
    await expect(page.getByTestId("linked-tool-call-id")).toHaveText(
      "tool-call-1",
    );
    await expect(
      page.getByTestId("chat-tool-block-tool-call-1"),
    ).toHaveAttribute("data-linked", "true");

    await page.getByTestId("tool-block-link-tool-call-3").click();
    await expect(page.getByTestId("linked-tool-call-id")).toHaveText(
      "tool-call-3",
    );
    await expect(page.getByTestId("selected-trace-tool-call-id")).toHaveText(
      "tool-call-3",
    );
    await expect(
      page.getByTestId("chat-tool-block-tool-call-3"),
    ).toHaveAttribute("data-linked", "true");

    const secondHighlightState = await readTraceSceneState(page);
    expect(
      secondHighlightState.find(
        (element) =>
          element.traceType === "tool-node" &&
          element.toolCallId === "tool-call-1",
      )?.opacity,
    ).toBe(28);
    expect(
      secondHighlightState.find(
        (element) =>
          element.traceType === "tool-node" &&
          element.toolCallId === "tool-call-3",
      )?.opacity,
    ).toBe(100);
  });
});
