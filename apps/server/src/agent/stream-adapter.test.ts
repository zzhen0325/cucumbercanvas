import { describe, expect, it } from "vitest";

import { buildAgentRunContext } from "./orchestration-context.js";
import { adaptDeepAgentStream } from "./stream-adapter.js";

describe("adaptDeepAgentStream orchestration events", () => {
  it("emits run context and prompt layering stage before model events", async () => {
    const context = buildAgentRunContext({
      modelSpecifier: "openai:gpt-4.1",
      prompt: "Create a campaign canvas",
    });

    const events = await collect(
      adaptDeepAgentStream({
        conversationId: "canvas_1",
        now: () => "2026-05-27T00:00:00.000Z",
        runContext: context,
        runId: "run_1",
        sessionId: "session_1",
        stream: emptyStream(),
      }),
    );

    expect(events.map((event) => event.type).slice(0, 3)).toEqual([
      "run.started",
      "run.context",
      "agent.stage",
    ]);
    expect(events[1]).toMatchObject({
      type: "run.context",
      context: {
        team: { id: "cucumber-default-agent-team" },
      },
    });
    expect(events[2]).toMatchObject({
      type: "agent.stage",
      stage: "prompt_layering",
      status: "completed",
      role: "orchestrator",
    });
  });

  it("wraps tool lifecycle with role-aware stage events", async () => {
    const events = await collect(
      adaptDeepAgentStream({
        conversationId: "canvas_1",
        now: () => "2026-05-27T00:00:00.000Z",
        runId: "run_1",
        sessionId: "session_1",
        stream: arrayStream([
          {
            event: "on_tool_start",
            name: "prompt_canvas_plan",
            run_id: "tool_1",
            data: { input: { prompt: "Plan" } },
          },
          {
            event: "on_tool_end",
            name: "prompt_canvas_plan",
            run_id: "tool_1",
            data: { output: '{"summary":"Plan ready"}' },
          },
        ]),
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "agent.stage",
      "tool.started",
      "tool.completed",
      "agent.stage",
      "run.completed",
    ]);
    expect(events[1]).toMatchObject({
      type: "agent.stage",
      stage: "planning",
      status: "started",
      role: "planner",
    });
    expect(events[4]).toMatchObject({
      type: "agent.stage",
      stage: "planning",
      status: "completed",
      role: "planner",
      summary: "Plan ready",
    });
  });

  it("can emit a paused terminal event for intentional pause aborts", async () => {
    const controller = new AbortController();
    controller.abort();

    const events = await collect(
      adaptDeepAgentStream({
        abortEvent: (runId, now) => ({
          reason: "用户暂停了执行链。",
          runId,
          timestamp: now(),
          type: "run.paused",
        }),
        conversationId: "canvas_1",
        now: () => "2026-05-27T00:00:00.000Z",
        runId: "run_1",
        sessionId: "session_1",
        signal: controller.signal,
        stream: emptyStream(),
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.paused",
    ]);
    expect(events[1]).toMatchObject({
      type: "run.paused",
      reason: "用户暂停了执行链。",
    });
  });
});

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

async function* emptyStream(): AsyncIterable<unknown> {}

async function* arrayStream(events: unknown[]): AsyncIterable<unknown> {
  for (const event of events) {
    yield event;
  }
}
