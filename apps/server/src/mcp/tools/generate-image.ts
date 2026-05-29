import {
  type PersistImageFn,
  type SubmitImageJobFn,
  createImageGenerateTool,
} from "../../agent/tools/image-generate.js";
import type { AvailableModel } from "../../generation/providers/registry.js";
import type { CucumberMcpTool } from "../types.js";
import { wrapLegacyStructuredToolAsMcpTool } from "./legacy-tool-wrapper.js";

export function createGenerateImageMcpTool(deps?: {
  persistImage?: PersistImageFn;
  submitImageJob?: SubmitImageJobFn;
  availableModels?: AvailableModel[];
}): CucumberMcpTool {
  return wrapLegacyStructuredToolAsMcpTool(createImageGenerateTool(deps));
}
