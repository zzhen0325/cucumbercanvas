import type { AvailableModel } from "../../generation/providers/registry.js";
import {
  createImageGenerateTool,
  type PersistImageFn,
  type SubmitImageJobFn,
} from "../../agent/tools/image-generate.js";
import type { CucumberMcpTool } from "../types.js";
import { wrapLegacyStructuredToolAsMcpTool } from "./legacy-tool-wrapper.js";

export function createGenerateImageMcpTool(deps?: {
  persistImage?: PersistImageFn;
  submitImageJob?: SubmitImageJobFn;
  availableModels?: AvailableModel[];
}): CucumberMcpTool {
  return wrapLegacyStructuredToolAsMcpTool(createImageGenerateTool(deps));
}
