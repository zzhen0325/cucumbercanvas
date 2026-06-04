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
      "所有图片生成、设计、结构化画布编辑、长链路生成或需要后续复盘/继续执行的任务，都必须先调用 create_agent_execution_flow",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "简单图片生成任务（例如“帮我生成一张小狗的图片”）也走 create_agent_execution_flow",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "传 targetContainerId: finalDeliverableNodeId，并把对应 generate_image 工具节点 ID 作为 agentExecutionNodeId",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain("record_agent_final_deliverable");
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "更新该 final_deliverable 节点的完成/失败状态和交付摘要",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "<agent_execution_continue_context>",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "mode 为 new_branch 时保留原节点并沿新分支/variant_branch 继续",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain("intent / intent_instruction");
    expect(CUCUMBER_SYSTEM_PROMPT).toContain("retry 重试当前失败步骤");
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "rerun_checkpoint 从 checkpoint 重建下游链路",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain("checkpoint_restart_reason");
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "作为从该 checkpoint 重建下游链路的锚点说明",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "checkpoint_rerun_downstream_node_ids / checkpoint_rerun_instruction",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "把这些节点视为需要重建、覆盖或明确标记旧版本的下游范围提示",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain("paused_continuation_instruction");
    expect(CUCUMBER_SYSTEM_PROMPT).toContain("不要尝试恢复旧 SSE 流");
    expect(CUCUMBER_SYSTEM_PROMPT).toContain("waiting_response_text");
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "把它视为用户对 ask_user_more 节点的补充答案",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "failure_attempted / failure_next_actions",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain("避免重复无效尝试");
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "branch_plan_summary / branch_deliverable_summary / branch_critique_summary",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain("只沿选中的 variant_branch 深化");
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "branch_continue_requires_mainline_selection 为 true",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "必须先调用 select_agent_variant_branch 把 node_id 对应分支设为唯一主线",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain("<canvas_node_references>");
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "可能包含 Agent 执行摘要、branch/comparison/checkpoint/waiting/failure 信息",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "这些摘要只是定位和意图提示，不是复制出来的画布真值",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain("<agent_recipe_template>");
    expect(CUCUMBER_SYSTEM_PROMPT).toContain("模板是执行链计划来源");
    expect(CUCUMBER_SYSTEM_PROMPT).toContain("不是第二套运行时状态");
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "template_source / startup_mode / source_node_policy",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain("input_slots 是必需输入槽位");
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "必须先创建 durable `ask_user_more` 节点询问缺失项",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "saved_source_nodes 只是旧成功链路的 provenance",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "模板 tool_sequence 中出现 create_agent_evidence / create_agent_ask_user_more",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "不要把 evidence、等待用户补充、分支、评审或 checkpoint 只写成聊天说明",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "本次必须创建新的 execution-chain 实例或沿明确的 continuation target 执行",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "必须调用 create_agent_variant_branches 创建 durable 的 variant_branch 节点和 comparison 节点",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "每条分支都要写清 planSummary、deliverableSummary、critiqueSummary",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "必须先调用 select_agent_variant_branch，把该分支及同一 comparison 下的兄弟分支同步更新为唯一主线",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain("create_agent_evidence");
    expect(CUCUMBER_SYSTEM_PROMPT).toContain("不要把资料来源只写在聊天里");
    expect(CUCUMBER_SYSTEM_PROMPT).toContain("record_agent_tool_call");
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "不要只把工具结果留在聊天或 run trace",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain("agentExecutionNodeId");
    expect(CUCUMBER_SYSTEM_PROMPT).toContain("create_agent_ask_user_more");
    expect(CUCUMBER_SYSTEM_PROMPT).toContain("不要只在聊天里说“请补充”");
    expect(CUCUMBER_SYSTEM_PROMPT).toContain("record_agent_critique");
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "工具返回值只是诊断来源，不能替代画布上的 critique 节点真值",
    );
    expect(CUCUMBER_SYSTEM_PROMPT).toContain(
      "如果最终交付失败，必须传入具体 errorReason 或 failure.reason",
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
