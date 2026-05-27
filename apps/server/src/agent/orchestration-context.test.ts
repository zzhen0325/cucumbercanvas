import { describe, expect, it } from "vitest";

import {
  buildAgentRunContext,
  serializeAgentRunContextXml,
} from "./orchestration-context.js";

describe("agent orchestration context", () => {
  it("splits a run into stable prompt layers, styleguide, team, and model profile", () => {
    const context = buildAgentRunContext({
      brandKitId: "brand-kit-1",
      canvasSummary: "Canvas has one locked reference frame.",
      mentions: [
        {
          mentionType: "brand-kit-asset",
          id: "asset-1",
          label: "Primary Logo",
          assetType: "logo",
          fileUrl: "https://example.com/logo.png",
        },
      ],
      modelSpecifier: "google:gemini-2.5-flash",
      prompt: "Create a launch campaign canvas",
      workspaceSkills: [
        {
          name: "Brand Writer",
          description: "Write with brand voice.",
          content: "Follow the brand voice.",
          files: [],
          path: "/workspace-skills/brand-writer/SKILL.md",
        },
      ],
    });

    expect(context.promptContext.layers.map((layer) => layer.key)).toEqual([
      "user_goal",
      "project_context",
      "style_intent",
      "layout_plan",
      "execution_tasks",
      "critique_rules",
    ]);
    expect(context.styleguide).toMatchObject({
      id: "brand-kit-1",
      source: "brand-kit",
    });
    expect(context.team.members.map((member) => member.role)).toEqual([
      "planner",
      "designer",
      "critic",
      "coder_exporter",
      "researcher",
    ]);
    expect(context.modelProfiles[0]).toMatchObject({
      id: "google:gemini-2.5-flash",
      provider: "google",
      speedTier: "fast",
      supportsVision: true,
    });
  });

  it("serializes XML that the main agent can consume as first-class run context", () => {
    const context = buildAgentRunContext({
      modelSpecifier: "openai:gpt-4.1",
      prompt: "Make a storyboard",
    });

    const xml = serializeAgentRunContextXml(context);

    expect(xml).toContain('<agent_run_context version="agent-context-v1">');
    expect(xml).toContain('<layer key="user_goal"');
    expect(xml).toContain('<agent role="planner"');
    expect(xml).toContain('<model_profile id="openai:gpt-4.1"');
  });
});
