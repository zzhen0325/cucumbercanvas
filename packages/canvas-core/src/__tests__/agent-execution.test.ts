import { describe, expect, it } from "vitest";
import {
  AGENT_EXECUTION_CANVAS_LAYOUT_VERSION,
  createAgentInputNode,
  createAgentRunNode,
  getAgentExecutionNodePresentationUpdates,
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
      summary: "正在拆解执行计划。",
    });
    expect(textContents(stepNode)).toEqual([]);

    const secondPass = normalizeAgentExecutionCanvasLayout(migrated.doc);
    expect(secondPass.changed).toBe(false);
    expect(secondPass.migratedNodeIds).toEqual([]);
  });

  it("creates a native execution container without canvas text children", () => {
    const node = createAgentRunNode({
      summary: "Thinking...",
      x: 120,
      y: 240,
    });

    expect(node).toMatchObject({
      height: 148,
      width: 240,
    });
    expect(getAgentExecutionMeta(node)).toMatchObject({
      canvasPresentation: {
        collapsed: false,
        layoutVersion: AGENT_EXECUTION_CANVAS_LAYOUT_VERSION,
      },
      kind: "agent_run_node",
      status: "running",
    });
    expect(node.children).toEqual([]);
    expect(node.meta?.agentExecutionContainer).toMatchObject({
      containerId: node.id,
      kind: "agent_run_node",
      status: "running",
      summary: "Thinking...",
      title: "AgentRunNode",
    });
    expect(textContents(node)).toEqual([]);
  });

  it("creates InputNode as the Agent-first input container", () => {
    const node = createAgentInputNode({
      text: "生成一张产品海报",
      x: 120,
      y: 180,
    });

    expect(node).toMatchObject({
      id: expect.stringMatching(/^agent_input_node_/),
      name: "InputNode",
      type: "frame",
      width: 240,
    });
    expect(getAgentExecutionMeta(node)).toMatchObject({
      canvasPresentation: {
        collapsed: false,
        layoutVersion: AGENT_EXECUTION_CANVAS_LAYOUT_VERSION,
      },
      kind: "input_node",
      status: "waiting",
      summary: "生成一张产品海报",
      title: "InputNode",
    });
    expect(textContents(node)).toEqual([]);
  });

  it("updates InputNode presentation without duplicating canvas text children", () => {
    const node = createAgentInputNode({
      text: "生成一张产品海报",
      x: 120,
      y: 180,
    });
    const legacyDisplayText = {
      content: "旧的展示文本",
      id: `${node.id}__user_input_text`,
      name: "InputNode 内容",
      type: "text",
      x: 0,
      y: 0,
    } as PenNode;
    const realChild = {
      height: 24,
      id: "real-child",
      name: "真实子节点",
      type: "rectangle",
      width: 24,
      x: 4,
      y: 4,
    } as PenNode;
    const nodeWithLegacyChild = {
      ...node,
      children: [legacyDisplayText, realChild],
    } as PenNode;
    const execution = getAgentExecutionMeta(nodeWithLegacyChild);
    if (!execution) throw new Error("expected InputNode execution metadata");

    const updates = getAgentExecutionNodePresentationUpdates({
      execution: {
        ...execution,
        status: "done",
        summary: "换一张更暖色的产品海报",
      },
      node: nodeWithLegacyChild,
      width: 240,
    });

    expect(textContents(updates as PenNode)).toEqual([]);
    expect(updates.children).toEqual([realChild]);
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
      kind: "input_node",
      schemaVersion: 1,
      status: "waiting",
      summary: "生成一张小狗插画。",
      title: "InputNode",
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
