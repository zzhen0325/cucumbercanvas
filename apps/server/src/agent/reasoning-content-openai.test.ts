import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { convertMessagesToReasoningContentCompletionsParams } from "./reasoning-content-openai.js";

describe("convertMessagesToReasoningContentCompletionsParams", () => {
  it("round-trips reasoning_content on assistant history messages", () => {
    const params = convertMessagesToReasoningContentCompletionsParams({
      messages: [
        new HumanMessage("use the tool"),
        new AIMessage({
          additional_kwargs: {
            reasoning_content: "I need to call the project search tool.",
          },
          content: "",
          tool_calls: [
            {
              args: { query: "brand kit" },
              id: "call_search",
              name: "project_search",
              type: "tool_call",
            },
          ],
        }),
        new ToolMessage({
          content: '{"ok":true}',
          tool_call_id: "call_search",
        }),
      ],
      model: "qwen3-coder-plus",
    });

    expect(params[1]).toMatchObject({
      reasoning_content: "I need to call the project search tool.",
      role: "assistant",
    });
    expect(params[2]).toMatchObject({
      role: "tool",
      tool_call_id: "call_search",
    });
  });

  it("does not add reasoning_content when the provider did not return it", () => {
    const params = convertMessagesToReasoningContentCompletionsParams({
      messages: [
        new HumanMessage("hello"),
        new AIMessage({
          content: "hi",
        }),
      ],
      model: "gpt-4o-mini",
    });

    expect(params[1]).toMatchObject({
      content: "hi",
      role: "assistant",
    });
    expect(params[1]).not.toHaveProperty("reasoning_content");
  });
});
