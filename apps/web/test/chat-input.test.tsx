// @vitest-environment jsdom

import type { AgentExecutionNodeMeta } from "@cucumber/canvas-core";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import type { CanvasSelectedElement } from "@/components/canvas-editor";
import {
  ChatInput,
  type ChatInputHandle,
  formatAgentExecutionContinuationPrompt,
} from "@/components/chat-input";
import { CUSTOM_AGENT_RECIPE_TEMPLATES_STORAGE_KEY } from "@/components/use-agent-recipe-templates";

function selectedAgentElement(
  execution: Partial<AgentExecutionNodeMeta> = {},
): CanvasSelectedElement {
  return {
    agentExecution: {
      kind: "critique",
      runId: "run-1",
      schemaVersion: 1,
      status: "done",
      title: "Critique 2",
      ...execution,
    } as AgentExecutionNodeMeta,
    height: 120,
    id: "node-critique-2",
    type: "frame",
    width: 240,
    x: 0,
    y: 0,
  };
}

function selectedTextElement(): CanvasSelectedElement {
  return {
    height: 40,
    id: "node-copy-1",
    text: "Launch hero copy",
    type: "text",
    width: 220,
    x: 12,
    y: 24,
  };
}

describe("ChatInput Agent execution continuation context", () => {
  it("submits selected Agent node context with branch or overwrite mode", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(
      <ChatInput
        onSend={onSend}
        selectedCanvasElements={[
          selectedAgentElement({
            branchId: "branch-a",
            kind: "variant_branch",
            status: "paused",
            title: "方案 A",
            toolName: "batch_design",
          }),
        ]}
      />,
    );

    expect(screen.getByText("方案分支 · 方案 A")).toBeVisible();
    expect(screen.getByRole("button", { name: "新分支继续" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "覆盖当前节点" }));
    await user.type(screen.getByLabelText("输入消息"), "继续深化这一版{enter}");

    expect(onSend).toHaveBeenCalledWith("继续深化这一版", {
      agentExecutionContinuation: {
        branchId: "branch-a",
        mode: "overwrite_current",
        nodeId: "node-critique-2",
        nodeKind: "variant_branch",
        nodeStatus: "paused",
        nodeTitle: "方案 A",
        pausedContinuationInstruction:
          "从 paused 执行节点继续时，不要尝试恢复旧 SSE 流；先 inspect 当前 PenDocument.pages 中的 node_id 和上下游，再开启新的执行链步骤并把后续状态写回 durable execution nodes。",
        runId: "run-1",
        toolName: "batch_design",
      },
    });
  });

  it("uses a prefilled branch continuation target instead of the currently selected comparison", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const ref = createRef<ChatInputHandle>();
    const branchTarget: CanvasSelectedElement = {
      ...selectedAgentElement({
        branch: {
          isMainline: false,
        },
        branchId: "branch-a",
        branchLabel: "方向 A",
        comparison: {
          branchNodeIds: ["branch-node-a", "branch-node-b"],
          recommendedBranchId: "branch-b",
          recommendationReason: "方向 B 更适合活动首发。",
        },
        kind: "variant_branch",
        status: "done",
        title: "方向 A",
      }),
      id: "branch-node-a",
    };

    render(
      <ChatInput
        ref={ref}
        onSend={onSend}
        selectedCanvasElements={[
          selectedAgentElement({
            comparison: {
              branchNodeIds: ["branch-node-a", "branch-node-b"],
              recommendedBranchId: "branch-b",
            },
            kind: "comparison",
            status: "done",
            title: "方案对比",
          }),
        ]}
      />,
    );

    act(() => {
      ref.current?.prefillAndFocus("继续深化方向 A", {
        continuationTargetElement: branchTarget,
        intent: "continue",
        mode: "overwrite_current",
      });
    });

    expect(screen.getByText("方案分支 · 方向 A")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "覆盖当前节点" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.type(screen.getByLabelText("输入消息"), "{enter}");

    expect(onSend).toHaveBeenCalledWith("继续深化方向 A", {
      agentExecutionContinuation: {
        branchId: "branch-a",
        branchLabel: "方向 A",
        branchContinueInstruction:
          "这个 variant_branch 还不是当前主线。继续深化前先用 node_id 调用 select_agent_variant_branch，把该分支设为 comparison 的主线，同时保留 sibling branches。",
        branchContinueRequiresMainlineSelection: true,
        branchIsMainline: false,
        comparisonBranchNodeIds: ["branch-node-a", "branch-node-b"],
        comparisonRecommendationReason: "方向 B 更适合活动首发。",
        comparisonRecommendedBranchId: "branch-b",
        intent: "continue",
        mode: "overwrite_current",
        nodeId: "branch-node-a",
        nodeKind: "variant_branch",
        nodeStatus: "done",
        nodeTitle: "方向 A",
        runId: "run-1",
      },
    });
  });

  it("formats continuation context into the Agent prompt without changing the visible message", () => {
    const prompt = formatAgentExecutionContinuationPrompt("继续修复问题", {
      agentExecutionContinuation: {
        intent: "retry",
        mode: "new_branch",
        nodeId: "critique-2",
        nodeKind: "critique",
        nodeStatus: "done",
        nodeTitle: "Critique 2",
        runId: "run-1",
        checkpointCanRestartFromHere: true,
        checkpointRestartReason: "设计方向已经收敛，可从这里重建后续链路。",
        failureAttempted: ["重试图片生成服务", "检查目标容器是否存在"],
        failureNextActions: ["改写输入后继续", "新建分支尝试另一种方案"],
        failureReason: "图片生成服务暂时不可用。",
        failureStep: "生成视觉资产",
        waitingAttachmentCount: 2,
        waitingResponseText: "品牌名 Cucumber Lab，主色绿色。",
      },
    });

    expect(prompt).toContain("<agent_execution_continue_context>");
    expect(prompt).toContain("mode: new_branch");
    expect(prompt).toContain("intent: retry");
    expect(prompt).toContain(
      "intent_instruction: 重试当前失败步骤；沿用原输入和上下文",
    );
    expect(prompt).toContain("node_id: critique-2");
    expect(prompt).toContain("run_id: run-1");
    expect(prompt).toContain("checkpoint_can_restart_from_here: true");
    expect(prompt).toContain(
      "checkpoint_restart_reason: 设计方向已经收敛，可从这里重建后续链路。",
    );
    expect(prompt).toContain("failure_step: 生成视觉资产");
    expect(prompt).toContain("failure_reason: 图片生成服务暂时不可用。");
    expect(prompt).toContain(
      "failure_attempted: 重试图片生成服务 | 检查目标容器是否存在",
    );
    expect(prompt).toContain(
      "failure_next_actions: 改写输入后继续 | 新建分支尝试另一种方案",
    );
    expect(prompt).toContain(
      "waiting_response_text: 品牌名 Cucumber Lab，主色绿色。",
    );
    expect(prompt).toContain("waiting_attachment_count: 2");
    expect(prompt.endsWith("继续修复问题")).toBe(true);
  });

  it("adds an explicit paused-node recovery instruction to continuation prompts", () => {
    const prompt = formatAgentExecutionContinuationPrompt("从暂停点继续", {
      agentExecutionContinuation: {
        mode: "new_branch",
        nodeId: "checkpoint-1",
        nodeKind: "checkpoint",
        nodeStatus: "paused",
        nodeTitle: "暂停点",
        pausedContinuationInstruction:
          "从 paused 执行节点继续时，不要尝试恢复旧 SSE 流；先 inspect 当前 PenDocument.pages 中的 node_id 和上下游，再开启新的执行链步骤并把后续状态写回 durable execution nodes。",
        runId: "run-paused",
      },
    });

    expect(prompt).toContain("node_status: paused");
    expect(prompt).toContain(
      "paused_continuation_instruction: 从 paused 执行节点继续时，不要尝试恢复旧 SSE 流；先 inspect 当前 PenDocument.pages 中的 node_id 和上下游，再开启新的执行链步骤并把后续状态写回 durable execution nodes。",
    );
  });

  it("carries variant branch execution summaries into continuation prompts", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(
      <ChatInput
        onSend={onSend}
        selectedCanvasElements={[
          selectedAgentElement({
            branch: {
              critiqueSummary: "传播张力强，但成本偏高。",
              deliverableSummary: "活动海报主视觉与社交媒体延展。",
              isMainline: false,
              planSummary: "先生成高冲击主视觉，再延展社交媒体比例。",
              risks: ["制作成本高"],
              strengths: ["传播张力强"],
              useCases: ["活动海报"],
            },
            branchId: "branch-c",
            branchLabel: "方向 C",
            downstreamNodeIds: ["comparison-1"],
            kind: "variant_branch",
            status: "done",
            title: "方向 C",
            upstreamNodeIds: ["plan-1"],
          }),
        ]}
      />,
    );

    await user.type(screen.getByLabelText("输入消息"), "继续深化这一版{enter}");

    expect(onSend).toHaveBeenCalledWith("继续深化这一版", {
      agentExecutionContinuation: expect.objectContaining({
        branchCritiqueSummary: "传播张力强，但成本偏高。",
        branchDeliverableSummary: "活动海报主视觉与社交媒体延展。",
        branchId: "branch-c",
        branchIsMainline: false,
        branchLabel: "方向 C",
        branchPlanSummary: "先生成高冲击主视觉，再延展社交媒体比例。",
        branchRisks: ["制作成本高"],
        branchStrengths: ["传播张力强"],
        branchUseCases: ["活动海报"],
        downstreamNodeIds: ["comparison-1"],
        mode: "new_branch",
        upstreamNodeIds: ["plan-1"],
      }),
    });

    const [, context] = onSend.mock.calls[0] as [
      string,
      Parameters<typeof formatAgentExecutionContinuationPrompt>[1],
    ];
    const prompt = formatAgentExecutionContinuationPrompt(
      "继续深化这一版",
      context,
    );

    expect(prompt).toContain("branch_label: 方向 C");
    expect(prompt).toContain(
      "branch_plan_summary: 先生成高冲击主视觉，再延展社交媒体比例。",
    );
    expect(prompt).toContain(
      "branch_deliverable_summary: 活动海报主视觉与社交媒体延展。",
    );
    expect(prompt).toContain(
      "branch_critique_summary: 传播张力强，但成本偏高。",
    );
    expect(prompt).toContain("branch_strengths: 传播张力强");
    expect(prompt).toContain("branch_risks: 制作成本高");
    expect(prompt).toContain("branch_use_cases: 活动海报");
    expect(prompt).toContain("branch_is_mainline: false");
    expect(prompt).toContain("upstream_node_ids: plan-1");
    expect(prompt).toContain("downstream_node_ids: comparison-1");
  });

  it("carries failed-node recovery history into continuation context", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(
      <ChatInput
        onSend={onSend}
        selectedCanvasElements={[
          selectedAgentElement({
            failure: {
              attempted: ["重试图片生成服务"],
              nextActions: ["改写输入后继续", "新建分支尝试另一种方案"],
              reason: "图片生成服务暂时不可用。",
              step: "生成视觉资产",
            },
            kind: "tool_call",
            status: "failed",
            title: "generate_image",
          }),
        ]}
      />,
    );

    await user.type(screen.getByLabelText("输入消息"), "重试这一段{enter}");

    expect(onSend).toHaveBeenCalledWith("重试这一段", {
      agentExecutionContinuation: expect.objectContaining({
        failureAttempted: ["重试图片生成服务"],
        failureNextActions: ["改写输入后继续", "新建分支尝试另一种方案"],
        failureReason: "图片生成服务暂时不可用。",
        failureStep: "生成视觉资产",
        nodeKind: "tool_call",
        nodeStatus: "failed",
      }),
    });
  });

  it("carries checkpoint restart reason into rerun continuation context", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const ref = createRef<ChatInputHandle>();

    render(
      <ChatInput
        ref={ref}
        onSend={onSend}
        selectedCanvasElements={[
          selectedAgentElement({
            checkpoint: {
              canRestartFromHere: true,
              restartReason: "计划和视觉方向已验证，可重建后续产物。",
            },
            downstreamNodeIds: ["step-after-checkpoint", "final-1"],
            kind: "checkpoint",
            status: "done",
            title: "Checkpoint 1",
          }),
        ]}
      />,
    );

    act(() => {
      ref.current?.prefillAndFocus("从 checkpoint 重跑", {
        intent: "rerun_checkpoint",
        mode: "overwrite_current",
      });
    });

    await user.type(screen.getByLabelText("输入消息"), "{enter}");

    expect(onSend).toHaveBeenCalledWith("从 checkpoint 重跑", {
      agentExecutionContinuation: expect.objectContaining({
        checkpointCanRestartFromHere: true,
        checkpointRestartReason: "计划和视觉方向已验证，可重建后续产物。",
        checkpointRerunDownstreamNodeIds: ["step-after-checkpoint", "final-1"],
        checkpointRerunInstruction:
          "从 checkpoint 重跑时，把这些 downstream_node_ids 视为需要重建、覆盖或明确标记为旧版本的下游执行链；先回读 checkpoint 和这些节点的当前 PenDocument.pages 状态，再写入新的 task/tool/critique/final_deliverable/checkpoint 节点。",
        downstreamNodeIds: ["step-after-checkpoint", "final-1"],
        intent: "rerun_checkpoint",
        mode: "overwrite_current",
        nodeKind: "checkpoint",
      }),
    });

    const [, context] = onSend.mock.calls[0] as [
      string,
      Parameters<typeof formatAgentExecutionContinuationPrompt>[1],
    ];
    const prompt = formatAgentExecutionContinuationPrompt(
      "从 checkpoint 重跑",
      context,
    );
    expect(prompt).toContain(
      "checkpoint_rerun_downstream_node_ids: step-after-checkpoint, final-1",
    );
    expect(prompt).toContain(
      "checkpoint_rerun_instruction: 从 checkpoint 重跑时，把这些 downstream_node_ids 视为需要重建",
    );
  });

  it("starts a reusable Recipe template while keeping the prompt editable", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(<ChatInput onSend={onSend} />);

    await user.click(screen.getByRole("button", { name: "Recipe" }));
    expect(screen.getByText("内置 · 6")).toBeVisible();
    await user.click(
      screen.getByRole("button", {
        name: "使用 Recipe 模板：品牌视觉探索",
      }),
    );

    expect(screen.getAllByText("Recipe").length).toBeGreaterThan(0);
    expect(screen.getByText("品牌视觉探索")).toBeVisible();
    expect(
      screen.getByText("需要：品牌名称 / 目标用户 / 品牌调性 +1"),
    ).toBeVisible();
    expect(
      (screen.getByLabelText("输入消息") as HTMLTextAreaElement).value,
    ).toContain("使用「品牌视觉探索」Recipe");
    expect(
      (screen.getByLabelText("输入消息") as HTMLTextAreaElement).value,
    ).toContain("待补输入：\n- 品牌名称：");
    expect(
      (screen.getByLabelText("输入消息") as HTMLTextAreaElement).value,
    ).toContain("- 参考图或现有画布节点：");

    await user.type(screen.getByLabelText("输入消息"), "{enter}");

    expect(onSend).toHaveBeenCalledWith(
      expect.stringContaining("使用「品牌视觉探索」Recipe"),
      {
        recipeTemplate: expect.objectContaining({
          id: "brand-visual-exploration",
          nodeStructure: expect.arrayContaining(["variant_branch"]),
          toolSequence: expect.arrayContaining(["create_agent_execution_flow"]),
        }),
      },
    );
    expect(onSend.mock.calls[0]?.[0]).toContain("ask_user_more 节点继续收集");
  });

  it("appends Recipe input slots when a template is selected after typing", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(<ChatInput onSend={onSend} />);

    await user.type(
      screen.getByLabelText("输入消息"),
      "帮我做一组新品发布海报",
    );
    await user.click(screen.getByRole("button", { name: "Recipe" }));
    await user.click(
      screen.getByRole("button", {
        name: "使用 Recipe 模板：海报多方案",
      }),
    );

    const inputValue = (
      screen.getByLabelText("输入消息") as HTMLTextAreaElement
    ).value;
    expect(inputValue).toContain("帮我做一组新品发布海报");
    expect(inputValue).toContain("待补输入：\n- 活动主题：");
    expect(inputValue).toContain("- 核心文案：");
    expect(screen.getByText("海报多方案")).toBeVisible();

    await user.type(screen.getByLabelText("输入消息"), "{enter}");

    expect(onSend).toHaveBeenCalledWith(
      expect.stringContaining("帮我做一组新品发布海报"),
      {
        recipeTemplate: expect.objectContaining({
          id: "poster-multi-variant",
        }),
      },
    );
  });

  it("formats selected Recipe template context into the Agent prompt", () => {
    const prompt = formatAgentExecutionContinuationPrompt("请按这个模板开始", {
      recipeTemplate: {
        defaultPrompt: "使用模板",
        deliverableFormat: "comparison + checkpoint",
        id: "poster-multi-variant",
        inputSlots: ["活动主题"],
        nodeStructure: ["user_goal", "recipe_plan", "variant_branch"],
        summary: "生成多方向海报",
        title: "海报多方案",
        toolSequence: ["create_agent_execution_flow"],
        validationRules: ["保留未选分支"],
      },
    });

    expect(prompt).toContain("<agent_recipe_template>");
    expect(prompt).toContain("template_id: poster-multi-variant");
    expect(prompt).toContain("template_source: builtin");
    expect(prompt).toContain("startup_mode: template_starter");
    expect(prompt).toContain(
      "input_slot_policy: Treat input_slots as required user/workflow inputs",
    );
    expect(prompt).toContain("create a durable ask_user_more node");
    expect(prompt).toContain(
      "instruction: Start by creating a durable Agent Execution Canvas chain from this template",
    );
    expect(prompt.endsWith("请按这个模板开始")).toBe(true);
  });

  it("loads saved Recipe templates from local storage", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    window.localStorage.setItem(
      CUSTOM_AGENT_RECIPE_TEMPLATES_STORAGE_KEY,
      JSON.stringify([
        {
          defaultPrompt: "使用「我的海报探索模板」Recipe：生成新的海报方向。",
          deliverableFormat: "comparison + checkpoint",
          id: "saved-template-1",
          inputSlots: ["活动主题"],
          nodeStructure: ["user_goal", "recipe_plan", "variant_branch"],
          savedFromNodeId: "checkpoint-1",
          source: "saved_execution_chain",
          summary: "从已完成 checkpoint 保存。",
          title: "我的海报探索模板",
          toolSequence: ["create_agent_execution_flow"],
          validationRules: ["保留未选分支"],
        },
      ]),
    );

    render(<ChatInput onSend={onSend} />);

    await user.click(screen.getByRole("button", { name: "Recipe" }));
    await user.click(
      screen.getByRole("button", {
        name: "使用 Recipe 模板：我的海报探索模板",
      }),
    );
    await user.type(screen.getByLabelText("输入消息"), "{enter}");

    expect(onSend).toHaveBeenCalledWith(
      expect.stringContaining("我的海报探索模板"),
      {
        recipeTemplate: expect.objectContaining({
          id: "saved-template-1",
          savedFromNodeId: "checkpoint-1",
          source: "saved_execution_chain",
        }),
      },
    );
  });

  it("formats saved Recipe templates as new execution-chain instances", () => {
    const prompt = formatAgentExecutionContinuationPrompt(
      "用保存模板再跑一版",
      {
        recipeTemplate: {
          defaultPrompt: "使用保存模板",
          deliverableFormat: "comparison + checkpoint",
          id: "saved-template-1",
          inputSlots: ["活动主题"],
          nodeStructure: ["user_goal", "recipe_plan", "variant_branch"],
          savedFromNodeId: "checkpoint-1",
          savedSourceNodeIds: ["goal-1", "plan-1", "checkpoint-1"],
          source: "saved_execution_chain",
          summary: "从已完成 checkpoint 保存。",
          title: "我的海报探索模板",
          toolSequence: ["create_agent_execution_flow"],
          validationRules: ["保留未选分支"],
        },
      },
    );

    expect(prompt).toContain("template_source: saved_execution_chain");
    expect(prompt).toContain("startup_mode: new_execution_chain_instance");
    expect(prompt).toContain("saved_from_node_id: checkpoint-1");
    expect(prompt).toContain(
      "saved_source_nodes: goal-1 -> plan-1 -> checkpoint-1",
    );
    expect(prompt).toContain(
      "source_node_policy: saved_source_nodes are provenance",
    );
    expect(prompt).toContain("用保存模板再跑一版");
  });

  it("previews and removes saved Recipe templates from the picker", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      CUSTOM_AGENT_RECIPE_TEMPLATES_STORAGE_KEY,
      JSON.stringify([
        {
          defaultPrompt: "使用「我的海报探索模板」Recipe：生成新的海报方向。",
          deliverableFormat: "comparison + checkpoint",
          id: "saved-template-1",
          inputSlots: ["活动主题"],
          nodeStructure: ["user_goal", "recipe_plan", "variant_branch"],
          savedFromNodeId: "checkpoint-1",
          savedSourceNodeIds: ["goal-1", "plan-1", "checkpoint-1"],
          source: "saved_execution_chain",
          summary: "从已完成 checkpoint 保存。",
          title: "我的海报探索模板",
          toolSequence: ["create_agent_execution_flow", "critique_canvas"],
          validationRules: ["保留未选分支"],
        },
      ]),
    );

    render(<ChatInput onSend={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Recipe" }));

    expect(screen.getByText("已保存 · 1")).toBeVisible();
    expect(screen.getByText("内置 · 6")).toBeVisible();
    expect(screen.getByText("3 个来源节点")).toBeVisible();
    await user.click(
      screen.getByRole("button", {
        name: "预览模板结构：我的海报探索模板",
      }),
    );
    expect(
      screen.getByText("从保存模板启动新的执行链，不修改来源节点"),
    ).toBeVisible();
    expect(
      screen.getByText("user_goal -> recipe_plan -> variant_branch"),
    ).toBeVisible();
    expect(
      screen.getByText("create_agent_execution_flow -> critique_canvas"),
    ).toBeVisible();
    expect(screen.getByText("保留未选分支")).toBeVisible();
    expect(screen.getByText("comparison + checkpoint")).toBeVisible();
    expect(screen.getByText("goal-1 -> plan-1 -> checkpoint-1")).toBeVisible();

    await user.click(
      screen.getByRole("button", {
        name: "删除保存模板：我的海报探索模板",
      }),
    );

    await waitFor(() =>
      expect(screen.queryByText("我的海报探索模板")).not.toBeInTheDocument(),
    );
    expect(
      JSON.parse(
        window.localStorage.getItem(
          CUSTOM_AGENT_RECIPE_TEMPLATES_STORAGE_KEY,
        ) ?? "[]",
      ),
    ).toEqual([]);
    expect(
      screen.getByRole("button", {
        name: "使用 Recipe 模板：品牌视觉探索",
      }),
    ).toBeVisible();
  });

  it("adds selected canvas nodes as removable manual references for the next send", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(
      <ChatInput
        onSend={onSend}
        selectedCanvasElements={[selectedTextElement()]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "添加引用" }));

    expect(screen.getByText("引用")).toBeVisible();
    expect(screen.getByText("Launch hero copy")).toBeVisible();
    expect(screen.getByRole("button", { name: "添加引用" })).toBeDisabled();

    await user.type(
      screen.getByLabelText("输入消息"),
      "参考这个文案继续{enter}",
    );

    expect(onSend).toHaveBeenCalledWith("参考这个文案继续", {
      canvasNodeReferences: [
        {
          bounds: {
            height: 40,
            width: 220,
            x: 12,
            y: 24,
          },
          label: "Launch hero copy",
          nodeId: "node-copy-1",
          type: "text",
        },
      ],
    });
    expect(screen.queryByText("Launch hero copy")).not.toBeInTheDocument();
  });

  it("carries Agent execution recovery summaries in manual canvas references", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(
      <ChatInput
        onSend={onSend}
        selectedCanvasElements={[
          selectedAgentElement({
            checkpoint: {
              canRestartFromHere: true,
              restartReason: "上游计划和素材已经确认。",
            },
            downstreamNodeIds: ["final-1"],
            failure: {
              attempted: ["切换素材源"],
              nextActions: ["改写输入后继续"],
              reason: "图片生成服务暂时不可用。",
              step: "生成最终视觉",
            },
            kind: "checkpoint",
            status: "failed",
            title: "Checkpoint A",
            upstreamNodeIds: ["plan-1"],
            waitingForUser: {
              acceptsFiles: true,
              prompt: "请补充品牌参考图。",
              response: {
                attachmentCount: 2,
                submittedAt: "2026-06-04T00:00:00.000Z",
                text: "已补充两张参考图。",
              },
            },
          }),
        ]}
      />,
    );

    expect(
      screen.getByTitle(
        "基于 Checkpoint A 继续；检查点 · 失败；失败原因：图片生成服务暂时不可用。；等待补充：请补充品牌参考图。；重启锚点：上游计划和素材已经确认。",
      ),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "添加引用" }));
    expect(screen.getByText("检查点 · 失败")).toBeVisible();
    expect(
      screen.getByTitle(
        "移除引用 Checkpoint A；检查点 · 失败；失败原因：图片生成服务暂时不可用。；等待补充：请补充品牌参考图。；重启锚点：上游计划和素材已经确认。",
      ),
    ).toBeVisible();
    await user.type(
      screen.getByLabelText("输入消息"),
      "参考这个节点继续{enter}",
    );

    expect(onSend).toHaveBeenCalledWith("参考这个节点继续", {
      agentExecutionContinuation: expect.objectContaining({
        checkpointCanRestartFromHere: true,
        checkpointRestartReason: "上游计划和素材已经确认。",
        nodeId: "node-critique-2",
        nodeKind: "checkpoint",
      }),
      canvasNodeReferences: [
        expect.objectContaining({
          agentExecution: expect.objectContaining({
            checkpointCanRestartFromHere: true,
            checkpointRestartReason: "上游计划和素材已经确认。",
            downstreamNodeIds: ["final-1"],
            failureAttempted: ["切换素材源"],
            failureNextActions: ["改写输入后继续"],
            failureReason: "图片生成服务暂时不可用。",
            failureStep: "生成最终视觉",
            kind: "checkpoint",
            status: "failed",
            upstreamNodeIds: ["plan-1"],
            waitingAttachmentCount: 2,
            waitingPrompt: "请补充品牌参考图。",
            waitingResponseText: "已补充两张参考图。",
          }),
          nodeId: "node-critique-2",
        }),
      ],
    });
  });

  it("carries paused recovery instructions in manual canvas references", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(
      <ChatInput
        onSend={onSend}
        selectedCanvasElements={[
          selectedAgentElement({
            kind: "checkpoint",
            status: "paused",
            title: "暂停点",
            upstreamNodeIds: ["plan-1"],
          }),
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "添加引用" }));
    await user.type(screen.getByLabelText("输入消息"), "参考暂停点继续{enter}");

    expect(onSend).toHaveBeenCalledWith("参考暂停点继续", {
      agentExecutionContinuation: expect.objectContaining({
        nodeId: "node-critique-2",
        nodeStatus: "paused",
        pausedContinuationInstruction:
          "从 paused 执行节点继续时，不要尝试恢复旧 SSE 流；先 inspect 当前 PenDocument.pages 中的 node_id 和上下游，再开启新的执行链步骤并把后续状态写回 durable execution nodes。",
      }),
      canvasNodeReferences: [
        expect.objectContaining({
          agentExecution: expect.objectContaining({
            kind: "checkpoint",
            pausedContinuationInstruction:
              "从 paused 执行节点继续时，不要尝试恢复旧 SSE 流；先 inspect 当前 PenDocument.pages 中的 node_id 和上下游，再开启新的执行链步骤并把后续状态写回 durable execution nodes。",
            status: "paused",
            upstreamNodeIds: ["plan-1"],
          }),
          nodeId: "node-critique-2",
        }),
      ],
    });
  });

  it("formats manual canvas node references as live node ids in the Agent prompt", () => {
    const prompt = formatAgentExecutionContinuationPrompt("结合这些节点继续", {
      canvasNodeReferences: [
        {
          agentExecution: {
            branchId: "branch-a",
            branchCritiqueSummary: "需要控制素材复杂度。",
            branchDeliverableSummary: "活动海报主视觉。",
            branchLabel: "方向 A",
            branchPlanSummary: "先做品牌主视觉探索。",
            branchRisks: ["素材复杂"],
            branchStrengths: ["识别度高"],
            branchUseCases: ["发布会 KV"],
            branchContinueInstruction:
              "这个 variant_branch 还不是当前主线。继续深化前先用 node_id 调用 select_agent_variant_branch，把该分支设为 comparison 的主线，同时保留 sibling branches。",
            branchContinueRequiresMainlineSelection: true,
            branchIsMainline: false,
            checkpointCanRestartFromHere: true,
            checkpointRestartReason: "方向已确认。",
            comparisonBranchNodeIds: ["branch-node-a", "branch-node-b"],
            comparisonRecommendationReason: "A 方向更贴合品牌。",
            comparisonRecommendedBranchId: "branch-a",
            downstreamNodeIds: ["final-1"],
            failureAttempted: ["重试图片生成服务"],
            failureNextActions: ["改写输入后继续"],
            failureReason: "图片生成服务暂时不可用。",
            failureStep: "生成视觉资产",
            kind: "variant_branch",
            pausedContinuationInstruction:
              "从 paused 执行节点继续时，不要尝试恢复旧 SSE 流；先 inspect 当前 PenDocument.pages 中的 node_id 和上下游，再开启新的执行链步骤并把后续状态写回 durable execution nodes。",
            runId: "run-1",
            status: "paused",
            title: "方案 A",
            toolName: "batch_design",
            upstreamNodeIds: ["plan-1"],
            waitingAttachmentCount: 2,
            waitingPrompt: "请补充品牌参考。",
            waitingResponseText: "品牌名 Cucumber Lab。",
          },
          bounds: {
            height: 160,
            width: 260,
            x: 10,
            y: 20,
          },
          label: "方案 A",
          nodeId: "branch-node-a",
          type: "frame",
        },
      ],
    });

    expect(prompt).toContain("<canvas_node_references>");
    expect(prompt).toContain(
      "Inspect the current PenDocument.pages node ids before editing",
    );
    expect(prompt).toContain("node_id: branch-node-a");
    expect(prompt).toContain("agent_kind: variant_branch");
    expect(prompt).toContain("branch_id: branch-a");
    expect(prompt).toContain("branch_label: 方向 A");
    expect(prompt).toContain("branch_plan_summary: 先做品牌主视觉探索。");
    expect(prompt).toContain("branch_deliverable_summary: 活动海报主视觉。");
    expect(prompt).toContain("branch_critique_summary: 需要控制素材复杂度。");
    expect(prompt).toContain("tool_name: batch_design");
    expect(prompt).toContain("upstream_node_ids: plan-1");
    expect(prompt).toContain("downstream_node_ids: final-1");
    expect(prompt).toContain("branch_strengths: 识别度高");
    expect(prompt).toContain("branch_risks: 素材复杂");
    expect(prompt).toContain("branch_use_cases: 发布会 KV");
    expect(prompt).toContain("branch_is_mainline: false");
    expect(prompt).toContain(
      "branch_continue_requires_mainline_selection: true",
    );
    expect(prompt).toContain(
      "branch_continue_instruction: 这个 variant_branch 还不是当前主线。继续深化前先用 node_id 调用 select_agent_variant_branch",
    );
    expect(prompt).toContain(
      "comparison_branch_node_ids: branch-node-a, branch-node-b",
    );
    expect(prompt).toContain("comparison_recommended_branch_id: branch-a");
    expect(prompt).toContain(
      "comparison_recommendation_reason: A 方向更贴合品牌。",
    );
    expect(prompt).toContain("checkpoint_can_restart_from_here: true");
    expect(prompt).toContain("checkpoint_restart_reason: 方向已确认。");
    expect(prompt).toContain(
      "paused_continuation_instruction: 从 paused 执行节点继续时，不要尝试恢复旧 SSE 流；先 inspect 当前 PenDocument.pages 中的 node_id 和上下游，再开启新的执行链步骤并把后续状态写回 durable execution nodes。",
    );
    expect(prompt).toContain("waiting_prompt: 请补充品牌参考。");
    expect(prompt).toContain("waiting_response_text: 品牌名 Cucumber Lab。");
    expect(prompt).toContain("waiting_attachment_count: 2");
    expect(prompt).toContain("failure_step: 生成视觉资产");
    expect(prompt).toContain("failure_reason: 图片生成服务暂时不可用。");
    expect(prompt).toContain("failure_attempted: 重试图片生成服务");
    expect(prompt).toContain("failure_next_actions: 改写输入后继续");
    expect(prompt.endsWith("结合这些节点继续")).toBe(true);
  });

  it("prefills and focuses a continuation draft from canvas actions", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const ref = createRef<ChatInputHandle>();

    render(
      <ChatInput
        ref={ref}
        onSend={onSend}
        selectedCanvasElements={[
          selectedAgentElement({
            branchId: "branch-c",
            kind: "variant_branch",
            status: "done",
            title: "方向 C",
          }),
        ]}
      />,
    );

    act(() => {
      ref.current?.prefillAndFocus("继续深化方向 C", {
        intent: "new_branch",
        mode: "new_branch",
      });
    });

    const input = screen.getByLabelText("输入消息");
    expect(input).toHaveValue("继续深化方向 C");
    expect(screen.getByRole("button", { name: "新分支继续" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.type(input, "{enter}");

    expect(onSend).toHaveBeenCalledWith("继续深化方向 C", {
      agentExecutionContinuation: {
        branchId: "branch-c",
        intent: "new_branch",
        mode: "new_branch",
        nodeId: "node-critique-2",
        nodeKind: "variant_branch",
        nodeStatus: "done",
        nodeTitle: "方向 C",
        runId: "run-1",
      },
    });
  });

  it("opens the attachment picker when a continuation draft requests files", async () => {
    const onSend = vi.fn();
    const ref = createRef<ChatInputHandle>();
    const clickSpy = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});

    render(
      <ChatInput
        ref={ref}
        onAddFiles={vi.fn()}
        onSend={onSend}
        selectedCanvasElements={[
          selectedAgentElement({
            kind: "ask_user_more",
            status: "waiting",
            title: "等待品牌资料",
          }),
        ]}
      />,
    );

    act(() => {
      ref.current?.prefillAndFocus("补充品牌图片", {
        mode: "overwrite_current",
        openFilePicker: true,
      });
    });

    expect(await screen.findByDisplayValue("补充品牌图片")).toBeVisible();
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());

    clickSpy.mockRestore();
  });

  it("carries a submitted waiting response from a prefilled continuation draft", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const ref = createRef<ChatInputHandle>();

    render(
      <ChatInput
        ref={ref}
        onSend={onSend}
        selectedCanvasElements={[
          selectedAgentElement({
            kind: "ask_user_more",
            status: "waiting",
            title: "等待品牌资料",
            waitingForUser: {
              prompt: "请补充品牌名和主色。",
            },
          }),
        ]}
      />,
    );

    act(() => {
      ref.current?.prefillAndFocus("已提交补充，请继续", {
        intent: "continue",
        mode: "overwrite_current",
        waitingResponseText: "品牌名 Cucumber Lab，主色绿色。",
      });
    });

    await user.type(screen.getByLabelText("输入消息"), "{enter}");

    expect(onSend).toHaveBeenCalledWith("已提交补充，请继续", {
      agentExecutionContinuation: expect.objectContaining({
        intent: "continue",
        mode: "overwrite_current",
        waitingPrompt: "请补充品牌名和主色。",
        waitingResponseText: "品牌名 Cucumber Lab，主色绿色。",
      }),
    });
  });
});
