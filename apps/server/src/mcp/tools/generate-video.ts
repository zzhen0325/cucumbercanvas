import {
  type SubmitVideoJobFn,
  createVideoGenerateTool,
} from "../../agent/tools/video-generate.js";
import type { AvailableModel } from "../../generation/providers/registry.js";
import type { CucumberMcpTool } from "../types.js";
import { wrapLegacyStructuredToolAsMcpTool } from "./legacy-tool-wrapper.js";

export function createGenerateVideoMcpTool(deps?: {
  submitVideoJob?: SubmitVideoJobFn;
  availableModels?: AvailableModel[];
}): CucumberMcpTool {
  return wrapLegacyStructuredToolAsMcpTool(createVideoGenerateTool(deps));
}
