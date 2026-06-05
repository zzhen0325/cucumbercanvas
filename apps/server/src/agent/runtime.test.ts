import { describe, expect, it } from "vitest";

import { buildUserMessage } from "./runtime.js";

describe("buildUserMessage", () => {
  it("serializes compact canvas entry with InputNode semantics", () => {
    const message = buildUserMessage(
      "生成一张产品海报",
      [],
      undefined,
      [],
      undefined,
      null,
      undefined,
      {
        agentExecutionNodeId: "agent_run_node_1",
        userGoalNodeId: "agent_input_node_1",
      },
    );

    expect(message.text).toContain('<input_node id="agent_input_node_1" />');
    expect(message.text).toContain('<agent_run_node id="agent_run_node_1" />');
    expect(message.text).toContain("InputNode 输入节点");
    expect(message.text).toContain("AgentRunNode");
    expect(message.text).toContain("唯一 AgentRunNode");
    expect(message.text).toContain(
      "不要调用 record_agent_tool_call 写 agent_run_node",
    );
    expect(message.text).not.toContain("<user_goal_node");
  });
});
