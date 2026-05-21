import type { BackendProtocol } from "deepagents";
import { describe, expect, it } from "vitest";

import type { AvailableModel } from "../generation/providers/registry.js";
import { bridgeMcpToolToDeepAgent } from "./deepagents-bridge.js";
import { createCucumberMcpServer } from "./server.js";
import { createGenerateImageMcpTool } from "./tools/generate-image.js";

const availableModels: AvailableModel[] = [
  {
    id: "bytedance/seedream-4.6",
    displayName: "Seedream 4.6",
    description: "Seedream image generation",
    provider: "seedream",
  },
];

describe("createCucumberMcpServer", () => {
  it("registers the Phase 3 MCP tools", () => {
    const server = createCucumberMcpServer({} as BackendProtocol, {
      createUserClient: () => ({}),
    });

    expect(server.listTools().map((toolDef) => toolDef.name)).toEqual([
      "project_search",
      "inspect_canvas",
      "manipulate_canvas",
      "generate_image",
      "generate_video",
      "persist_sandbox_file",
    ]);
  });
});

describe("bridgeMcpToolToDeepAgent", () => {
  it("keeps generate_image usable through the MCP bridge", async () => {
    let submittedModel: string | undefined;
    const bridgedTool = bridgeMcpToolToDeepAgent(
      createGenerateImageMcpTool({
        availableModels,
        submitImageJob: async (input) => {
          submittedModel = input.model;
          return { jobId: "job_bridge", error: "stubbed failure" };
        },
      }),
    );

    const result = await bridgedTool.invoke({
      prompt: "3d Christmas villain",
      title: "Christmas villain",
      model: "Seedream 4.6",
    });

    expect(submittedModel).toBe("bytedance/seedream-4.6");
    expect(result).toMatchObject({
      jobId: "job_bridge",
      jobType: "image_generation",
    });
  });
});
