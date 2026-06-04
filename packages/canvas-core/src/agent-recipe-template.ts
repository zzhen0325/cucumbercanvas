import type { PenNode } from "@cucumber/pen-types";

import {
  type AgentExecutionNodeKind,
  type AgentExecutionNodeMeta,
  getAgentExecutionKindLabel,
  getAgentExecutionMeta,
} from "./agent-execution.js";

export type AgentRecipeTemplateId =
  | "brand-visual-exploration"
  | "poster-multi-variant"
  | "product-image-generation"
  | "storyboard-script"
  | "webpage-design"
  | "design-to-code"
  | (string & {});

export type AgentRecipeTemplate = {
  id: AgentRecipeTemplateId;
  title: string;
  summary: string;
  defaultPrompt: string;
  nodeStructure: string[];
  toolSequence: string[];
  inputSlots: string[];
  validationRules: string[];
  deliverableFormat: string;
  source?: "builtin" | "saved_execution_chain";
  savedFromNodeId?: string;
  savedSourceNodeIds?: string[];
  savedAt?: string;
};

type AgentRecipeTemplateSourceNode = Pick<PenNode, "id" | "meta" | "name">;

type AgentRecipeTemplateGraphNode = {
  execution: AgentExecutionNodeMeta;
  node: AgentRecipeTemplateSourceNode;
};

export const DEFAULT_AGENT_RECIPE_TEMPLATES: AgentRecipeTemplate[] = [
  {
    id: "brand-visual-exploration",
    title: "品牌视觉探索",
    summary: "生成多方向品牌视觉方案并沉淀主线。",
    defaultPrompt:
      "使用「品牌视觉探索」Recipe：围绕我的品牌目标生成 3 个视觉方向，比较优缺点，并推荐一个可继续深化的主线。",
    nodeStructure: [
      "user_goal",
      "recipe_plan",
      "variant_branch",
      "critique",
      "comparison",
      "checkpoint",
      "final_deliverable",
    ],
    toolSequence: [
      "inspect_canvas_semantic",
      "create_agent_execution_flow",
      "create_agent_variant_branches",
      "critique_canvas",
      "select_agent_variant_branch",
    ],
    inputSlots: ["品牌名称", "目标用户", "品牌调性", "参考图或现有画布节点"],
    validationRules: [
      "每个方向必须有清晰适用场景和风险",
      "comparison 节点必须给出推荐理由",
      "推荐分支必须保留其他未选分支",
    ],
    deliverableFormat:
      "3 个 variant_branch + 1 个 comparison + 推荐主线 checkpoint",
  },
  {
    id: "poster-multi-variant",
    title: "海报多方案",
    summary: "生成海报方向、比较构图，并从主线继续精修。",
    defaultPrompt:
      "使用「海报多方案」Recipe：为这个主题生成 3 个海报方案，包含构图、主视觉、文案层级、风险评审和推荐方案。",
    nodeStructure: [
      "user_goal",
      "recipe_plan",
      "variant_branch",
      "tool_call",
      "critique",
      "comparison",
      "checkpoint",
      "final_deliverable",
    ],
    toolSequence: [
      "inspect_canvas_semantic",
      "create_agent_execution_flow",
      "create_agent_variant_branches",
      "layout_canvas",
      "critique_canvas",
    ],
    inputSlots: ["活动主题", "尺寸比例", "核心文案", "风格参考", "禁用元素"],
    validationRules: [
      "方案之间必须有明显构图差异",
      "文案层级必须可读",
      "最终推荐必须说明适合投放场景",
    ],
    deliverableFormat: "多方案海报画布节点 + comparison + 可重跑 checkpoint",
  },
  {
    id: "product-image-generation",
    title: "产品图生成",
    summary: "从产品目标到生成图容器、评审和可继续 checkpoint。",
    defaultPrompt:
      "使用「产品图生成」Recipe：基于产品信息生成产品图方向，写出图像提示词，生成结果容器，并评审可改进点。",
    nodeStructure: [
      "user_goal",
      "recipe_plan",
      "task_step",
      "tool_call",
      "critique",
      "checkpoint",
      "final_deliverable",
    ],
    toolSequence: [
      "inspect_canvas_semantic",
      "create_agent_execution_flow",
      "generate_image",
      "critique_canvas",
    ],
    inputSlots: ["产品名称", "卖点", "画面场景", "尺寸比例", "参考图片"],
    validationRules: [
      "提示词必须区分主体、场景、光线和构图",
      "生成结果必须写入 final_deliverable 容器",
      "critique 节点必须说明下一轮修改方向",
    ],
    deliverableFormat: "产品图执行链 + 图像结果容器 + critique + checkpoint",
  },
  {
    id: "storyboard-script",
    title: "分镜脚本",
    summary: "把视频创意拆成场景、镜头和后续生成节点。",
    defaultPrompt:
      "使用「分镜脚本」Recipe：把这个视频创意拆成分镜脚本，包含场景目标、镜头描述、旁白/字幕和生成风险。",
    nodeStructure: [
      "user_goal",
      "recipe_plan",
      "task_step",
      "evidence",
      "critique",
      "checkpoint",
      "final_deliverable",
    ],
    toolSequence: [
      "inspect_canvas_semantic",
      "create_agent_execution_flow",
      "generate_storyboard",
      "critique_canvas",
      "export_canvas_deliverable",
    ],
    inputSlots: ["视频主题", "时长", "目标平台", "视觉风格", "必须出现的元素"],
    validationRules: [
      "每个镜头必须有目的和转场关系",
      "旁白/字幕不能和画面目标冲突",
      "checkpoint 必须支持从任意场景继续生成",
    ],
    deliverableFormat: "分镜节点链 + 场景产物 + 可导出 storyboard spec",
  },
  {
    id: "webpage-design",
    title: "网页设计",
    summary: "从目标到页面结构、视觉方案、评审和交付规格。",
    defaultPrompt:
      "使用「网页设计」Recipe：为这个产品/活动设计一个网页，生成结构、视觉方向、关键模块、评审和最终页面规格。",
    nodeStructure: [
      "user_goal",
      "recipe_plan",
      "task_step",
      "tool_call",
      "critique",
      "checkpoint",
      "final_deliverable",
    ],
    toolSequence: [
      "inspect_canvas_semantic",
      "create_agent_execution_flow",
      "layout_canvas",
      "critique_canvas",
      "export_canvas_deliverable",
    ],
    inputSlots: [
      "产品/活动名称",
      "目标用户",
      "首屏信息",
      "页面模块",
      "品牌限制",
    ],
    validationRules: [
      "首屏必须能表达产品/活动对象",
      "模块层级必须能落到画布容器",
      "final_deliverable 必须可导出 component_spec 或 flow_spec",
    ],
    deliverableFormat: "页面结构画布 + critique + component/flow spec",
  },
  {
    id: "design-to-code",
    title: "设计转代码",
    summary: "从设计节点读取、验证、导出规格并生成实现计划。",
    defaultPrompt:
      "使用「设计转代码」Recipe：读取我选中的设计节点，验证结构和资产，导出实现规格，并生成可继续的代码实现计划。",
    nodeStructure: [
      "user_goal",
      "recipe_plan",
      "evidence",
      "task_step",
      "critique",
      "checkpoint",
      "final_deliverable",
    ],
    toolSequence: [
      "get_selection_context",
      "inspect_canvas_semantic",
      "validate_canvas",
      "export_canvas_deliverable",
      "create_agent_execution_flow",
    ],
    inputSlots: ["选中设计节点", "目标框架", "响应式要求", "交付代码格式"],
    validationRules: [
      "必须先读取 live PenDocument.pages 选区",
      "旧字段或诊断信息不得参与运行时决策",
      "导出规格必须带 source node ids",
    ],
    deliverableFormat: "设计证据节点 + 验证节点 + 实现计划 + deliverable spec",
  },
];

export function getAgentRecipeTemplateById(
  id: string,
): AgentRecipeTemplate | undefined {
  return DEFAULT_AGENT_RECIPE_TEMPLATES.find((template) => template.id === id);
}

export function canSaveAgentExecutionNodeAsRecipeTemplate(
  node: Pick<PenNode, "id" | "meta"> | null | undefined,
): { canSave: boolean; reason?: string } {
  const execution = getAgentExecutionMeta(node);
  if (!execution) {
    return {
      canSave: false,
      reason: "先选中一个 Agent 执行节点。",
    };
  }
  if (execution.status !== "done") {
    return {
      canSave: false,
      reason: "只有已完成的执行节点才能保存为 Recipe 模板。",
    };
  }
  if (
    execution.kind !== "checkpoint" &&
    execution.kind !== "final_deliverable" &&
    execution.kind !== "comparison" &&
    execution.kind !== "variant_branch" &&
    execution.kind !== "recipe_plan"
  ) {
    return {
      canSave: false,
      reason:
        "请选择已完成的 Recipe、方案分支、方案对比、checkpoint 或最终交付物节点保存模板。",
    };
  }
  return { canSave: true };
}

export function createAgentRecipeTemplateFromExecutionNode(
  node: AgentRecipeTemplateSourceNode,
  options: {
    id?: string;
    now?: () => string;
    relatedNodes?: AgentRecipeTemplateSourceNode[];
    title?: string;
  } = {},
): AgentRecipeTemplate | undefined {
  const execution = getAgentExecutionMeta(node);
  if (!execution) return undefined;
  const saveState = canSaveAgentExecutionNodeAsRecipeTemplate(node);
  if (!saveState.canSave) return undefined;

  const savedAt = options.now?.() ?? new Date().toISOString();
  const sourceGraph = collectAgentRecipeTemplateSourceGraph(
    node,
    options.relatedNodes,
  );
  const sourceExecutions = sourceGraph.map((item) => item.execution);
  const title =
    options.title?.trim() ||
    `保存的 Recipe：${execution.title || node.name || getAgentExecutionKindLabel(execution.kind)}`;
  return {
    deliverableFormat: inferDeliverableFormat(execution, sourceExecutions),
    defaultPrompt: `使用「${title}」Recipe：基于已保存的${sourceGraph.length > 1 ? "执行链图谱" : "执行链结构"}启动新的任务，并按模板的节点结构、工具顺序、验证规则和交付格式生成可继续的画布执行链。`,
    id:
      options.id ??
      `saved-${node.id}-${savedAt.replace(/[^a-zA-Z0-9]+/g, "-")}`,
    inputSlots: inferInputSlots(execution, sourceExecutions),
    nodeStructure: inferNodeStructure(execution, sourceExecutions),
    savedAt,
    savedFromNodeId: node.id,
    savedSourceNodeIds: sourceGraph.map((item) => item.node.id),
    source: "saved_execution_chain",
    summary: inferTemplateSummary(execution, sourceExecutions),
    title,
    toolSequence: inferToolSequence(execution, sourceExecutions),
    validationRules: inferValidationRules(execution, sourceExecutions),
  };
}

export function formatAgentRecipeTemplatePromptBlock(
  template: AgentRecipeTemplate,
): string {
  const isSavedTemplate = template.source === "saved_execution_chain";
  return [
    "<agent_recipe_template>",
    `template_id: ${template.id}`,
    `template_source: ${template.source ?? "builtin"}`,
    `startup_mode: ${
      isSavedTemplate ? "new_execution_chain_instance" : "template_starter"
    }`,
    `title: ${sanitizeTemplateLine(template.title)}`,
    `summary: ${sanitizeTemplateLine(template.summary)}`,
    `node_structure: ${template.nodeStructure.join(" -> ")}`,
    `tool_sequence: ${template.toolSequence.join(" -> ")}`,
    `input_slots: ${template.inputSlots.map(sanitizeTemplateLine).join(" | ")}`,
    "input_slot_policy: Treat input_slots as required user/workflow inputs. If the current user message and live canvas context do not provide enough information for a required slot, create a durable ask_user_more node for the missing inputs before inventing values or continuing.",
    `validation_rules: ${template.validationRules
      .map(sanitizeTemplateLine)
      .join(" | ")}`,
    `deliverable_format: ${sanitizeTemplateLine(template.deliverableFormat)}`,
    ...(template.savedFromNodeId
      ? [`saved_from_node_id: ${template.savedFromNodeId}`]
      : []),
    ...(template.savedSourceNodeIds?.length
      ? [`saved_source_nodes: ${template.savedSourceNodeIds.join(" -> ")}`]
      : []),
    isSavedTemplate
      ? "source_node_policy: saved_source_nodes are provenance from the old successful chain. Do not edit, overwrite, or treat them as the runtime target unless the user also references those live node IDs explicitly."
      : undefined,
    "instruction: Start by creating a durable Agent Execution Canvas chain from this template. If an <agent_execution_continue_context> is also present, apply the template to that continuation target after inspecting live PenDocument.pages; otherwise create a new execution-chain instance. Treat node_structure, tool_sequence, input_slots, validation_rules, and deliverable_format as the reusable workflow contract. The template describes expected PenNode/meta.agentExecution structure, not a separate runtime state.",
    "</agent_recipe_template>",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function formatAgentRecipeTemplateStartPrompt(
  template: AgentRecipeTemplate,
): string {
  return appendAgentRecipeTemplateInputSlotChecklist(
    template.defaultPrompt,
    template,
  );
}

export function appendAgentRecipeTemplateInputSlotChecklist(
  prompt: string,
  template: AgentRecipeTemplate,
): string {
  const inputSlots = template.inputSlots
    .map(sanitizeTemplateLine)
    .filter((slot) => slot.length > 0);
  const trimmedPrompt = prompt.trim();
  if (inputSlots.length === 0 || trimmedPrompt.includes("待补输入：")) {
    return prompt;
  }
  return [
    prompt,
    "",
    "待补输入：",
    ...inputSlots.map((slot) => `- ${slot}：`),
    "如果暂时缺少某些信息，可以直接发送；Agent 会在画布上创建 ask_user_more 节点继续收集。",
  ].join("\n");
}

function sanitizeTemplateLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function collectAgentRecipeTemplateSourceGraph(
  selectedNode: AgentRecipeTemplateSourceNode,
  relatedNodes: AgentRecipeTemplateSourceNode[] | undefined,
): AgentRecipeTemplateGraphNode[] {
  const selectedExecution = getAgentExecutionMeta(selectedNode);
  if (!selectedExecution) return [];
  const allNodes = uniqueNodesById([selectedNode, ...(relatedNodes ?? [])]);
  const executionByNodeId = new Map<string, AgentExecutionNodeMeta>();
  const nodeById = new Map<string, AgentRecipeTemplateSourceNode>();
  for (const node of allNodes) {
    const execution = getAgentExecutionMeta(node);
    if (!execution || execution.status !== "done") continue;
    if (!isSameExecutionScope(selectedExecution, execution)) continue;
    executionByNodeId.set(node.id, execution);
    nodeById.set(node.id, node);
  }
  if (!executionByNodeId.has(selectedNode.id)) {
    return [{ execution: selectedExecution, node: selectedNode }];
  }

  const visited = new Set<string>();
  const queue = [selectedNode.id];
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId)) continue;
    const execution = executionByNodeId.get(nodeId);
    if (!execution) continue;
    visited.add(nodeId);
    for (const neighborId of getExecutionNeighborIds(
      nodeId,
      executionByNodeId,
    )) {
      if (!visited.has(neighborId)) queue.push(neighborId);
    }
  }

  const graphNodes = Array.from(visited)
    .map((nodeId) => {
      const node = nodeById.get(nodeId);
      const execution = executionByNodeId.get(nodeId);
      if (!node || !execution) return null;
      return { execution, node };
    })
    .filter((item): item is AgentRecipeTemplateGraphNode => Boolean(item));
  return orderAgentRecipeTemplateGraphNodes(graphNodes);
}

function getExecutionNeighborIds(
  nodeId: string,
  executionByNodeId: Map<string, AgentExecutionNodeMeta>,
): string[] {
  const execution = executionByNodeId.get(nodeId);
  if (!execution) return [];
  const neighbors = new Set<string>([
    ...(execution.upstreamNodeIds ?? []),
    ...(execution.downstreamNodeIds ?? []),
  ]);
  for (const [candidateId, candidateExecution] of executionByNodeId) {
    if (
      candidateExecution.upstreamNodeIds?.includes(nodeId) ||
      candidateExecution.downstreamNodeIds?.includes(nodeId)
    ) {
      neighbors.add(candidateId);
    }
  }
  return Array.from(neighbors).filter((neighborId) =>
    executionByNodeId.has(neighborId),
  );
}

function orderAgentRecipeTemplateGraphNodes(
  graphNodes: AgentRecipeTemplateGraphNode[],
): AgentRecipeTemplateGraphNode[] {
  const nodeIds = new Set(graphNodes.map((item) => item.node.id));
  const byId = new Map(graphNodes.map((item) => [item.node.id, item]));
  const incomingById = new Map<string, Set<string>>();
  const outgoingById = new Map<string, Set<string>>();

  for (const item of graphNodes) {
    incomingById.set(item.node.id, new Set());
    outgoingById.set(item.node.id, new Set());
  }
  for (const item of graphNodes) {
    const downstreamIds = new Set(item.execution.downstreamNodeIds ?? []);
    for (const candidate of graphNodes) {
      if (candidate.node.id === item.node.id) continue;
      if (
        downstreamIds.has(candidate.node.id) ||
        candidate.execution.upstreamNodeIds?.includes(item.node.id)
      ) {
        outgoingById.get(item.node.id)?.add(candidate.node.id);
        incomingById.get(candidate.node.id)?.add(item.node.id);
      }
    }
  }

  const ordered: AgentRecipeTemplateGraphNode[] = [];
  const ready = graphNodes
    .filter((item) => incomingById.get(item.node.id)?.size === 0)
    .map((item) => item.node.id);
  const originalIndex = new Map(
    graphNodes.map((item, index) => [item.node.id, index]),
  );
  ready.sort((left, right) => {
    return (originalIndex.get(left) ?? 0) - (originalIndex.get(right) ?? 0);
  });

  while (ready.length > 0) {
    const nodeId = ready.shift();
    const item = nodeId ? byId.get(nodeId) : undefined;
    if (!nodeId || !item) continue;
    ordered.push(item);
    for (const downstreamId of outgoingById.get(nodeId) ?? []) {
      const incoming = incomingById.get(downstreamId);
      incoming?.delete(nodeId);
      if (incoming?.size === 0) ready.push(downstreamId);
    }
    ready.sort((left, right) => {
      return (originalIndex.get(left) ?? 0) - (originalIndex.get(right) ?? 0);
    });
  }

  if (ordered.length === graphNodes.length) return ordered;
  const orderedIds = new Set(ordered.map((item) => item.node.id));
  return [
    ...ordered,
    ...graphNodes.filter(
      (item) => nodeIds.has(item.node.id) && !orderedIds.has(item.node.id),
    ),
  ];
}

function isSameExecutionScope(
  selectedExecution: AgentExecutionNodeMeta,
  candidateExecution: AgentExecutionNodeMeta,
): boolean {
  if (
    selectedExecution.runId &&
    candidateExecution.runId &&
    selectedExecution.runId !== candidateExecution.runId
  ) {
    return false;
  }
  if (
    selectedExecution.sessionId &&
    candidateExecution.sessionId &&
    selectedExecution.sessionId !== candidateExecution.sessionId
  ) {
    return false;
  }
  return true;
}

function uniqueNodesById(
  nodes: AgentRecipeTemplateSourceNode[],
): AgentRecipeTemplateSourceNode[] {
  const seen = new Set<string>();
  const uniqueNodes: AgentRecipeTemplateSourceNode[] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    uniqueNodes.push(node);
  }
  return uniqueNodes;
}

function inferNodeStructure(
  execution: AgentExecutionNodeMeta,
  sourceExecutions: AgentExecutionNodeMeta[] = [],
): string[] {
  if (sourceExecutions.length > 1) {
    return uniqueStrings(sourceExecutions.map((item) => item.kind));
  }
  if (execution.kind === "comparison") {
    return [
      "user_goal",
      "recipe_plan",
      "variant_branch",
      "comparison",
      "critique",
      "checkpoint",
      "final_deliverable",
    ];
  }
  if (execution.kind === "variant_branch") {
    return [
      "user_goal",
      "recipe_plan",
      "variant_branch",
      "critique",
      "checkpoint",
      "final_deliverable",
    ];
  }
  if (execution.kind === "final_deliverable") {
    return [
      "user_goal",
      "recipe_plan",
      "task_step",
      "tool_call",
      "critique",
      "checkpoint",
      "final_deliverable",
    ];
  }
  if (execution.kind === "checkpoint") {
    return [
      "user_goal",
      "recipe_plan",
      "task_step",
      "tool_call",
      "critique",
      "checkpoint",
    ];
  }
  return uniqueStrings(["user_goal", "recipe_plan", execution.kind]);
}

function inferToolSequence(
  execution: AgentExecutionNodeMeta,
  sourceExecutions: AgentExecutionNodeMeta[] = [],
): string[] {
  if (sourceExecutions.length > 1) {
    return uniqueStrings(
      [
        "inspect_canvas_semantic",
        "create_agent_execution_flow",
        ...sourceExecutions
          .map((item) => item.toolName)
          .filter((toolName): toolName is string => Boolean(toolName)),
        sourceExecutions.some((item) => item.kind === "variant_branch")
          ? "create_agent_variant_branches"
          : null,
        sourceExecutions.some((item) => item.kind === "evidence")
          ? "create_agent_evidence"
          : null,
        sourceExecutions.some((item) => item.kind === "ask_user_more")
          ? "create_agent_ask_user_more"
          : null,
        sourceExecutions.some((item) => item.kind === "critique")
          ? "critique_canvas"
          : null,
      ].filter((tool): tool is string => Boolean(tool)),
    );
  }
  const tools = [
    "inspect_canvas_semantic",
    "create_agent_execution_flow",
    execution.toolName,
    execution.kind === "comparison" ? "create_agent_variant_branches" : null,
    execution.kind === "variant_branch"
      ? "create_agent_variant_branches"
      : null,
    execution.kind === "evidence" ? "create_agent_evidence" : null,
    execution.kind === "ask_user_more" ? "create_agent_ask_user_more" : null,
    "critique_canvas",
  ].filter((tool): tool is string => Boolean(tool));
  return uniqueStrings(tools);
}

function inferInputSlots(
  execution: AgentExecutionNodeMeta,
  sourceExecutions: AgentExecutionNodeMeta[] = [],
): string[] {
  const slots = ["用户目标", "当前画布上下文"];
  const kinds = new Set(sourceExecutions.map((item) => item.kind));
  if (execution.kind === "comparison" || kinds.has("comparison")) {
    slots.push("方案数量", "评估标准");
  }
  if (execution.kind === "variant_branch") {
    slots.push("已验证分支方向", "深化目标");
  }
  if (
    execution.kind === "final_deliverable" ||
    kinds.has("final_deliverable")
  ) {
    slots.push("交付格式", "质量要求");
  }
  if (execution.kind === "checkpoint" || kinds.has("checkpoint")) {
    slots.push("继续/重跑起点", "新增约束");
  }
  if (kinds.has("evidence")) {
    slots.push("参考资料或资产");
  }
  if (kinds.has("ask_user_more")) {
    slots.push("用户补充信息");
  }
  if (kinds.has("variant_branch")) {
    slots.push("分支方向约束");
  }
  return slots;
}

function inferValidationRules(
  execution: AgentExecutionNodeMeta,
  sourceExecutions: AgentExecutionNodeMeta[] = [],
): string[] {
  const executions =
    sourceExecutions.length > 0 ? sourceExecutions : [execution];
  const rules = [
    "必须先读取 live PenDocument.pages 上下文",
    "必须把 Recipe、关键步骤、评审和 checkpoint 落为 meta.agentExecution 节点",
    "不能删除未选方案分支或用户手动调整过的节点",
  ];
  if (
    executions.some((item) => item.comparison || item.kind === "comparison")
  ) {
    rules.push("comparison 节点必须保留推荐理由和未选分支");
  }
  if (executions.some((item) => item.kind === "variant_branch")) {
    rules.push("variant_branch 必须保留各自计划、产物和评审结论");
  }
  if (executions.some((item) => item.kind === "evidence")) {
    rules.push("evidence 节点必须保留来源类型、URL/资产/节点引用和可信度");
  }
  if (executions.some((item) => item.kind === "ask_user_more")) {
    rules.push("ask_user_more 节点必须记录等待提示、文件要求和用户补充结果");
  }
  if (executions.some((item) => item.kind === "critique")) {
    rules.push("critique 节点必须说明问题、风险和下一步改进方向");
  }
  if (executions.some((item) => item.checkpoint?.canRestartFromHere)) {
    rules.push("checkpoint 必须可从此处继续或重跑下游链路");
  }
  if (execution.summary) {
    rules.push(`复用原执行链目标：${sanitizeTemplateLine(execution.summary)}`);
  }
  return rules;
}

function inferDeliverableFormat(
  execution: AgentExecutionNodeMeta,
  sourceExecutions: AgentExecutionNodeMeta[] = [],
): string {
  const kinds = new Set(sourceExecutions.map((item) => item.kind));
  if (kinds.has("comparison") && kinds.has("final_deliverable")) {
    return "variant_branch/comparison 决策链 + critique + checkpoint + final_deliverable";
  }
  if (kinds.has("evidence") || kinds.has("ask_user_more")) {
    return "带 evidence / ask_user_more 上下文的可继续执行链 + checkpoint";
  }
  if (kinds.has("comparison")) {
    return "variant_branch 节点 + comparison 推荐 + checkpoint";
  }
  if (kinds.has("final_deliverable")) {
    return "final_deliverable 容器 + critique + checkpoint";
  }
  switch (execution.kind) {
    case "comparison":
      return "variant_branch 节点 + comparison 推荐 + checkpoint";
    case "variant_branch":
      return "单个 variant_branch 深化链 + critique + checkpoint + final_deliverable";
    case "final_deliverable":
      return "final_deliverable 容器 + critique + checkpoint";
    case "checkpoint":
      return "可继续/可重跑 checkpoint + 下游执行链";
    case "recipe_plan":
      return "Recipe 计划 + task/tool/critique/final/checkpoint 链路";
    default:
      return `${getAgentExecutionKindLabel(execution.kind)} 执行链`;
  }
}

function inferTemplateSummary(
  execution: AgentExecutionNodeMeta,
  sourceExecutions: AgentExecutionNodeMeta[] = [],
): string {
  const kind = getAgentExecutionKindLabel(execution.kind);
  if (sourceExecutions.length > 1) {
    return `从已完成的${sourceExecutions.length}个节点执行链图谱「${sanitizeTemplateLine(execution.title)}」保存的可复用模板。`;
  }
  return `从已完成的${kind}「${sanitizeTemplateLine(execution.title)}」保存的可复用执行链模板。`;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}
