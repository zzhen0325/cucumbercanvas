import { randomUUID } from "node:crypto";

import {
  type AgentTaskPlan,
  type AgentTaskStep,
  agentTaskPlanSchema,
} from "@cucumber/shared";
import { z } from "zod";

import type { CucumberMcpTool } from "../types.js";
import { schemaToJsonSchema } from "../utils.js";

const taskTargetInputSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("selection"),
      elementIds: z.array(z.string().min(1)).default([]),
    }),
    z.object({
      kind: z.literal("elementIds"),
      elementIds: z.array(z.string().min(1)).min(1),
    }),
    z.object({
      kind: z.literal("region"),
      bounds: z.object({
        x: z.number(),
        y: z.number(),
        width: z.number().positive(),
        height: z.number().positive(),
      }),
    }),
    z.object({
      kind: z.literal("new_container"),
      label: z.string().min(1).optional(),
      bounds: z
        .object({
          x: z.number(),
          y: z.number(),
          width: z.number().positive(),
          height: z.number().positive(),
        })
        .optional(),
    }),
  ])
  .optional();

const publishTaskPlanSchema = z.object({
  planId: z.string().min(1).optional(),
  title: z.string().min(1).describe("Short user-facing title for this task."),
  summary: z
    .string()
    .min(1)
    .optional()
    .describe("Brief explanation of what will happen."),
  steps: z
    .array(
      z.object({
        stepId: z.string().min(1).optional(),
        title: z.string().min(1),
        description: z.string().min(1).optional(),
        target: taskTargetInputSchema,
        agentName: z.string().min(1).optional(),
      }),
    )
    .min(1)
    .describe("Ordered steps that the user can inspect on the canvas."),
});

type PublishTaskPlanInput = z.infer<typeof publishTaskPlanSchema>;

export function createPublishTaskPlanMcpTool(): CucumberMcpTool {
  return {
    name: "publish_task_plan",
    description:
      "Publish a typed task plan before running multi-step canvas or generation work. Use this to make the agent workflow visible in the Agent Flow container.",
    schema: publishTaskPlanSchema,
    inputSchema: schemaToJsonSchema(publishTaskPlanSchema),
    execute: async (args, context) => {
      const input = publishTaskPlanSchema.parse(args);
      const plan = normalizePlan(input);
      const runId =
        typeof context.configurable?.run_id === "string"
          ? context.configurable.run_id
          : undefined;

      console.log("[mcp] task_plan.publish", {
        planId: plan.planId,
        runId,
        stepCount: plan.steps.length,
      });

      return {
        content: [
          {
            type: "text",
            text: `Published task plan "${plan.title}" with ${plan.steps.length} steps.`,
          },
        ],
        structuredContent: {
          kind: "task_plan",
          plan,
        },
      };
    },
  };
}

function normalizePlan(input: PublishTaskPlanInput): AgentTaskPlan {
  const planId = input.planId ?? `plan_${randomUUID()}`;
  const steps: AgentTaskStep[] = input.steps.map((step, index) => ({
    stepId: step.stepId ?? `${planId}_step_${index + 1}`,
    title: step.title,
    ...(step.description ? { description: step.description } : {}),
    status: "pending",
    ...(step.target ? { target: step.target } : {}),
    ...(step.agentName ? { agentName: step.agentName } : {}),
  }));

  return agentTaskPlanSchema.parse({
    planId,
    title: input.title,
    ...(input.summary ? { summary: input.summary } : {}),
    steps,
  });
}
