import { describe, expect, it } from "vitest";

import { CUCUMBER_SYSTEM_PROMPT } from "./cucumber-main.js";

describe("CUCUMBER_SYSTEM_PROMPT", () => {
  it("defaults visual generation work to a canvas execution chain", () => {
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "画布默认承载 Agent 的执行链和最终结果",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "不需要等待用户额外说明“在画布上展示”",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "简单图片生成任务（例如“帮我生成一张小狗的图片”）必须先调用 create_agent_canvas_flow",
    );
  });

  it("keeps pure text work out of canvas tool calls", () => {
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "纯文字任务或用户明确要求不要改画布时，才不创建画布链路",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "纯文字任务**（小说、文章、代码、翻译）→ 直接回复，**不调用**任何工具",
    );
  });
});
