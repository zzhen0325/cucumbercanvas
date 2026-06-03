import { describe, expect, it } from "vitest";

import type { AvailableModel } from "../../generation/providers/registry.js";
import {
  createImageGenerateTool,
  resolveImagePlacement,
} from "./image-generate.js";

const availableModels: AvailableModel[] = [
  {
    id: "bytedance/seedream-4.6",
    displayName: "Seedream 4.6",
    description: "Seedream image generation",
    provider: "seedream",
  },
];

describe("createImageGenerateTool", () => {
  it("normalizes a display-name model argument before submitting a job", async () => {
    let submittedModel: string | undefined;
    const imageTool = createImageGenerateTool({
      availableModels,
      submitImageJob: async (input) => {
        submittedModel = input.model;
        return { jobId: "job_1", error: "stubbed failure" };
      },
    });

    const result = await imageTool.invoke({
      title: "Christmas villain",
      prompt: "3d Christmas villain",
      model: "Seedream 4.6",
    });

    expect(submittedModel).toBe("bytedance/seedream-4.6");
    expect(result).toMatchObject({
      jobId: "job_1",
      jobType: "image_generation",
    });
  });

  it("falls back to the default model instead of throwing on unknown model text", async () => {
    let submittedModel: string | undefined;
    const imageTool = createImageGenerateTool({
      availableModels,
      submitImageJob: async (input) => {
        submittedModel = input.model;
        return { jobId: "job_2", error: "stubbed failure" };
      },
    });

    await expect(
      imageTool.invoke({
        title: "Christmas villain",
        prompt: "3d Christmas villain",
        model: "seedream-image",
      }),
    ).resolves.toMatchObject({
      jobId: "job_2",
      jobType: "image_generation",
    });
    expect(submittedModel).toBe("bytedance/seedream-4.6");
  });

  it("derives optional metadata instead of rejecting loose tool arguments", async () => {
    let submittedTitle: string | undefined;
    const imageTool = createImageGenerateTool({
      availableModels,
      submitImageJob: async (input) => {
        submittedTitle = input.title;
        return { jobId: "job_3", error: "stubbed failure" };
      },
    });

    await expect(
      imageTool.invoke({
        prompt: "cinematic 3d Christmas villain",
        model: "Seedream 4.6",
        quality: "high",
        outputFormat: "jpeg",
      }),
    ).resolves.toMatchObject({
      jobId: "job_3",
      jobType: "image_generation",
    });
    expect(submittedTitle).toBe("cinematic 3d Christmas villain");
  });

  it("preserves source aspect ratio when placement size is omitted", () => {
    expect(
      resolveImagePlacement({
        placementX: 100,
        placementY: 200,
        sourceWidth: 1024,
        sourceHeight: 576,
      }),
    ).toEqual({
      x: 100,
      y: 200,
      width: 512,
      height: 288,
    });
  });

  it("forwards placement and target container metadata to image jobs", async () => {
    let submitted:
      | {
          placementHeight?: number;
          placementWidth?: number;
          placementX?: number;
          placementY?: number;
          targetContainerId?: string;
        }
      | undefined;
    const imageTool = createImageGenerateTool({
      availableModels,
      submitImageJob: async (input) => {
        submitted = input;
        return { jobId: "job_4", error: "stubbed failure" };
      },
    });

    await imageTool.invoke({
      prompt: "A playful puppy",
      model: "Seedream 4.6",
      placementHeight: 512,
      placementWidth: 512,
      placementX: 44,
      placementY: 88,
      targetContainerId: "agent_image_result_1",
    });

    expect(submitted).toMatchObject({
      placementHeight: 512,
      placementWidth: 512,
      placementX: 44,
      placementY: 88,
      targetContainerId: "agent_image_result_1",
    });
  });
});
