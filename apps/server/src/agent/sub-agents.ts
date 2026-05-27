import type { SubAgent } from "deepagents";

import { bridgeMcpToolToDeepAgent } from "../mcp/deepagents-bridge.js";
import { createGenerateVideoMcpTool } from "../mcp/tools/generate-video.js";

export function createAgentTeamSubAgents(): SubAgent[] {
  return [
    {
      name: "planner",
      description:
        "Break down a complex canvas request into prompt layers, task order, constraints, and a spatial container plan.",
      systemPrompt:
        "You are Planner for Cucumber Studio. Produce concise phased plans that preserve the user goal, project context, style intent, layout plan, execution tasks, and critique rules. Do not create final assets; define the work so other agents can execute it.",
    },
    {
      name: "designer",
      description:
        "Create or revise editable canvas structure, visual hierarchy, containers, and spatial relationships from an approved plan.",
      systemPrompt:
        "You are Designer for Cucumber Studio. Turn plans into editable AI-native canvas structures. Use containers as output units, preserve spatial context, respect styleguides and Brand Kit constraints, and keep text inside bounds.",
    },
    {
      name: "critic",
      description:
        "Review intermediate or final canvas output for brand fit, layout coherence, text overflow, tool result quality, and replayability.",
      systemPrompt:
        "You are Critic for Cucumber Studio. Inspect work against the run's critique rules. Report concrete issues and propose fix passes. Do not approve vague or non-editable outputs.",
    },
    {
      name: "coder_exporter",
      description:
        "Prepare code or export artifacts from selected canvas nodes when the task requires React, HTML, Vue, or file outputs.",
      systemPrompt:
        "You are Coder/Exporter for Cucumber Studio. Preserve design intent while producing exportable artifacts. Include warning metadata when fidelity is limited, and keep outputs traceable to canvas nodes.",
    },
    {
      name: "researcher",
      description:
        "Gather and summarize external or project facts only when factual context can materially change the canvas result.",
      systemPrompt:
        "You are Researcher for Cucumber Studio. Research narrowly, cite the useful facts in compact form, and convert findings into constraints or content that the canvas team can apply.",
    },
  ];
}

export function createVideoSubAgent(): SubAgent {
  return {
    name: "video_generate",
    description:
      "Generate a video based on a creative description. Video generation availability depends on provider configuration.",
    systemPrompt: `You are a video generation specialist. Given a description, generate a video using the generate_video tool and return the result.

If video generation is not available or fails, clearly explain the limitation.`,
    tools: [bridgeMcpToolToDeepAgent(createGenerateVideoMcpTool())],
  };
}
