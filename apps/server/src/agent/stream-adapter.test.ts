import { describe, expect, it } from "vitest";

import { adaptDeepAgentStream } from "./stream-adapter.js";

describe("adaptDeepAgentStream agent flow events", () => {
  it("emits task plan and container events from publish_task_plan output", async () => {
    const stream = [
      {
        event: "on_tool_start",
        name: "publish_task_plan",
        run_id: "tool_publish",
        data: {
          input: {
            title: "Plan visible workflow",
            steps: [{ title: "Inspect canvas" }],
          },
        },
      },
      {
        event: "on_tool_end",
        name: "publish_task_plan",
        run_id: "tool_publish",
        data: {
          output: {
            kind: "task_plan",
            plan: {
              planId: "plan_123",
              title: "Plan visible workflow",
              steps: [
                {
                  stepId: "step_1",
                  title: "Inspect canvas",
                  status: "pending",
                },
              ],
            },
          },
        },
      },
    ];

    const events = await collect(
      adaptDeepAgentStream({
        conversationId: "canvas_123",
        runId: "run_123",
        sessionId: "session_123",
        stream: toAsync(stream),
        now: () => "2026-03-23T12:00:00.000Z",
      }),
    );

    expect(events.map((event) => event.type)).toContain("task.plan.created");
    expect(events.map((event) => event.type)).toContain(
      "agent.flow.container.created",
    );
    const containerEvent = events.find(
      (event) => event.type === "agent.flow.container.created",
    );
    expect(containerEvent?.type).toBe("agent.flow.container.created");
    if (containerEvent?.type === "agent.flow.container.created") {
      expect(containerEvent.container.kind).toBe("agent_flow");
      expect(containerEvent.data.planId).toBe("plan_123");
    }
  });

  it("attaches plan step metadata to tool lifecycle events", async () => {
    const stream = [
      {
        event: "on_tool_start",
        name: "generate_image",
        run_id: "tool_image",
        data: {
          input: {
            prompt: "A poster",
            planId: "plan_123",
            planStepId: "step_1",
          },
        },
      },
      {
        event: "on_tool_end",
        name: "generate_image",
        run_id: "tool_image",
        data: {
          output: {
            summary: "done",
          },
        },
      },
    ];

    const events = await collect(
      adaptDeepAgentStream({
        conversationId: "canvas_123",
        runId: "run_123",
        sessionId: "session_123",
        stream: toAsync(stream),
        now: () => "2026-03-23T12:00:00.000Z",
      }),
    );

    const started = events.find((event) => event.type === "tool.started");
    const completed = events.find((event) => event.type === "tool.completed");
    expect(started?.type).toBe("tool.started");
    expect(completed?.type).toBe("tool.completed");
    if (started?.type === "tool.started") {
      expect(started.planId).toBe("plan_123");
      expect(started.stepId).toBe("step_1");
    }
    if (completed?.type === "tool.completed") {
      expect(completed.planId).toBe("plan_123");
      expect(completed.stepId).toBe("step_1");
    }
  });
});

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

async function* toAsync<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}
