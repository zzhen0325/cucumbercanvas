// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AgentFlowContainerRenderer } from "../src/components/canvas/agent-flow-container-renderer";

afterEach(() => cleanup());

describe("AgentFlowContainerRenderer", () => {
  it("renders typed steps, tool links, and artifacts inside the container", () => {
    render(
      <AgentFlowContainerRenderer
        element={{
          width: 760,
          height: 420,
          customData: {
            highlightToolCallId: "tool_1",
            agentFlowData: {
              planId: "plan_123",
              runId: "run_123",
              steps: [
                {
                  stepId: "step_1",
                  title: "Inspect canvas",
                  status: "completed",
                  agentName: "cucumber",
                },
              ],
              toolLinks: [
                {
                  toolCallId: "tool_1",
                  toolName: "inspect_canvas",
                  status: "completed",
                  stepId: "step_1",
                },
              ],
              artifacts: [
                {
                  type: "image",
                  url: "https://example.com/a.png",
                  mimeType: "image/png",
                  width: 512,
                  height: 512,
                },
              ],
            },
          },
        }}
      />,
    );

    expect(screen.getByTestId("agent-flow-container")).toBeTruthy();
    expect(screen.getByText("Inspect canvas")).toBeTruthy();
    expect(screen.getByText("inspect_canvas · completed")).toBeTruthy();
    expect(screen.getByText("Artifacts")).toBeTruthy();
  });
});
