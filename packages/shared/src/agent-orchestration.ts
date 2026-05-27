import { z } from "zod";

import { runIdSchema, timestampSchema } from "./contracts.js";

export const agentRoleSchema = z.enum([
  "orchestrator",
  "planner",
  "designer",
  "critic",
  "coder_exporter",
  "researcher",
]);

export const promptLayerKeySchema = z.enum([
  "user_goal",
  "project_context",
  "style_intent",
  "layout_plan",
  "execution_tasks",
  "critique_rules",
]);

export const promptLayerSchema = z.object({
  key: promptLayerKeySchema,
  title: z.string().min(1),
  content: z.array(z.string().min(1)).min(1),
  source: z.enum(["user", "system", "project", "canvas", "styleguide"]),
});

export const layeredPromptContextSchema = z.object({
  version: z.literal("agent-context-v1"),
  layers: z.array(promptLayerSchema).min(1),
});

export const styleguideSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  scope: z.enum(["project", "page", "run"]),
  source: z.enum(["brand-kit", "user", "system"]),
  brandColors: z.array(z.string().min(1)).optional(),
  typography: z.array(z.string().min(1)).optional(),
  tone: z.array(z.string().min(1)).optional(),
  layoutDensity: z.enum(["dense", "balanced", "spacious"]).optional(),
  disabledStyles: z.array(z.string().min(1)).optional(),
  references: z.array(z.string().min(1)).optional(),
  componentPreferences: z.array(z.string().min(1)).optional(),
});

export const modelCapabilitySchema = z.enum([
  "planning",
  "visual_description",
  "code_generation",
  "critique",
  "research",
  "tool_use",
  "long_context",
]);

export const modelCapabilityProfileSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  strengths: z.array(modelCapabilitySchema).min(1),
  costTier: z.enum(["low", "medium", "high"]),
  speedTier: z.enum(["fast", "balanced", "slow"]),
  contextWindow: z.number().int().positive(),
  supportsToolCalls: z.boolean(),
  supportsVision: z.boolean(),
  recommendedRoles: z.array(agentRoleSchema).min(1),
});

export const agentTeamMemberSchema = z.object({
  role: agentRoleSchema,
  displayName: z.string().min(1),
  responsibilities: z.array(z.string().min(1)).min(1),
  modelProfileId: z.string().min(1).optional(),
});

export const agentTeamPlanSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  members: z.array(agentTeamMemberSchema).min(1),
});

export const agentRunContextPayloadSchema = z.object({
  promptContext: layeredPromptContextSchema,
  styleguide: styleguideSchema.optional(),
  modelProfiles: z.array(modelCapabilityProfileSchema).min(1),
  team: agentTeamPlanSchema,
});

export const runContextEventSchema = z.object({
  type: z.literal("run.context"),
  runId: runIdSchema,
  timestamp: timestampSchema,
  context: agentRunContextPayloadSchema,
});

export const agentStageEventSchema = z.object({
  type: z.literal("agent.stage"),
  runId: runIdSchema,
  stageId: z.string().min(1),
  stage: z.enum([
    "prompt_layering",
    "planning",
    "research",
    "design",
    "tool_execution",
    "critique",
    "export",
    "replay_checkpoint",
  ]),
  status: z.enum(["started", "completed", "failed", "blocked"]),
  role: agentRoleSchema.optional(),
  summary: z.string().min(1).optional(),
  tasks: z.array(z.string().min(1)).optional(),
  timestamp: timestampSchema,
});

export type AgentRole = z.infer<typeof agentRoleSchema>;
export type PromptLayerKey = z.infer<typeof promptLayerKeySchema>;
export type PromptLayer = z.infer<typeof promptLayerSchema>;
export type LayeredPromptContext = z.infer<typeof layeredPromptContextSchema>;
export type Styleguide = z.infer<typeof styleguideSchema>;
export type ModelCapability = z.infer<typeof modelCapabilitySchema>;
export type ModelCapabilityProfile = z.infer<
  typeof modelCapabilityProfileSchema
>;
export type AgentTeamMember = z.infer<typeof agentTeamMemberSchema>;
export type AgentTeamPlan = z.infer<typeof agentTeamPlanSchema>;
export type AgentRunContextPayload = z.infer<
  typeof agentRunContextPayloadSchema
>;
export type RunContextEvent = z.infer<typeof runContextEventSchema>;
export type AgentStageEvent = z.infer<typeof agentStageEventSchema>;
