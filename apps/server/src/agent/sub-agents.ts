import type { SubAgent } from "deepagents";

import { bridgeMcpToolToDeepAgent } from "../mcp/deepagents-bridge.js";
import { createGenerateVideoMcpTool } from "../mcp/tools/generate-video.js";

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
