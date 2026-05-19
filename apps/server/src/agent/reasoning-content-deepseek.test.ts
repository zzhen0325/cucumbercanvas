import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { convertMessagesToReasoningContentCompletionsParams } from "./reasoning-content-openai.js";

describe("convertMessagesToReasoningContentCompletionsParams for DeepSeek", () => {
  it("round-trips reasoning_content on assistant history messages with tool calls (DeepSeek reasoning mode)", () => {
    const params = convertMessagesToReasoningContentCompletionsParams({
      messages: [
        new HumanMessage("use the tool"),
        new AIMessage({
          additional_kwargs: {
            reasoning_content:
              "I need to call the project search tool to find brand kit information.",
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
      model: "deepseek-reasoner",
    });

    expect(params[1]).toMatchObject({
      reasoning_content:
        "I need to call the project search tool to find brand kit information.",
      role: "assistant",
    });
    expect(params[2]).toMatchObject({
      role: "tool",
      tool_call_id: "call_search",
    });
  });

  it("preserves reasoning_content across multiple tool rounds", () => {
    const params = convertMessagesToReasoningContentCompletionsParams({
      messages: [
        new HumanMessage("search and then generate"),
        new AIMessage({
          additional_kwargs: {
            reasoning_content: "First, I should search for existing assets.",
          },
          content: "",
          tool_calls: [
            {
              args: { query: "logo" },
              id: "call_1",
              name: "project_search",
              type: "tool_call",
            },
          ],
        }),
        new ToolMessage({
          content: '{"results":[]}',
          tool_call_id: "call_1",
        }),
        new AIMessage({
          additional_kwargs: {
            reasoning_content:
              "No results found. I should generate a new image.",
          },
          content: "",
          tool_calls: [
            {
              args: { prompt: "a logo" },
              id: "call_2",
              name: "generate_image",
              type: "tool_call",
            },
          ],
        }),
        new ToolMessage({
          content: '{"url":"https://example.com/img.png"}',
          tool_call_id: "call_2",
        }),
      ],
      model: "deepseek-reasoner",
    });

    expect(params[1]).toMatchObject({
      reasoning_content: "First, I should search for existing assets.",
      role: "assistant",
    });
    expect(params[3]).toMatchObject({
      reasoning_content: "No results found. I should generate a new image.",
      role: "assistant",
    });
  });
});
