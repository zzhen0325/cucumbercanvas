import type {
  AgentRole,
  AgentRunContextPayload,
  AgentTeamMember,
  ModelCapability,
  ModelCapabilityProfile,
  PromptLayer,
  Styleguide,
} from "@cucumber/shared";

import type { ImageAttachment, MessageMention } from "@cucumber/shared";
import type { WorkspaceSkillEntry } from "./workspace-skills.js";

type BuildAgentRunContextInput = {
  attachments?: ImageAttachment[];
  brandKitId?: string | null;
  canvasSummary?: string | null;
  mentions?: MessageMention[];
  modelSpecifier: string;
  prompt: string;
  workspaceSkills?: WorkspaceSkillEntry[];
};

export function buildAgentRunContext(
  input: BuildAgentRunContextInput,
): AgentRunContextPayload {
  const profile = createModelCapabilityProfile(input.modelSpecifier);
  const styleguide = createRunStyleguide(input);
  const members = createAgentTeamMembers(profile.id);

  return {
    promptContext: {
      version: "agent-context-v1",
      layers: buildPromptLayers(input, styleguide),
    },
    ...(styleguide ? { styleguide } : {}),
    modelProfiles: [profile],
    team: {
      id: "cucumber-default-agent-team",
      name: "Cucumber Agent Team",
      members,
    },
  };
}

export function serializeAgentRunContextXml(
  context: AgentRunContextPayload,
): string {
  const layerXml = context.promptContext.layers
    .map(
      (layer) =>
        `<layer key="${escapeXmlAttribute(layer.key)}" source="${escapeXmlAttribute(layer.source)}" title="${escapeXmlAttribute(layer.title)}">\n${layer.content
          .map((item) => `  <item>${escapeXmlText(item)}</item>`)
          .join("\n")}\n</layer>`,
    )
    .join("\n");

  const teamXml = context.team.members
    .map(
      (member) =>
        `<agent role="${escapeXmlAttribute(member.role)}" display_name="${escapeXmlAttribute(member.displayName)}"${member.modelProfileId ? ` model_profile_id="${escapeXmlAttribute(member.modelProfileId)}"` : ""}>\n${member.responsibilities
          .map(
            (item) =>
              `  <responsibility>${escapeXmlText(item)}</responsibility>`,
          )
          .join("\n")}\n</agent>`,
    )
    .join("\n");

  const profileXml = context.modelProfiles
    .map(
      (profile) =>
        `<model_profile id="${escapeXmlAttribute(profile.id)}" provider="${escapeXmlAttribute(profile.provider)}" model="${escapeXmlAttribute(profile.model)}" cost_tier="${profile.costTier}" speed_tier="${profile.speedTier}" context_window="${profile.contextWindow}" tool_calls="${profile.supportsToolCalls}" vision="${profile.supportsVision}">\n  <strengths>${profile.strengths.map(escapeXmlText).join(", ")}</strengths>\n  <recommended_roles>${profile.recommendedRoles.map(escapeXmlText).join(", ")}</recommended_roles>\n</model_profile>`,
    )
    .join("\n");

  const styleguideXml = context.styleguide
    ? `<styleguide id="${escapeXmlAttribute(context.styleguide.id)}" name="${escapeXmlAttribute(context.styleguide.name)}" scope="${context.styleguide.scope}" source="${context.styleguide.source}">\n${styleguideLines(context.styleguide)}\n</styleguide>`
    : "";

  return `<agent_run_context version="${context.promptContext.version}">\n<prompt_layers>\n${layerXml}\n</prompt_layers>\n${styleguideXml ? `${styleguideXml}\n` : ""}<agent_team id="${escapeXmlAttribute(context.team.id)}" name="${escapeXmlAttribute(context.team.name)}">\n${teamXml}\n</agent_team>\n<model_profiles>\n${profileXml}\n</model_profiles>\n</agent_run_context>`;
}

function buildPromptLayers(
  input: BuildAgentRunContextInput,
  styleguide?: Styleguide,
): PromptLayer[] {
  const mentions = input.mentions ?? [];
  const attachments = input.attachments ?? [];
  const skillNames = input.workspaceSkills?.map((skill) => skill.name) ?? [];
  const brandAssets = mentions
    .filter((mention) => mention.mentionType === "brand-kit-asset")
    .map((mention) => `${mention.label} (${mention.assetType})`);

  return [
    {
      key: "user_goal",
      title: "User Goal",
      source: "user",
      content: [
        input.prompt.trim() ||
          "用户提交了一条空白目标，需要先请用户补充明确目标。",
      ],
    },
    {
      key: "project_context",
      title: "Project Context",
      source: "project",
      content: compactList([
        input.canvasSummary
          ? "当前画布摘要已注入，必须尊重已有容器、坐标、尺寸、连接关系和用户手动调整。"
          : "当前消息没有可用画布摘要；需要依赖用户目标和显式工具读取获得上下文。",
        input.brandKitId
          ? "项目绑定了 Brand Kit；设计相关任务必须先读取品牌信息再执行。"
          : undefined,
        brandAssets.length > 0
          ? `用户提及品牌资产：${brandAssets.join("、")}。`
          : undefined,
        attachments.length > 0
          ? `用户提供了 ${attachments.length} 个参考图像附件，可通过 asset_id 精确引用。`
          : undefined,
        skillNames.length > 0
          ? `工作区启用技能：${skillNames.join("、")}。`
          : undefined,
      ]),
    },
    {
      key: "style_intent",
      title: "Style Intent",
      source: styleguide ? "styleguide" : "system",
      content: styleguide
        ? describeStyleguide(styleguide)
        : [
            "未绑定持久化 Styleguide 时，以用户描述、Brand Kit、提及资产和现有画布视觉语言为唯一风格依据。",
          ],
    },
    {
      key: "layout_plan",
      title: "Layout Plan",
      source: "canvas",
      content: [
        "复杂输出先生成 root/section 容器，再把图片、文本、形状、视频、导出文件放入对应容器。",
        "容器位置表达推理顺序、依赖关系和数据流；新增内容优先放在现有内容右侧或下方的空白空间。",
      ],
    },
    {
      key: "execution_tasks",
      title: "Execution Tasks",
      source: "system",
      content: [
        "Planner 拆解目标和空间计划。",
        "Designer 生成可编辑画布结构和视觉内容。",
        "Researcher 只在事实或外部资料会改变结果时补充上下文。",
        "Coder/Exporter 在用户要求导出或代码产物时生成文件。",
        "Critic 按验收规则检查文字溢出、容器边界、品牌一致性和可继续性。",
      ],
    },
    {
      key: "critique_rules",
      title: "Critique Rules",
      source: "system",
      content: [
        "不得把复杂画布任务压成单条无结构回复；过程、草稿、工具调用和最终产物都应能被 run 事件复盘。",
        "不要在界面或结果里输出 null、undefined、错误码或空默认值；失败要说明具体原因和下一步。",
        "完成 3 个以上画布元素创建或大批量修改后，优先用 validate_canvas 或 inspect_canvas_semantic 验证结构；需要视觉证据时再使用 screenshot_canvas。",
      ],
    },
  ];
}

function createRunStyleguide(
  input: BuildAgentRunContextInput,
): Styleguide | undefined {
  const mentions = input.mentions ?? [];
  const brandAssets = mentions
    .filter((mention) => mention.mentionType === "brand-kit-asset")
    .map((mention) => mention.label);

  if (!input.brandKitId && brandAssets.length === 0) {
    return undefined;
  }

  return {
    id: input.brandKitId ?? "run-mentioned-brand-assets",
    name: input.brandKitId ? "Project Brand Kit" : "Mentioned Brand Assets",
    scope: "run",
    source: "brand-kit",
    tone: ["遵守品牌资产语气和视觉约束", "输出可编辑、可复盘的容器化结果"],
    layoutDensity: "balanced",
    disabledStyles: ["无依据的品牌色替换", "纯装饰性渐变背景", "文字溢出容器"],
    references:
      brandAssets.length > 0
        ? brandAssets.map((asset) => `Brand asset: ${asset}`)
        : ["Project Brand Kit"],
    componentPreferences: [
      "优先复用现有画布容器、组件、变量和 Cucumber structured canvas DSL 工具",
    ],
  };
}

function createModelCapabilityProfile(
  specifier: string,
): ModelCapabilityProfile {
  const colonIdx = specifier.indexOf(":");
  const provider = colonIdx > 0 ? specifier.slice(0, colonIdx) : "openai";
  const model = colonIdx > 0 ? specifier.slice(colonIdx + 1) : specifier;
  const lower = model.toLowerCase();
  const isFlash = lower.includes("flash") || lower.includes("mini");
  const isDeepSeek = provider === "deepseek" || lower.includes("deepseek");
  const isGemini = provider === "google" || lower.includes("gemini");

  const strengths: ModelCapability[] = [
    "planning",
    "visual_description",
    "critique",
    "tool_use",
  ];
  if (!isDeepSeek) strengths.push("code_generation");
  if (isGemini) strengths.push("long_context");

  return {
    id: `${provider}:${model}`,
    provider,
    model,
    strengths,
    costTier: isFlash || isDeepSeek ? "low" : "medium",
    speedTier: isFlash || isDeepSeek ? "fast" : "balanced",
    contextWindow: isGemini ? 1_000_000 : 128_000,
    supportsToolCalls: true,
    supportsVision: !isDeepSeek,
    recommendedRoles: [
      "orchestrator",
      "planner",
      "designer",
      "critic",
      "coder_exporter",
    ],
  };
}

function createAgentTeamMembers(modelProfileId: string): AgentTeamMember[] {
  const roles: Array<{
    role: AgentRole;
    displayName: string;
    responsibilities: string[];
  }> = [
    {
      role: "planner",
      displayName: "Planner",
      responsibilities: [
        "拆解用户目标",
        "生成空间/容器计划",
        "明确执行任务边界",
      ],
    },
    {
      role: "designer",
      displayName: "Designer",
      responsibilities: [
        "生成画布容器和视觉结构",
        "落实 Styleguide",
        "维护可编辑性",
      ],
    },
    {
      role: "critic",
      displayName: "Critic",
      responsibilities: [
        "检查品牌一致性",
        "检查文字溢出和空间关系",
        "提出修复 pass",
      ],
    },
    {
      role: "coder_exporter",
      displayName: "Coder/Exporter",
      responsibilities: [
        "按需导出 React/HTML/Vue",
        "记录导出警告",
        "保留可复盘产物",
      ],
    },
    {
      role: "researcher",
      displayName: "Researcher",
      responsibilities: ["仅在需要外部事实时研究", "把资料转化为可引用上下文"],
    },
  ];

  return roles.map((member) => ({
    ...member,
    modelProfileId,
  }));
}

function describeStyleguide(styleguide: Styleguide): string[] {
  return compactList([
    `Styleguide：${styleguide.name}（${styleguide.source} / ${styleguide.scope}）。`,
    styleguide.layoutDensity
      ? `布局密度：${styleguide.layoutDensity}。`
      : undefined,
    styleguide.tone?.length
      ? `语气：${styleguide.tone.join("、")}。`
      : undefined,
    styleguide.disabledStyles?.length
      ? `禁用风格：${styleguide.disabledStyles.join("、")}。`
      : undefined,
    styleguide.references?.length
      ? `参考：${styleguide.references.join("、")}。`
      : undefined,
    styleguide.componentPreferences?.length
      ? `组件偏好：${styleguide.componentPreferences.join("、")}。`
      : undefined,
  ]);
}

function styleguideLines(styleguide: Styleguide): string {
  return describeStyleguide(styleguide)
    .map((line) => `  <rule>${escapeXmlText(line)}</rule>`)
    .join("\n");
}

function compactList(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replaceAll('"', "&quot;");
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
