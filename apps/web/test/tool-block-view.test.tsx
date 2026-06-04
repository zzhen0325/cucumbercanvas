// @vitest-environment jsdom

import type { ToolBlock } from "@cucumber/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToolBlockView } from "@/components/chat/tool-block-view";

describe("ToolBlockView", () => {
  it("renders generate_image previews from output.imageUrl when artifacts are absent", () => {
    const block: ToolBlock = {
      input: {
        model: "bytedance/seedream-4.6",
        prompt: "一只小狗",
      },
      output: {
        height: 1024,
        imageUrl: "https://cdn.example.test/generated/puppy.png",
        mimeType: "image/png",
        title: "小狗图片",
        width: 1024,
      },
      outputSummary: "Generated image",
      status: "completed",
      toolCallId: "tool-call-1",
      toolName: "generate_image",
      type: "tool",
    };

    render(<ToolBlockView block={block} />);

    expect(screen.getByAltText("小狗图片")).toHaveAttribute(
      "src",
      "https://cdn.example.test/generated/puppy.png",
    );
    expect(screen.queryByText("图片加载失败")).toBeNull();
  });
});
