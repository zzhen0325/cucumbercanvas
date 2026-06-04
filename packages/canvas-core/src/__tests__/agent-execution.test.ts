import { describe, expect, it } from "vitest";
import {
  AGENT_EXECUTION_CANVAS_LAYOUT_VERSION,
  createAgentExecutionNode,
  measureAgentExecutionComponentLayout,
  normalizeAgentExecutionCanvasLayout,
  toggleAgentExecutionCanvasCollapsed,
  withAgentExecutionCanvasPresentation,
} from "../agent-execution-layout.js";
import {
  getAgentExecutionKindLabel,
  getAgentExecutionMeta,
  getAgentExecutionNodeSemanticUpdates,
  getAgentExecutionStatusLabel,
  withAgentExecutionMeta,
  withAgentExecutionNodeSemantics,
} from "../agent-execution.js";
import {
  DEFAULT_AGENT_RECIPE_TEMPLATES,
  appendAgentRecipeTemplateInputSlotChecklist,
  canSaveAgentExecutionNodeAsRecipeTemplate,
  createAgentRecipeTemplateFromExecutionNode,
  formatAgentRecipeTemplatePromptBlock,
  formatAgentRecipeTemplateStartPrompt,
  getAgentRecipeTemplateById,
} from "../agent-recipe-template.js";
import { createCanvasDocument, findNode } from "../document.js";
import type { PenNode } from "../types.js";

describe("agent execution metadata", () => {
  it("stores execution node semantics on PenNode meta without replacing existing metadata", () => {
    const node = withAgentExecutionMeta(
      {
        id: "node-1",
        meta: { boardKind: "sticky" },
        type: "frame",
      } as PenNode,
      {
        kind: "recipe_plan",
        runId: "run-1",
        status: "done",
        summary: "Plan the image generation.",
        title: "Recipe plan",
      },
    );

    expect(node.meta?.boardKind).toBe("sticky");
    expect(getAgentExecutionMeta(node)).toMatchObject({
      kind: "recipe_plan",
      runId: "run-1",
      schemaVersion: 1,
      status: "done",
      title: "Recipe plan",
    });
    expect(getAgentExecutionKindLabel("recipe_plan")).toBe("Recipe 计划");
    expect(getAgentExecutionStatusLabel("done")).toBe("已完成");
  });

  it("ignores malformed or unsupported metadata instead of guessing", () => {
    expect(
      getAgentExecutionMeta({
        meta: {
          agentExecution: {
            kind: "legacy_step",
            schemaVersion: 1,
            status: "done",
            title: "Legacy",
          },
        },
      }),
    ).toBeUndefined();
    expect(
      getAgentExecutionMeta({
        meta: {
          agentExecution: {
            kind: "task_step",
            schemaVersion: 0,
            status: "done",
            title: "Wrong version",
          },
        },
      }),
    ).toBeUndefined();
  });

  it("binds execution meta with top-level semantic fields on the same PenNode", () => {
    const node = withAgentExecutionNodeSemantics(
      {
        id: "tool-1",
        meta: { importedFrom: "test" },
        type: "rectangle",
      } as PenNode,
      {
        agentId: "agent-1",
        kind: "tool_call",
        runId: "run-1",
        sessionId: "session-1",
        status: "running",
        title: "Generate image",
        toolName: "generate_image",
      },
    );

    expect(node).toMatchObject({
      agentBinding: {
        agentId: "agent-1",
        name: "Generate image",
        permissions: ["read", "write"],
        role: "assistant",
        status: "running",
        toolName: "generate_image",
      },
      containerRole: ["dataflow", "task"],
      contextSlots: {
        rules: ["agent execution node: tool_call"],
      },
      createdByAgentId: "agent-1",
      runId: "run-1",
      sessionId: "session-1",
    });
    expect(node.meta?.importedFrom).toBe("test");
    expect(getAgentExecutionMeta(node)).toMatchObject({
      agentId: "agent-1",
      kind: "tool_call",
      runId: "run-1",
      schemaVersion: 1,
      sessionId: "session-1",
      status: "running",
      title: "Generate image",
      toolName: "generate_image",
    });
  });

  it("preserves explicit container role and existing agent binding when adding execution semantics", () => {
    const node = withAgentExecutionNodeSemantics(
      {
        agentBinding: {
          agentId: "agent-1",
          name: "Existing designer",
          permissions: ["read"],
          role: "designer",
          status: "thinking",
        },
        containerRole: ["visual"],
        contextSlots: { rules: ["existing rule"] },
        id: "deliverable-1",
        type: "frame",
      } as PenNode,
      {
        agentId: "agent-1",
        kind: "final_deliverable",
        runId: "run-1",
        status: "done",
        title: "Final",
      },
      { agentBindingRole: "assistant" },
    );

    expect(node).toMatchObject({
      agentBinding: {
        agentId: "agent-1",
        name: "Existing designer",
        permissions: ["read"],
        role: "designer",
        status: "thinking",
      },
      containerRole: ["visual"],
      contextSlots: {
        rules: ["existing rule", "agent execution node: final_deliverable"],
      },
    });
  });

  it("builds semantic update patches for existing execution nodes", () => {
    const node = withAgentExecutionNodeSemantics(
      {
        id: "tool-1",
        type: "frame",
      } as PenNode,
      {
        agentId: "agent-1",
        kind: "tool_call",
        runId: "run-1",
        status: "running",
        title: "Generate image",
        toolName: "generate_image",
      },
    );
    const currentExecution = getAgentExecutionMeta(node);
    if (!currentExecution) throw new Error("Expected execution metadata.");

    const updates = getAgentExecutionNodeSemanticUpdates(
      node,
      {
        ...currentExecution,
        details: { outputSummary: "Image job completed." },
        status: "done",
      },
      { agentBindingStatus: "completed" },
    );

    expect(updates).toMatchObject({
      agentBinding: {
        agentId: "agent-1",
        status: "completed",
        toolName: "generate_image",
      },
      containerRole: ["dataflow", "task"],
      runId: "run-1",
    });
    expect(getAgentExecutionMeta({ meta: updates.meta })).toMatchObject({
      details: { outputSummary: "Image job completed." },
      kind: "tool_call",
      status: "done",
    });
  });
});

describe("agent execution canvas presentation", () => {
  it("normalizes old execution nodes to the v2 three-part canvas layout once", () => {
    const doc = createCanvasDocument("Execution layout migration");
    const page = doc.pages?.[0];
    if (!page) throw new Error("Expected default canvas page.");
    page.children = [
      withAgentExecutionNodeSemantics(
        {
          children: [],
          height: 160,
          id: "goal-1",
          name: "Legacy goal",
          type: "frame",
          width: 280,
          x: 420,
          y: 220,
        } as PenNode,
        {
          kind: "user_goal",
          status: "done",
          summary: "用户希望生成新品海报。",
          title: "用户目标",
        },
      ),
      withAgentExecutionNodeSemantics(
        {
          children: [],
          height: 180,
          id: "step-1",
          name: "Legacy step",
          type: "frame",
          width: 320,
          x: 760,
          y: 220,
        } as PenNode,
        {
          kind: "task_step",
          status: "running",
          summary: "正在拆解执行计划。",
          title: "Agent 执行",
          upstreamNodeIds: ["goal-1"],
        },
      ),
      withAgentExecutionNodeSemantics(
        {
          children: [],
          height: 220,
          id: "result-1",
          name: "Legacy result",
          type: "frame",
          width: 320,
          x: 1120,
          y: 220,
        } as PenNode,
        {
          kind: "final_deliverable",
          status: "waiting",
          summary: "结果展示区等待写入。",
          title: "结果展示",
          upstreamNodeIds: ["step-1"],
        },
      ),
    ];

    const migrated = normalizeAgentExecutionCanvasLayout(doc);

    expect(migrated.changed).toBe(true);
    expect(migrated.migratedNodeIds).toEqual(["goal-1", "step-1", "result-1"]);
    expect(
      getAgentExecutionMeta(findNode(migrated.doc, "goal-1")),
    ).toMatchObject({
      canvasPresentation: {
        collapsed: false,
        layoutVersion: AGENT_EXECUTION_CANVAS_LAYOUT_VERSION,
      },
      kind: "user_goal",
    });
    const stepNode = findNode(migrated.doc, "step-1");
    expect(stepNode).toMatchObject({
      height: 36,
      width: 240,
      x: 420,
      y: 344,
    });
    expect(getAgentExecutionMeta(stepNode)).toMatchObject({
      canvasPresentation: {
        collapsed: true,
        layoutVersion: AGENT_EXECUTION_CANVAS_LAYOUT_VERSION,
      },
      kind: "task_step",
      status: "running",
    });
    expect(textContents(stepNode)).toContain("正在拆解执行计划。");

    const secondPass = normalizeAgentExecutionCanvasLayout(migrated.doc);
    expect(secondPass.changed).toBe(false);
    expect(secondPass.migratedNodeIds).toEqual([]);
  });

  it("creates visible compact agent execution text for the canvas node", () => {
    const node = createAgentExecutionNode({
      summary: "Thinking...",
      x: 120,
      y: 240,
    });

    expect(node).toMatchObject({
      height: 36,
      width: 240,
    });
    expect(getAgentExecutionMeta(node)).toMatchObject({
      canvasPresentation: {
        collapsed: true,
        layoutVersion: AGENT_EXECUTION_CANVAS_LAYOUT_VERSION,
      },
      kind: "agent_execution",
      status: "running",
    });
    expect(textContents(node)).toContain("Thinking...");
  });

  it("toggles canvas collapsed state without changing Agent semantics", () => {
    const node = withAgentExecutionNodeSemantics(
      {
        children: [],
        id: "tool-1",
        type: "frame",
      } as PenNode,
      withAgentExecutionCanvasPresentation({
        kind: "tool_call",
        schemaVersion: 1,
        status: "running",
        summary: "正在调用图片生成工具。",
        title: "generate_image",
        toolName: "generate_image",
      }),
    );

    const toggled = toggleAgentExecutionCanvasCollapsed(node);

    expect(getAgentExecutionMeta(toggled)).toMatchObject({
      canvasPresentation: {
        collapsed: false,
        layoutVersion: AGENT_EXECUTION_CANVAS_LAYOUT_VERSION,
      },
      kind: "tool_call",
      status: "running",
      summary: "正在调用图片生成工具。",
      title: "generate_image",
      toolName: "generate_image",
    });
  });

  it("measures auto-height Agent components and only shows toggles on overflow", () => {
    const shortExecution = withAgentExecutionCanvasPresentation({
      kind: "user_goal",
      schemaVersion: 1,
      status: "waiting",
      summary: "生成一张小狗插画。",
      title: "用户目标",
    });
    const shortLayout = measureAgentExecutionComponentLayout(
      shortExecution,
      240,
      false,
    );
    expect(shortLayout.hasOverflow).toBe(false);
    expect(shortLayout.showToggle).toBe(false);
    expect(shortLayout.height).toBeGreaterThanOrEqual(84);

    const longExecution = withAgentExecutionCanvasPresentation(
      {
        kind: "tool_call",
        schemaVersion: 1,
        status: "running",
        summary: Array.from(
          { length: 24 },
          (_, index) =>
            `步骤 ${index + 1} 需要记录输入、输出、失败原因和下一步动作`,
        ).join("，"),
        title: "生成图片",
        toolName: "generate_image",
      },
      { collapsed: true },
    );
    const collapsedLayout = measureAgentExecutionComponentLayout(
      longExecution,
      240,
      false,
    );
    const expandedLayout = measureAgentExecutionComponentLayout(
      longExecution,
      240,
      true,
    );
    expect(collapsedLayout.hasOverflow).toBe(true);
    expect(collapsedLayout.showToggle).toBe(true);
    expect(collapsedLayout.height).toBe(36);
    expect(expandedLayout.height).toBeGreaterThan(collapsedLayout.height);
  });
});

function textContents(node: PenNode | undefined): string[] {
  if (!node || !("children" in node) || !Array.isArray(node.children)) {
    return [];
  }
  return node.children
    .filter((child) => child.type === "text")
    .map((child) => (child as { content?: string }).content ?? "");
}

describe("agent recipe templates", () => {
  it("defines reusable Recipe starters without becoming runtime canvas truth", () => {
    const template = getAgentRecipeTemplateById("brand-visual-exploration");

    expect(template).toBeDefined();
    expect(template?.nodeStructure).toContain("variant_branch");
    expect(template?.toolSequence).toContain("create_agent_execution_flow");
    expect(DEFAULT_AGENT_RECIPE_TEMPLATES.map((item) => item.id)).toContain(
      "design-to-code",
    );
  });

  it("formats a template start prompt with visible input slots", () => {
    const template = getAgentRecipeTemplateById("brand-visual-exploration");
    if (!template) throw new Error("Expected brand template.");

    const startPrompt = formatAgentRecipeTemplateStartPrompt(template);

    expect(startPrompt).toContain(template.defaultPrompt);
    expect(startPrompt).toContain("待补输入：\n- 品牌名称：");
    expect(startPrompt).toContain("- 目标用户：");
    expect(startPrompt).toContain("- 品牌调性：");
    expect(startPrompt).toContain("- 参考图或现有画布节点：");
    expect(startPrompt).toContain("ask_user_more 节点继续收集");
  });

  it("appends template input slots to an existing prompt once", () => {
    const template = getAgentRecipeTemplateById("poster-multi-variant");
    if (!template) throw new Error("Expected poster template.");

    const appended = appendAgentRecipeTemplateInputSlotChecklist(
      "帮我做一组新品发布海报",
      template,
    );
    const repeated = appendAgentRecipeTemplateInputSlotChecklist(
      appended,
      template,
    );

    expect(appended).toContain("帮我做一组新品发布海报");
    expect(appended).toContain("待补输入：\n- 活动主题：");
    expect(appended).toContain("- 核心文案：");
    expect(repeated).toBe(appended);
  });

  it("formats a template prompt block with durable execution-chain instructions", () => {
    const template = getAgentRecipeTemplateById("webpage-design");
    if (!template) throw new Error("Expected webpage-design template.");

    const promptBlock = formatAgentRecipeTemplatePromptBlock(template);

    expect(promptBlock).toContain("<agent_recipe_template>");
    expect(promptBlock).toContain("template_id: webpage-design");
    expect(promptBlock).toContain("template_source: builtin");
    expect(promptBlock).toContain("startup_mode: template_starter");
    expect(promptBlock).toContain("node_structure:");
    expect(promptBlock).toContain(
      "input_slot_policy: Treat input_slots as required user/workflow inputs",
    );
    expect(promptBlock).toContain("create a durable ask_user_more node");
    expect(promptBlock).toContain(
      "Treat node_structure, tool_sequence, input_slots, validation_rules, and deliverable_format as the reusable workflow contract",
    );
    expect(promptBlock).toContain(
      "otherwise create a new execution-chain instance",
    );
    expect(promptBlock).toContain("PenNode/meta.agentExecution");
    expect(promptBlock).toContain("</agent_recipe_template>");
  });

  it("extracts a reusable Recipe template from a completed execution node", () => {
    const node = withAgentExecutionMeta(
      {
        id: "checkpoint-1",
        type: "frame",
      } as PenNode,
      {
        checkpoint: {
          canRestartFromHere: true,
          restartReason: "Validated branch.",
        },
        kind: "checkpoint",
        status: "done",
        summary: "生成并评审三套海报方向。",
        title: "Checkpoint 1",
      },
    );

    expect(canSaveAgentExecutionNodeAsRecipeTemplate(node)).toEqual({
      canSave: true,
    });

    const template = createAgentRecipeTemplateFromExecutionNode(node, {
      id: "saved-template-1",
      now: () => "2026-06-03T00:00:00.000Z",
    });

    expect(template).toMatchObject({
      id: "saved-template-1",
      savedFromNodeId: "checkpoint-1",
      source: "saved_execution_chain",
    });
    expect(template?.nodeStructure).toContain("checkpoint");
    expect(template?.toolSequence).toContain("create_agent_execution_flow");
    expect(template?.validationRules.join(" ")).toContain("checkpoint");
  });

  it("extracts a graph-aware Recipe template from related completed execution nodes", () => {
    const runId = "run-template-1";
    const userGoal = withAgentExecutionMeta(
      { id: "goal-1", type: "frame" } as PenNode,
      {
        downstreamNodeIds: ["plan-1"],
        kind: "user_goal",
        runId,
        status: "done",
        title: "用户目标",
      },
    );
    const plan = withAgentExecutionMeta(
      { id: "plan-1", type: "frame" } as PenNode,
      {
        downstreamNodeIds: ["step-1"],
        kind: "recipe_plan",
        runId,
        status: "done",
        title: "Recipe",
        upstreamNodeIds: ["goal-1"],
      },
    );
    const step = withAgentExecutionMeta(
      { id: "step-1", type: "frame" } as PenNode,
      {
        downstreamNodeIds: ["tool-1"],
        kind: "task_step",
        runId,
        status: "done",
        title: "生成方案",
        upstreamNodeIds: ["plan-1"],
      },
    );
    const tool = withAgentExecutionMeta(
      { id: "tool-1", type: "frame" } as PenNode,
      {
        downstreamNodeIds: ["critique-1"],
        kind: "tool_call",
        runId,
        status: "done",
        title: "生成图像",
        toolName: "generate_image",
        upstreamNodeIds: ["step-1"],
      },
    );
    const critique = withAgentExecutionMeta(
      { id: "critique-1", type: "frame" } as PenNode,
      {
        downstreamNodeIds: ["checkpoint-1"],
        kind: "critique",
        runId,
        status: "done",
        title: "评审",
        upstreamNodeIds: ["tool-1"],
      },
    );
    const checkpoint = withAgentExecutionMeta(
      { id: "checkpoint-1", type: "frame" } as PenNode,
      {
        checkpoint: { canRestartFromHere: true },
        kind: "checkpoint",
        runId,
        status: "done",
        summary: "产品图生成链路完成。",
        title: "Checkpoint",
        upstreamNodeIds: ["critique-1"],
      },
    );
    const otherRun = withAgentExecutionMeta(
      { id: "other-run", type: "frame" } as PenNode,
      {
        kind: "final_deliverable",
        runId: "run-other",
        status: "done",
        title: "Other run",
        upstreamNodeIds: ["checkpoint-1"],
      },
    );

    const template = createAgentRecipeTemplateFromExecutionNode(checkpoint, {
      id: "saved-graph-template",
      relatedNodes: [
        otherRun,
        tool,
        userGoal,
        checkpoint,
        plan,
        critique,
        step,
      ],
    });

    expect(template).toMatchObject({
      id: "saved-graph-template",
      savedFromNodeId: "checkpoint-1",
      savedSourceNodeIds: [
        "goal-1",
        "plan-1",
        "step-1",
        "tool-1",
        "critique-1",
        "checkpoint-1",
      ],
    });
    expect(template?.nodeStructure).toEqual([
      "user_goal",
      "recipe_plan",
      "task_step",
      "tool_call",
      "critique",
      "checkpoint",
    ]);
    expect(template?.toolSequence).toContain("generate_image");
    expect(template?.validationRules.join(" ")).toContain("critique 节点");
    if (!template) throw new Error("Expected saved graph template.");
    expect(formatAgentRecipeTemplatePromptBlock(template)).toContain(
      "saved_source_nodes: goal-1 -> plan-1 -> step-1 -> tool-1 -> critique-1 -> checkpoint-1",
    );
    expect(formatAgentRecipeTemplatePromptBlock(template)).toContain(
      "saved_from_node_id: checkpoint-1",
    );
    expect(formatAgentRecipeTemplatePromptBlock(template)).toContain(
      "startup_mode: new_execution_chain_instance",
    );
    expect(formatAgentRecipeTemplatePromptBlock(template)).toContain(
      "saved_source_nodes are provenance from the old successful chain",
    );
  });

  it("preserves evidence and ask-user-more boundaries in saved Recipe templates", () => {
    const runId = "run-template-context";
    const goal = withAgentExecutionMeta(
      { id: "goal-context", type: "frame" } as PenNode,
      {
        downstreamNodeIds: ["evidence-1"],
        kind: "user_goal",
        runId,
        status: "done",
        title: "用户目标",
      },
    );
    const evidence = withAgentExecutionMeta(
      { id: "evidence-1", type: "frame" } as PenNode,
      {
        downstreamNodeIds: ["ask-1"],
        evidence: {
          confidence: 0.9,
          sourceType: "url",
          url: "https://example.com/brand.pdf",
        },
        kind: "evidence",
        runId,
        status: "done",
        title: "品牌资料",
        upstreamNodeIds: ["goal-context"],
      },
    );
    const ask = withAgentExecutionMeta(
      { id: "ask-1", type: "frame" } as PenNode,
      {
        downstreamNodeIds: ["checkpoint-context"],
        kind: "ask_user_more",
        runId,
        status: "done",
        title: "等待品牌补充",
        upstreamNodeIds: ["evidence-1"],
        waitingForUser: {
          acceptsFiles: true,
          prompt: "请补充品牌参考图。",
          response: {
            attachmentCount: 2,
            submittedAt: "2026-06-03T00:00:00.000Z",
            text: "已补充两张参考图。",
          },
        },
      },
    );
    const checkpoint = withAgentExecutionMeta(
      { id: "checkpoint-context", type: "frame" } as PenNode,
      {
        checkpoint: { canRestartFromHere: true },
        kind: "checkpoint",
        runId,
        status: "done",
        summary: "品牌资料已确认，可继续生成视觉方向。",
        title: "资料确认 checkpoint",
        upstreamNodeIds: ["ask-1"],
      },
    );

    const template = createAgentRecipeTemplateFromExecutionNode(checkpoint, {
      id: "saved-context-template",
      relatedNodes: [ask, checkpoint, goal, evidence],
    });

    expect(template).toMatchObject({
      deliverableFormat:
        "带 evidence / ask_user_more 上下文的可继续执行链 + checkpoint",
      inputSlots: expect.arrayContaining(["参考资料或资产", "用户补充信息"]),
      nodeStructure: ["user_goal", "evidence", "ask_user_more", "checkpoint"],
      savedSourceNodeIds: [
        "goal-context",
        "evidence-1",
        "ask-1",
        "checkpoint-context",
      ],
      toolSequence: expect.arrayContaining([
        "create_agent_evidence",
        "create_agent_ask_user_more",
      ]),
    });
    expect(template?.validationRules.join(" ")).toContain(
      "evidence 节点必须保留来源类型",
    );
    expect(template?.validationRules.join(" ")).toContain(
      "ask_user_more 节点必须记录等待提示",
    );
    if (!template) throw new Error("Expected saved context template.");
    expect(formatAgentRecipeTemplatePromptBlock(template)).toContain(
      "tool_sequence: inspect_canvas_semantic -> create_agent_execution_flow -> create_agent_evidence -> create_agent_ask_user_more",
    );
  });

  it("saves a completed variant branch as a branch-deepening Recipe template", () => {
    const branch = withAgentExecutionMeta(
      { id: "branch-a", type: "frame" } as PenNode,
      {
        branch: {
          critiqueSummary: "需要控制素材复杂度。",
          deliverableSummary: "活动海报主视觉。",
          isMainline: true,
          planSummary: "先做品牌主视觉探索。",
          risks: ["素材复杂"],
          strengths: ["识别度高"],
          useCases: ["发布会 KV"],
        },
        branchId: "branch-a",
        branchLabel: "方向 A",
        kind: "variant_branch",
        status: "done",
        summary: "已验证的活动海报方向。",
        title: "方向 A",
      },
    );

    expect(canSaveAgentExecutionNodeAsRecipeTemplate(branch)).toEqual({
      canSave: true,
    });

    const template = createAgentRecipeTemplateFromExecutionNode(branch, {
      id: "saved-branch-template",
    });

    expect(template).toMatchObject({
      deliverableFormat:
        "单个 variant_branch 深化链 + critique + checkpoint + final_deliverable",
      inputSlots: expect.arrayContaining(["已验证分支方向", "深化目标"]),
      nodeStructure: [
        "user_goal",
        "recipe_plan",
        "variant_branch",
        "critique",
        "checkpoint",
        "final_deliverable",
      ],
      savedFromNodeId: "branch-a",
      toolSequence: expect.arrayContaining(["create_agent_variant_branches"]),
    });
    expect(template?.validationRules.join(" ")).toContain(
      "variant_branch 必须保留各自计划、产物和评审结论",
    );
  });

  it("preserves comparison siblings when saving a variant branch template from the active page graph", () => {
    const runId = "run-branch-comparison";
    const branchA = withAgentExecutionMeta(
      { id: "branch-a", type: "frame" } as PenNode,
      {
        branch: {
          isMainline: true,
          isRecommended: true,
          strengths: ["识别度高"],
        },
        branchId: "branch-a",
        branchLabel: "方向 A",
        kind: "variant_branch",
        runId,
        status: "done",
        title: "方向 A",
      },
    );
    const branchB = withAgentExecutionMeta(
      { id: "branch-b", type: "frame" } as PenNode,
      {
        branch: {
          isMainline: false,
          risks: ["制作成本高"],
        },
        branchId: "branch-b",
        branchLabel: "方向 B",
        kind: "variant_branch",
        runId,
        status: "done",
        title: "方向 B",
      },
    );
    const comparison = withAgentExecutionMeta(
      { id: "comparison-1", type: "frame" } as PenNode,
      {
        comparison: {
          branchNodeIds: ["branch-a", "branch-b"],
          recommendedBranchId: "branch-a",
          recommendationReason: "方向 A 更适合首发。",
        },
        kind: "comparison",
        runId,
        status: "done",
        title: "方案对比",
        upstreamNodeIds: ["branch-a", "branch-b"],
      },
    );

    const template = createAgentRecipeTemplateFromExecutionNode(branchA, {
      id: "saved-branch-comparison-template",
      relatedNodes: [comparison, branchB, branchA],
    });

    expect(template).toMatchObject({
      deliverableFormat: "variant_branch 节点 + comparison 推荐 + checkpoint",
      nodeStructure: ["variant_branch", "comparison"],
      savedSourceNodeIds: ["branch-a", "branch-b", "comparison-1"],
      toolSequence: expect.arrayContaining(["create_agent_variant_branches"]),
      validationRules: expect.arrayContaining([
        "comparison 节点必须保留推荐理由和未选分支",
        "variant_branch 必须保留各自计划、产物和评审结论",
      ]),
    });
  });

  it("does not save unfinished execution nodes as templates", () => {
    const node = withAgentExecutionMeta(
      {
        id: "task-1",
        type: "frame",
      } as PenNode,
      {
        kind: "task_step",
        status: "running",
        title: "Still running",
      },
    );

    expect(canSaveAgentExecutionNodeAsRecipeTemplate(node)).toMatchObject({
      canSave: false,
    });
    expect(createAgentRecipeTemplateFromExecutionNode(node)).toBeUndefined();
  });
});
